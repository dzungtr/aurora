import { createHash } from "node:crypto";
import { chunksFor } from "./artifactText";
import type { ArtifactStore } from "./artifactStore";
import type { LiveBus } from "./liveBus";
import type { SearchIndex } from "./searchIndex";

/**
 * Indexer (spec #118, D5, ADR-0013): keeps the Search index fed. Subscribed
 * in-process to the live bus, it indexes an artifact after the push that
 * announced it has returned — nothing here runs inside a push, and a failure
 * is logged and swallowed, never surfaced to the push or the process.
 */

export interface IndexerOptions {
  store: ArtifactStore;
  index: SearchIndex;
  /** Embedding client, or null when embedding is off (always null until semantic search lands). */
  embedding: null;
  log?: (message: string) => void;
}

export class Indexer {
  private readonly store: ArtifactStore;
  private readonly index: SearchIndex;
  private readonly log: (message: string) => void;
  /** Tail of the serial work chain: one unit of indexing work runs at a time. */
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private failureCount = 0;

  constructor(options: IndexerOptions) {
    this.store = options.store;
    this.index = options.index;
    this.log = options.log ?? ((m) => console.error(`indexer: ${m}`));
  }

  /** Index every artifact the live bus announces. Returns the unsubscribe function. */
  start(liveBus: LiveBus): () => void {
    return liveBus.subscribe((evt) => {
      void this.indexArtifact(evt.session_id, evt.artifact_id);
    });
  }

  /**
   * Bring the index in line with the store for one artifact: absent, audio or
   * video → no index entry; otherwise keyword rows for the current content.
   * Serialised behind earlier work; never rejects.
   */
  indexArtifact(session_id: string, artifact_id: string): Promise<void> {
    this.queued++;
    const run = this.tail.then(async () => {
      try {
        await this.syncArtifact(session_id, artifact_id);
      } catch (err) {
        this.failureCount++;
        this.log(`failed to index ${session_id}/${artifact_id}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.queued--;
      }
    });
    this.tail = run;
    return run;
  }

  /** Resolves once all queued work has finished. */
  async idle(): Promise<void> {
    while (this.queued > 0) await this.tail;
  }

  /** How many indexing attempts have failed since start. */
  get failures(): number {
    return this.failureCount;
  }

  private async syncArtifact(session_id: string, artifact_id: string): Promise<void> {
    const meta = await this.store.getArtifactMeta(session_id, artifact_id);
    const content =
      meta === null || meta.type === "audio" || meta.type === "video" || meta.type === "image"
        ? ""
        : ((await this.store.getArtifact(session_id, artifact_id))?.content ?? "");
    const chunks = meta === null ? [] : chunksFor(meta, content);
    if (meta === null || chunks.length === 0) {
      this.index.removeArtifact(session_id, artifact_id);
      return;
    }
    const session = await this.store.getSession(session_id);
    this.index.upsertArtifact({
      session_id,
      artifact_id,
      type: meta.type,
      title: meta.title,
      session_title: session?.title ?? session_id,
      updated_at: meta.updated_at,
      content_hash: contentHash(meta, content),
      chunks,
    });
  }
}

/** SHA-256 of `title + "\n" + content` for text types; of `title + "\n" + updated_at + "\n" + size` for images. */
export function contentHash(
  meta: { type: string; title: string; updated_at: string; size?: number },
  content: string
): string {
  const input =
    meta.type === "image" ? `${meta.title}\n${meta.updated_at}\n${meta.size}` : `${meta.title}\n${content}`;
  return createHash("sha256").update(input).digest("hex");
}
