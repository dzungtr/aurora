import type { ArtifactMeta } from "./artifactStore";

/**
 * Type-mapped read mapping (spec #67 D4, ADR-0008). Every `read_artifact`
 * response is produced here, so a model only ever receives content it can
 * consume. Pure by construction: no fs, MCP, or network imports — the only
 * module-level state is the cap constants below.
 */

/** Per-call cap for the paged text types (mermaid/chart/ui); markdown is uncapped. */
export const TEXT_READ_CAP_BYTES = 256 * 1024;

/** Decoded cap for inline image blocks; larger blobs are named by URL instead. */
export const IMAGE_READ_CAP_BYTES = 4 * 1024 * 1024;

/** Artifact source for a read: text for source types, bytes for image, null for audio/video (bytes never cross MCP). */
export type ArtifactReadPayload = { text: string } | { bytes: Uint8Array } | null;

/** The MCP content blocks a read may emit (SDK CallToolResult content union, subset). */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ReadOptions {
  /** Byte offset to continue a capped text read from; taken from the truncation marker. */
  offset?: number;
  /** Absolute page URL for the artifact. Supplied by the caller — this module has no base URL. */
  deepLink?: string;
  /** Absolute HTTP URL of the artifact blob. Supplied by the caller. */
  blobUrl?: string;
}

const UNCAPPED_TEXT_TYPES = new Set(["markdown"]);
const UNSUPPORTED_TYPES = new Set(["audio", "video"]);

/**
 * The D4 type→response table. Tool descriptions import this verbatim so the
 * agent-facing contract cannot drift from the implementation.
 */
export const READ_ARTIFACT_TYPE_TABLE = [
  "read_artifact response by artifact type:",
  "- markdown → full text, never truncated",
  `- mermaid | chart | ui → text, capped at ${TEXT_READ_CAP_BYTES / 1024} KiB per call; the truncation marker states total size and the offset to continue from (pass offset=<n>)`,
  `- image → MCP image content block (base64) when ≤${IMAGE_READ_CAP_BYTES / 1048576} MiB decoded; above that a text error names the blob URL`,
  "- audio | video → unsupported-type text message with the deep link; bytes never cross MCP",
].join("\n");

/**
 * Map one artifact to the MCP content blocks its type allows.
 *
 * Precondition: `meta.type` is one of the seven known artifact types and the
 * payload shape matches it (text for markdown/mermaid/chart/ui, bytes for
 * image, null for audio/video).
 */
export function mapArtifactToContent(
  meta: ArtifactMeta,
  payload: ArtifactReadPayload,
  opts: ReadOptions = {}
): McpContent[] {
  if (UNSUPPORTED_TYPES.has(meta.type)) {
    return [{ type: "text", text: unsupportedTypeMessage(meta, opts) }];
  }
  if (meta.type === "image") {
    return imageContent(meta, bytesOf(payload), opts);
  }
  const text = textOf(payload);
  if (UNCAPPED_TEXT_TYPES.has(meta.type)) {
    return [{ type: "text", text }];
  }
  // mermaid/chart/ui — and, defensively, any type outside the known seven —
  // page through the 256 KiB cap rather than risking a context-blowing read.
  return cappedText(meta, text, opts.offset ?? 0);
}

function textOf(payload: ArtifactReadPayload): string {
  if (payload && "text" in payload) return payload.text;
  throw new TypeError("text artifact requires a {text} payload");
}

function bytesOf(payload: ArtifactReadPayload): Uint8Array {
  if (payload && "bytes" in payload) return payload.bytes;
  throw new TypeError("image artifact requires a {bytes} payload");
}

function imageContent(meta: ArtifactMeta, bytes: Uint8Array, opts: ReadOptions): McpContent[] {
  if (bytes.byteLength > IMAGE_READ_CAP_BYTES) {
    return [
      {
        type: "text",
        text:
          `Image artifact ${meta.artifact_id} ("${meta.title}") is ${mib(bytes.byteLength)} MiB decoded, ` +
          `over the ${mib(IMAGE_READ_CAP_BYTES)} MiB inline read cap, so it is not returned inline. ` +
          `Open the blob URL instead: ${opts.blobUrl ?? "(blob URL unavailable)"}`,
      },
    ];
  }
  return [
    {
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: meta.mime ?? "application/octet-stream",
    },
  ];
}

function cappedText(meta: ArtifactMeta, text: string, offset: number): McpContent[] {
  // Buffer, not TextEncoder: bun's TextEncoder miscounts non-ASCII bytes on
  // long strings (drops them), which would corrupt capped reads.
  const bytes = Buffer.from(text, "utf8");
  const total = bytes.length;
  const start = Math.max(0, offset);
  // A zero-offset read of an empty source is still a valid empty chunk, but a
  // nonzero offset into an empty source is past the end and must get guidance.
  if (start > 0 && start >= total) {
    return [
      {
        type: "text",
        text:
          `offset ${start} is past the end of ${meta.type} artifact ${meta.artifact_id} ` +
          `("${meta.title}"), which is ${total} bytes. Call read_artifact without offset, or with a smaller one.`,
      },
    ];
  }
  let end = Math.min(total, start + TEXT_READ_CAP_BYTES);
  // Never split a multi-byte UTF-8 sequence: back off to the previous character
  // boundary so the chunk decodes cleanly and the continuation offset aligns.
  while (end > start && (bytes[end]! & 0xc0) === 0x80) end--;
  const chunk = bytes.subarray(start, end).toString("utf8");
  if (end >= total) return [{ type: "text", text: chunk }];
  return [{ type: "text", text: chunk + truncationMarker(start, end, total) }];
}

function truncationMarker(start: number, end: number, total: number): string {
  return (
    `\n\n---\n[truncated: bytes ${start}-${end} of ${total} total; ` +
    `call read_artifact with offset=${end} to continue]`
  );
}

function unsupportedTypeMessage(meta: ArtifactMeta, opts: ReadOptions): string {
  const size = meta.size === undefined ? "unknown size" : `${meta.size} bytes`;
  return (
    `${meta.type} artifact ${meta.artifact_id} ("${meta.title}", ${meta.mime ?? "unknown mime"}, ${size}) ` +
    `cannot be read over MCP: aurora never sends ${meta.type} bytes to agents ` +
    `(no MCP content type can carry it reliably). Deep link: ${opts.deepLink ?? "(deep link unavailable)"}`
  );
}

function mib(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}
