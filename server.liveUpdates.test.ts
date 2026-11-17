// Live-update channel tests: a WS client connected to /ws receives the thin
// artifact event when an MCP push lands; content refetched over HTTP matches.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "./server";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5072;

// Hermetic tests: a real OPENROUTER_API_KEY in the environment would make
// createServer fall back to a fire-and-forget live catalog fetch. PRD #24
// Testing Decisions: tests run against the fake only, never live network.
delete process.env.OPENROUTER_API_KEY;
const BASE = `http://127.0.0.1:${PORT}`;

let artifactsDir: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-ws-artifacts-"));
  server = createServer(PORT, { artifactsDir });
});

afterAll(() => {
  server?.stop(true);
  rmSync(artifactsDir, { recursive: true, force: true });
});

/** Resolve once a WebSocket message matching `match` arrives (with timeout). */
function nextEvent(ws: WebSocket, match: (e: any) => boolean, ms = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for WS event")), ms);
    ws.addEventListener("message", (msg) => {
      try {
        const e = JSON.parse(String(msg.data));
        if (match(e)) {
          clearTimeout(timer);
          resolve(e);
        }
      } catch {
        // ignore non-JSON frames
      }
    });
  });
}

async function push(client: Client, args: Record<string, unknown>) {
  return client.callTool({ name: "push_markdown", arguments: args });
}

describe("live updates over /ws", () => {
  it("delivers thin events on push and replace; HTTP refetch matches", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
    const client = new Client({ name: "ws-test-client", version: "0.0.1" });
    await client.connect(transport);

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws connect failed")));
    });

    // First push → "pushed" event for the (implicitly created) session.
    const pushedPromise = nextEvent(ws, (e) => e.event === "pushed");
    const r1: any = await push(client, {
      session_id: "ws-live",
      title: "Report",
      content: "# hello live",
    });
    const pushed = await pushedPromise;
    expect(pushed).toEqual({
      event: "pushed",
      session_id: "ws-live",
      artifact_id: r1.structuredContent.artifact_id,
    });

    // HTTP refetch returns the pushed content.
    const res = await fetch(`${BASE}/api/preview/sessions/ws-live/artifacts/${pushed.artifact_id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("# hello live");

    // Replace in place → "updated" event for the same artifact id.
    const updatedPromise = nextEvent(ws, (e) => e.event === "updated");
    await push(client, {
      session_id: "ws-live",
      title: "Report",
      content: "# replaced",
      artifact_id: pushed.artifact_id,
    });
    const updated = await updatedPromise;
    expect(updated).toEqual({
      event: "updated",
      session_id: "ws-live",
      artifact_id: pushed.artifact_id,
    });

    // Content refetched after "updated" is the replacement.
    const res2 = await fetch(`${BASE}/api/preview/sessions/ws-live/artifacts/${pushed.artifact_id}`);
    expect((await res2.json()).content).toBe("# replaced");

    ws.close();
    await client.close();
  });
});

describe("briefing live patch (issue #91)", () => {
  const BRIEFING = [
    'root = Stack([hdr, sec1, itm_003, thr_neo4j, done], "column")',
    'hdr = BriefingHeader("Wed 4 Nov", 142, 1, 12, true)',
    'sec1 = SectionHeader("Agent infra")',
    'itm_003 = DigestCard("itm-003", "list", "Title", "GitHub", "EN", 2, "Sapo.", "Why you.")',
    'thr_neo4j = ThreadUpdate("thr-neo4j", "Graph memory", "Day one update.")',
    'done = DoneMarker("You\'re done.")',
  ].join("\n");

  it("patch adding a DigestCard merges into a full snapshot and the live bus emits; a patched thread updates in place", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
    const client = new Client({ name: "ws-briefing-client", version: "0.0.1" });
    await client.connect(transport);
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws connect failed")));
    });

    const first: any = await client.callTool({
      name: "push_ui",
      arguments: { session_id: "ws-briefing", title: "Tech briefing", program: BRIEFING },
    });
    expect(first.isError).toBeUndefined();
    const aid = first.structuredContent.artifact_id;

    // Patch 1: a new card, wired into root at sec1's position.
    const updated1 = nextEvent(ws, (e) => e.event === "updated" && e.artifact_id === aid);
    const patch1: any = await client.callTool({
      name: "push_ui",
      arguments: {
        session_id: "ws-briefing",
        title: "Tech briefing",
        mode: "patch",
        artifact_id: aid,
        program: [
          'root = Stack([hdr, sec1, itm_009, itm_003, thr_neo4j, done], "column")',
          'itm_009 = DigestCard("itm-009", "list", "Breaking", "LWN", "EN", 2, "Sapo.", "Why you.")',
        ].join("\n"),
      },
    });
    expect(patch1.isError).toBeUndefined();
    expect(patch1.structuredContent.merged).toBe(true);
    expect(patch1.structuredContent.statement_names).toEqual([
      "root", "hdr", "sec1", "itm_003", "thr_neo4j", "done", "itm_009",
    ]);
    expect(await updated1).toEqual({ event: "updated", session_id: "ws-briefing", artifact_id: aid });

    const snap1 = await (await fetch(`${BASE}/api/preview/sessions/ws-briefing/artifacts/${aid}`)).json();
    expect(snap1.content).toContain('itm_009 = DigestCard("itm-009"');
    expect(snap1.content).toContain("itm_003 = DigestCard"); // untouched statements kept: full snapshot

    // Patch 2: only the thread statement, new text, same name.
    const updated2 = nextEvent(ws, (e) => e.event === "updated" && e.artifact_id === aid);
    const patch2: any = await client.callTool({
      name: "push_ui",
      arguments: {
        session_id: "ws-briefing",
        title: "Tech briefing",
        mode: "patch",
        artifact_id: aid,
        program: 'thr_neo4j = ThreadUpdate("thr-neo4j", "Graph memory", "Day two: new benchmark.", "Day 2", [{when: "Mon 2", text: "Opened."}])',
      },
    });
    expect(patch2.isError).toBeUndefined();
    await updated2;
    const snap2 = await (await fetch(`${BASE}/api/preview/sessions/ws-briefing/artifacts/${aid}`)).json();
    expect(snap2.content).toContain("Day two: new benchmark.");
    expect(snap2.content).not.toContain("Day one update.");
    expect(snap2.content).toContain('itm_009 = DigestCard("itm-009"');

    ws.close();
    await client.close();
  });
});
