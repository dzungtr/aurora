import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobRegistry } from "./jobRegistry";

describe("JobRegistry", () => {
  let dir: string;
  let registry: JobRegistry;

  const makeRegistry = () => {
    dir = mkdtempSync(join(tmpdir(), "aurora-jobs-"));
    registry = new JobRegistry(join(dir, "generations.db"));
  };

  afterEach(() => {
    registry?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("creates a pending row and reads it back", () => {
    makeRegistry();
    const job = registry.createJob({
      job_id: "job-1",
      session_id: "sess",
      title: "Clip",
      model: "m",
      prompt: "p",
    });
    expect(job.status).toBe("pending");
    expect(job.usage_cost).toBeNull();
    expect(job.artifact_id).toBeNull();
    expect(job.target_artifact_id).toBeNull();
    expect(registry.getJob("job-1")!.session_id).toBe("sess");
    expect(registry.getJob("missing")).toBeNull();
  });

  it("persists target_artifact_id at submit for replace-in-place", () => {
    makeRegistry();
    registry.createJob({
      job_id: "job-1",
      session_id: "sess",
      target_artifact_id: "a1",
      title: "Clip",
      model: "m",
      prompt: "p",
    });
    expect(registry.getJob("job-1")!.target_artifact_id).toBe("a1");
  });

  it("updates status, cost, and artifact id; history is retained (no delete)", () => {
    makeRegistry();
    registry.createJob({ job_id: "job-1", session_id: "s", title: "t", model: "m", prompt: "p" });
    registry.updateJob("job-1", { status: "completed", usage_cost: 0.25, artifact_id: "a9" });
    const job = registry.getJob("job-1")!;
    expect(job.status).toBe("completed");
    expect(job.usage_cost).toBe(0.25);
    expect(job.artifact_id).toBe("a9");
    expect(job.updated_at).toBeGreaterThanOrEqual(job.created_at);
    // updateJob on an unknown id is a no-op, never an insert
    registry.updateJob("missing", { status: "failed" });
    expect(registry.getJob("missing")).toBeNull();
  });

  it("listPending returns only pending jobs for boot recovery", () => {
    makeRegistry();
    registry.createJob({ job_id: "j1", session_id: "s", title: "t", model: "m", prompt: "p" });
    registry.createJob({ job_id: "j2", session_id: "s", title: "t", model: "m", prompt: "p" });
    registry.updateJob("j2", { status: "failed" });
    expect(registry.listPending().map((j) => j.job_id)).toEqual(["j1"]);
  });

  it("reopens the same database file and sees prior rows (WAL persistence)", () => {
    dir = mkdtempSync(join(tmpdir(), "aurora-jobs-"));
    const path = join(dir, "generations.db");
    const first = new JobRegistry(path);
    first.createJob({ job_id: "j1", session_id: "s", title: "t", model: "m", prompt: "p" });
    first.close();
    const second = new JobRegistry(path);
    expect(second.getJob("j1")!.status).toBe("pending");
    second.close();
  });
});
