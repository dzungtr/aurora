import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import type { ArtifactMeta } from "./artifactStore";

// The sandbox forbids ephemeral ports (port 0), so tests pin a fixed loopback
// port from the allowed dev range (3000-3999 / 5000-5999 / 7634).
const PORT = 5272;
const base = `http://127.0.0.1:${PORT}`;

const root = mkdtempSync(join(tmpdir(), "aurora-preview-routes-"));
const artifactsDir = mkdtempSync(join(tmpdir(), "aurora-preview-routes-artifacts-"));
const server = createServer(root, PORT, { artifactsDir });

afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

async function pushMarkdown(sessionId: string, title: string, content: string, artifactId?: string) {
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const res = await client.callTool({
    name: "push_markdown",
    arguments: {
      session_id: sessionId,
      title,
      content,
      ...(artifactId ? { artifact_id: artifactId } : {}),
    },
  });
  await client.close();
  return (res as any).structuredContent as { artifact_id: string };
}

describe("GET /api/preview/sessions/:sid/artifacts", () => {
  it("lists the session's artifacts in append (seq) order with type and title", async () => {
    await pushMarkdown("routes-sess", "first", "one");
    await pushMarkdown("routes-sess", "second", "two");

    const res = await fetch(`${base}/api/preview/sessions/routes-sess/artifacts`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as ArtifactMeta[];
    expect(list.length).toBe(2);
    expect(list[0].title).toBe("first");
    expect(list[1].title).toBe("second");
    expect(list.every((a) => typeof a.type === "string" && typeof a.artifact_id === "string")).toBe(true);
  });

  it("404s a session that was never pushed to", async () => {
    const res = await fetch(`${base}/api/preview/sessions/no-such-session/artifacts`);
    expect(res.status).toBe(404);
  });
});

describe("preview deep links serve the SPA", () => {
  it.each(["/preview", "/preview/routes-sess", "/preview/routes-sess/a1"])(
    "serves index HTML for %s",
    async (path) => {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('id="root"');
    }
  );
});
