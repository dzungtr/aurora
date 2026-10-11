import type { ArtifactStore } from "./artifactStore";
import type { LiveBus } from "./liveBus";
import { artifactEvent } from "./liveBus";
import type { JobRecord, JobRegistry } from "./jobRegistry";
import type { OpenRouterClient } from "./openrouter";

/**
 * Submit-and-notify video generation service (ADR-0004). `create_video` calls
 * submit() and returns immediately; background pollers drive jobs to a
 * terminal state and push the resulting artifact into the session. Pending
 * jobs persist in the registry, so a server boot re-attaches pollers via
 * recoverPending() and already-billed jobs still land after a restart.
 *
 * The completion/failure path is deliberately a single method (pollOnce's
 * terminal branches) so check_generation (#27) can reuse it without touching
 * the poller loop.
 */
export interface VideoJobServiceOptions {
  client: OpenRouterClient;
  registry: JobRegistry;
  store: ArtifactStore;
  liveBus?: LiveBus;
  /** Poll cadence (default 30s, per PRD #24) */
  pollIntervalMs?: number;
  /** Ceiling before a pending job is marked expired (default 15 minutes) */
  ceilingMs?: number;
  log?: (message: string) => void;
}

export interface PollOnceResult {
  terminal: boolean;
  /** Provider error message when the terminal state was a failure. */
  error?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_CEILING_MS = 15 * 60_000;

/** Provider statuses that mean the job can still move; everything else is terminal. */
const NON_TERMINAL_STATUSES = new Set(["pending", "in_progress"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VideoJobService {
  private stopped = false;
  private running = new Set<string>();
  /** Jobs whose terminal transition is in flight; keeps the poller and an eager check_generation from double-pushing. */
  private completing = new Set<string>();
  private pollIntervalMs: number;
  private ceilingMs: number;

  constructor(private options: VideoJobServiceOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.ceilingMs = options.ceilingMs ?? DEFAULT_CEILING_MS;
  }

  /**
   * Submit to the provider, persist the pending row, and start the poller.
   * The registry write happens before the tool responds, so a crash between
   * submit and the first poll still recovers on the next boot.
   */
  async submit(input: {
    session_id: string;
    target_artifact_id?: string;
    title: string;
    model: string;
    prompt: string;
    duration?: number;
    resolution?: string;
    aspect_ratio?: string;
    generate_audio?: boolean;
  }): Promise<JobRecord> {
    const submitted = await this.options.client.submitVideo({
      model: input.model,
      prompt: input.prompt,
      duration: input.duration,
      resolution: input.resolution,
      aspect_ratio: input.aspect_ratio,
      generate_audio: input.generate_audio,
    });
    const job = this.options.registry.createJob({
      job_id: submitted.jobId,
      session_id: input.session_id,
      target_artifact_id: input.target_artifact_id,
      title: input.title,
      model: input.model,
      prompt: input.prompt,
    });
    this.startPoller(job.job_id);
    return job;
  }

  /** Attach a background poller to one pending job (boot recovery path). */
  startPoller(jobId: string): void {
    void (async () => {
      const deadline = Date.now() + this.ceilingMs;
      this.running.add(jobId);
      try {
        while (Date.now() < deadline) {
          await sleep(this.pollIntervalMs);
          if (this.stopped || !this.running.has(jobId)) return;
          try {
            const done = await this.pollOnce(jobId);
            if (done.terminal) return;
          } catch (err) {
            // Transient poll errors (network, 5xx): keep polling until the ceiling.
            this.options.log?.(`video job ${jobId}: poll error: ${err}`);
          }
        }
        await this.expireJob(jobId);
      } finally {
        this.running.delete(jobId);
      }
    })();
  }

  /**
   * One status GET plus the terminal-state handling. `terminal` is true when
   * the job reached a terminal state; `error` carries the provider error
   * message on a failed transition. Shared by the poller loop and #27's
   * check_generation completion path.
   */
  async pollOnce(jobId: string): Promise<PollOnceResult> {
    const job = this.options.registry.getJob(jobId);
    if (!job || job.status !== "pending") return { terminal: true }; // already terminal or unknown
    if (this.completing.has(jobId)) return { terminal: false };
    const status = await this.options.client.getVideoJob(jobId);
    if (status.status === "completed") {
      this.completing.add(jobId);
      try {
        await this.completeJob(job, status.contentUrl, status.cost);
      } finally {
        this.completing.delete(jobId);
      }
      return { terminal: true };
    }
    if (!NON_TERMINAL_STATUSES.has(status.status)) {
      // failed / cancelled / any other provider terminal state
      const reason = status.status === "failed" ? "failed" : "cancelled";
      this.completing.add(jobId);
      try {
        await this.failJob(job, reason, status.error);
      } finally {
        this.completing.delete(jobId);
      }
      return { terminal: true, error: status.error };
    }
    return { terminal: false };
  }

  /** Boot-time recovery: re-attach pollers to every pending registry row. */
  recoverPending(): void {
    for (const job of this.options.registry.listPending()) {
      this.startPoller(job.job_id);
    }
  }

  /** Cancel all poller loops (server shutdown; tests). */
  stopAll(): void {
    this.stopped = true;
    this.running.clear();
  }

  /**
   * Completion path: download via the authenticated content endpoint, snapshot
   * as a video artifact (replace-in-place via target_artifact_id), broadcast
   * on the live bus, record artifact id + actual usage cost in the registry.
   */
  private async completeJob(job: JobRecord, contentUrl: string | undefined, cost?: number): Promise<void> {
    if (!contentUrl) {
      await this.failJob(job, "failed", "provider reported completion without a content URL");
      return;
    }
    const video = await this.options.client.downloadVideo(contentUrl);
    const result = await this.options.store.pushMedia({
      session_id: job.session_id,
      title: job.title,
      type: "video",
      source: { base64: Buffer.from(video.bytes).toString("base64"), mime: video.mime },
      artifact_id: job.target_artifact_id ?? undefined,
    });
    this.options.liveBus?.broadcast(artifactEvent(result));
    this.options.registry.updateJob(job.job_id, {
      status: "completed",
      usage_cost: cost,
      artifact_id: result.artifact.artifact_id,
    });
  }

  /**
   * Failure path: push a small markdown failure artifact into the session so
   * the human sees it in the stack, then reach the terminal registry state.
   */
  private async failJob(job: JobRecord, status: "failed" | "cancelled" | "expired", reason?: string): Promise<void> {
    const result = await this.options.store.pushMarkdown({
      session_id: job.session_id,
      title: `${job.title} — generation failed`,
      content:
        `# Video generation failed\n\n` +
        `- Job: \`${job.job_id}\`\n- Model: \`${job.model}\`\n` +
        `- Prompt: ${job.prompt}\n- Status: ${status}\n` +
        (reason ? `- Reason: ${reason}\n` : "") +
        `\nThe provider was billed for this job but no video was produced. Re-submit \`create_video\` to retry.`,
    });
    this.options.liveBus?.broadcast(artifactEvent(result));
    this.options.registry.updateJob(job.job_id, {
      status,
      artifact_id: result.artifact.artifact_id,
    });
  }

  /** Ceiling reached: the pending job expires with a visible failure artifact. */
  private async expireJob(jobId: string): Promise<void> {
    const job = this.options.registry.getJob(jobId);
    if (!job || job.status !== "pending") return;
    await this.failJob(job, "expired", `generation did not complete within ${Math.round(this.ceilingMs / 1000)}s`);
  }
}
