import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DEFAULT_MEDIA_SIZE_CAP, type ArtifactStore } from "./artifactStore";

/**
 * Reference-image input variant (PRD #24, References). Exactly one variant is
 * present per entry; every variant resolves server-side to an inline base64
 * data URL because aurora is localhost and provider servers cannot fetch from
 * it (PRD #24 story 22).
 */
export interface ReferenceInput {
  /** Prior aurora image artifact, referenced by session + artifact id */
  artifact?: { session_id: string; artifact_id: string };
  /** Absolute local file path */
  path?: string;
  /** Inline base64-encoded image bytes (requires mime) */
  base64?: string;
  /** Mime type, required with base64 */
  mime?: string;
  /** Remote URL, fetched server-side */
  url?: string;
  /** Speech voice-cloning clips: optional transcript forwarded alongside the clip */
  transcript?: string;
}

/** Reference modality (spec #55): speech accepts audio clips, image stays image. */
export type ReferenceModality = "image" | "speech";

/** A reference resolved to the shape the provider APIs accept. */
export interface ResolvedReference {
  /** `data:<mime>;base64,<bytes>` */
  dataUrl: string;
  mime: string;
}

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function enforceCap(bytes: Uint8Array, cap: number): void {
  if (bytes.byteLength > cap) {
    throw new ReferenceError(
      `Reference is ${(bytes.byteLength / 1048576).toFixed(1)} MiB, over the ${(cap / 1048576).toFixed(0)} MiB cap. Fallback: downscale or re-encode the image before referencing it.`
    );
  }
}

/**
 * Resolve one reference entry to an inline data URL. Image bytes over the
 * size cap are rejected for every variant (URL, path, base64, and artifact
 * snapshots) — the resolved data URL is forwarded to the provider inline, so
 * an oversized reference would fail upstream.
 */
export async function resolveReference(
  ref: ReferenceInput,
  store: ArtifactStore,
  cap: number = DEFAULT_MEDIA_SIZE_CAP,
  modality: ReferenceModality = "image"
): Promise<ResolvedReference> {
  const variants = [
    ref.artifact !== undefined && "artifact",
    ref.path !== undefined && "path",
    ref.base64 !== undefined && "base64",
    ref.url !== undefined && "url",
  ].filter(Boolean);
  if (variants.length !== 1) {
    throw new ReferenceError(
      "Each reference must provide exactly one of: artifact (session_id + artifact_id), path, base64+mime, or url"
    );
  }

  if (ref.artifact) {
    const { session_id, artifact_id } = ref.artifact;
    const meta = await store.getArtifactMeta(session_id, artifact_id);
    if (!meta) {
      throw new ReferenceError(`Referenced artifact not found: ${artifact_id} in session ${session_id}`);
    }
    const expectedType = modality === "speech" ? "audio" : "image";
    if (meta.type !== expectedType) {
      const accepted = expectedType;
      throw new ReferenceError(
        `Referenced artifact ${artifact_id} is a ${meta.type} artifact, not ${modality === "image" ? "an image" : "an audio clip"} — provider ${modality} generation APIs accept ${accepted} references only. Reference an ${accepted} artifact (e.g. one produced by ${modality === "image" ? "create_image" : "push_audio"}) instead.`
      );
    }
    const blobPath = await store.blobPath(session_id, artifact_id);
    if (!blobPath) {
      throw new ReferenceError(`Referenced artifact ${artifact_id} has no snapshot blob to resolve`);
    }
    const bytes = new Uint8Array(await readFile(blobPath));
    enforceCap(bytes, cap);
    const mime = meta.mime ?? "application/octet-stream";
    return {
      dataUrl: toDataUrl(bytes, mime),
      mime,
    };
  }

  if (ref.path !== undefined) {
    if (!isAbsolute(ref.path)) {
      throw new ReferenceError("path reference must be an absolute filesystem path");
    }
    const file = Bun.file(ref.path);
    if (!(await file.exists())) {
      throw new ReferenceError(`Reference file not found: ${ref.path}`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    enforceCap(bytes, cap);
    const mime = file.type || "application/octet-stream";
    return { dataUrl: toDataUrl(bytes, mime), mime };
  }

  if (ref.base64 !== undefined) {
    if (!ref.mime) throw new ReferenceError("base64 reference requires a mime field");
    const bytes = Buffer.from(ref.base64, "base64");
    enforceCap(bytes, cap);
    return { dataUrl: toDataUrl(bytes, ref.mime), mime: ref.mime };
  }

  // url: fetched server-side; content-length is checked before download and
  // the read is capped too (content-length can be missing or lying).
  const res = await fetch(ref.url!);
  if (!res.ok) {
    throw new ReferenceError(`Fetching reference ${ref.url} failed: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    throw new ReferenceError(
      `Reference at ${ref.url} is ${(declared / 1048576).toFixed(1)} MiB, over the ${(cap / 1048576).toFixed(0)} MiB cap.`
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  enforceCap(bytes, cap);
  const mime = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  return { dataUrl: toDataUrl(bytes, mime), mime };
}
