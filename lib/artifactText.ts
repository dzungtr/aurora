import type { ArtifactMeta } from "./artifactStore";

/**
 * Artifact text (spec #118, D8): reduce an artifact to the readable text the
 * Search index records, and split it into chunks. Pure by construction: no
 * fs, network, clock, or randomness, so the same input always yields the same
 * chunks.
 */

export interface Chunk {
  chunk_no: number;
  text: string;
}

/** Longest chunk, in characters. */
export const CHUNK_MAX_CHARS = 1500;

/** Characters shared between consecutive windows of a long text. */
export const CHUNK_OVERLAP_CHARS = 150;

/** Types that are never indexed (D13). */
const UNINDEXED_TYPES = new Set(["audio", "video"]);

const HEADING_LINE = /^#{1,6}(?=\s|$)/;

/**
 * The text a Search index records for one artifact, or null for audio and
 * video (never indexed). `content` is the artifact's text snapshot, "" for
 * image.
 */
export function searchableText(meta: Pick<ArtifactMeta, "type" | "title">, content: string): string | null {
  switch (meta.type) {
    case "audio":
    case "video":
      return null;
    case "image":
      return meta.title;
    case "chart":
      return withBody(meta.title, chartStringValues(content));
    case "ui":
      return withBody(meta.title, uiStringLiterals(content));
    default:
      // markdown, mermaid, and any type outside the known set: full source.
      return `${meta.title}\n\n${content}`;
  }
}

/** The chunks of `searchableText`: [] when the artifact is not indexed, else at least one. */
export function chunksFor(meta: Pick<ArtifactMeta, "type" | "title">, content: string): Chunk[] {
  const text = searchableText(meta, content);
  if (text === null) return [];
  const pieces = splitText(text, meta.type === "markdown");
  return pieces.map((piece, chunk_no) => ({ chunk_no, text: piece }));
}

/** The string a vector is made from: session and artifact title as context, then the chunk. */
export function embedInput(sessionTitle: string, artifactTitle: string, chunkText: string): string {
  return `${sessionTitle} › ${artifactTitle}\n\n${chunkText}`;
}

function withBody(title: string, lines: string[]): string {
  return lines.length === 0 ? title : `${title}\n\n${lines.join("\n")}`;
}

/** Every string value in the chart JSON in document order; keys and numbers dropped. */
function chartStringValues(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      if (value.length > 0) out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(parsed);
  return out;
}

/** Every non-empty double-quoted string literal in a UI program, unescaped, in source order. */
function uiStringLiterals(program: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < program.length) {
    if (program[i] !== '"') {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < program.length && program[j] !== '"') j += program[j] === "\\" ? 2 : 1;
    if (j >= program.length) break; // unterminated literal: nothing more to read
    const literal = program.slice(i, j + 1);
    const value = unescapeLiteral(literal);
    if (value.length > 0) out.push(value);
    i = j + 1;
  }
  return out;
}

function unescapeLiteral(literal: string): string {
  try {
    const value = JSON.parse(literal);
    if (typeof value === "string") return value;
  } catch {
    // raw control characters or a non-JSON escape: fall back to the inner text
  }
  return literal.slice(1, -1);
}

function splitText(text: string, markdown: boolean): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];
  const sections = markdown ? splitAtHeadings(text) : [text];
  const out: string[] = [];
  for (const section of sections) {
    if (section.length <= CHUNK_MAX_CHARS) {
      if (section.trim().length > 0) out.push(section);
    } else {
      out.push(...windows(section));
    }
  }
  return out.length > 0 ? out : [text.slice(0, CHUNK_MAX_CHARS)];
}

/** Split before every heading line (`#` to `######` at line start). */
function splitAtHeadings(text: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (HEADING_LINE.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  sections.push(current.join("\n"));
  return sections;
}

/** Windows of CHUNK_MAX_CHARS with CHUNK_OVERLAP_CHARS overlap, breaking at the last whitespace where one exists. */
function windows(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_MAX_CHARS, text.length);
    if (end < text.length) {
      const lastSpace = lastWhitespace(text, start, end);
      // A break that leaves less than the overlap would stall the window.
      if (lastSpace - start > CHUNK_OVERLAP_CHARS) end = lastSpace;
    }
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) out.push(piece);
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return out;
}

function lastWhitespace(text: string, start: number, end: number): number {
  for (let i = end - 1; i > start; i--) {
    if (/\s/.test(text[i]!)) return i;
  }
  return -1;
}
