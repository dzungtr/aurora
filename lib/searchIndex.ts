import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Chunk } from "./artifactText";

/**
 * Search index (spec #118, D7/D14, ADR-0013): one SQLite file of chunked
 * artifact text, FTS5 keyword rows, and per-artifact state. Derived data —
 * nothing else in aurora depends on it, it can be deleted at any time, and a
 * schema-version mismatch drops and recreates it empty.
 */

/** Bump when any table changes; a mismatch drops and recreates the file's tables. */
export const SEARCH_SCHEMA_VERSION = 1;

/** Location of the index file inside an artifacts directory (beside `sessions/`, invisible to the store). */
export function searchIndexPath(artifactsDir: string): string {
  return join(artifactsDir, ".index", "search.db");
}

export interface IndexDoc {
  session_id: string;
  artifact_id: string;
  type: string;
  title: string;
  session_title: string;
  updated_at: string;
  content_hash: string;
  chunks: Chunk[];
}

export interface IndexEntry {
  session_id: string;
  artifact_id: string;
  type: string;
  content_hash: string;
  text_model: string | null;
  image_model: string | null;
}

export interface SearchFilter {
  session_id?: string;
  type?: string;
}

/** One matching chunk, best first within a list. */
export interface ChunkHit {
  session_id: string;
  artifact_id: string;
  type: string;
  title: string;
  session_title: string;
  updated_at: string;
  /** What matched: a text chunk, or (semantic slice) an image vector. Keyword hits are always "text". */
  kind: "text" | "image";
  text: string;
}

export class SearchIndex {
  private db: Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const row = this.db.query("PRAGMA user_version").get() as { user_version: number };
    if (row.user_version === SEARCH_SCHEMA_VERSION) return;
    this.db.transaction(() => {
      this.db.exec(`
        DROP TABLE IF EXISTS chunks_fts;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS artifacts;
        CREATE TABLE artifacts (
          session_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          session_title TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          text_model TEXT,
          image_model TEXT,
          image_vector BLOB,
          PRIMARY KEY (session_id, artifact_id)
        );
        CREATE TABLE chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          artifact_id TEXT NOT NULL,
          chunk_no INTEGER NOT NULL,
          text TEXT NOT NULL,
          vector BLOB
        );
        CREATE INDEX chunks_by_artifact ON chunks (session_id, artifact_id);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          title, text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);
      this.db.exec(`PRAGMA user_version = ${SEARCH_SCHEMA_VERSION}`);
    })();
  }

  /**
   * Record an artifact's chunks and keyword rows. Returns false and changes
   * nothing when the stored content hash already equals the doc's; otherwise
   * replaces the artifact's row, chunks and keyword rows (discarding any
   * vectors) in one transaction and returns true.
   */
  upsertArtifact(doc: IndexDoc): boolean {
    return this.db.transaction((): boolean => {
      const stored = this.db
        .query("SELECT content_hash FROM artifacts WHERE session_id = ? AND artifact_id = ?")
        .get(doc.session_id, doc.artifact_id) as { content_hash: string } | null;
      if (stored?.content_hash === doc.content_hash) return false;
      this.deleteArtifactRows(doc.session_id, doc.artifact_id);
      this.db
        .query(
          `INSERT INTO artifacts (session_id, artifact_id, type, title, session_title, updated_at, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(doc.session_id, doc.artifact_id, doc.type, doc.title, doc.session_title, doc.updated_at, doc.content_hash);
      const insertChunk = this.db.query(
        "INSERT INTO chunks (session_id, artifact_id, chunk_no, text) VALUES (?, ?, ?, ?)"
      );
      const insertFts = this.db.query("INSERT INTO chunks_fts (rowid, title, text) VALUES (?, ?, ?)");
      for (const chunk of doc.chunks) {
        const { lastInsertRowid } = insertChunk.run(doc.session_id, doc.artifact_id, chunk.chunk_no, chunk.text);
        insertFts.run(lastInsertRowid, doc.title, chunk.text);
      }
      return true;
    })();
  }

  removeArtifact(session_id: string, artifact_id: string): void {
    this.db.transaction(() => this.deleteArtifactRows(session_id, artifact_id))();
  }

  removeSession(session_id: string): void {
    this.db.transaction(() => {
      this.db
        .query("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE session_id = ?)")
        .run(session_id);
      this.db.query("DELETE FROM chunks WHERE session_id = ?").run(session_id);
      this.db.query("DELETE FROM artifacts WHERE session_id = ?").run(session_id);
    })();
  }

  entries(): IndexEntry[] {
    return this.db
      .query(
        "SELECT session_id, artifact_id, type, content_hash, text_model, image_model FROM artifacts ORDER BY session_id, artifact_id"
      )
      .all() as IndexEntry[];
  }

  /** Keyword matches, best (BM25) first, at most `limit` chunks. */
  keywordSearch(query: string, filter: SearchFilter, limit: number): ChunkHit[] {
    const match = ftsQuery(query);
    if (match === null) return [];
    const where = ["chunks_fts MATCH ?"];
    const params: (string | number)[] = [match];
    if (filter.session_id !== undefined) {
      where.push("c.session_id = ?");
      params.push(filter.session_id);
    }
    if (filter.type !== undefined) {
      where.push("a.type = ?");
      params.push(filter.type);
    }
    params.push(limit);
    const rows = this.db
      .query(
        `SELECT c.session_id, c.artifact_id, a.type, a.title, a.session_title, a.updated_at, c.text
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN artifacts a ON a.session_id = c.session_id AND a.artifact_id = c.artifact_id
         WHERE ${where.join(" AND ")}
         ORDER BY bm25(chunks_fts), c.id
         LIMIT ?`
      )
      .all(...params) as Omit<ChunkHit, "kind">[];
    return rows.map((row) => ({ ...row, kind: "text" as const }));
  }

  private deleteArtifactRows(session_id: string, artifact_id: string): void {
    this.db
      .query(
        "DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE session_id = ? AND artifact_id = ?)"
      )
      .run(session_id, artifact_id);
    this.db.query("DELETE FROM chunks WHERE session_id = ? AND artifact_id = ?").run(session_id, artifact_id);
    this.db.query("DELETE FROM artifacts WHERE session_id = ? AND artifact_id = ?").run(session_id, artifact_id);
  }
}

/**
 * Build an FTS5 MATCH expression from user input: whitespace-separated terms,
 * each double-quoted (inner quotes doubled) and joined with OR, so user input
 * is never parsed as FTS5 syntax. Null when the query has no terms.
 */
export function ftsQuery(query: string): string | null {
  const terms = query.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
}
