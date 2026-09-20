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

async function startServer(cap?: number) {
  server = createServer(root, PORT, { artifactsDir, mediaSizeCap: cap });
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

describe("push_image / push_video", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

  it("lists both media tools", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["push_image", "push_video"]));
    await client.close();
  });

  it("pushes an image end-to-end; blob lands in the store and deep link works", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_image",
      arguments: {
        session_id: "media",
        title: "Screenshot",
        source: { base64: PNG, mime: "image/png" },
        session_title: "Media Run",
      },
    });
    const sc = res.structuredContent as any;
    expect(res.isError).toBeFalsy();
    expect(sc.deep_link).toBe(`${BASE}/preview/media`);
    const blobRes = await fetch(`${BASE}/api/preview/sessions/media/artifacts/${sc.artifact_id}/blob`);
    expect(blobRes.status).toBe(200);
    expect(blobRes.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await blobRes.arrayBuffer())).toEqual(Buffer.from(PNG, "base64"));
    await client.close();
  });

  it("pushes a video and serves range requests (206) for seeking", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const bytes = Buffer.from("0123456789");
    const res = await client.callTool({
      name: "push_video",
      arguments: {
        session_id: "vid",
        title: "Clip",
        source: { base64: bytes.toString("base64"), mime: "video/mp4" },
      },
    });
    const aid = (res.structuredContent as any).artifact_id;
    await client.close();
    const range = await fetch(`${BASE}/api/preview/sessions/vid/artifacts/${aid}/blob`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(await range.text()).toBe("0123");
  });

  it("rejects oversized media with an actionable isError result", async () => {
    // restart the server with a tiny cap to make the push exceed it cheaply
    server.stop(true);
    artifactsDir = mkdtempSync(join(tmpdir(), "aurora-mcp-artifacts-cap-"));
    root = mkdtempSync(join(tmpdir(), "aurora-mcp-root-cap-"));
    await startServer(6); // 6-byte cap
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_image",
      arguments: {
        session_id: "big",
        title: "Too big",
        source: { base64: Buffer.from("0123456789").toString("base64"), mime: "image/png" },
      },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any)[0].text;
    expect(text).toContain("cap");
    expect(text).toContain("path");
    await client.close();
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
    rmSync(artifactsDir, { recursive: true, force: true });
    await startServer();
  });

  it("rejects a malformed source (no variant given)", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "push_image",
      arguments: { session_id: "bad", title: "Bad", source: {} },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("supports in-place replace via artifact_id", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const first = await client.callTool({
      name: "push_image",
      arguments: {
        session_id: "rep",
        title: "v1",
        source: { base64: PNG, mime: "image/png" },
        artifact_id: "shot",
      },
    });
    const second = await client.callTool({
      name: "push_image",
      arguments: {
        session_id: "rep",
        title: "v2",
        source: { base64: PNG, mime: "image/png" },
        artifact_id: "shot",
      },
    });
    expect((second.structuredContent as any).created).toBe(false);
    expect((second.structuredContent as any).artifact_id).toBe((first.structuredContent as any).artifact_id);
    const list = await (await fetch(`${BASE}/api/preview/sessions/rep/artifacts`)).json();
    expect(list.length).toBe(1);
    await client.close();
  });
});

describe("session delete API", () => {
  it("deletes a session from disk and the list", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "doomed", title: "t", content: "c" },
    });
    await client.close();
    expect((await (await fetch(`${BASE}/api/preview/sessions`)).json()).some((s: any) => s.session_id === "doomed")).toBe(true);

    const del = await fetch(`${BASE}/api/preview/sessions/doomed`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(existsSync(join(artifactsDir, "sessions", "doomed"))).toBe(false);
    const list = await (await fetch(`${BASE}/api/preview/sessions`)).json();
    expect(list.some((s: any) => s.session_id === "doomed")).toBe(false);
  });

  it("404s deleting an unknown session", async () => {
    expect((await fetch(`${BASE}/api/preview/sessions/ghost`, { method: "DELETE" })).status).toBe(404);
  });
});
