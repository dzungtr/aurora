import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";

// The sandbox forbids ephemeral ports (port 0), so the read API tests pin a
// fixed loopback port from the allowed dev range (3000-3999 / 5000-5999 / 7634).
const PORT = 5271;
const base = `http://127.0.0.1:${PORT}`;

const root = mkdtempSync(join(tmpdir(), "aurora-read-api-"));
const artifactsDir = mkdtempSync(join(tmpdir(), "aurora-read-api-artifacts-"));
const server = createServer(root, PORT, { artifactsDir });

afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

async function pushMarkdown(sessionId: string, artifactId?: string) {
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const res = await client.callTool({
    name: "push_markdown",
    arguments: { session_id: sessionId, title: "ok", content: "hi", ...(artifactId ? { artifact_id: artifactId } : {}) },
  });
  await client.close();
  return (res as any).structuredContent as { artifact_id: string };
}

describe("GET /api/preview/sessions/:sid/artifacts/:aid (path traversal)", () => {
  it("404s a traversal artifact id instead of reading outside the store", async () => {
    // plant a readable meta.json + content.md pair OUTSIDE the artifacts root
    const evil = join(root, "evil");
    mkdirSync(evil, { recursive: true });
    writeFileSync(join(evil, "meta.json"), JSON.stringify({ artifact_id: "evil", seq: 1, type: "markdown", title: "pwned", created_at: "", updated_at: "" }));
    writeFileSync(join(evil, "content.md"), "SECRET-CONTENT");

    const res = await fetch(
      `${base}/api/preview/sessions/s/artifacts/${encodeURIComponent("../../../evil")}`
    );
    expect(res.status).toBe(404);
  });

  it("404s a traversal session id", async () => {
    const res = await fetch(`${base}/api/preview/sessions/${encodeURIComponent("../../etc")}/artifacts/a`);
    expect(res.status).toBe(404);
  });

  it("404s ids containing slashes or dot segments", async () => {
    expect((await fetch(`${base}/api/preview/sessions/a%2Fb/artifacts/c`)).status).toBe(404);
    expect((await fetch(`${base}/api/preview/sessions/a/artifacts/..`)).status).toBe(404);
  });

  it("still serves a legitimately pushed artifact over the same route", async () => {
    const { artifact_id } = await pushMarkdown("s");
    const read = await fetch(`${base}/api/preview/sessions/s/artifacts/${artifact_id}`);
    expect(read.status).toBe(200);
    expect((await read.json()).content).toBe("hi");
  });
});
