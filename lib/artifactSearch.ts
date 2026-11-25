import type { ArtifactStore } from "./artifactStore";
import type { ChunkHit, SearchIndex } from "./searchIndex";

/**
 * Artifact search (spec #118, D3/D4/D10, ADR-0013): answer a query from the
 * Search index — keyword list, rank fusion, dead-hit filtering, snippets.
 * Keyword mode only until the embedding client lands; every response says so.
 */

export const SEARCH_TYPES = ["markdown", "mermaid", "chart", "ui", "image"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

/** Chunks taken from each ranked list before collapsing to one entry per artifact. */
export const CANDIDATE_POOL = 50;

/** Reciprocal rank fusion constant (D3). */
const RRF_K = 60;

const SNIPPET_CHARS = 200;

export const REASON_NOT_CONFIGURED = "embedding endpoint not configured";

export interface SearchRequest {
  query: string;
  session_id?: string;
  type?: SearchType;
  limit?: number;
}

export interface SearchHit {
  session_id: string;
  session_title: string;
  artifact_id: string;
  type: string;
  title: string;
  updated_at: string;
  snippet: string;
}

export interface SearchResponse {
  mode: "hybrid" | "keyword";
  reason?: string;
  total: number;
  hits: SearchHit[];
}

export class ArtifactSearch {
  constructor(private readonly deps: { index: SearchIndex; store: ArtifactStore }) {}

  /**
   * Precondition: `query` is non-empty after trimming. `limit` is clamped to
   * 1..50 (default 10). Never returns audio or video, and never returns an
   * artifact that is gone from the store; index entries found dead are removed.
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    const query = request.query.trim();
    const limit = Math.min(Math.max(request.limit ?? DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const filter = { session_id: request.session_id, type: request.type };

    const keywordList = this.deps.index.keywordSearch(query, filter, CANDIDATE_POOL);
    const candidates = fuse([keywordList]);
    const live = await this.dropDead(candidates);

    return {
      mode: "keyword",
      reason: REASON_NOT_CONFIGURED,
      total: live.length,
      hits: live.slice(0, limit).map((c) => toHit(c.best, query)),
    };
  }

  /** Keep candidates whose artifact still exists and is indexable; remove the dead from the index. */
  private async dropDead(candidates: Candidate[]): Promise<Candidate[]> {
    const live: Candidate[] = [];
    for (const candidate of candidates) {
      const { session_id, artifact_id } = candidate.best;
      let type: string | null = null;
      try {
        type = (await this.deps.store.getArtifactMeta(session_id, artifact_id))?.type ?? null;
      } catch {
        // an id the store refuses is as good as absent
      }
      if (type === null || type === "audio" || type === "video") {
        this.deps.index.removeArtifact(session_id, artifact_id);
      } else {
        live.push(candidate);
      }
    }
    return live;
  }
}

interface Candidate {
  best: ChunkHit;
  score: number;
}

/**
 * Reciprocal rank fusion over ranked chunk lists: each list collapses to one
 * entry per artifact at its best chunk's rank (1-based); score is the sum of
 * 1 / (60 + rank). Order: score descending, then updated_at descending.
 */
function fuse(lists: ChunkHit[][]): Candidate[] {
  const byArtifact = new Map<string, Candidate>();
  for (const list of lists) {
    const seen = new Set<string>();
    list.forEach((hit, i) => {
      const key = `${hit.session_id}\u0000${hit.artifact_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      const gain = 1 / (RRF_K + i + 1);
      const existing = byArtifact.get(key);
      if (existing) existing.score += gain;
      else byArtifact.set(key, { best: hit, score: gain });
    });
  }
  return [...byArtifact.values()].sort(
    (a, b) => b.score - a.score || b.best.updated_at.localeCompare(a.best.updated_at)
  );
}

function toHit(chunk: ChunkHit, query: string): SearchHit {
  return {
    session_id: chunk.session_id,
    session_title: chunk.session_title,
    artifact_id: chunk.artifact_id,
    type: chunk.type,
    title: chunk.title,
    updated_at: chunk.updated_at,
    // An image is indexed by title alone, so its title is its snippet.
    snippet: chunk.type === "image" ? chunk.title : makeSnippet(chunk.text, query),
  };
}

/**
 * About 200 characters of `text`, centred on the first query term found
 * (case-insensitive) else starting at the beginning; whitespace collapsed; an
 * ellipsis marks each cut end.
 */
export function makeSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_CHARS) return flat;
  const lower = flat.toLowerCase();
  let start = 0;
  for (const term of query.toLowerCase().split(/\s+/)) {
    if (term.length === 0) continue;
    const at = lower.indexOf(term);
    if (at < 0) continue;
    start = at + Math.floor(term.length / 2) - Math.floor(SNIPPET_CHARS / 2);
    break;
  }
  start = Math.max(0, Math.min(start, flat.length - SNIPPET_CHARS));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}
