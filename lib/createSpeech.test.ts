import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { OpenRouterClient } from "./openrouter";

// create_speech (issue #57): /audio/speech client fetch, whitelist voice
// fill, voice-cloning preflight, resolver modality (audio refs accepted for
// speech), artifact landing with byte-sniffed mime, replace-in-place.

const PORT = 5121;
const FAKE_OPENROUTER_PORT = 5122;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// Fake mp3 (ID3 header) and wav (RIFF/WAVE) payloads; bytes only need the
// sniffable signatures.
const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x01, 0x02, 0x03]);
const WAV_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x00, 0x01,
]);
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface FakeCall {
  path: string;
  body: any;
}

let fakeCalls: FakeCall[] = [];
/** Marker voice: the fake provider 400s it, mirroring unknown-voice behavior. */
let failVoice: string | null = null;
let fakeServer: ReturnType<typeof Bun.serve>;

function startFakeOpenRouter() {
  fakeServer = Bun.serve({
    port: FAKE_OPENROUTER_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/audio/speech") {
        const body = await req.json();
        fakeCalls.push({ path: url.pathname, body });
        if (failVoice !== null && body.voice === failVoice) {
          return Response.json({ error: { message: `unknown voice ${body.voice}` } }, { status: 400 });
        }
        const wav = body.response_format === "wav";
        return new Response(wav ? WAV_BYTES : MP3_BYTES, {
          headers: {
            "content-type": wav ? "audio/wav" : "audio/mpeg",
            "x-request-id": "gen-speech-123",
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/chat/completions") {
        fakeCalls.push({ path: url.pathname, body: await req.json() });
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
        });
      }
      if (url.pathname === "/models") {
        return Response.json({ data: [] });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

let root: string;
let artifactsDir: string;
let dbPath: string;
let configPath: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

function writeConfig(speech: any[]) {
  // Image/video keys omitted: those modalities fall back to defaults while
  // speech is overridden per-modality (spec #55 decision 3).
  writeFileSync(configPath, JSON.stringify({ speech }));
}

beforeAll(async () => {
  startFakeOpenRouter();
  root = mkdtempSync(join(tmpdir(), "aurora-speech-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-speech-artifacts-"));
  dbPath = join(root, "generations.db"); // temp registry db (sandbox has no ~/.local/share)
  configPath = join(root, "generation.json");
  writeConfig([
    { id: "hexgrad/kokoro-82m", default: true, default_voice: "af_heart" },
    { id: "elevenlabs/eleven-v4", default_voice: "Rachel", supports_voice_cloning: true },
  ]);
  server = createServer(root, PORT, {
    artifactsDir,
    generation: {
      apiKey: API_KEY,
      baseUrl: FAKE_OPENROUTER,
      whitelistPath: configPath,
      dbPath,
    },
  });
});

afterAll(() => {
  server?.stop(true);
  fakeServer?.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("create_speech", () => {
  it("is registered with a speech whitelist enum and the per-character price note", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_speech");
    expect(tool).toBeDefined();
    expect((tool!.inputSchema as any).properties.model.enum).toEqual([
      "hexgrad/kokoro-82m",
      "elevenlabs/eleven-v4",
    ]);
    expect(tool!.description).toContain("Priced per input character");
    expect(tool!.description).toContain("voice cloning");
    await client.close();
  });

  it("happy path: omitted voice fills from the whitelist default_voice and lands an audio artifact", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_speech",
      arguments: { session_id: "speech-agent", title: "Narration", input: "hello world", model: "hexgrad/kokoro-82m" },
    });
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.voice).toBe("af_heart");
    expect(structured.artifact_id).toBeDefined();
    expect(structured.deep_link).toBe(`${BASE}/preview/speech-agent`);
    expect(structured.created).toBe(true);

    const call = fakeCalls.find((c) => c.path === "/audio/speech");
    expect(call).toBeDefined();
    expect(call!.body.model).toBe("hexgrad/kokoro-82m");
    expect(call!.body.input).toBe("hello world");
    expect(call!.body.voice).toBe("af_heart");
    expect(call!.body.response_format).toBe("mp3");

    // Bytes were snapshotted as an audio artifact with the sniffed mime
    const listRes = await fetch(`${BASE}/api/preview/sessions/speech-agent/artifacts`);
    const artifacts = (await listRes.json()) as any[];
    const audio = artifacts.find((a) => a.artifact_id === structured.artifact_id);
    expect(audio.type).toBe("audio");
    expect(audio.mime).toBe("audio/mpeg");

    // Completed speech jobs are recorded in the registry like image jobs
    expect(structured.job_id).toBeDefined();
    const check = await client.callTool({ name: "check_generation", arguments: { job_id: structured.job_id } });
    expect((check.structuredContent as any).status).toBe("completed");
    expect((check.structuredContent as any).artifact_id).toBe(structured.artifact_id);
    await client.close();
  });

  it("response_format wav passes through and the mime is sniffed from bytes", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "Narration wav",
        input: "wav please",
        model: "hexgrad/kokoro-82m",
        response_format: "wav",
      },
    });
    expect(res.isError).toBeFalsy();
    const call = fakeCalls.at(-1)!;
    expect(call.body.response_format).toBe("wav");
    const structured = res.structuredContent as any;
    const listRes = await fetch(`${BASE}/api/preview/sessions/speech-agent/artifacts`);
    const audio = ((await listRes.json()) as any[]).find((a) => a.artifact_id === structured.artifact_id);
    expect(audio.mime).toBe("audio/wav");
    await client.close();
  });

  it("replace-in-place via artifact_id mirrors push semantics", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const first = await client.callTool({
      name: "create_speech",
      arguments: { session_id: "speech-agent", title: "Narration", input: "v1", model: "hexgrad/kokoro-82m" },
    });
    const firstId = (first.structuredContent as any).artifact_id;
    const second = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "Narration",
        input: "v2",
        model: "hexgrad/kokoro-82m",
        artifact_id: firstId,
      },
    });
    const structured = second.structuredContent as any;
    expect(structured.created).toBe(false);
    expect(structured.artifact_id).toBe(firstId);
    await client.close();
  });

  it("unknown voices surface the provider 400 to the agent", async () => {
    failVoice = "not-a-voice";
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "t",
        input: "p",
        model: "hexgrad/kokoro-82m",
        voice: "not-a-voice",
      },
    });
    failVoice = null;
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("400");
    expect(text).toContain("not-a-voice");
    await client.close();
  });

  it("input_references on a non-cloning model fail preflight with an actionable error", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const speechCallsBefore = fakeCalls.filter((c) => c.path === "/audio/speech").length;
    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "t",
        input: "p",
        model: "hexgrad/kokoro-82m",
        input_references: [{ base64: Buffer.from(MP3_BYTES).toString("base64"), mime: "audio/mpeg" }],
      },
    });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("hexgrad/kokoro-82m");
    expect(text).toContain("voice cloning");
    // No provider call was made by the rejected preflight
    expect(fakeCalls.filter((c) => c.path === "/audio/speech").length).toBe(speechCallsBefore);
    await client.close();
  });

  it("cloning references resolve to inline input_audio parts with paired transcripts", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    // Seed an audio artifact via push_audio so cloning composes with pushes
    const pushed = await client.callTool({
      name: "push_audio",
      arguments: {
        session_id: "speech-agent",
        title: "Voice sample",
        source: { base64: Buffer.from(WAV_BYTES).toString("base64"), mime: "audio/wav" },
      },
    });
    const sampleId = (pushed.structuredContent as any).artifact_id;

    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "Cloned narration",
        input: "mimic this voice",
        model: "elevenlabs/eleven-v4",
        input_references: [
          { artifact: { session_id: "speech-agent", artifact_id: sampleId }, transcript: "transcript of the sample" },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const call = fakeCalls.find((c) => c.path === "/audio/speech" && c.body.model === "elevenlabs/eleven-v4");
    expect(call).toBeDefined();
    expect(call!.body.voice).toBe("Rachel");
    const parts = call!.body.input;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts[0]).toEqual({ type: "text", text: "mimic this voice" });
    expect(parts[1]).toEqual({ type: "text", text: "transcript of the sample" });
    expect(parts[2].type).toBe("input_audio");
    expect(parts[2].input_audio.format).toBe("wav");
    expect(parts[2].input_audio.data).toMatch(/^data:audio\/wav;base64,/);
    await client.close();
  });

  it("pairs per-clip transcripts by position when an earlier reference omits its transcript", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    // First clip has no transcript; second clip does. The pairing must stay
    // positional: the transcript text part precedes the second input_audio part.
    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "Sparse transcripts",
        input: "mimic this voice",
        model: "elevenlabs/eleven-v4",
        input_references: [
          { base64: Buffer.from(WAV_BYTES).toString("base64"), mime: "audio/wav" },
          { base64: Buffer.from(MP3_BYTES).toString("base64"), mime: "audio/mpeg", transcript: "second clip transcript" },
        ],
      },
    });
    expect(res.isError).toBeFalsy();
    const calls = fakeCalls.filter((c) => c.path === "/audio/speech" && c.body.model === "elevenlabs/eleven-v4");
    const parts = calls[calls.length - 1]!.body.input;
    expect(parts[0]).toEqual({ type: "text", text: "mimic this voice" });
    expect(parts[1].type).toBe("input_audio");
    expect(parts[2]).toEqual({ type: "text", text: "second clip transcript" });
    expect(parts[3].type).toBe("input_audio");
    expect(parts[3].input_audio.format).toBe("mp3");
    await client.close();
  });

  it("rejects an image artifact as a speech reference with a clear error", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const pushed = await client.callTool({
      name: "push_image",
      arguments: {
        session_id: "speech-agent",
        title: "An image",
        source: { base64: PNG_BASE64, mime: "image/png" },
      },
    });
    const imageId = (pushed.structuredContent as any).artifact_id;
    const res = await client.callTool({
      name: "create_speech",
      arguments: {
        session_id: "speech-agent",
        title: "t",
        input: "p",
        model: "elevenlabs/eleven-v4",
        input_references: [{ artifact: { session_id: "speech-agent", artifact_id: imageId } }],
      },
    });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("image artifact");
    expect(text).toContain("audio");
    await client.close();
  });
});

describe("generateSpeech client", () => {
  it("posts to /audio/speech and returns bytes, mime from content-type, and the generation id", async () => {
    const client = new OpenRouterClient({ apiKey: API_KEY, baseUrl: FAKE_OPENROUTER });
    const result = await client.generateSpeech({
      model: "hexgrad/kokoro-82m",
      input: "unit",
      voice: "af_heart",
      response_format: "mp3",
    });
    expect(result.mime).toBe("audio/mpeg");
    expect(result.generationId).toBe("gen-speech-123");
    expect(Buffer.from(result.bytes.subarray(0, 3)).toString("ascii")).toBe("ID3");
  });

  it("provider errors pass through with their HTTP status", async () => {
    failVoice = "bad-voice";
    const client = new OpenRouterClient({ apiKey: API_KEY, baseUrl: FAKE_OPENROUTER });
    try {
      await client.generateSpeech({
        model: "hexgrad/kokoro-82m",
        input: "unit",
        voice: "bad-voice",
        response_format: "mp3",
      });
      throw new Error("expected rejection");
    } catch (err: any) {
      expect(err.message).toContain("(400)");
      expect(err.message).toContain("bad-voice");
    } finally {
      failVoice = null;
    }
  });
});