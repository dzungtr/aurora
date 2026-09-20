import { mkdir, readFile, readdir } from "node:fs/promises";
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class InvalidArtifactIdError extends Error {
  constructor(id: string) {
    super(`Invalid id (allowed: alphanumerics, dot, underscore, hyphen, max 128 chars): ${id}`);
    this.name = "InvalidArtifactIdError";
  }
}

export interface SessionMeta {
  session_id: string;
  title: string;
  created_at: string;
  last_activity: string;
}

export interface ArtifactMeta {
  artifact_id: string;
  /** per-session monotonically increasing append order; stable sort key */
  seq: number;
  type: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface PushMarkdownInput {
  session_id: string;
  title: string;
  content: string;
  artifact_id?: string;
  session_title?: string;
}

export interface PushResult {
  session: SessionMeta;
  artifact: ArtifactMeta;
  /** true when the push created a new artifact, false when it replaced one in place */
  created: boolean;
}

/**
 * Session and artifact ids are used as directory names on disk, so they must
 * be restricted to a safe charset; anything else is rejected up front.
 */
export function validateId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new InvalidArtifactIdError(id);
  }
}

function atomicWriteFileSync(path: string, data: string) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, path);
}

export function sessionDir(baseDir: string, sessionId: string) {
  return join(baseDir, "sessions", sessionId);
}

export function artifactDir(baseDir: string, sessionId: string, artifactId: string) {
  return join(sessionDir(baseDir, sessionId), "artifacts", artifactId);
}

export class ArtifactStore {
  readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async getSession(sessionId: string): Promise<SessionMeta | null> {
    try {
      return JSON.parse(await readFile(join(sessionDir(this.baseDir, sessionId), "meta.json"), "utf-8"));
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<SessionMeta[]> {
    let entries;
    try {
      entries = await readdir(join(this.baseDir, "sessions"), { withFileTypes: true });
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.getSession(entry.name);
      if (meta) sessions.push(meta);
    }
    return sessions.sort((a, b) => b.last_activity.localeCompare(a.last_activity));
  }

  async getArtifactMeta(sessionId: string, artifactId: string): Promise<ArtifactMeta | null> {
    try {
      return JSON.parse(
        await readFile(join(artifactDir(this.baseDir, sessionId, artifactId), "meta.json"), "utf-8")
      );
    } catch {
      return null;
    }
  }

  async getArtifact(
    sessionId: string,
    artifactId: string
  ): Promise<{ meta: ArtifactMeta; content: string } | null> {
    const meta = await this.getArtifactMeta(sessionId, artifactId);
    if (!meta) return null;
    let content = "";
    try {
      content = await readFile(join(artifactDir(this.baseDir, sessionId, artifactId), "content.md"), "utf-8");
    } catch {
      // keep empty content rather than dropping the meta
    }
    return { meta, content };
  }

  async listArtifacts(sessionId: string): Promise<ArtifactMeta[]> {
    let entries;
    try {
      entries = await readdir(join(sessionDir(this.baseDir, sessionId), "artifacts"), {
        withFileTypes: true,
      });
    } catch {
      return [];
    }
    const artifacts: ArtifactMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await this.getArtifactMeta(sessionId, entry.name);
      if (meta) artifacts.push(meta);
    }
    return artifacts.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Push a markdown artifact. First push to an unseen session implicitly
   * creates it (session_title honored only at creation). Without artifact_id
   * a new artifact is appended; with an existing artifact_id it is replaced
   * in place (created_at preserved, updated_at bumped).
   */
  async pushMarkdown(input: PushMarkdownInput): Promise<PushResult> {
    validateId(input.session_id);
    if (input.artifact_id !== undefined) validateId(input.artifact_id);

    const now = new Date().toISOString();
    const sDir = sessionDir(this.baseDir, input.session_id);
    let session = await this.getSession(input.session_id);
    if (!session) {
      session = {
        session_id: input.session_id,
        title: input.session_title?.trim() || input.session_id,
        created_at: now,
        last_activity: now,
      };
      await mkdir(sDir, { recursive: true });
      atomicWriteFileSync(join(sDir, "meta.json"), JSON.stringify(session, null, 2));
    }

    const aDir = join(sDir, "artifacts");
    await mkdir(aDir, { recursive: true });

    const artifactId = input.artifact_id ?? randomUUID();
    const dir = artifactDir(this.baseDir, input.session_id, artifactId);
    const existing = await this.getArtifactMeta(input.session_id, artifactId);
    const seq = existing?.seq ?? (await this.listArtifacts(input.session_id)).length + 1;
    const artifact: ArtifactMeta = {
      artifact_id: artifactId,
      type: "markdown",
      seq,
      title: input.title,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    await mkdir(dir, { recursive: true });
    atomicWriteFileSync(join(dir, "meta.json"), JSON.stringify(artifact, null, 2));
    atomicWriteFileSync(join(dir, "content.md"), input.content);

    session = { ...session, last_activity: now };
    atomicWriteFileSync(join(sDir, "meta.json"), JSON.stringify(session, null, 2));

    return { session, artifact, created: !existing };
  }
}
