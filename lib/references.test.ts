import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";

// Reference inputs for both generation tools (issue #28): four variants
// resolved to inline data URLs, video role routing, artifact-type gating,
// size-cap discipline, and the create_image → create_video chain.

const PORT = 5111;
const FAKE_OPENROUTER_PORT = 5112;
const IMAGE_URL_PORT = 5113;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const IMAGE_URL_SERVER = `http://127.0.0.1:${IMAGE_URL_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// Minimal valid 1x1 PNG / tiny fake mp4.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const VIDEO_BASE64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

interface FakeCall {
  method: string;
  path: string;
  body: any;
}

let fakeCalls: FakeCall[] = [];
/** Provider-side job phase served for every submitted video job. */
let videoPhase: "pending" | "completed" = "pending";
let fakeServer: ReturnType<typeof Bun.serve>;
let imageUrlServer: ReturnType<typeof Bun.serve>;
let fakeJobCounter = 0;

function startFakeOpenRouter() {
  fakeServer = Bun.serve({
    port: FAKE_OPENROUTER_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const record = (body: any) =>
        fakeCalls.push({ method: req.method, path: url.pathname, body });
      if (req.method === "POST" && url.pathname === "/chat/completions") {
        record(await req.json());
        return Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }],
              },
              finish_reason: "stop",
            },
          ],
          usage: { cost: 0.042 },
        });
      }
      if (req.method === "POST" && url.pathname === "/videos") {
        record(await req.json());
        const id = `job-${++fakeJobCounter}`;
        return Response.json(
          { id, polling_url: `${FAKE_OPENROUTER}/videos/${id}`, status: "pending" },
          { status: 202 }
        );
      }
      if (req.method === "GET" && url.pathname === "/videos/models") {
        record(null);
        return Response.json({ data: [{ id: "fake/video-model", pricing_skus: {} }] });
      }
      const statusMatch = url.pathname.match(/^\/videos\/([^/]+)$/);
      if (req.method === "GET" && statusMatch) {
        record(null);
        if (videoPhase === "completed") {
          return Response.json({
            id: statusMatch[1],
            status: "completed",
            unsigned_urls: [`${FAKE_OPENROUTER}/videos/${statusMatch[1]}/content?index=0`],
            usage: { cost: 0.25 },
          });
        }
        return Response.json({ id: statusMatch[1], status: "pending" });
      }
      if (req.method === "GET" && url.pathname.endsWith("/content")) {
        record(null);
        return new Response(Buffer.from(VIDEO_BASE64, "base64"), {
          headers: { "content-type": "video/mp4" },
        });
      }
      if (url.pathname === "/models") {
        record(null);
        return Response.json({ data: [{ id: "cheap/model", pricing: { image: "0.03" } }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

function startImageUrlServer() {
  imageUrlServer = Bun.serve({
    port: IMAGE_URL_PORT,
    hostname: "127.0.0.1",
    fetch() {
      return new Response(Buffer.from(PNG_BASE64, "base64"), {
        headers: { "content-type": "image/png" },
      });
    },
  });
}

let root: string;
let artifactsDir: string;
let configPath: string;
let dbPath: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

beforeAll(async () => {
  startFakeOpenRouter();
  startImageUrlServer();
  root = mkdtempSync(join(tmpdir(), "aurora-ref-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-ref-artifacts-"));
  configPath = join(root, "generation.json");
  dbPath = join(root, "generations.db");
  writeFileSync(
    configPath,
    JSON.stringify({
      image: [{ id: "cheap/model", default: true }],
      video: [
        {
          id: "fake/video-model",
          default: true,
          durations: [4, 6, 8],
          resolutions: ["720p", "1080p"],
          aspect_ratios: ["16:9", "9:16"],
          supports_audio: true,
        },
      ],
    })
  );
  server = createServer(root, PORT, {
    artifactsDir,
    generation: { apiKey: API_KEY, baseUrl: FAKE_OPENROUTER, whitelistPath: configPath, dbPath },
  });
  await Bun.sleep(150);
});

afterAll(async () => {
  // Let the submitted video job's poller run out before tearing down.
  await Bun.sleep(300);
  server?.stop(true);
  fakeServer?.stop(true);
  imageUrlServer?.stop(true);
  for (const dir of [root, artifactsDir]) rmSync(dir, { recursive: true, force: true });
});

async function pushImageArtifact(): Promise<string> {
  const { client, transport } = makeClient();
  await client.connect(transport);
  const res = await client.callTool({
    name: "push_image",
    arguments: {
      session_id: "ref-agent",
      title: "Source image",
      source: { base64: PNG_BASE64, mime: "image/png" },
    },
  });
  const id = (res.structuredContent as any).artifact_id as string;
  await client.close();
  return id;
}

describe("create_image references", () => {
  it("resolves all four variants to inline data URLs in the provider payload", async () => {
    const artifactId = await pushImageArtifact();
    const path = join(root, "ref.png");
    writeFileSync(path, Buffer.from(PNG_BASE64, "base64"));
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_image",
      arguments: {
        session_id: "ref-agent",
        title: "With references",
        prompt: "blend these",
        model: "cheap/model",
        references: [
          { artifact: { session_id: "ref-agent", artifact_id: artifactId } },
          { path },
          { base64: PNG_BASE64, mime: "image/png" },
          { url: `${IMAGE_URL_SERVER}/img.png` },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const call = fakeCalls.find((c) => c.path === "/chat/completions")!;
    expect(call).toBeDefined();
    const content = call.body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "blend these" });
    const imageParts = content.slice(1);
    expect(imageParts).toHaveLength(4);
    for (const part of imageParts) {
      expect(part.type).toBe("image_url");
      expect(part.image_url.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
    }
    await client.close();
  });

  it("rejects a non-image artifact reference with a clear message", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    // A markdown artifact in the same session
    const md = await client.callTool({
      name: "push_markdown",
      arguments: { session_id: "ref-agent", title: "Notes", content: "# hi" },
    });
    const mdId = (md.structuredContent as any).artifact_id as string;
    const res = await client.callTool({
      name: "create_image",
      arguments: {
        session_id: "ref-agent",
        title: "t",
        prompt: "p",
        model: "cheap/model",
        references: [{ artifact: { session_id: "ref-agent", artifact_id: mdId } }],
      },
    });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("image references only");
    await client.close();
  });

  it("rejects a url reference over the media size cap", async () => {
    // Dedicated server with a tiny cap; the image-url server serves 1 KiB.
    const port = 5114;
    const fakePort = 5115;
    const tinyFake = Bun.serve({
      port: fakePort,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ data: [{ id: "cheap/model", pricing: { image: "0.03" } }] }),
    });
    const bigServer = Bun.serve({
      port: IMAGE_URL_PORT + 10,
      hostname: "127.0.0.1",
      fetch: () => new Response(Buffer.alloc(2 * 1024 * 1024, 1), { headers: { "content-type": "image/png" } }),
    });
    const capRoot = mkdtempSync(join(tmpdir(), "aurora-ref-cap-"));
    const capArtifacts = mkdtempSync(join(tmpdir(), "aurora-ref-cap-a-"));
    const tinyServer = createServer(capRoot, port, {
      artifactsDir: capArtifacts,
      mediaSizeCap: 1024,
      generation: {
        apiKey: API_KEY,
        baseUrl: `http://127.0.0.1:${fakePort}`,
        whitelistPath: configPath,
        dbPath: join(capRoot, "generations.db"),
      },
    });
      const { client, transport } = makeClient();
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      const res = await client.callTool({
        name: "create_image",
        arguments: {
          session_id: "cap-agent",
          title: "t",
          prompt: "p",
          model: "cheap/model",
          references: [{ url: `http://127.0.0.1:${IMAGE_URL_PORT + 10}/big.png` }],
        },
      });
      expect(res.isError).toBe(true);
      const text = JSON.stringify(res.content);
      expect(text).toContain("cap");
      expect(text).toContain("2.0 MiB");
      await client.close();
      tinyServer.stop(true);
      tinyFake.stop(true);
      bigServer.stop(true);
      rmSync(capRoot, { recursive: true, force: true });
      rmSync(capArtifacts, { recursive: true, force: true });
  });

  it("rejects a base64 reference without mime", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_image",
      arguments: {
        session_id: "ref-agent",
        title: "t",
        prompt: "p",
        model: "cheap/model",
        references: [{ base64: PNG_BASE64 }],
      },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("mime");
    await client.close();
  });
});

describe("create_video references", () => {
  it("routes style references to input_references and frame roles to frame_images", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_video",
      arguments: {
        session_id: "ref-agent",
        title: "Routed video",
        prompt: "animate it",
        model: "fake/video-model",
        duration: 4,
        references: [
          { url: `${IMAGE_URL_SERVER}/style.png` },
          { url: `${IMAGE_URL_SERVER}/first.png`, role: "first_frame" },
          { url: `${IMAGE_URL_SERVER}/last.png`, role: "last_frame" },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const call = fakeCalls.find((c) => c.path === "/videos")!;
    expect(call).toBeDefined();
    expect(call.body.input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
    ]);
    expect(call.body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${PNG_BASE64}` },
        frame_type: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${PNG_BASE64}` },
        frame_type: "last_frame",
      },
    ]);
    await client.close();
  });

  it("chain: create_image output referenced by artifact id in create_video", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const img = await client.callTool({
      name: "create_image",
      arguments: { session_id: "chain-agent", title: "Frame", prompt: "a key", model: "cheap/model" },
    });
    expect(img.isError).toBeFalsy();
    const artifactId = (img.structuredContent as any).artifact_id as string;
    videoPhase = "completed";
    const vid = await client.callTool({
      name: "create_video",
      arguments: {
        session_id: "chain-agent",
        title: "From image",
        prompt: "animate the key",
        model: "fake/video-model",
        duration: 4,
        references: [{ artifact: { session_id: "chain-agent", artifact_id: artifactId } }],
      },
    });
    expect(vid.isError).toBeFalsy();
    const call = [...fakeCalls].reverse().find((c) => c.path === "/videos")!;
    expect(call.body.frame_images).toBeUndefined();
    expect(call.body.input_references).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } },
    ]);
    videoPhase = "pending";
    await client.close();
  });
});

describe("reference schema validity", () => {
  it("both generation tools' inputSchemas validate under JSON Schema draft 2020-12", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const schemas = ["create_image", "create_video"].map(
      (name) => tools.find((t) => t.name === name)!.inputSchema
    );
    await client.close();
    const script = `
import json, sys
from jsonschema import Draft202012Validator
for path in sys.argv[1:]:
    with open(path) as f:
        Draft202012Validator.check_schema(json.load(f))
`;
    const paths = schemas.map((s, i) => join(tmpdir(), `aurora-ref-schema-${Date.now()}-${i}.json`));
    schemas.forEach((s, i) => writeFileSync(paths[i], JSON.stringify(s)));
    try {
      const proc = Bun.spawnSync(["python3", "-c", script, ...paths]);
      const stderr = new TextDecoder().decode(proc.stderr);
      expect(stderr, stderr).toBe("");
      expect(proc.exitCode).toBe(0);
    } finally {
      for (const p of paths) rmSync(p, { force: true });
    }
  });
});
