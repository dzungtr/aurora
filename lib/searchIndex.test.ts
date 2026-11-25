import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SearchIndex, SEARCH_SCHEMA_VERSION, searchIndexPath, ftsQuery, type IndexDoc } from "./searchIndex";

const dirs: string[] = [];
function freshPath() {
  const dir = mkdtempSync(join(tmpdir(), "aurora-search-index-"));
  dirs.push(dir);
  return searchIndexPath(dir);
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function doc(over: Partial<IndexDoc> = {}): IndexDoc {
  return {
    session_id: "s1",
    artifact_id: "a1",
    type: "markdown",
    title: "Retention",
    session_title: "Session one",
    updated_at: "2026-01-01T00:00:00.000Z",
    content_hash: "h1",
    chunks: [{ chunk_no: 0, text: "channel artifacts are deleted after thirty days" }],
    ...over,
  };
}

describe("SearchIndex", () => {
  it("creates its file (and directory) at the given path", () => {
    const path = freshPath();
    new SearchIndex(path).close();
    expect(existsSync(path)).toBe(true);
  });

  it("upsert returns true for new content and false when the content hash is unchanged", () => {
    const index = new SearchIndex(freshPath());
    expect(index.upsertArtifact(doc())).toBe(true);
    expect(index.upsertArtifact(doc({ title: "ignored: hash equal" }))).toBe(false);
    expect(index.keywordSearch("retention", {}, 10)[0]!.title).toBe("Retention");
    expect(index.upsertArtifact(doc({ content_hash: "h2", chunks: [{ chunk_no: 0, text: "brand new words" }] }))).toBe(true);
    expect(index.keywordSearch("thirty", {}, 10)).toEqual([]);
    expect(index.keywordSearch("brand", {}, 10)).toHaveLength(1);
  });

  it("records state per artifact in entries()", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc());
    expect(index.entries()).toEqual([
      { session_id: "s1", artifact_id: "a1", type: "markdown", content_hash: "h1", text_model: null, image_model: null },
    ]);
  });

  it("removeArtifact and removeSession drop rows and keyword matches", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc());
    index.upsertArtifact(doc({ artifact_id: "a2", content_hash: "h2" }));
    index.upsertArtifact(doc({ session_id: "s2", content_hash: "h3" }));
    index.removeArtifact("s1", "a1");
    expect(index.entries().map((e) => `${e.session_id}/${e.artifact_id}`)).toEqual(["s1/a2", "s2/a1"]);
    index.removeSession("s1");
    expect(index.entries().map((e) => `${e.session_id}/${e.artifact_id}`)).toEqual(["s2/a1"]);
    expect(index.keywordSearch("thirty", {}, 10)).toHaveLength(1);
  });

  it("filters by session and type, and honours the chunk limit", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc());
    index.upsertArtifact(doc({ session_id: "s2", type: "mermaid", content_hash: "h2" }));
    expect(index.keywordSearch("thirty", { session_id: "s2" }, 10).map((h) => h.session_id)).toEqual(["s2"]);
    expect(index.keywordSearch("thirty", { type: "markdown" }, 10).map((h) => h.type)).toEqual(["markdown"]);
    expect(index.keywordSearch("thirty", {}, 1)).toHaveLength(1);
  });

  it("matches accented text with a diacritic-free query", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc({ chunks: [{ chunk_no: 0, text: "le café du matin" }] }));
    expect(index.keywordSearch("cafe", {}, 10)).toHaveLength(1);
  });

  it("never parses user input as FTS5 syntax", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc({ chunks: [{ chunk_no: 0, text: "release notes for ticket 98" }] }));
    for (const hostile of ['"', 'a"b', "AND", "NOT x", "OR", "NEAR(a b)", "title:release", "release*", "(", "-", "^release"]) {
      expect(() => index.keywordSearch(hostile, {}, 10)).not.toThrow();
    }
    expect(index.keywordSearch("NOT release", {}, 10)).toHaveLength(1); // plain OR of two terms
    expect(ftsQuery('say "hi" now')).toBe('"say" OR """hi""" OR "now"');
    expect(ftsQuery("   ")).toBeNull();
    expect(index.keywordSearch("   ", {}, 10)).toEqual([]);
  });

  it("orders by relevance, best first", () => {
    const index = new SearchIndex(freshPath());
    index.upsertArtifact(doc({ artifact_id: "weak", content_hash: "w", title: "x", chunks: [{ chunk_no: 0, text: "pruning is mentioned once among many other unrelated filler words here" }] }));
    index.upsertArtifact(doc({ artifact_id: "strong", content_hash: "s", title: "y", chunks: [{ chunk_no: 0, text: "pruning pruning pruning" }] }));
    expect(index.keywordSearch("pruning", {}, 10).map((h) => h.artifact_id)).toEqual(["strong", "weak"]);
  });

  it("drops and recreates its tables on a schema version mismatch", () => {
    const path = freshPath();
    const first = new SearchIndex(path);
    first.upsertArtifact(doc());
    first.close();

    const raw = new Database(path);
    raw.exec(`PRAGMA user_version = ${SEARCH_SCHEMA_VERSION + 1}`);
    raw.close();

    const second = new SearchIndex(path);
    expect(second.entries()).toEqual([]);
    expect(second.upsertArtifact(doc())).toBe(true);
    second.close();

    const third = new SearchIndex(path);
    expect(third.entries()).toHaveLength(1); // same version: data kept
  });
});
