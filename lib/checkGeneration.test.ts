import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import type { GenerationOptions } from "./mcpSurface";
import { JobRegistry } from "./jobRegistry";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
// Distinct port per test server: rapid stop/rebind on one port races EADDRINUSE.
const PORTS = [5105, 5106, 5107, 5108, 5109, 5110, 5111, 5113, 5114];
let portCursor = 0;
const FAKE_OPENROUTER_PORT = 5121;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// A real OPENROUTER_API_KEY in the environment would change tool registration.
delete process.env.OPENROUTER_API_KEY;

// Minimal fake mp4 payload and 1x1 PNG (bytes, not real streams).
const VIDEO_BASE64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface FakeCall {
  method: string;
  path: string;
  auth: string | null;
  body: any;
}

let fakeCalls: FakeCall[] = [];
/** Provider-side job phase the fake serves for every video job. */
let phase: "pending" | "completed" | "failed" = "pending";
let failReason = "provider exploded";
let fakeServer: ReturnType<typeof Bun.serve>;
let fakeJobCounter = 0;

function startFakeOpenRouter() {
  fakeServer = Bun.serve({
    port: FAKE_OPENROUTER_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      const record = (body: any) => fakeCalls.push({ method: req.method, path: url.pathname, auth, body });
      if (req.method === "POST" && url.pathname === "/videos") {
        record(await req.json());
        const id = `job-${++fakeJobCounter}`;
        return Response.json({ id, status: "pending" }, { status: 202 });
      }
      if (req.method === "POST" && url.pathname === "/chat/completions") {
        record(await req.json());
        return Response.json({
          choices: [
            {
              message: { role: "assistant", content: "", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }] },
              finish_reason: "stop",
            },
          ],
          usage: { cost: 0.042 },
        });
      }
      const statusMatch = url.pathname.match(/^\/videos\/([^/]+)$/);
      if (req.method === "GET" && statusMatch) {
        record(null);
        if (phase === "completed") {
          return Response.json({
            id: statusMatch[1],
            status: "completed",
            unsigned_urls: [`${FAKE_OPENROUTER}/videos/${statusMatch[1]}/content`],
            usage: { cost: 0.25 },
          });
        }
        if (phase === "failed") {
          return Response.json({ id: statusMatch[1], status: "failed", error: failReason });
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

let root: string;
let artifactsDir: string;
let configPath: string;
let dbPath: string;

function makeClient(port: number) {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

function writeWhitelistConfig() {
  writeFileSync(
    configPath,
    JSON.stringify({
      image: [{ id: "cheap/model", default: true }],
      video: [
        {
          id: "fake/video-model",
          note: "test video tier",
          default: true,
          durations: [4, 6, 8],
          resolutions: ["720p", "1080p"],
          aspect_ratios: ["16:9", "9:16"],
          supports_audio: true,
        },
      ],
    })
  );
}

interface TestServer {
  server: ReturnType<typeof createServer>;
  generation: GenerationOptions;
  registry: JobRegistry;
  port: number;
}

// Long poll cadence: the background poller never fires in-test, so only
// check_generation drives terminal transitions.
async function startServer(): Promise<TestServer> {
  const port = PORTS[portCursor++];
  writeWhitelistConfig();
  const generation: GenerationOptions = {
    apiKey: API_KEY,
    baseUrl: FAKE_OPENROUTER,
    whitelistPath: configPath,
    dbPath,
    pollIntervalMs: 60_000,
  };
  const server = createServer(port, { artifactsDir, generation });
  // Give the fire-and-forget startup catalog fetches a moment to land.
  await Bun.sleep(150);
  return { server, generation, registry: new JobRegistry(dbPath), port };
}

function stopAll(ts: TestServer) {
  ts.generation.videoService?.stopAll();
  ts.server.stop(true);
  ts.registry.close();
}

async function listArtifacts(port: number, sessionId: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/preview/sessions/${sessionId}/artifacts`);
  return (await res.json()) as any[];
}

async function submitVideo(ts: TestServer, sessionId: string, title: string) {
  const { client, transport } = makeClient(ts.port);
  await client.connect(transport);
  const res = await client.callTool({
    name: "create_video",
    arguments: { session_id: sessionId, title, prompt: "a lighthouse in fog", model: "fake/video-model" },
  });
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  return { jobId: (res.structuredContent as any).job_id, client };
}

beforeAll(() => {
  startFakeOpenRouter();
  root = mkdtempSync(join(tmpdir(), "aurora-check-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-check-artifacts-"));
  configPath = join(root, "generation.json");
  dbPath = join(root, "generations.db");
});

afterAll(() => {
  fakeServer?.stop(true);
  for (const dir of [root, artifactsDir]) rmSync(dir, { recursive: true, force: true });
});

describe("check_generation", () => {
  beforeEach(() => {
    fakeCalls = [];
    phase = "pending";
  });

  it("is registered alongside the other generation tools", async () => {
    const ts = await startServer();
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("check_generation");
    const tool = tools.find((t) => t.name === "check_generation");
    expect((tool!.inputSchema as any).required).toContain("job_id");
    await client.close();
    stopAll(ts);
  });

  it("check_generation inputSchema validates under JSON Schema draft 2020-12", async () => {
    const ts = await startServer();
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "check_generation");
    expect(tool).toBeDefined();
    await client.close();
    stopAll(ts);

    const script = `
import json, sys
from jsonschema import Draft202012Validator
with open(sys.argv[1]) as f:
    schema = json.load(f)
Draft202012Validator.check_schema(schema)
`;
    const schemaPath = join(root, `check-generation-schema-${Date.now()}.json`);
    writeFileSync(schemaPath, JSON.stringify(tool!.inputSchema));
    const proc = Bun.spawnSync(["python3", "-c", script, schemaPath]);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(stderr, stderr).toBe("");
    expect(proc.exitCode).toBe(0);
  });

  it("pending job: returns current status with no side effects; live status GET carries the auth header", async () => {
    const ts = await startServer();
    const { jobId, client } = await submitVideo(ts, "cg-pending", "Pending clip");
    const res = await client.callTool({ name: "check_generation", arguments: { job_id: jobId } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.status).toBe("pending");
    expect(structured.artifact_id).toBeUndefined();
    expect(structured.cost).toBeUndefined();
    // Registry row untouched.
    expect(ts.registry.getJob(jobId)!.status).toBe("pending");
    // The live status request hit the provider with the bearer key.
    const statusCall = fakeCalls.find((c) => c.method === "GET" && /^\/videos\/job-/.test(c.path))!;
    expect(statusCall).toBeDefined();
    expect(statusCall.auth).toBe(`Bearer ${API_KEY}`);
    await client.close();
    stopAll(ts);
  });

  it("completed-but-unprocessed job: check drives the full completion path and returns artifact id, deep link, cost", async () => {
    const ts = await startServer();
    const { jobId, client } = await submitVideo(ts, "cg-eager", "Eager clip");
    phase = "completed";

    // Live-bus event on the check-driven completion push.
    const ws = new WebSocket(`ws://127.0.0.1:${ts.port}/ws`);
    const nextEvent = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for WS event")), 5000);
      ws.addEventListener("message", (msg) => {
        const e = JSON.parse(String(msg.data));
        if (e.session_id === "cg-eager" && (e.event === "pushed" || e.event === "updated")) {
          clearTimeout(timer);
          resolve(e);
        }
      });
    });

    const res = await client.callTool({ name: "check_generation", arguments: { job_id: jobId } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.status).toBe("completed");
    expect(structured.cost).toBe(0.25);
    expect(structured.deep_link).toBe(`http://127.0.0.1:${ts.port}/s/cg-eager`);
    expect(structured.artifact_id).toBeDefined();

    // Registry updated; artifact snapshotted in the store.
    const job = ts.registry.getJob(jobId)!;
    expect(job.status).toBe("completed");
    expect(job.usage_cost).toBe(0.25);
    expect(job.artifact_id).toBe(structured.artifact_id);
    const artifacts = await listArtifacts(ts.port, "cg-eager");
    const video = artifacts.find((a) => a.artifact_id === structured.artifact_id);
    expect(video.type).toBe("video");
    expect(video.mime).toBe("video/mp4");
    // Content download went out authenticated.
    const contentCall = fakeCalls.find((c) => c.path.endsWith("/content"))!;
    expect(contentCall.auth).toBe(`Bearer ${API_KEY}`);

    const event = await nextEvent;
    expect(event.artifact_id).toBe(structured.artifact_id);
    ws.close();
    await client.close();
    stopAll(ts);
  });

  it("failed job surfaced through the check path: provider error visible, failure artifact pushed", async () => {
    const ts = await startServer();
    const { jobId, client } = await submitVideo(ts, "cg-fail", "Doomed clip");
    phase = "failed";
    failReason = "safety filter rejected the prompt";
    const res = await client.callTool({ name: "check_generation", arguments: { job_id: jobId } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.status).toBe("failed");
    expect(structured.artifact_id).toBeDefined();
    expect(JSON.stringify(res.content)).toContain("safety filter rejected the prompt");
    const job = ts.registry.getJob(jobId)!;
    expect(job.status).toBe("failed");
    const artifacts = await listArtifacts(ts.port, "cg-fail");
    const failure = artifacts.find((a) => a.type === "markdown" && /failed/i.test(a.title));
    expect(failure).toBeDefined();
    await client.close();
    stopAll(ts);
  });

  it("unknown job id returns an actionable error, not a crash", async () => {
    const ts = await startServer();
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const res = await client.callTool({ name: "check_generation", arguments: { job_id: "no-such-job" } });
    expect(res.isError).toBe(true);
    const text = (res.content as any[])[0].text;
    expect(text.toLowerCase()).toContain("unknown job");
    expect(text).toContain("no-such-job");
    await client.close();
    stopAll(ts);
  });

  it("image generation jobs are recorded and checkable", async () => {
    const ts = await startServer();
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const create = await client.callTool({
      name: "create_image",
      arguments: { session_id: "cg-image", title: "A dot", prompt: "a red dot", model: "cheap/model" },
    });
    expect(create.isError, JSON.stringify(create.content)).toBeFalsy();
    const jobId = (create.structuredContent as any).job_id;
    expect(jobId).toBeDefined();

    const res = await client.callTool({ name: "check_generation", arguments: { job_id: jobId } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.status).toBe("completed");
    expect(structured.artifact_id).toBe((create.structuredContent as any).artifact_id);
    expect(structured.cost).toBe(0.042);
    expect(structured.deep_link).toBe(`http://127.0.0.1:${ts.port}/s/cg-image`);
    expect(ts.registry.getJob(jobId)!.status).toBe("completed");
    await client.close();
    stopAll(ts);
  });

  it("check does not double-push when a poller races the check on the same job", async () => {
    // Short poll cadence so a background poller is live; the completing guard
    // must keep the artifact push single-shot.
    const port = PORTS[portCursor++];
    writeWhitelistConfig();
    const generation: GenerationOptions = {
      apiKey: API_KEY,
      baseUrl: FAKE_OPENROUTER,
      whitelistPath: configPath,
      dbPath,
      pollIntervalMs: 25,
    };
    const server = createServer(port, { artifactsDir, generation });
    await Bun.sleep(150);
    const ts: TestServer = { server, generation, registry: new JobRegistry(dbPath), port };
    const { jobId, client } = await submitVideo(ts, "cg-race", "Race clip");
    phase = "completed";
    // Both the background poller and the eager check drive the same job.
    const [checkRes] = await Promise.all([
      client.callTool({ name: "check_generation", arguments: { job_id: jobId } }),
      (async () => {
        const deadline = Date.now() + 5000;
        while (ts.registry.getJob(jobId)!.status === "pending") await Bun.sleep(10);
      })(),
    ]);
    expect((checkRes.structuredContent as any).status).toBe("completed");
    const artifacts = await listArtifacts(ts.port, "cg-race");
    const videos = artifacts.filter((a) => a.type === "video");
    expect(videos.length).toBe(1);
    expect(ts.registry.getJob(jobId)!.artifact_id).toBe(videos[0].artifact_id);
    await client.close();
    stopAll(ts);
  });
});
