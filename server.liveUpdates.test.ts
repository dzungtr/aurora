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
const BASE = `http://127.0.0.1:${PORT}`;

let root: string;
let artifactsDir: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "aurora-ws-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-ws-artifacts-"));
  server = createServer(root, PORT, { artifactsDir });
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
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
