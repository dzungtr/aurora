import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { writeFileSync, renameSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

/** Fails a push when base64/url media exceeds the shared size cap. */
export class MediaSizeCapError extends Error {
  constructor(size: number, cap: number) {
    super(
      `Media source is ${(size / 1048576).toFixed(1)} MiB, over the ${(cap / 1048576).toFixed(0)} MiB cap. Fallback: write the file to disk and push by local path.`
    );
    this.name = "MediaSizeCapError";
  }
}

export class MediaSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaSourceError";
  }
}

/** Default cap for base64 and url media pushes; path pushes are not capped. */
export const DEFAULT_MEDIA_SIZE_CAP = 50 * 1024 * 1024;

/**
 * Media source variants. Exactly one is present; all are snapshotted into the
 * artifact store on receipt so artifacts survive agent temp-file cleanup.
 */
export type MediaSource =
  | { path: string }
  | { base64: string; mime: string }
  | { url: string };

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
  /** media artifacts: mime type of the snapshot blob */
  mime?: string;
  /** media artifacts: snapshot byte size */
  size?: number;
}

export interface PushMediaInput {
  session_id: string;
  title: string;
  /** "image" or "video" — determines the tool and the UI renderer */
  type: "image" | "video";
  source: MediaSource;
  artifact_id?: string;
  session_title?: string;
  size_cap?: number;
}

export interface PushMarkdownInput {
  session_id: string;
  title: string;
  content: string;
  artifact_id?: string;
  session_title?: string;
  /** artifact kind, defaults to "markdown"; set to "mermaid" by pushMermaid */
  type?: string;
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

function atomicWriteBufferSync(path: string, data: Uint8Array) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
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
    // ids become path segments; reject traversal attempts before touching disk
    validateId(sessionId);
    validateId(artifactId);
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
   * First push to an unseen session implicitly creates it (session_title
   * honored only at creation). Returns the (possibly newly created) session
   * meta with last_activity bumped to `now`.
   */
  private async ensureSession(sessionId: string, sessionTitle: string | undefined, now: string) {
    const sDir = sessionDir(this.baseDir, sessionId);
    let session = await this.getSession(sessionId);
    if (!session) {
      session = {
        session_id: sessionId,
        title: sessionTitle?.trim() || sessionId,
        created_at: now,
        last_activity: now,
      };
      await mkdir(sDir, { recursive: true });
      atomicWriteFileSync(join(sDir, "meta.json"), JSON.stringify(session, null, 2));
      return session;
    }
    session = { ...session, last_activity: now };
    atomicWriteFileSync(join(sDir, "meta.json"), JSON.stringify(session, null, 2));
    return session;
  }

  /**
   * Snapshot media bytes into the store as an immutable blob. Sources:
   * local absolute path (uncapped), inline base64+mime, or remote url
   * (fetched server-side). base64 and url are subject to the shared size
   * cap — exceeding it fails with MediaSizeCapError.
   */
  async pushMedia(input: PushMediaInput): Promise<PushResult> {
    validateId(input.session_id);
    if (input.artifact_id !== undefined) validateId(input.artifact_id);

    const cap = input.size_cap ?? DEFAULT_MEDIA_SIZE_CAP;
    const { bytes, mime } = await snapshotMedia(input.source, cap);

    const now = new Date().toISOString();
    const session = await this.ensureSession(input.session_id, input.session_title, now);

    const aDir = join(sessionDir(this.baseDir, input.session_id), "artifacts");
    await mkdir(aDir, { recursive: true });

    const artifactId = input.artifact_id ?? randomUUID();
    const dir = artifactDir(this.baseDir, input.session_id, artifactId);
    const existing = await this.getArtifactMeta(input.session_id, artifactId);
    // max(seq)+1 (not length+1) so ordering stays stable after future deletions
    // and concurrent pushes cannot derive the same seq from a mid-list count
    const seq = existing?.seq
      ?? Math.max(0, ...(await this.listArtifacts(input.session_id)).map((a) => a.seq)) + 1;
    const artifact: ArtifactMeta = {
      artifact_id: artifactId,
      type: input.type,
      seq,
      title: input.title,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      mime,
      size: bytes.byteLength,
    };

    await mkdir(dir, { recursive: true });
    atomicWriteFileSync(join(dir, "meta.json"), JSON.stringify(artifact, null, 2));
    atomicWriteBufferSync(join(dir, "blob"), bytes);

    return { session, artifact, created: !existing };
  }

  /** Absolute path of a media artifact's snapshot blob, or null if none. */
  async blobPath(sessionId: string, artifactId: string): Promise<string | null> {
    const meta = await this.getArtifactMeta(sessionId, artifactId);
    if (!meta) return null;
    const p = join(artifactDir(this.baseDir, sessionId, artifactId), "blob");
    return (await Bun.file(p).exists()) ? p : null;
  }

  /** Remove a session and all its artifacts from disk. */
  async deleteSession(sessionId: string): Promise<boolean> {
    validateId(sessionId);
    if (!(await this.getSession(sessionId))) return false;
    await rm(sessionDir(this.baseDir, sessionId), { recursive: true, force: true });
    return true;
  }

  /**
   * Push a markdown artifact. First push to an unseen session implicitly
   * creates it (session_title honored only at creation). Without artifact_id
   * a new artifact is appended; with an existing artifact_id it is replaced
   * in place (created_at preserved, updated_at bumped).
   */
  async pushMarkdown(input: PushMarkdownInput): Promise<PushResult> {
    return this.pushArtifact(input);
  }

  /** Push a mermaid diagram artifact (same session/replace semantics as markdown). */
  async pushMermaid(input: {
    session_id: string;
    title: string;
    code: string;
    artifact_id?: string;
    session_title?: string;
  }): Promise<PushResult> {
    return this.pushArtifact({ ...input, content: input.code, type: "mermaid" });
  }

  private async pushArtifact(input: PushMarkdownInput): Promise<PushResult> {
    validateId(input.session_id);
    if (input.artifact_id !== undefined) validateId(input.artifact_id);

    const now = new Date().toISOString();
    const sDir = sessionDir(this.baseDir, input.session_id);
    const session = await this.ensureSession(input.session_id, input.session_title, now);

    const aDir = join(sDir, "artifacts");
    await mkdir(aDir, { recursive: true });

    const artifactId = input.artifact_id ?? randomUUID();
    const dir = artifactDir(this.baseDir, input.session_id, artifactId);
    const existing = await this.getArtifactMeta(input.session_id, artifactId);
    // max(seq)+1 (not length+1) so ordering stays stable after future deletions
    // and concurrent pushes cannot derive the same seq from a mid-list count
    const seq = existing?.seq
      ?? Math.max(0, ...(await this.listArtifacts(input.session_id)).map((a) => a.seq)) + 1;
    const artifact: ArtifactMeta = {
      artifact_id: artifactId,
      type: input.type ?? "markdown",
      seq,
      title: input.title,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    await mkdir(dir, { recursive: true });
    atomicWriteFileSync(join(dir, "meta.json"), JSON.stringify(artifact, null, 2));
    atomicWriteFileSync(join(dir, "content.md"), input.content);

    return { session, artifact, created: !existing };
  }
}

/** Read source bytes per variant, enforcing the size cap on base64 and url. */
async function snapshotMedia(
  source: MediaSource,
  cap: number
): Promise<{ bytes: Uint8Array; mime: string }> {
  if ("path" in source) {
    if (!isAbsolute(source.path)) {
      throw new MediaSourceError("path source must be an absolute filesystem path");
    }
    const file = Bun.file(source.path);
    if (!(await file.exists())) {
      throw new MediaSourceError(`Source file not found: ${source.path}`);
    }
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || "application/octet-stream" };
  }
  if ("base64" in source) {
    if (!source.mime) throw new MediaSourceError("base64 source requires a mime field");
    const bytes = Buffer.from(source.base64, "base64");
    if (bytes.byteLength > cap) throw new MediaSizeCapError(bytes.byteLength, cap);
    return { bytes, mime: source.mime };
  }
  // url: fetched server-side, size-capped. content-length is checked first so
  // oversized files are rejected before download; the read is capped too since
  // content-length can be missing or lying.
  const res = await fetch(source.url);
  if (!res.ok) throw new MediaSourceError(`Fetching ${source.url} failed: HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) throw new MediaSizeCapError(declared, cap);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > cap) throw new MediaSizeCapError(buf.byteLength, cap);
  return { bytes: buf, mime: res.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
}
