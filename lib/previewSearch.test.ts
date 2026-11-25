import { describe, it, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { searchIndexPath } from "./searchIndex";

// Fixed loopback ports from the sandbox-allowed range (5000-5999).
const PORT = 5302;
const RESTART_PORT = 5303;
const base = `http://127.0.0.1:${PORT}`;

// Hermetic: no embedding endpoint, no generation provider, no real network.
for (const key of Object.keys(process.env)) if (key.startsWith("AURORA_EMBEDDING_")) delete process.env[key];
delete process.env.OPENROUTER_API_KEY;

const artifactsDir = mkdtempSync(join(tmpdir(), "aurora-preview-search-"));
const server = createServer(PORT, { artifactsDir });

afterAll(() => {
  server.stop(true);
  rmSync(artifactsDir, { recursive: true, force: true });
});

async function push(origin: string, srv: ReturnType<typeof createServer>, args: Record<string, unknown>) {
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  const res = await client.callTool({ name: "push_markdown", arguments: args });
  await client.close();
  await srv.indexer!.idle();
  return (res.structuredContent as any).artifact_id as string;
}

const pushMd = (session_id: string, title: string, content: string, artifact_id?: string) =>
  push(base, server, { session_id, title, content, ...(artifact_id ? { artifact_id } : {}) });

const get = (query: string) => fetch(`${base}/api/preview/search${query}`);

describe("GET /api/preview/search", () => {
  it("returns the SearchResponse as JSON", async () => {
    const artifact_id = await pushMd("http-a", "Retention pruning", "Channel artifacts are deleted after thirty days.");
    const res = await get("?q=thirty+days");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(Object.keys(body).sort()).toEqual(["hits", "mode", "reason", "total"]);
    expect(body.mode).toBe("keyword");
    expect(body.reason).toBe("embedding endpoint not configured");
    expect(body.total).toBe(1);
    expect(body.hits).toHaveLength(1);
    expect(Object.keys(body.hits[0]).sort()).toEqual(
      ["artifact_id", "session_id", "session_title", "snippet", "title", "type", "updated_at"]
    );
    expect(body.hits[0]).toMatchObject({
      session_id: "http-a",
      session_title: "http-a",
      artifact_id,
      type: "markdown",
      title: "Retention pruning",
    });
    expect(body.hits[0].snippet).toContain("thirty days");
  });

  it("restricts by session, type and limit", async () => {
    await pushMd("http-b1", "One", "capybara one");
    await pushMd("http-b2", "Two", "capybara two");
    await pushMd("http-b2", "Three", "capybara three");
    const all = (await (await get("?q=capybara")).json()) as any;
    expect(all.hits).toHaveLength(3);
    const one = (await (await get("?q=capybara&session=http-b2")).json()) as any;
    expect(one.hits.map((h: any) => h.session_id)).toEqual(["http-b2", "http-b2"]);
    const none = (await (await get("?q=capybara&type=mermaid")).json()) as any;
    expect(none.hits).toEqual([]);
    const limited = (await (await get("?q=capybara&limit=1")).json()) as any;
    expect(limited.hits).toHaveLength(1);
    expect(limited.total).toBe(3);
  });

  it("answers 400 for a missing or blank q", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?q=")).status).toBe(400);
    expect((await get("?q=%20%20")).status).toBe(400);
  });

  it("answers 400 for a bad type or limit", async () => {
    expect((await get("?q=x&type=audio")).status).toBe(400);
    expect((await get("?q=x&limit=0")).status).toBe(400);
    expect((await get("?q=x&limit=51")).status).toBe(400);
    expect((await get("?q=x&limit=abc")).status).toBe(400);
  });

  it("answers 404 for an unknown session, including an unsafe id", async () => {
    expect((await get("?q=x&session=no-such-session")).status).toBe(404);
    expect((await get("?q=x&session=..%2Fetc")).status).toBe(404);
  });
});

describe("delete routes clear the search index", () => {
  it("DELETE artifact removes it from search", async () => {
    const keep = await pushMd("http-del", "Keep", "narwhal keeper");
    const gone = await pushMd("http-del", "Gone", "narwhal goner");
    expect(((await (await get("?q=narwhal&session=http-del")).json()) as any).hits).toHaveLength(2);

    const res = await fetch(`${base}/api/preview/sessions/http-del/artifacts/${gone}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const after = (await (await get("?q=narwhal&session=http-del")).json()) as any;
    expect(after.hits.map((h: any) => h.artifact_id)).toEqual([keep]);
    // gone from the index itself, not merely filtered at query time
    expect(server.searchIndex!.entries().map((e) => e.artifact_id)).not.toContain(gone);
  });

  it("DELETE session removes all its artifacts from search", async () => {
    await pushMd("http-delsess", "A", "platypus alpha");
    await pushMd("http-delsess", "B", "platypus beta");
    expect(((await (await get("?q=platypus")).json()) as any).hits).toHaveLength(2);

    const res = await fetch(`${base}/api/preview/sessions/http-delsess`, { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(((await (await get("?q=platypus")).json()) as any).hits).toEqual([]);
    expect(server.searchIndex!.entries().filter((e) => e.session_id === "http-delsess")).toEqual([]);
  });

  it("a failed delete (unknown artifact) leaves other index entries alone", async () => {
    const id = await pushMd("http-del2", "Stay", "manatee stays");
    const res = await fetch(`${base}/api/preview/sessions/http-del2/artifacts/missing`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(((await (await get("?q=manatee")).json()) as any).hits.map((h: any) => h.artifact_id)).toEqual([id]);
  });
});

describe("index file", () => {
  it("lives at <artifactsDir>/.index/search.db", () => {
    expect(existsSync(searchIndexPath(artifactsDir))).toBe(true);
    expect(searchIndexPath(artifactsDir)).toBe(join(artifactsDir, ".index", "search.db"));
  });

  it("is invisible to the store's session list", async () => {
    await pushMd("http-vis", "Vis", "content");
    const sessions = (await (await fetch(`${base}/api/preview/sessions`)).json()) as any[];
    expect(sessions.every((s) => typeof s.session_id === "string" && s.session_id !== ".index")).toBe(true);
  });

  it("can be deleted: aurora restarts normally and finds nothing until artifacts are pushed again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-preview-search-restart-"));
    const origin = `http://127.0.0.1:${RESTART_PORT}`;
    try {
      let srv = createServer(RESTART_PORT, { artifactsDir: dir });
      await push(origin, srv, { session_id: "r1", title: "Before", content: "gazelle sighting" });
      expect(((await (await fetch(`${origin}/api/preview/search?q=gazelle`)).json()) as any).hits).toHaveLength(1);
      srv.searchIndex!.close();
      srv.stop(true);

      rmSync(join(dir, ".index"), { recursive: true, force: true });

      srv = createServer(RESTART_PORT, { artifactsDir: dir });
      const res = await fetch(`${origin}/api/preview/search?q=gazelle`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).hits).toEqual([]);

      await push(origin, srv, { session_id: "r1", title: "After", content: "gazelle again" });
      expect(((await (await fetch(`${origin}/api/preview/search?q=gazelle`)).json()) as any).hits).toHaveLength(1);
      srv.stop(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
