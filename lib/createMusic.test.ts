import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { OpenRouterClient } from "./openrouter";
import type { GenerationOptions } from "./mcpSurface";
import { JobRegistry } from "./jobRegistry";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5131;
const FAKE_OPENROUTER_PORT = 5132;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// A real OPENROUTER_API_KEY in the environment would change tool registration.
delete process.env.OPENROUTER_API_KEY;

// 1x1 PNG for image-conditioning references.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Minimal fake MP3 payload: ID3 header is what the audio mime sniffer keys on.
const MP3_BASE64 = Buffer.from("ID3\x03\x00fake-mp3-audio-bytes", "latin1").toString("base64");
// Split payload for the multi-audio-chunk SSE fixture: both halves decode and
// concatenate back to the exact original bytes.
const MP3_BYTES = Buffer.from(MP3_BASE64, "base64");
const MP3_HALF = Math.floor(MP3_BYTES.length / 2);
const MP3_A_BASE64 = MP3_BYTES.subarray(0, MP3_HALF).toString("base64");
const MP3_B_BASE64 = MP3_BYTES.subarray(MP3_HALF).toString("base64");

const TRANSCRIPT = "[Verse 1]\nHello aurora [0.0:2.6] [[A0]]";

interface FakeCall {
  path: string;
  auth: string | null;
  body: any;
}

let fakeCalls: FakeCall[] = [];
/** Which SSE fixture the fake serves for /chat/completions on this test. */
let sseMode: "single" | "multi" | "noaudio" = "single";
let fakeServer: ReturnType<typeof Bun.serve>;

function sseResponse(events: any[]): Response {
  const body =
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function startFakeOpenRouter() {
  fakeServer = Bun.serve({
    port: FAKE_OPENROUTER_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (req.method === "POST" && url.pathname === "/chat/completions") {
        fakeCalls.push({ path: url.pathname, auth, body: await req.json() });
        if (sseMode === "single") {
          return sseResponse([
            { choices: [{ delta: { content: TRANSCRIPT } }] },
            { choices: [{ delta: { audio: { data: MP3_BASE64 } } }] },
            { choices: [], usage: { cost: 0.04 } },
          ]);
        }
        if (sseMode === "multi") {
          return sseResponse([
            { choices: [{ delta: { content: "[Intro]" } }] },
            { choices: [{ delta: { audio: { data: MP3_A_BASE64 } } }] },
            { choices: [{ delta: { audio: { data: MP3_B_BASE64 } } }] },
            { choices: [{ delta: { content: " coda" } }] },
            { choices: [], usage: { cost: 0.08 } },
          ]);
        }
        // noaudio: structure text only, the stream ends without audio chunks.
        return sseResponse([{ choices: [{ delta: { content: TRANSCRIPT } }] }]);
      }
      if (url.pathname === "/models") {
        fakeCalls.push({ path: url.pathname, auth, body: null });
        return Response.json({ data: [{ id: "clip/model", pricing: { image: "0.04" } }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

let root: string;
let artifactsDir: string;
let configPath: string;
let dbPath: string;
let server: ReturnType<typeof createServer>;
let generation: GenerationOptions;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

function writeConfig(models: any[]) {
  // Per-modality override: only music is overridden; image/video fall back to
  // code-shipped defaults.
  writeFileSync(configPath, JSON.stringify({ music: models }));
}

async function listArtifacts(sessionId: string) {
  const res = await fetch(`${BASE}/api/preview/sessions/${sessionId}/artifacts`);
  return (await res.json()) as any[];
}

async function getArtifact(sessionId: string, artifactId: string) {
  const res = await fetch(`${BASE}/api/preview/sessions/${sessionId}/artifacts/${artifactId}`);
  return (await res.json()) as any;
}

beforeAll(async () => {
  startFakeOpenRouter();
  root = mkdtempSync(join(tmpdir(), "aurora-music-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-music-artifacts-"));
  configPath = join(root, "generation.json");
  dbPath = join(root, "generations.db");
  writeConfig([
    { id: "clip/model", note: "$0.04/clip", default: true },
    { id: "pro/model", note: "$0.08/song" },
  ]);
  // Long poll cadence: the background video poller never fires in-test.
  generation = {
    apiKey: API_KEY,
    baseUrl: FAKE_OPENROUTER,
    whitelistPath: configPath,
    dbPath,
    pollIntervalMs: 60_000,
  };
  server = createServer(PORT, { artifactsDir, generation });
  // Give the fire-and-forget startup catalog fetch a moment to land.
  await Bun.sleep(150);
});

afterAll(() => {
  generation.videoService?.stopAll();
  server?.stop(true);
  fakeServer?.stop(true);
  for (const dir of [root, artifactsDir]) rmSync(dir, { recursive: true, force: true });
});

describe("create_music", () => {
  it("is registered with a whitelist enum and per-song price hints in the description", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_music");
    expect(tool).toBeDefined();
    const modelSchema = (tool!.inputSchema as any).properties.model;
    expect(modelSchema.type).toBe("string");
    expect(modelSchema.enum).toEqual(["clip/model", "pro/model"]);
    // Per-song price hints (spec #55 decision 9) surface in the description
    // so agents can weigh model choice.
    expect(tool!.description).toContain("$0.04/clip");
    expect(tool!.description).toContain("$0.08/song");
    expect(tool!.description).toContain("[default]");
    await client.close();
  });

  it("happy path: SSE parse → audio artifact with transcript, registry-recorded", async () => {
    sseMode = "single";
    fakeCalls = [];
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_music",
      arguments: {
        session_id: "music-agent",
        title: "Celebration song",
        prompt: "a triumphant song about aurora",
        model: "clip/model",
      },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.model).toBe("clip/model");
    expect(structured.cost).toBe(0.04);
    expect(structured.transcript).toBe(TRANSCRIPT);
    expect(structured.artifact_id).toBeDefined();
    expect(structured.deep_link).toBe(`${BASE}/preview/music-agent`);
    expect(structured.created).toBe(true);

    // Auth header asserted: the fake server saw the bearer key
    const call = fakeCalls.find((c) => c.path === "/chat/completions");
    expect(call).toBeDefined();
    expect(call!.auth).toBe(`Bearer ${API_KEY}`);
    expect(call!.body.model).toBe("clip/model");
    expect(call!.body.modalities).toEqual(["text", "audio"]);
    expect(call!.body.stream).toBe(true);
    expect(call!.body.usage).toEqual({ include: true });
    expect(call!.body.messages[0].content).toBe("a triumphant song about aurora");

    // Bytes were snapshotted as an audio artifact; the mime is sniffed from
    // the ID3 header (spec #55 decision 7), and the transcript persisted.
    const artifact = await getArtifact("music-agent", structured.artifact_id);
    expect(artifact.meta.type).toBe("audio");
    expect(artifact.meta.mime).toBe("audio/mpeg");
    expect(artifact.meta.transcript).toBe(TRANSCRIPT);
    const blobRes = await fetch(
      `${BASE}/api/preview/sessions/music-agent/artifacts/${structured.artifact_id}/blob`
    );
    expect(Buffer.from(await blobRes.arrayBuffer()).toString("base64")).toBe(MP3_BASE64);

    // Synchronous completion is recorded in the registry like create_image
    // so check_generation looks it up uniformly.
    const check = await client.callTool({ name: "check_generation", arguments: { job_id: structured.job_id } });
    expect(check.isError).toBeFalsy();
    const checkStructured = check.structuredContent as any;
    expect(checkStructured.status).toBe("completed");
    expect(checkStructured.artifact_id).toBe(structured.artifact_id);
    expect(checkStructured.cost).toBe(0.04);
    await client.close();
  });

  it("multi-chunk SSE: audio chunks concatenate, transcript joins, final usage.cost wins", async () => {
    sseMode = "multi";
    const client = new OpenRouterClient({ apiKey: API_KEY, baseUrl: FAKE_OPENROUTER });
    const result = await client.generateMusic({ model: "pro/model", prompt: "a ballad" });
    expect(result.base64).toBe(MP3_BASE64);
    expect(result.transcript).toBe("[Intro] coda");
    expect(result.cost).toBe(0.08);
  });

  it("SSE stream without audio chunks fails with an actionable error", async () => {
    sseMode = "noaudio";
    const client = new OpenRouterClient({ apiKey: API_KEY, baseUrl: FAKE_OPENROUTER });
    expect(
      client.generateMusic({ model: "clip/model", prompt: "lyrics only" })
    ).rejects.toThrow(/no audio payload/i);
  });

  it("image references are forwarded as image_url content parts alongside the prompt", async () => {
    sseMode = "single";
    fakeCalls = [];
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_music",
      arguments: {
        session_id: "music-agent",
        title: "Themed song",
        prompt: "sing about this picture",
        model: "clip/model",
        references: [{ base64: PNG_BASE64, mime: "image/png" }],
      },
    });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const call = fakeCalls.find((c) => c.path === "/chat/completions")!;
    const content = call.body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "sing about this picture" });
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url.url).toBe(`data:image/png;base64,${PNG_BASE64}`);
    await client.close();
  });

  it("replace-in-place via artifact_id mirrors push semantics", async () => {
    sseMode = "single";
    const { client, transport } = makeClient();
    await client.connect(transport);
    const first = await client.callTool({
      name: "create_music",
      arguments: { session_id: "music-agent", title: "Song", prompt: "v1", model: "clip/model" },
    });
    const firstId = (first.structuredContent as any).artifact_id;
    const second = await client.callTool({
      name: "create_music",
      arguments: {
        session_id: "music-agent",
        title: "Song",
        prompt: "v2",
        model: "clip/model",
        artifact_id: firstId,
      },
    });
    const structured = second.structuredContent as any;
    expect(structured.created).toBe(false);
    expect(structured.artifact_id).toBe(firstId);
    await client.close();
  });

  it("rejects a non-whitelisted model with an actionable error", async () => {
    sseMode = "single";
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client
      .callTool({
        name: "create_music",
        arguments: { session_id: "music-agent", title: "t", prompt: "p", model: "unknown/model" },
      })
      .catch((err: any) => err);
    // Schema-level rejection from the whitelist enum, either as an error
    // result or as a thrown SDK client error — both name the bad model.
    const rendered = res?.isError ? JSON.stringify(res.content) : String(res);
    expect(rendered).toMatch(/unknown\.model|enum|expected one of/i);
    await client.close();
  });

  it("config-file edits change the model enum without restart (per-modality override)", async () => {
    sseMode = "single";
    writeConfig([{ id: "only/song-model", default: true }]);
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_music");
    expect((tool!.inputSchema as any).properties.model.enum).toEqual(["only/song-model"]);
    await client.close();
  });
});
