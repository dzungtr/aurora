import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5071;
const BASE = `http://127.0.0.1:${PORT}`;

let root: string;
let artifactsDir: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

async function startServer() {
  server = createServer(root, PORT, { artifactsDir });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "aurora-mcp-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-mcp-artifacts-"));
  await startServer();
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("MCP endpoint /mcp", () => {
  it("binds loopback only and lists push_markdown", async () => {
    expect(server.hostname).toBe("127.0.0.1");
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("push_markdown");
    await client.close();
  });

  it("pushes markdown end-to-end and returns a working deep link", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: {
        session_id: "agent-a",
        title: "Status report",
        content: "# All good",
        session_title: "Agent A session",
      },
    });
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.deep_link).toBe(`${BASE}/preview/agent-a`);
    expect(structured.created).toBe(true);
    expect(JSON.stringify(res.content)).toContain("/preview/agent-a");

    // Artifact is on disk and fetchable over HTTP
    expect(res.structuredContent).toBeDefined();
    const artifacts = JSON.parse(
      readFileSync(
        join(artifactsDir, "sessions", "agent-a", "meta.json"),
        "utf-8"
      )
    );
    expect(artifacts.title).toBe("Agent A session");
    const listRes = await fetch(`${BASE}/api/preview/sessions`);
    const sessions = await listRes.json();
    const s = sessions.find((x: any) => x.session_id === "agent-a");
    expect(s.artifact_count).toBe(1);

    const aid = structured.artifact_id;
    const got = await (await fetch(`${BASE}/api/preview/sessions/agent-a/artifacts/${aid}`)).json();
    expect(got.content).toBe("# All good");
    expect(got.meta.title).toBe("Status report");
    await client.close();
  });

  it("rejects invalid tool input via schema validation", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "agent-a", content: "missing title" },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("rejects path-traversing session ids with a tool error, writing nothing", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "../escape", title: "x", content: "y" },
    });
    expect(res.isError).toBe(true);
    expect(existsSync(join(artifactsDir, "sessions", "escape"))).toBe(false);
    await client.close();
  });

  it("appends by default and replaces in place with artifact_id", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const first = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "agent-b", title: "v1", content: "one" },
    });
    const second = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "agent-b", title: "v2", content: "two" },
    });
    const replaced = await client.callTool({
      name: "push_markdown",
      arguments: {
        session_id: "agent-b",
        title: "v1 fixed",
        content: "one-edited",
        artifact_id: (first.structuredContent as any).artifact_id,
      },
    });
    expect((replaced.structuredContent as any).created).toBe(false);
    const sessions = await (await fetch(`${BASE}/api/preview/sessions`)).json();
    expect(sessions.find((s: any) => s.session_id === "agent-b").artifact_count).toBe(2);
    const aid = (replaced.structuredContent as any).artifact_id;
    const got = await (
      await fetch(`${BASE}/api/preview/sessions/agent-b/artifacts/${aid}`)
    ).json();
    expect(got.content).toBe("one-edited");
    expect(got.meta.title).toBe("v1 fixed");
    await client.close();
  });

  it("isolates concurrent sessions over HTTP", async () => {
    const a = makeClient();
    const b = makeClient();
    await a.client.connect(a.transport);
    await b.client.connect(b.transport);
    const ra = await a.client.callTool({
      name: "push_markdown",
      arguments: { session_id: "iso-a", title: "A", content: "from a" },
    });
    const rb = await b.client.callTool({
      name: "push_markdown",
      arguments: { session_id: "iso-b", title: "B", content: "from b" },
    });
    const aidA = (ra.structuredContent as any).artifact_id;
    const cross = await fetch(`${BASE}/api/preview/sessions/iso-b/artifacts/${aidA}`);
    expect(cross.status).toBe(404);
    await a.client.close();
    await b.client.close();
  });

  it("persists artifacts across a server restart", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "persist", title: "Keep", content: "# persisted" },
    });
    const aid = (res.structuredContent as any).artifact_id;
    await client.close();

    server.stop(true);
    await startServer();

    const got = await (
      await fetch(`${BASE}/api/preview/sessions/persist/artifacts/${aid}`)
    ).json();
    expect(got.content).toBe("# persisted");
  });
});
