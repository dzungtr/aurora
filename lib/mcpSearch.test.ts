import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { artifactDir } from "./artifactStore";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999.
const PORT = 5301;
const BASE = `http://127.0.0.1:${PORT}`;

// Hermetic: no embedding endpoint and no generation provider, no real network.
for (const key of Object.keys(process.env)) if (key.startsWith("AURORA_EMBEDDING_")) delete process.env[key];
delete process.env.OPENROUTER_API_KEY;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const KEYWORD_REASON = "embedding endpoint not configured";

let artifactsDir: string;
let server: ReturnType<typeof createServer>;

beforeAll(() => {
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-mcp-search-"));
  server = createServer(PORT, { artifactsDir });
});

afterAll(() => {
  server?.stop(true);
  rmSync(artifactsDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const client = new Client({ name: "search-test", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return res;
}

/** Push through MCP, then wait for the indexer to go idle (no sleeps). */
async function push(name: string, args: Record<string, unknown>) {
  const res = await call(name, args);
  expect(res.isError).toBeFalsy();
  await server.indexer!.idle();
  return (res.structuredContent as any).artifact_id as string;
}

async function search(args: Record<string, unknown>) {
  const res = await call("search_artifacts", args);
  return { res, sc: res.structuredContent as any, text: (res.content as any[])[0]?.text as string };
}

const sid = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}`;

describe("search_artifacts registration", () => {
  it("is listed alongside the three read tools, with no embedding configured", async () => {
    const client = new Client({ name: "search-test", version: "0.0.1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_sessions", "list_artifacts", "read_artifact", "search_artifacts"])
    );
    await client.close();
  });
});

describe("keyword search", () => {
  it("finds a markdown artifact, with snippet, mode, reason and deep link", async () => {
    const session_id = sid("kw");
    const artifact_id = await push("push_markdown", {
      session_id,
      title: "Retention pruning",
      content: "# Retention\n\nChannel artifacts are deleted after thirty days of inactivity.",
    });
    const { res, sc, text } = await search({ query: "thirty days" });
    expect(res.isError).toBeFalsy();
    expect(sc.mode).toBe("keyword");
    expect(sc.reason).toBe(KEYWORD_REASON);
    const hits = sc.hits.filter((h: any) => h.session_id === session_id);
    expect(hits).toHaveLength(1);
    expect(sc.total).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatchObject({
      artifact_id,
      type: "markdown",
      title: "Retention pruning",
      session_title: session_id,
      deep_link: `${BASE}/s/${session_id}/${artifact_id}`,
    });
    expect(hits[0].snippet).toContain("thirty days");
    expect(typeof hits[0].updated_at).toBe("string");
    expect(hits[0].score).toBeUndefined();

    // text output: header with count, mode and reason; one line per hit; closing pointer
    const lines = text.split("\n");
    expect(lines[0]).toContain("keyword");
    expect(lines[0]).toContain(KEYWORD_REASON);
    expect(lines.some((l) => l.startsWith(`${session_id} | ${artifact_id} | markdown | Retention pruning | updated `))).toBe(true);
    expect(lines.at(-1)).toContain("read_artifact");
  });

  it("returns one hit per artifact even when several chunks match", async () => {
    const session_id = sid("onehit");
    const body = Array.from({ length: 6 }, (_, i) => `## Part ${i}\n${"zebracrossing ".repeat(80)}`).join("\n");
    await push("push_markdown", { session_id, title: "Many chunks", content: body });
    const { sc } = await search({ query: "zebracrossing", session_id });
    expect(sc.hits).toHaveLength(1);
    expect(sc.total).toBe(1);
  });

  it("indexes UI string literals but not component names", async () => {
    const session_id = sid("ui");
    await push("push_ui", {
      session_id,
      title: "Hello UI",
      program: `root = Stack([card1], "column")\ncard1 = Card([t1])\nt1 = Text("hello aurora")`,
    });
    expect((await search({ query: "hello aurora", session_id })).sc.hits).toHaveLength(1);
    expect((await search({ query: "Text", session_id })).sc.hits).toHaveLength(0);
    expect((await search({ query: "Stack Card", session_id })).sc.hits).toHaveLength(0);
  });

  it("indexes chart string values but not JSON keys", async () => {
    const session_id = sid("chart");
    await push("push_chart", {
      session_id,
      title: "Perf",
      chart_type: "line",
      data: { kind: "line", x: ["Mo", "Tu"], series: [{ name: "Latency p99", values: [1, 2] }] },
    });
    expect((await search({ query: "latency", session_id })).sc.hits).toHaveLength(1);
    expect((await search({ query: "chart_type", session_id })).sc.hits).toHaveLength(0);
    expect((await search({ query: "series", session_id })).sc.hits).toHaveLength(0);
  });

  it("indexes mermaid source", async () => {
    const session_id = sid("mer");
    await push("push_mermaid", { session_id, title: "Flow", code: "flowchart TD\n  Gateway --> Billing" });
    expect((await search({ query: "billing", session_id })).sc.hits[0]).toMatchObject({ type: "mermaid" });
  });

  it("indexes an image by title; the snippet is the title", async () => {
    const session_id = sid("img");
    await push("push_image", {
      session_id,
      title: "Architecture overview",
      source: { base64: PNG.toString("base64"), mime: "image/png" },
    });
    const { sc } = await search({ query: "architecture", session_id });
    expect(sc.hits).toHaveLength(1);
    expect(sc.hits[0]).toMatchObject({ type: "image", snippet: "Architecture overview" });
  });

  it("never returns audio or video, even by title", async () => {
    const session_id = sid("av");
    await push("push_audio", {
      session_id,
      title: "Narration",
      source: { base64: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0]).toString("base64"), mime: "audio/mpeg" },
    });
    await push("push_video", {
      session_id,
      title: "Clipreel",
      source: { base64: Buffer.from("0123456789").toString("base64"), mime: "video/mp4" },
    });
    expect((await search({ query: "narration" })).sc.hits).toHaveLength(0);
    expect((await search({ query: "clipreel" })).sc.hits).toHaveLength(0);
    expect(server.searchIndex!.entries().filter((e) => e.session_id === session_id)).toEqual([]);
  });

  it("searches a replaced artifact by its new content only", async () => {
    const session_id = sid("replace");
    const artifact_id = await push("push_markdown", { session_id, title: "Doc", content: "the quokka phrase" });
    expect((await search({ query: "quokka", session_id })).sc.hits).toHaveLength(1);
    await push("push_markdown", { session_id, artifact_id, title: "Doc", content: "the wombat phrase" });
    expect((await search({ query: "quokka", session_id })).sc.hits).toHaveLength(0);
    const fresh = await search({ query: "wombat", session_id });
    expect(fresh.sc.hits).toHaveLength(1);
    expect(fresh.sc.hits[0].artifact_id).toBe(artifact_id);
  });

  it("returns a no-hit response, not an error, when nothing matches", async () => {
    const { res, sc, text } = await search({ query: "zzzzqqqq-nothing-matches" });
    expect(res.isError).toBeFalsy();
    expect(sc).toMatchObject({ mode: "keyword", reason: KEYWORD_REASON, total: 0, hits: [] });
    expect(text).toContain("0 of 0");
  });

  it("treats FTS5 syntax in the query as plain words", async () => {
    const session_id = sid("fts");
    await push("push_markdown", { session_id, title: "Syntax", content: "plain okapi text" });
    for (const q of ['"', "okapi AND", "NEAR(okapi", "title:okapi", "okapi*"]) {
      const { res } = await search({ query: q, session_id });
      expect(res.isError).toBeFalsy();
    }
    expect((await search({ query: 'NOT "okapi', session_id })).sc.hits).toHaveLength(1);
  });
});

describe("filters and limits", () => {
  it("restricts to one session", async () => {
    const a = sid("fa");
    const b = sid("fb");
    await push("push_markdown", { session_id: a, title: "A", content: "pangolin in a" });
    await push("push_markdown", { session_id: b, title: "B", content: "pangolin in b" });
    const all = await search({ query: "pangolin" });
    expect(new Set(all.sc.hits.map((h: any) => h.session_id))).toEqual(new Set([a, b]));
    const only = await search({ query: "pangolin", session_id: a });
    expect(only.sc.hits.map((h: any) => h.session_id)).toEqual([a]);
  });

  it("restricts to one type", async () => {
    const session_id = sid("ft");
    await push("push_markdown", { session_id, title: "Md", content: "axolotl notes" });
    await push("push_mermaid", { session_id, title: "Mm", code: "flowchart TD\n  axolotl --> pond" });
    const both = await search({ query: "axolotl", session_id });
    expect(both.sc.hits.map((h: any) => h.type).sort()).toEqual(["markdown", "mermaid"]);
    const md = await search({ query: "axolotl", session_id, type: "markdown" });
    expect(md.sc.hits.map((h: any) => h.type)).toEqual(["markdown"]);
  });

  it("caps hits at limit, default 10, and reports the larger total", async () => {
    const session_id = sid("lim");
    for (let i = 0; i < 12; i++) {
      await push("push_markdown", { session_id, title: `Note ${i}`, content: `tapir entry ${i}` });
    }
    const dflt = await search({ query: "tapir", session_id });
    expect(dflt.sc.hits).toHaveLength(10);
    expect(dflt.sc.total).toBe(12);
    const two = await search({ query: "tapir", session_id, limit: 2 });
    expect(two.sc.hits).toHaveLength(2);
    expect(two.sc.total).toBe(12);
  });

  it("rejects a limit above 50 and an unknown type at the schema", async () => {
    expect((await search({ query: "x", limit: 51 })).res.isError).toBe(true);
    expect((await search({ query: "x", type: "audio" })).res.isError).toBe(true);
    expect((await search({ query: "" })).res.isError).toBe(true);
  });

  it("returns a tool error naming list_sessions for an unknown session", async () => {
    const { res, text } = await search({ query: "anything", session_id: "no-such-session" });
    expect(res.isError).toBe(true);
    expect(text).toContain("list_sessions");
  });
});

describe("deleted artifacts", () => {
  it("drops an artifact removed from disk, and clears its index entry", async () => {
    const session_id = sid("dead");
    const artifact_id = await push("push_markdown", { session_id, title: "Doomed", content: "ocelot report" });
    expect((await search({ query: "ocelot", session_id })).sc.hits).toHaveLength(1);
    expect(server.searchIndex!.entries().map((e) => e.artifact_id)).toContain(artifact_id);

    rmSync(artifactDir(artifactsDir, session_id, artifact_id), { recursive: true, force: true });

    expect((await search({ query: "ocelot", session_id })).sc.hits).toHaveLength(0);
    expect(server.searchIndex!.entries().map((e) => e.artifact_id)).not.toContain(artifact_id);
  });

  it("drops an artifact pruned out of a channel by a later push", async () => {
    const session_id = sid("chan");
    const old = await push("push_markdown", { session_id, title: "Old", content: "lemur briefing", session_kind: "channel", retention_days: 1 });
    // age the artifact beyond retention directly on disk
    const metaPath = join(artifactDir(artifactsDir, session_id, old), "meta.json");
    const meta = await Bun.file(metaPath).json();
    meta.updated_at = "2020-01-01T00:00:00.000Z";
    await Bun.write(metaPath, JSON.stringify(meta));
    await push("push_markdown", { session_id, title: "Fresh", content: "other briefing", session_kind: "channel" });
    const { sc } = await search({ query: "lemur", session_id });
    expect(sc.hits).toHaveLength(0);
  });
});

// Runs last: it closes the index for the rest of this file's server.
describe("pushes", () => {
  it("do not fail when the search index is unusable", async () => {
    const session_id = sid("broken");
    server.searchIndex!.close();
    const res = await call("push_markdown", { session_id, title: "Still works", content: "body" });
    expect(res.isError).toBeFalsy();
    await server.indexer!.idle();
    expect(server.indexer!.failures).toBeGreaterThan(0);
  });
});
