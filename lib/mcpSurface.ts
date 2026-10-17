import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ArtifactStore, MediaSource, PushResult } from "./artifactStore";
import { DEFAULT_MEDIA_SIZE_CAP } from "./artifactStore";
import { artifactEvent, type LiveBus } from "./liveBus";
import { CHART_TYPES, chartContractError, chartPushSchema } from "./chartContract";
import {
  formatUiProgramErrors,
  generateUiToolDescription,
  PUSH_UI_CROSS_GUIDANCE,
  statementNames,
  validateUiProgram,
} from "./openuiLibrary";
import { mergeStatements } from "@openuidev/react-lang";
import {
  buildImageToolDescription,
  buildSpeechToolDescription,
  buildVideoToolDescription,
  defaultGenerationConfigPath,
  loadWhitelist,
  modelIds,
  preflightParamError,
  speechCloningPreflightError,
  videoPreflightError,
  type GenerationWhitelist,
  type ModelCatalogInfo,
  type WhitelistModelEntry,
} from "./whitelist";
import { OpenRouterClient } from "./openrouter";
import type { JobRegistry } from "./jobRegistry";
import { resolveReference, type ReferenceInput, type ReferenceModality } from "./referenceResolver";
import { sniffAudioMime } from "./audioMime";
import type { VideoJobService } from "./videoGeneration";

/**
 * Generation configuration injected through server options. The whitelist is
 * re-read per request (stateless handler) so config edits apply without a
 * restart; the catalog map is refreshed best-effort at startup.
 */
export interface GenerationOptions {
  apiKey: string;
  baseUrl: string;
  whitelistPath?: string;
  /** Shared, mutable: startup catalog enrichment writes price hints here */
  catalog?: Map<string, ModelCatalogInfo>;
  /** SQLite job registry location (default ~/.local/share/aurora/generations.db) */
  dbPath?: string;
  /** Poller cadence override (tests; default 30s per PRD #24) */
  pollIntervalMs?: number;
  /** Pending-job ceiling override (tests; default 15 minutes) */
  jobCeilingMs?: number;
  /** Constructed by the server at boot; create_video is registered only with one */
  videoService?: VideoJobService;
  /** Same SQLite registry the video service writes; image jobs are recorded here too */
  jobRegistry?: JobRegistry;
}

function resolveWhitelist(generation: GenerationOptions): GenerationWhitelist {
  return loadWhitelist(generation.whitelistPath ?? defaultGenerationConfigPath());
}

function registerCreateImageTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number,
  liveBus: LiveBus | undefined,
  generation: GenerationOptions
) {
  const whitelist = resolveWhitelist(generation);
  const client = new OpenRouterClient({ apiKey: generation.apiKey, baseUrl: generation.baseUrl });
  server.registerTool(
    "create_image",
    {
      title: "Generate image",
      description: buildImageToolDescription(whitelist, generation.catalog),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        prompt: z.string().min(1).describe("Text prompt describing the image to generate"),
        model: z
          .enum(modelIds(whitelist.image) as [string, ...string[]])
          .describe("OpenRouter image model from the active whitelist"),
        resolution: z.string().optional().describe("Resolution hint, validated against the model's capabilities"),
        aspect_ratio: z.string().optional().describe("Aspect ratio hint, validated against the model's capabilities"),
        quality: z.string().optional().describe("Quality hint, validated against the model's capabilities"),
        references: z
          .array(REFERENCE_SCHEMA)
          .max(MAX_REFERENCES)
          .optional()
          .describe("Optional reference images for image-to-image generation; resolved to inline data URLs server-side"),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, prompt, model, artifact_id, session_title, resolution, aspect_ratio, quality, references }) => {
      try {
        // Pre-flight: validate optional params for actionable errors instead of
        // upstream 400s (PRD #24 story 16). Caps come from the operator-curated
        // whitelist entry, not the OpenRouter catalog: the public catalog
        // exposes pricing only, so the whitelist is the only curated cap source
        // (amendment 2026-10-11 in issue #24).
        const entry: WhitelistModelEntry | undefined = resolveWhitelist(generation).image.find(
          (m) => m.id === model
        );
        if (!entry) return toolError(`model ${model} is not on the active whitelist`);
        for (const [param, value] of [
          ["resolution", resolution],
          ["aspect_ratio", aspect_ratio],
          ["quality", quality],
        ] as const) {
          if (value === undefined) continue;
          const key = param === "resolution" ? "resolutions" : param === "aspect_ratio" ? "aspect_ratios" : "qualities";
          const err = preflightParamError(entry, key, value);
          if (err) return toolError(err);
        }
        const generated = await client.generateImage({
          model,
          prompt,
          references: await resolveReferences(references as ReferenceInput[] | undefined, store, mediaSizeCap),
          resolution,
          aspect_ratio,
          quality,
        });
        const image = generated.images[0];
        const result = await store.pushMedia({
          session_id,
          title,
          type: "image",
          source: { base64: image.base64, mime: image.mime },
          artifact_id,
          session_title,
        });
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        // Image jobs complete inline but are recorded in the registry so
        // check_generation can look them up like any other generation job.
        let job_id: string | undefined;
        if (generation.jobRegistry) {
          job_id = `img-${crypto.randomUUID()}`;
          generation.jobRegistry.createJob({
            job_id,
            session_id,
            target_artifact_id: artifact_id,
            title,
            model,
            prompt,
          });
          generation.jobRegistry.updateJob(job_id, {
            status: "completed",
            usage_cost: generated.cost,
            artifact_id: artifact.artifact_id,
          });
        }
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Generated" : "Replaced"} image artifact ${artifact.artifact_id} in session ${session_id} with ${model}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
            model,
            cost: generated.cost,
            job_id,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerCreateSpeechTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number,
  liveBus: LiveBus | undefined,
  generation: GenerationOptions
) {
  const whitelist = resolveWhitelist(generation);
  const client = new OpenRouterClient({ apiKey: generation.apiKey, baseUrl: generation.baseUrl });
  server.registerTool(
    "create_speech",
    {
      title: "Generate speech",
      description: buildSpeechToolDescription(whitelist),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        input: z.string().min(1).describe("Text to speak; priced per input character"),
        model: z
          .enum(modelIds(whitelist.speech) as [string, ...string[]])
          .describe("OpenRouter speech model from the active whitelist"),
        voice: z
          .string()
          .optional()
          .describe("Provider voice id; omitted voices fill from the model's whitelist default_voice"),
        instructions: z.string().optional().describe("Delivery style guidance, passed through to the provider"),
        speed: z.number().positive().optional().describe("Playback speed multiplier, passed through to the provider"),
        response_format: z
          .enum(["mp3", "wav"])
          .default("mp3")
          .describe("Audio container for the generated speech (pcm excluded: unplayable in the browser)") as any,
        input_references: z
          .array(SPEECH_REFERENCE_SCHEMA)
          .max(3)
          .optional()
          .describe(
            "Optional voice-cloning clips (1-3; audio artifacts, files, base64, or urls, each with an optional transcript); requires a cloning-capable model"
          ),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({
      session_id,
      title,
      input,
      model,
      voice,
      instructions,
      speed,
      response_format,
      input_references,
      artifact_id,
      session_title,
    }) => {
      try {
        const entry: WhitelistModelEntry | undefined = resolveWhitelist(generation).speech.find(
          (m) => m.id === model
        );
        if (!entry) return toolError(`model ${model} is not on the active whitelist`);
        // Voice-cloning preflight (spec #55 story 17): fail fast and legibly
        // before any provider spend.
        const refs = (input_references ?? []) as ReferenceInput[];
        const cloningError = speechCloningPreflightError(entry, refs.length > 0);
        if (cloningError) return toolError(cloningError);
        // Omitted voice fills from the whitelist entry; without it the
        // provider 400s (verified live during the design session).
        const resolvedVoice = voice ?? entry.default_voice;
        const resolved = [];
        const transcripts: string[] = [];
        for (const ref of refs) {
          // Speech references are modality-aware: audio artifacts/clips are
          // accepted (images stay on the image path).
          resolved.push((await resolveReference(ref, store, mediaSizeCap, "speech")).dataUrl);
          if (ref.transcript !== undefined) transcripts.push(ref.transcript);
        }
        const generated = await client.generateSpeech({
          model,
          input,
          voice: resolvedVoice,
          instructions,
          speed,
          response_format: response_format ?? "mp3",
          references: resolved.length > 0 ? resolved : undefined,
          referenceTranscripts: transcripts.length > 0 ? transcripts : undefined,
        });
        const result = await store.pushMedia({
          session_id,
          title,
          type: "audio",
          source: {
            base64: Buffer.from(generated.bytes).toString("base64"),
            // Sniffed from bytes at push; content-type header is the fallback.
            mime: generated.mime,
          },
          artifact_id,
          session_title,
        });
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        // Speech jobs complete inline but are recorded in the registry so
        // check_generation can look them up like any other generation job.
        let job_id: string | undefined;
        if (generation.jobRegistry) {
          job_id = `speech-${crypto.randomUUID()}`;
          generation.jobRegistry.createJob({
            job_id,
            session_id,
            target_artifact_id: artifact_id,
            title,
            model,
            prompt: input,
          });
          generation.jobRegistry.updateJob(job_id, {
            status: "completed",
            artifact_id: artifact.artifact_id,
          });
        }
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Generated" : "Replaced"} speech artifact ${artifact.artifact_id} in session ${session_id} with ${model}${resolvedVoice ? ` (voice ${resolvedVoice})` : ""}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
            model,
            ...(resolvedVoice !== undefined ? { voice: resolvedVoice } : {}),
            job_id,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerCreateVideoTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number,
  liveBus: LiveBus | undefined,
  generation: GenerationOptions
) {
  const whitelist = resolveWhitelist(generation);
  const service = generation.videoService!;
  server.registerTool(
    "create_video",
    {
      title: "Generate video",
      description: buildVideoToolDescription(whitelist, generation.catalog),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        prompt: z.string().min(1).describe("Text prompt describing the video to generate"),
        model: z
          .enum(modelIds(whitelist.video) as [string, ...string[]])
          .describe("OpenRouter video model from the active whitelist"),
        duration: z.number().int().positive().optional().describe("Video duration in seconds, validated against the model's capabilities"),
        resolution: z.string().optional().describe("Resolution hint, validated against the model's capabilities"),
        aspect_ratio: z.string().optional().describe("Aspect ratio hint, validated against the model's capabilities"),
        generate_audio: z.boolean().optional().describe("Generate audio alongside the video"),
        references: z
          .array(REFERENCE_SCHEMA.extend({ role: REFERENCE_ROLES.optional() }))
          .max(MAX_REFERENCES)
          .optional()
          .describe(
            "Optional image references; role `style` (default) guides style, `first_frame`/`last_frame` set image-to-video frames"
          ),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, prompt, model, duration, resolution, aspect_ratio, generate_audio, references, artifact_id, session_title }) => {
      try {
        // Pre-flight validation against the model's whitelist entry caps for
        // actionable errors instead of upstream 400s (PRD #24 story 16).
        const entry: WhitelistModelEntry | undefined = resolveWhitelist(generation).video.find(
          (m) => m.id === model
        );
        if (!entry) return toolError(`model ${model} is not on the active whitelist`);
        const preflightError = videoPreflightError(entry, { duration, resolution, aspect_ratio, generate_audio });
        if (preflightError) return toolError(preflightError);
        // Role routing (PRD #24 References): `style` (default) feeds the
        // provider's reference list (reference-to-video); first/last frame
        // roles feed the frame-image list (image-to-video).
        const inputReferences: string[] = [];
        const frameImages: { url: string; frame_type: "first_frame" | "last_frame" }[] = [];
        for (const ref of (references ?? []) as (ReferenceInput & { role?: string })[]) {
          const { dataUrl } = await resolveReference(ref, store, mediaSizeCap);
          if (ref.role === "first_frame" || ref.role === "last_frame") {
            frameImages.push({ url: dataUrl, frame_type: ref.role });
          } else {
            inputReferences.push(dataUrl);
          }
        }
        // Immediate response: registry row is pending before we return; the
        // background poller owns everything after this point.
        const job = await service.submit({
          session_id,
          target_artifact_id: artifact_id,
          title,
          model,
          prompt,
          duration,
          resolution,
          aspect_ratio,
          generate_audio,
          inputReferences: inputReferences.length > 0 ? inputReferences : undefined,
          frameImages: frameImages.length > 0 ? frameImages : undefined,
        });
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const priceHint = generation.catalog?.get(model)?.priceHint ?? entry.note;
        const text =
          `Submitted video generation job ${job.job_id} with ${model}` +
          (priceHint ? ` (~${priceHint})` : "") +
          `. It will appear in session ${session_id} when complete. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            job_id: job.job_id,
            deep_link,
            model,
            price_hint: priceHint,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerCheckGenerationTool(
  server: McpServer,
  baseUrl: string,
  generation: GenerationOptions
) {
  const registry = generation.jobRegistry!;
  const service = generation.videoService;
  server.registerTool(
    "check_generation",
    {
      title: "Check generation job",
      description:
        "Check the status of a generation job (create_video / create_image). " +
        "Returns {status, artifact_id?, deep_link?, cost?}. If the job completed but the " +
        "background poller has not processed it yet, this check drives the completion " +
        "(artifact push, live update, registry update) so the artifact lands immediately.",
      inputSchema: {
        job_id: ID_SCHEMA.describe(
          "Job id as returned by create_video (or create_image's job_id)"
        ),
      },
    },
    async ({ job_id }) => {
      try {
        const job = registry.getJob(job_id);
        if (!job) {
          return toolError(
            `Unknown job id ${job_id}: no generation job with that id exists in the registry. ` +
              "Use the job_id returned by create_video."
          );
        }
        // Pending job: a single live status GET; if the provider already
        // reached a terminal state the shared completion path runs here, so
        // an eager agent gets its artifact without waiting for the poller.
        let providerError: string | undefined;
        if (job.status === "pending" && service) {
          const poll = await service.pollOnce(job_id);
          providerError = poll.error;
        }
        const current = registry.getJob(job_id)!;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(current.session_id)}`;
        const text =
          `Generation job ${job_id} is ${current.status}` +
          (current.artifact_id ? `; artifact ${current.artifact_id} in session ${current.session_id}. Preview: ${deep_link}` : `.`) +
          (providerError ? ` Provider error: ${providerError}` : "");
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            status: current.status,
            artifact_id: current.artifact_id ?? undefined,
            deep_link: current.artifact_id ? deep_link : undefined,
            cost: current.usage_cost ?? undefined,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

export const MCP_PATH = "/mcp";

/**
 * Tool-level error: returned as an isError result with an actionable message
 * so the agent can fall back (e.g. write to disk and push by path) instead of
 * the transport failing.
 */
function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const ID_SCHEMA = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "alphanumerics, dot, underscore, hyphen; max 128 chars");

const OPTIONAL_ID_SCHEMA = ID_SCHEMA.optional().describe(
  "Replace an existing artifact in place when provided"
);

const SESSION_TITLE_SCHEMA = z
  .string()
  .optional()
  .describe("Session title, honored only when the session is created by this push");

/** Media source: exactly one variant. Validated by the store on push. */
const MEDIA_SOURCE_SCHEMA = z
  .object({
    path: z.string().optional().describe("Absolute local file path to snapshot"),
    base64: z.string().optional().describe("Inline base64-encoded media bytes (size-capped)"),
    mime: z.string().optional().describe("Mime type, required with base64"),
    url: z.string().optional().describe("Remote URL, fetched server-side (size-capped)"),
  })
  .describe("Media source: provide exactly one of path, base64+mime, or url");

const MAX_REFERENCES = 8;

/**
 * Generation reference-image entry: exactly one variant is present per
 * entry (validated by the resolver at call time). Artifact references must
 * be image artifacts; all variants resolve to inline data URLs server-side.
 */
const REFERENCE_SCHEMA = z
  .object({
    artifact: z
      .object({ session_id: ID_SCHEMA, artifact_id: ID_SCHEMA })
      .optional()
      .describe("Prior aurora image artifact to reference by id"),
    path: z.string().optional().describe("Absolute local image file path"),
    base64: z.string().optional().describe("Inline base64-encoded image bytes"),
    mime: z.string().optional().describe("Mime type, required with base64"),
    url: z.string().optional().describe("Remote image URL"),
  })
  .describe("Reference image: provide exactly one of artifact, path, base64+mime, or url");

const REFERENCE_ROLES = z
  .enum(["style", "first_frame", "last_frame"])
  .describe("Reference role; defaults to style");

/**
 * Speech voice-cloning reference entry (spec #57): the shared reference
 * schema plus an optional per-clip transcript forwarded as a paired text
 * part; resolver accepts audio clips on the speech modality.
 */
const SPEECH_REFERENCE_SCHEMA = REFERENCE_SCHEMA.extend({
  transcript: z.string().optional().describe("Optional clip transcript forwarded to the model alongside the audio"),
});

/** Resolve every reference entry to an inline data URL for the provider. */
async function resolveReferences(
  refs: ReferenceInput[] | undefined,
  store: ArtifactStore,
  mediaSizeCap: number
): Promise<string[] | undefined> {
  if (!refs || refs.length === 0) return undefined;
  const resolved: string[] = [];
  for (const ref of refs) {
    resolved.push((await resolveReference(ref, store, mediaSizeCap)).dataUrl);
  }
  return resolved;
}

/**
 * push_ui (issue #39, spec #37): the agent composes a complete openui-lang
 * program against the aurora component library (lib/openuiLibrary.ts). The
 * description is generated from that library definition — never hand-written.
 * Validation runs at push time before snapshot; invalid or dropped statements
 * are returned as structured, self-correcting errors.
 */
function registerPushUiTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  liveBus?: LiveBus
) {
  server.registerTool(
    "push_ui",
    {
      title: "Push UI dashboard artifact",
      description: generateUiToolDescription(),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        program: z
          .string()
          .min(1)
          .describe("Complete openui-lang program (one statement per line) against the aurora component library"),
        mode: z
          .enum(["replace", "patch"])
          .optional()
          .describe(
            '"replace" (default): program is the complete replacement. "patch": program holds only changed/new statements; they are merged server-side into the artifact_id snapshot by statement name (same name replaces, new name adds, missing kept) and the MERGED full program is stored as the new snapshot. Requires artifact_id.'
          ),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, program, mode, artifact_id, session_title }) => {
      try {
        // Patch mode (issue #41): merge server-side against the previous
        // snapshot's source; the merged full program becomes the new immutable
        // snapshot (ADR 0002 — deltas are never stored).
        let merged = false;
        if (mode === "patch") {
          if (!artifact_id) {
            return toolError(
              'mode "patch" requires artifact_id — the snapshot to merge into. ' +
                "Push a full program (no mode) first, or omit mode to replace."
            );
          }
          const existing = await store.getArtifact(session_id, artifact_id);
          if (!existing) {
            return toolError(
              `Artifact ${artifact_id} not found in session ${session_id} — nothing to patch. ` +
                "Push a full program instead, or check the artifact_id."
            );
          }
          if (existing.meta.type !== "ui") {
            return toolError(
              `Artifact ${artifact_id} is a ${existing.meta.type} artifact — patch mode applies only to ui artifacts. ` +
                "Use a full push (no mode) to replace it with a UI artifact."
            );
          }
          program = mergeStatements(existing.content, program);
          merged = true;
        }
        // Push-time validation before snapshot (spec #37). Every invalid or
        // dropped statement is surfaced — never silently hidden. In patch mode
        // this validates the merged result, so caps apply to the merge too.
        const errors = validateUiProgram(program);
        if (errors.length > 0) return toolError(formatUiProgramErrors(errors));
        const result = await store.pushUi({ session_id, title, program, artifact_id, session_title });
        // Thin live-update event: clients refetch content over HTTP.
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${merged ? "Patched" : created ? "Pushed" : "Replaced"} UI artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            merged,
            // Patch merge is by name; echoing the final statement-name list
            // lets the agent chain patches without holding the old program.
            ...(merged ? { statement_names: statementNames(program) } : {}),
            deep_link,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerMediaTool(
  server: McpServer,
  name: "push_image" | "push_video" | "push_audio",
  artifactType: "image" | "video" | "audio",
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number,
  liveBus?: LiveBus
) {
  server.registerTool(
    name,
    {
      title: `Push ${artifactType} artifact`,
      description:
        `Push an ${artifactType} artifact to an aurora preview session. ` +
        "Source is an absolute local path, inline base64+mime, or a remote url; " +
        "bytes are snapshotted into the store on receipt. " +
        "Creates the session implicitly on first push. Returns a deep link.",
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        source: MEDIA_SOURCE_SCHEMA,
        // Audio carries an optional transcript (lyrics, narration text)
        // persisted with the artifact metadata (spec #55 decision 10).
        ...(artifactType === "audio"
          ? { transcript: z.string().optional().describe("Optional transcript (lyrics, narration text) shown with the audio player") }
          : {}),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, source, artifact_id, session_title, transcript }) => {
      try {
        const result = await store.pushMedia({
          session_id,
          title,
          type: artifactType,
          source: source as MediaSource,
          artifact_id,
          session_title,
          size_cap: mediaSizeCap,
          transcript,
        });
        // Thin live-update event: clients refetch content over HTTP.
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Pushed" : "Replaced"} artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
            // Audio push results echo the transcript (spec #55 decision 10).
            ...(artifact.transcript !== undefined ? { transcript: artifact.transcript } : {}),
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/**
 * Handle one request to the MCP endpoint. Stateless mode: a fresh transport
 * (and server instance) per request, no session id issued, per the official
 * SDK guidance for serverless/stateless Streamable HTTP.
 */
export async function handleMcpRequest(
  req: Request,
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number = DEFAULT_MEDIA_SIZE_CAP,
  liveBus?: LiveBus,
  generation?: GenerationOptions
) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = new McpServer(
    { name: "aurora", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  const pushTextTool = (
    name: string,
    title: string,
    description: string,
    valueField: "content" | "code",
    valueDescription: string,
    push: (input: { session_id: string; title: string; artifact_id?: string; session_title?: string }) => Promise<PushResult>
  ) => {
    // Shared shape: session/title/value + optional artifact_id/session_title;
    // response carries the preview deep link either way.
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          session_id: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "session_id: alphanumerics, dot, underscore, hyphen; max 128 chars"),
          title: z.string().min(1).describe("Human-visible artifact title"),
          [valueField]: z.string().min(1).describe(valueDescription),
          artifact_id: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
            .optional()
            .describe("Replace an existing artifact in place when provided"),
          session_title: z
            .string()
            .optional()
            .describe("Session title, honored only when the session is created by this push"),
        },
      },
      async (args) => {
        const { session_id, title, artifact_id, session_title } = args as {
          session_id: string;
          title: string;
          artifact_id?: string;
          session_title?: string;
        };
        const result = await push(args as any);
        // Thin live-update event: clients refetch content over HTTP.
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Pushed" : "Replaced"} artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
          },
        };
      }
    );
  };

  pushTextTool(
    "push_markdown",
    "Push markdown artifact",
    "Push a markdown artifact to an aurora preview session. Creates the session implicitly on first push. Returns a deep link the human can open.",
    "content",
    "Markdown source",
    (input) => store.pushMarkdown(input as any)
  );

  pushTextTool(
    "push_mermaid",
    "Push mermaid diagram",
    "Push a mermaid diagram (as source code) to an aurora preview session, rendered with the house dark theme. Creates the session implicitly on first push. Returns a deep link the human can open.",
    "code",
    "Mermaid diagram source (e.g. 'flowchart TD; A --> B')",
    (input) => store.pushMermaid(input as any)
  );

  registerMediaTool(server, "push_image", "image", store, baseUrl, mediaSizeCap, liveBus);
  registerMediaTool(server, "push_video", "video", store, baseUrl, mediaSizeCap, liveBus);
  registerMediaTool(server, "push_audio", "audio", store, baseUrl, mediaSizeCap, liveBus);

  // Generation tools are registered only when an OpenRouter API key is
  // configured (env var read once at server start, or injected via options).
  if (generation?.apiKey) {
    registerCreateImageTool(server, store, baseUrl, mediaSizeCap, liveBus, generation);
    // Speech needs at least one whitelisted speech model for a valid enum.
    if (modelIds(resolveWhitelist(generation).speech).length > 0) {
      registerCreateSpeechTool(server, store, baseUrl, mediaSizeCap, liveBus, generation);
    }
    // The video tool needs the boot-owned poller service (submit-and-notify);
    // it also needs at least one whitelisted video model for a valid enum.
    if (generation.videoService && modelIds(resolveWhitelist(generation).video).length > 0) {
      registerCreateVideoTool(server, store, baseUrl, mediaSizeCap, liveBus, generation);
    }
    // Job status lookup needs the boot-owned registry (video + image jobs).
    if (generation.jobRegistry) {
      registerCheckGenerationTool(server, baseUrl, generation);
    }
  }

  server.registerTool(
    "push_chart",
    {
      title: "Push chart artifact",
      description:
        'Push a data chart rendered with aurora\'s house theme. chart_type is one of ' +
        CHART_TYPES.join("|") +
        '. data must match the per-type contract: pie → {kind:"pie", points:[{label,value}]}; bar/column → {kind:"categorical", categories:[string], series:[{name, values:[number]}]}; line/area → {kind:"line", x:[string|number], series:[{name, values:[number]}]}; scatter → {kind:"scatter", series:[{name, points:[[x,y]]}]}. Agents never send raw chart-lib specs. ' +
        PUSH_UI_CROSS_GUIDANCE,
      inputSchema: {
        session_id: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "session_id: alphanumerics, dot, underscore, hyphen; max 128 chars"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        chart_type: z.enum(CHART_TYPES).describe("Chart kind aurora renders under its house theme"),
        data: chartPushSchema.shape.data.describe(
          'Typed data contract; the `kind` field must match chart_type (categorical for bar/column, line for line/area)'
        ),
        artifact_id: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
          .optional()
          .describe("Replace an existing artifact in place when provided"),
        session_title: z
          .string()
          .optional()
          .describe("Session title, honored only when the session is created by this push"),
      },
    },
    async ({ session_id, title, chart_type, data, artifact_id, session_title }) => {
      const contractError = chartContractError(chart_type, data);
      if (contractError) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: contractError }],
        };
      }
      const result = await store.pushChart({
        session_id,
        title,
        chart_type,
        data,
        artifact_id,
        session_title,
      });
      // Thin live-update event: clients refetch content over HTTP.
      liveBus?.broadcast(artifactEvent(result));
      const { artifact, created } = result;
      const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
      const text = `${created ? "Pushed" : "Replaced"} chart artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
      return {
        content: [{ type: "text" as const, text }],
        structuredContent: {
          session_id,
          artifact_id: artifact.artifact_id,
          created,
          deep_link,
        },
      };
    }
  );

  registerPushUiTool(server, store, baseUrl, liveBus);

  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    // Stateless mode: the transport must not be closed before its response
    // body (often an SSE stream) is fully written. Buffer the body here and
    // re-emit it as a plain Response so the route handler can return it safely.
    const body = res.body ? await res.text() : null;
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } finally {
    await transport.close();
    await server.close();
  }
}
