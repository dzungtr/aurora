import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import type { GenerationOptions } from "./mcpSurface";
import { JobRegistry } from "./jobRegistry";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
// Distinct port per test server: rapid stop/rebind on one port races EADDRINUSE.
const PORTS = [5091, 5093, 5094, 5095, 5096, 5097, 5098, 5099, 5101, 5103];
let portCursor = 0;
const FAKE_OPENROUTER_PORT = 5092;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// A real OPENROUTER_API_KEY in the environment would change tool registration.
delete process.env.OPENROUTER_API_KEY;

// Minimal fake mp4 payload (bytes, not a real stream; only store/transport tested).
const VIDEO_BASE64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

interface FakeCall {
  method: string;
  path: string;
  auth: string | null;
  body: any;
}

let fakeCalls: FakeCall[] = [];
/** Provider-side job phase the fake serves for every submitted job. */
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
        return Response.json(
          { id, polling_url: `${FAKE_OPENROUTER}/videos/${id}`, status: "pending" },
          { status: 202 }
        );
      }
      if (req.method === "GET" && url.pathname === "/videos/models") {
        record(null);
        return Response.json({
          data: [
            {
              id: "fake/video-model",
              pricing_skus: { cents_per_video_output_second_720p: "5" },
            },
          ],
        });
      }
      const statusMatch = url.pathname.match(/^\/videos\/([^/]+)$/);
      if (req.method === "GET" && statusMatch) {
        record(null);
        if (phase === "completed") {
          return Response.json({
            id: statusMatch[1],
            status: "completed",
            unsigned_urls: [`${FAKE_OPENROUTER}/videos/${statusMatch[1]}/content?index=0`],
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

function writeConfig(videoModels: any[]) {
  writeFileSync(
    configPath,
    JSON.stringify({
      image: [{ id: "cheap/model", default: true }],
      video: videoModels,
    })
  );
}

interface TestServer {
  server: ReturnType<typeof createServer>;
  generation: GenerationOptions;
  registry: JobRegistry;
}

async function startServer(opts: { pollIntervalMs?: number; jobCeilingMs?: number; dbPath?: string } = {}): Promise<TestServer & { port: number }> {
  const port = PORTS[portCursor++];
  // Explicit `dbPath: undefined` selects the default (~/.local/share/aurora).
  const usedDb = "dbPath" in opts ? opts.dbPath : dbPath;
  writeConfig([
    {
      id: "fake/video-model",
      note: "test video tier",
      default: true,
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspect_ratios: ["16:9", "9:16"],
      supports_audio: true,
    },
    {
      id: "fake/video-no-audio",
      note: "test video tier without audio",
      durations: [4, 6, 8],
      resolutions: ["720p", "1080p"],
      aspect_ratios: ["16:9", "9:16"],
      supports_audio: false,
    },
  ]);
  const generation: GenerationOptions = {
    apiKey: API_KEY,
    baseUrl: FAKE_OPENROUTER,
    whitelistPath: configPath,
    dbPath: usedDb,
    pollIntervalMs: opts.pollIntervalMs,
    jobCeilingMs: opts.jobCeilingMs,
  };
  const server = createServer(port, { artifactsDir, generation });
  // Give the fire-and-forget startup catalog fetches a moment to land.
  await Bun.sleep(150);
  // The fresh-HOME test leaves usedDb undefined; that test never touches the
  // registry handle, so fall back to the shared test db for typing only.
  return { server, generation, registry: new JobRegistry(usedDb ?? dbPath), port };
}

async function awaitRegistryStatus(registry: JobRegistry, jobId: string, status: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const job = registry.getJob(jobId);
    if (job?.status === status) return job;
    await Bun.sleep(25);
  }
  throw new Error(`job ${jobId} never reached ${status}; last=${registry.getJob(jobId)?.status}`);
}

async function listArtifacts(port: number, sessionId: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/preview/sessions/${sessionId}/artifacts`);
  return (await res.json()) as any[];
}

let cleanupServers: TestServer[] = [];

function stopAll(ts: TestServer) {
  ts.generation.videoService?.stopAll();
  ts.server.stop(true);
  ts.registry.close();
}

beforeAll(() => {
  startFakeOpenRouter();
  root = mkdtempSync(join(tmpdir(), "aurora-video-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-video-artifacts-"));
  configPath = join(root, "generation.json");
  dbPath = join(root, "generations.db");
});

afterAll(() => {
  for (const ts of cleanupServers) {
    try {
      stopAll(ts);
    } catch {
      // already stopped
    }
  }
  fakeServer?.stop(true);
  for (const dir of [root, artifactsDir]) rmSync(dir, { recursive: true, force: true });
});

describe("create_video", () => {
  beforeEach(() => {
    fakeCalls = [];
  });

  it("is registered with a whitelist enum and a per-second price hint in the description", async () => {
    const ts = await startServer();
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_video");
    expect(tool).toBeDefined();
    const modelSchema = (tool!.inputSchema as any).properties.model;
    expect(modelSchema.type).toBe("string");
    expect(modelSchema.enum).toEqual(["fake/video-model", "fake/video-no-audio"]);
    // Startup video-catalog fetch enriches the description (cents SKU → $/s).
    expect(JSON.stringify(tool!.description)).toContain("$0.05/s");
    await client.close();
    // The tool registered without the image test's server; drop this server.
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);
  });

  it("create_video inputSchema validates under JSON Schema draft 2020-12", async () => {
    const ts = await startServer();
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_video");
    expect(tool).toBeDefined();
    await client.close();
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);

    const script = `
import json, sys
from jsonschema import Draft202012Validator
with open(sys.argv[1]) as f:
    schema = json.load(f)
Draft202012Validator.check_schema(schema)
`;
    const schemaPath = join(root, `create-video-schema-${Date.now()}.json`);
    writeFileSync(schemaPath, JSON.stringify(tool!.inputSchema));
    const proc = Bun.spawnSync(["python3", "-c", script, schemaPath]);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(stderr, stderr).toBe("");
    expect(proc.exitCode).toBe(0);
  });

  it("rejects params outside the model's caps pre-flight (duration, resolution, aspect ratio, audio)", async () => {
    const ts = await startServer();
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    for (const args of [
      { duration: 5 }, // not in [4, 6, 8]
      { resolution: "4K" }, // not in [720p, 1080p]
      { aspect_ratio: "21:9" }, // not in [16:9, 9:16]
      { model: "fake/video-no-audio", generate_audio: true }, // supports_audio: false
    ]) {
      const res = await client.callTool({
        name: "create_video",
        arguments: { session_id: "v-agent", title: "t", prompt: "p", model: "fake/video-model", ...args },
      });
      expect(res.isError).toBe(true);
      const text = JSON.stringify(res.content);
      expect(text).toContain(args.model ?? "fake/video-model");
    }
    const submits = fakeCalls.filter((c) => c.method === "POST" && c.path === "/videos");
    expect(submits.length).toBe(0); // nothing reached the provider
    await client.close();
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);
  });

  it("permanently-pending job hits the ceiling without hanging: registry expires, failure artifact lands", async () => {
    phase = "pending";
    const ts = await startServer({ pollIntervalMs: 25, jobCeilingMs: 150 });
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_video",
      arguments: { session_id: "v-ceiling", title: "Ceiling clip", prompt: "spin forever", model: "fake/video-model" },
    });
    expect(res.isError).toBeFalsy();
    const jobId = (res.structuredContent as any).job_id;
    const job = await awaitRegistryStatus(ts.registry, jobId, "expired");
    expect(job.usage_cost).toBeNull();

    const artifacts = await listArtifacts(ts.port, "v-ceiling");
    const failure = artifacts.find((a) => a.type === "markdown" && /failed/i.test(a.title));
    expect(failure).toBeDefined();
    const content = await (await fetch(`http://127.0.0.1:${ts.port}/api/preview/sessions/v-ceiling/artifacts/${failure.artifact_id}`)).json();
    expect(content.content).toContain("job");
    expect(content.content).toContain("expired");
    await client.close();
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);
  });

  it("happy path: immediate response, artifact lands, registry completed with cost; replace-in-place honored", async () => {
    phase = "pending";
    const ts = await startServer({ pollIntervalMs: 25 });
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);

    // A pre-existing video artifact the second job replaces in place.
    const seed = await client.callTool({
      name: "push_video",
      arguments: {
        session_id: "v-agent",
        title: "Clip",
        source: { base64: VIDEO_BASE64, mime: "video/mp4" },
      },
    });
    const targetId = (seed.structuredContent as any).artifact_id;

    // Live-bus event on the eventual completion push.
    const ws = new WebSocket(`ws://127.0.0.1:${ts.port}/ws`);
    const nextEvent = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for WS event")), 5000);
      ws.addEventListener("message", (msg) => {
        const e = JSON.parse(String(msg.data));
        if (e.session_id === "v-agent" && e.event === "updated") {
          clearTimeout(timer);
          resolve(e);
        }
      });
    });

    const submit = await client.callTool({
      name: "create_video",
      arguments: {
        session_id: "v-agent",
        title: "Clip",
        prompt: "a lighthouse in fog, moving clouds",
        model: "fake/video-model",
        duration: 6,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: true,
        artifact_id: targetId,
      },
    });
    expect(submit.isError).toBeFalsy();
    const structured = submit.structuredContent as any;
    // Immediate response: job id + deep link + model + price hint.
    expect(structured.job_id).toBeDefined();
    expect(structured.deep_link).toBe(`http://127.0.0.1:${ts.port}/s/v-agent`);
    expect(structured.model).toBe("fake/video-model");
    expect(structured.price_hint).toBe("$0.05/s");
    // Registry row is pending at response time.
    expect(ts.registry.getJob(structured.job_id)!.status).toBe("pending");
    // Provider-side job completes; the poller drives the rest.
    phase = "completed";

    // Provider saw the full validated payload with the bearer key.
    const submitCall = fakeCalls.find((c) => c.method === "POST" && c.path === "/videos")!;
    expect(submitCall.auth).toBe(`Bearer ${API_KEY}`);
    expect(submitCall.body).toEqual({
      model: "fake/video-model",
      prompt: "a lighthouse in fog, moving clouds",
      duration: 6,
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    });

    const job = await awaitRegistryStatus(ts.registry, structured.job_id, "completed");
    expect(job.usage_cost).toBe(0.25);
    expect(job.artifact_id).toBe(targetId); // replace-in-place honored

    // Content endpoint was hit with the auth header; bytes snapshotted.
    const contentCall = fakeCalls.find((c) => c.path.endsWith("/content"))!;
    expect(contentCall.auth).toBe(`Bearer ${API_KEY}`);
    const artifacts = await listArtifacts(ts.port, "v-agent");
    const video = artifacts.find((a) => a.artifact_id === targetId);
    expect(video.type).toBe("video");
    expect(video.mime).toBe("video/mp4");
    const blob = await (await fetch(`http://127.0.0.1:${ts.port}/api/preview/sessions/v-agent/artifacts/${targetId}/blob`)).text();
    expect(blob).toBe(Buffer.from(VIDEO_BASE64, "base64").toString("latin1"));

    const event = await nextEvent;
    expect(event.artifact_id).toBe(targetId);
    ws.close();
    await client.close();
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);
  });

  it("failed job pushes a visible markdown failure artifact and reaches a terminal registry state", async () => {
    phase = "failed";
    failReason = "safety filter rejected the prompt";
    const ts = await startServer({ pollIntervalMs: 25 });
    cleanupServers.push(ts);
    const { client, transport } = makeClient(ts.port);
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_video",
      arguments: { session_id: "v-fail", title: "Doomed clip", prompt: "bad prompt", model: "fake/video-model" },
    });
    expect(res.isError).toBeFalsy();
    const jobId = (res.structuredContent as any).job_id;
    const job = await awaitRegistryStatus(ts.registry, jobId, "failed");
    expect(job.usage_cost).toBeNull();

    const artifacts = await listArtifacts(ts.port, "v-fail");
    const failure = artifacts.find((a) => a.type === "markdown" && /failed/i.test(a.title));
    expect(failure).toBeDefined();
    const content = await (await fetch(`http://127.0.0.1:${ts.port}/api/preview/sessions/v-fail/artifacts/${failure.artifact_id}`)).json();
    expect(content.content).toContain("safety filter rejected the prompt");
    await client.close();
    stopAll(ts);
    cleanupServers = cleanupServers.filter((x) => x !== ts);
  });

  it("restart mid-job: boot re-attaches the poller and the artifact lands", async () => {
    phase = "pending";
    // First server: a poll cadence long enough that it never polls in-test —
    // only the restarted server drives this job to completion.
    const ts1 = await startServer({ pollIntervalMs: 60_000 });
    const { client, transport } = makeClient(ts1.port);
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_video",
      arguments: { session_id: "v-restart", title: "Survivor clip", prompt: "outlive the restart", model: "fake/video-model" },
    });
    const jobId = (res.structuredContent as any).job_id;
    expect(ts1.registry.getJob(jobId)!.status).toBe("pending");
    await client.close();
    ts1.generation.videoService?.stopAll();
    ts1.server.stop(true);
    ts1.registry.close();

    // The fake provider survives the "restart" and flips to completed.
    phase = "completed";
    const ts2 = await startServer({ pollIntervalMs: 25, dbPath });
    const job = await awaitRegistryStatus(ts2.registry, jobId, "completed");
    expect(job.usage_cost).toBe(0.25);
    expect(job.artifact_id).toBeDefined();
    const artifacts = await listArtifacts(ts2.port, "v-restart");
    expect(artifacts.find((a) => a.artifact_id === job.artifact_id)?.type).toBe("video");
    stopAll(ts2);
  });

  it("create_video is not registered when no key is configured", async () => {
    const port = 5094;
    const artifacts2 = join(tmpdir(), `aurora-video-artifacts2-${Date.now()}`);
    const s = createServer(port, { artifactsDir: artifacts2 });
    try {
      const { client, transport } = makeClient(port);
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain("create_video");
      await client.close();
    } finally {
      s.stop(true);
      rmSync(artifacts2, { recursive: true, force: true });
    }
  });

  it(
    "works out of the box with the default db path under a fresh HOME (P1: parent dir is created)",
    async () => {
    // Nested path whose parent directories do not exist yet, like a fresh install.
    // A subprocess is required because bun caches os.homedir() per process.
    writeConfig([
      {
        id: "fake/video-model",
        note: "test video tier",
        default: true,
        durations: [4, 6, 8],
        resolutions: ["720p", "1080p"],
        aspect_ratios: ["16:9", "9:16"],
        supports_audio: true,
      },
    ]);
    const freshHome = join(tmpdir(), `aurora-fresh-home-${Date.now()}`, "nested");
    const port = PORTS[portCursor++];
    const artifacts = join(tmpdir(), `aurora-fresh-artifacts-${Date.now()}`);
    const bootScript = `
      const { createServer } = await import(process.env.AURORA_ROOT + "/server.ts");
      const generation = {
        apiKey: "sk-test-openrouter-key",
        baseUrl: "${FAKE_OPENROUTER}",
        whitelistPath: process.env.WHITELIST_PATH,
        pollIntervalMs: 25,
        jobCeilingMs: 150,
      };
      createServer(Number(process.env.PORT!), { generation, artifactsDir: process.env.ARTIFACTS_DIR });
    `;
    const child = Bun.spawn(["bun", "-e", bootScript], {
      env: {
        ...process.env,
        HOME: freshHome,
        AURORA_ROOT: import.meta.dir + "/..",
        PORT: String(port),
        ARTIFACTS_DIR: artifacts,
        WHITELIST_PATH: configPath,
      },
      stdout: "ignore",
      stderr: "pipe",
    });

    try {
      // Wait for boot; a wrong port would surface as connect timeout below.
      const deadline = Date.now() + 10000;
      let up = false;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/mcp`);
          if (r.status === 405) { up = true; break; }
        } catch { /* not up yet */ }
        await Bun.sleep(50);
      }
      if (!up) {
        const errText = await Promise.race([new Response(child.stderr as any).text(), Bun.sleep(1000).then(() => "<stderr unreadable>")]);
        throw new Error(`child did not boot: ${errText}`);
      }
      const { client, transport } = makeClient(port);
      await client.connect(transport);
      const { tools } = await client.listTools();
      // Boot must not have fallen back to "create_video disabled".
      expect(tools.map((t) => t.name)).toContain("create_video");
      // And a submit must land a pending row at the default location.
      const res = await client.callTool({
        name: "create_video",
        arguments: { session_id: "v-agent", title: "fresh boot", prompt: "p", model: "fake/video-model", duration: 6 },
      });
      expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
      const structured = res.structuredContent as any;
      expect(structured.job_id).toBeDefined();
      expect(existsSync(join(freshHome, ".local/share/aurora/generations.db"))).toBe(true);
      await client.close();
    } finally {
      child.kill();
      await child.exited;
      rmSync(freshHome, { recursive: true, force: true });
      rmSync(artifacts, { recursive: true, force: true });
    }
    },
    15000
  );
});
