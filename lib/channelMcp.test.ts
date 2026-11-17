// Tool-boundary tests for channel sessions (spec #86, issue #89): session_kind /
// retention_days on push_ui and push_markdown, prune reporting, list_sessions.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { artifactDir, sessionDir } from "./artifactStore";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5273;
const BASE = `http://127.0.0.1:${PORT}`;

delete process.env.OPENROUTER_API_KEY;

let artifactsDir: string;
let server: ReturnType<typeof createServer>;
let client: Client;

const PROGRAM = `root = Stack([card1], "column")
card1 = Card([t1])
t1 = Text("hello aurora")`;

beforeAll(async () => {
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-channel-mcp-"));
  server = createServer(PORT, { artifactsDir });
  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
});

afterAll(async () => {
  await client?.close();
  server?.stop(true);
  rmSync(artifactsDir, { recursive: true, force: true });
});

const text = (res: any) => (res.content as Array<{ text: string }>)[0].text;
const sessionMeta = (id: string) =>
  JSON.parse(readFileSync(join(sessionDir(artifactsDir, id), "meta.json"), "utf-8"));

/** Age an artifact so it falls outside any retention window. */
function age(sessionId: string, artifactId: string, daysOld: number) {
  const p = join(artifactDir(artifactsDir, sessionId, artifactId), "meta.json");
  const meta = JSON.parse(readFileSync(p, "utf-8"));
  const updated_at = new Date(Date.now() - daysOld * 86_400_000).toISOString();
  writeFileSync(p, JSON.stringify({ ...meta, updated_at }));
}

describe("tool schemas", () => {
  it("push_ui and push_markdown take session_kind and retention_days; other push tools do not", async () => {
    const { tools } = await client.listTools();
    const props = (name: string) =>
      Object.keys((tools.find((t) => t.name === name)!.inputSchema as any).properties);
    for (const name of ["push_ui", "push_markdown"]) {
      expect(props(name)).toContain("session_kind");
      expect(props(name)).toContain("retention_days");
    }
    for (const name of ["push_mermaid", "push_image", "push_video", "push_audio"]) {
      expect(props(name)).not.toContain("session_kind");
      expect(props(name)).not.toContain("retention_days");
    }
    expect(tools.map((t) => t.name)).not.toContain("open_channel");
  });

  it("rejects out-of-range retention_days", async () => {
    for (const retention_days of [0, 366, 1.5]) {
      const res = await client.callTool({
        name: "push_markdown",
        arguments: { session_id: "bad-ret", title: "t", content: "x", session_kind: "channel", retention_days },
      });
      expect(res.isError).toBe(true);
    }
    expect(existsSync(sessionDir(artifactsDir, "bad-ret"))).toBe(false);
  });

  it("rejects a session_kind other than channel", async () => {
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "bad-kind", title: "t", content: "x", session_kind: "ordinary" },
    });
    expect(res.isError).toBe(true);
  });
});

describe("scenario 1: declaring a channel", () => {
  it("push_markdown with session_kind=channel stores kind and default retention, says so in the response", async () => {
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "feed-tech", title: "Briefing", content: "# hi", session_kind: "channel" },
    });
    expect(res.isError).toBeFalsy();
    expect(sessionMeta("feed-tech").kind).toBe("channel");
    expect(sessionMeta("feed-tech").retention_days).toBe(30);
    expect(text(res)).toContain("channel");
    expect(text(res)).toContain("retention 30d");
    expect(text(res)).not.toContain("pruned");
    expect(res.structuredContent).toMatchObject({
      session_id: "feed-tech",
      session_kind: "channel",
      retention_days: 30,
      pruned: 0,
    });
  });
});

describe("scenario 2 and 3: pruning", () => {
  it("push into a channel prunes artifacts older than retention and reports the count", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "prune-ch", title: "old", content: "x", artifact_id: "old", session_kind: "channel" },
    });
    age("prune-ch", "old", 31);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "prune-ch", title: "new", content: "y", artifact_id: "new" },
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain("pruned 1");
    expect((res.structuredContent as any).pruned).toBe(1);
    expect(existsSync(artifactDir(artifactsDir, "prune-ch", "old"))).toBe(false);
    expect(existsSync(artifactDir(artifactsDir, "prune-ch", "new"))).toBe(true);
  });

  it("push_ui into a channel prunes too", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "prune-ui", title: "old", content: "x", artifact_id: "old", session_kind: "channel" },
    });
    age("prune-ui", "old", 31);
    const res = await client.callTool({
      name: "push_ui",
      arguments: { session_id: "prune-ui", title: "d", program: PROGRAM },
    });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain("pruned 1");
    expect(existsSync(artifactDir(artifactsDir, "prune-ui", "old"))).toBe(false);
  });

  it("ordinary sessions are never pruned", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "ordinary", title: "old", content: "x", artifact_id: "old" },
    });
    age("ordinary", "old", 400);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "ordinary", title: "new", content: "y" },
    });
    expect(text(res)).not.toContain("pruned");
    expect(text(res)).not.toContain("channel");
    expect(existsSync(artifactDir(artifactsDir, "ordinary", "old"))).toBe(true);
  });
});

describe("scenario 4: sticky kind, retention updates", () => {
  it("push without session_kind keeps the channel; retention_days updates the window", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "sticky", title: "a", content: "x", session_kind: "channel" },
    });
    const plain = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "sticky", title: "b", content: "x" },
    });
    expect(sessionMeta("sticky").kind).toBe("channel");
    expect(text(plain)).toContain("channel");

    // retention_days alone is fine on an existing channel
    const seven = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "sticky", title: "c", content: "x", retention_days: 7 },
    });
    expect(seven.isError).toBeFalsy();
    expect(sessionMeta("sticky").retention_days).toBe(7);
    expect(text(seven)).toContain("retention 7d");
  });
});

describe("scenario 5: retention_days without a channel", () => {
  it("push_ui with retention_days on an ordinary session is a tool error and writes nothing", async () => {
    const res = await client.callTool({
      name: "push_ui",
      arguments: { session_id: "ord-ui", title: "d", program: PROGRAM, retention_days: 7 },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('session_kind: "channel"');
    expect(existsSync(sessionDir(artifactsDir, "ord-ui"))).toBe(false);
  });

  it("push_markdown with retention_days on an existing ordinary session errors and leaves it untouched", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "ord-md", title: "a", content: "x" },
    });
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "ord-md", title: "b", content: "x", retention_days: 7 },
    });
    expect(res.isError).toBe(true);
    expect(sessionMeta("ord-md").kind).toBeUndefined();
    const list = await client.callTool({ name: "list_artifacts", arguments: { session_id: "ord-md" } });
    expect((list.structuredContent as any).artifacts).toHaveLength(1);
  });
});

describe("scenario 6: list_sessions", () => {
  it("includes kind and retention_days for channels only", async () => {
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "list-ch", title: "a", content: "x", session_kind: "channel", retention_days: 9 },
    });
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "list-plain", title: "a", content: "x" },
    });
    const res = await client.callTool({ name: "list_sessions", arguments: { limit: 200 } });
    const sessions = (res.structuredContent as any).sessions as any[];
    const ch = sessions.find((s) => s.session_id === "list-ch");
    const plain = sessions.find((s) => s.session_id === "list-plain");
    expect(ch.kind).toBe("channel");
    expect(ch.retention_days).toBe(9);
    expect(plain.kind).toBeUndefined();
    expect(plain.retention_days).toBeUndefined();
    expect(text(res)).toContain("list-ch | ");
    expect(text(res)).toMatch(/list-ch \|[^\n]*channel[^\n]*9d/);
    expect(text(res)).not.toMatch(/list-plain \|[^\n]*channel/);
  });
});
