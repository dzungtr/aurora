import { Database } from "bun:sqlite";

/**
 * SQLite job registry for async generation jobs (bun:sqlite, zero new
 * dependencies, WAL mode). Write on submit, update on terminal state,
 * history retained (rows are never deleted). Pending records let a server
 * boot re-attach pollers so already-billed jobs survive a restart (ADR-0004).
 */
export type JobStatus = "pending" | "completed" | "failed" | "cancelled" | "expired";

export interface JobRecord {
  job_id: string;
  session_id: string;
  /** artifact_id passed at submit; honored by the eventual push (replace-in-place) */
  target_artifact_id: string | null;
  title: string;
  model: string;
  prompt: string;
  status: JobStatus;
  /** Actual generation cost in USD, recorded at the terminal state */
  usage_cost: number | null;
  /** Artifact id of the landed video (or failure) artifact */
  artifact_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateJobInput {
  job_id: string;
  session_id: string;
  target_artifact_id?: string;
  title: string;
  model: string;
  prompt: string;
}

export interface JobUpdate {
  status?: JobStatus;
  usage_cost?: number;
  artifact_id?: string;
}

export class JobRegistry {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      target_artifact_id TEXT,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      usage_cost REAL,
      artifact_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }

  /** Insert a pending job row at submit time. */
  createJob(input: CreateJobInput): JobRecord {
    const now = Date.now();
    this.db
      .query(
        `INSERT INTO jobs (job_id, session_id, target_artifact_id, title, model, prompt, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.job_id,
        input.session_id,
        input.target_artifact_id ?? null,
        input.title,
        input.model,
        input.prompt,
        now,
        now
      );
    return this.getJob(input.job_id)!;
  }

  getJob(jobId: string): JobRecord | null {
    return (
      (this.db.query("SELECT * FROM jobs WHERE job_id = ?").get(jobId) as JobRecord | null) ?? null
    );
  }

  /** Patch status/cost/artifact; bumps updated_at. Never deletes — history retained. */
  updateJob(jobId: string, patch: JobUpdate): void {
    const existing = this.getJob(jobId);
    if (!existing) return;
    this.db
      .query(
        `UPDATE jobs SET status = ?, usage_cost = ?, artifact_id = ?, updated_at = ? WHERE job_id = ?`
      )
      .run(
        patch.status ?? existing.status,
        patch.usage_cost ?? existing.usage_cost,
        patch.artifact_id ?? existing.artifact_id,
        Date.now(),
        jobId
      );
  }

  /** Jobs not yet terminal — pollers re-attach to these on server boot. */
  listPending(): JobRecord[] {
    return this.db
      .query("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at")
      .all() as JobRecord[];
  }

  close(): void {
    this.db.close();
  }
}
