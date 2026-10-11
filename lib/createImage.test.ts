import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5081;
const FAKE_OPENROUTER_PORT = 5082;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_OPENROUTER = `http://127.0.0.1:${FAKE_OPENROUTER_PORT}`;
const API_KEY = "sk-test-openrouter-key";

// Minimal valid 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface FakeCall {
  path: string;
  auth: string | null;
  body: any;
}

let fakeCalls: FakeCall[] = [];
let fakeServer: ReturnType<typeof Bun.serve>;

function fakeImageResponse() {
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

function startFakeOpenRouter() {
  fakeServer = Bun.serve({
    port: FAKE_OPENROUTER_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (url.pathname === "/chat/completions") {
        fakeCalls.push({ path: url.pathname, auth, body: await req.json() });
        return fakeImageResponse();
      }
      if (url.pathname === "/models") {
        fakeCalls.push({ path: url.pathname, auth, body: null });
        return Response.json({
          data: [
            { id: "cheap/model", pricing: { image: "0.03" } },
            { id: "premium/model", pricing: { image: "0.15" } },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

let root: string;
let artifactsDir: string;
let configPath: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

function writeConfig(models: any[]) {
  writeFileSync(configPath, JSON.stringify({ image: models, video: [] }));
}

beforeAll(async () => {
  startFakeOpenRouter();
  root = mkdtempSync(join(tmpdir(), "aurora-gen-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-gen-artifacts-"));
  configPath = join(root, "generation.json");
  writeConfig([
    { id: "cheap/model", note: "budget tier", default: true, aspect_ratios: ["1:1", "16:9"] },
    { id: "premium/model", note: "premium tier" },
  ]);
  server = createServer(root, PORT, {
    artifactsDir,
    generation: { apiKey: API_KEY, baseUrl: FAKE_OPENROUTER, whitelistPath: configPath },
  });
  // Give the fire-and-forget startup catalog fetch a moment to land.
  await Bun.sleep(150);
});

afterAll(() => {
  server?.stop(true);
  fakeServer?.stop(true);
  for (const dir of [root, artifactsDir]) rmSync(dir, { recursive: true, force: true });
});

describe("create_image", () => {
  it("is registered with a whitelist enum and price hints in the description", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_image");
    expect(tool).toBeDefined();
    const modelSchema = (tool!.inputSchema as any).properties.model;
    expect(modelSchema.type).toBe("string");
    expect(modelSchema.enum).toEqual(["cheap/model", "premium/model"]);
    // Startup catalog fetch enriches the description with live price hints
    // (falls back to static notes offline; fake server serves both tiers).
    expect(JSON.stringify(tool!.description)).toContain("$0.03/image");
    expect(JSON.stringify(tool!.description)).toContain("$0.15/image");
    await client.close();
  });

  it("create_image inputSchema validates under JSON Schema draft 2020-12", async () => {
    // Deterministic coverage of the draft 2020-12 regression for create_image:
    // the mcpSurface regression server only registers generation tools when a
    // real OPENROUTER_API_KEY is present, so keyless CI would skip the new
    // tool there. This server is always generation-configured, so validate the
    // create_image inputSchema here with Draft202012Validator.check_schema.
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_image");
    expect(tool).toBeDefined();
    await client.close();

    const script = `
import json, sys
from jsonschema import Draft202012Validator
with open(sys.argv[1]) as f:
    schema = json.load(f)
Draft202012Validator.check_schema(schema)
`;
    const schemaPath = join(tmpdir(), `aurora-create-image-schema-${Date.now()}.json`);
    writeFileSync(schemaPath, JSON.stringify(tool!.inputSchema));
    try {
      const proc = Bun.spawnSync(["python3", "-c", script, schemaPath]);
      const stderr = new TextDecoder().decode(proc.stderr);
      expect(stderr, stderr).toBe("");
      expect(proc.exitCode).toBe(0);
    } finally {
      rmSync(schemaPath, { force: true });
    }
  });

  it("happy path: prompt-only call snapshots an image artifact and returns cost", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_image",
      arguments: { session_id: "gen-agent", title: "Concept art", prompt: "a lighthouse in fog", model: "cheap/model" },
    });
    expect(res.isError).toBeFalsy();
    const structured = res.structuredContent as any;
    expect(structured.model).toBe("cheap/model");
    expect(structured.cost).toBe(0.042);
    expect(structured.artifact_id).toBeDefined();
    expect(structured.deep_link).toBe(`${BASE}/preview/gen-agent`);
    expect(structured.created).toBe(true);

    // Auth header asserted: the fake server saw the bearer key
    const call = fakeCalls.find((c) => c.path === "/chat/completions");
    expect(call).toBeDefined();
    expect(call!.auth).toBe(`Bearer ${API_KEY}`);
    expect(call!.body.model).toBe("cheap/model");
    expect(call!.body.modalities).toEqual(["image", "text"]);
    expect(call!.body.messages[0].content).toBe("a lighthouse in fog");

    // Bytes were snapshotted into the artifact store as a png
    const listRes = await fetch(`${BASE}/api/preview/sessions/gen-agent/artifacts`);
    const artifacts = (await listRes.json()) as any[];
    const img = artifacts.find((a) => a.artifact_id === structured.artifact_id);
    expect(img.type).toBe("image");
    expect(img.mime).toBe("image/png");
    await client.close();
  });

  it("replace-in-place via artifact_id mirrors push semantics", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const first = await client.callTool({
      name: "create_image",
      arguments: { session_id: "gen-agent", title: "Concept art", prompt: "v1", model: "cheap/model" },
    });
    const firstId = (first.structuredContent as any).artifact_id;
    const second = await client.callTool({
      name: "create_image",
      arguments: {
        session_id: "gen-agent",
        title: "Concept art",
        prompt: "v2",
        model: "cheap/model",
        artifact_id: firstId,
      },
    });
    const structured = second.structuredContent as any;
    expect(structured.created).toBe(false);
    expect(structured.artifact_id).toBe(firstId);
    await client.close();
  });

  it("rejects an invalid model with an actionable error", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client
      .callTool({
        name: "create_image",
        arguments: { session_id: "gen-agent", title: "t", prompt: "p", model: "unknown/model" },
      })
      .catch((err: any) => err);
    // Schema-level rejection from the whitelist enum, either as an error
    // result or as a thrown SDK client error — both name the bad model.
    const rendered = res?.isError ? JSON.stringify(res.content) : String(res);
    expect(rendered).toMatch(/unknown\.model|enum|expected one of/i);
    await client.close();
  });

  it("rejects params outside the model's catalog capabilities pre-flight", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const res = await client.callTool({
      name: "create_image",
      arguments: {
        session_id: "gen-agent",
        title: "t",
        prompt: "p",
        model: "cheap/model",
        aspect_ratio: "21:9", // not in the config's allowed aspect_ratios
      },
    });
    expect(res.isError).toBe(true);
    const text = JSON.stringify(res.content);
    expect(text).toContain("cheap/model");
    expect(text).toContain("1:1, 16:9");
    await client.close();
  });

  it("config-file edits change the model enum without restart", async () => {
    writeConfig([{ id: "only/model", default: true }]);
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "create_image");
    expect((tool!.inputSchema as any).properties.model.enum).toEqual(["only/model"]);
    await client.close();
  });
});

describe("generation without an API key", () => {
  it("create_image is not registered when no key is configured", async () => {
    const port = 5090;
    const artifacts2 = join(tmpdir(), `aurora-gen-artifacts2-${Date.now()}`);
    // Tests may run in an environment that carries a real key; the "absent
    // when not present" contract must hold regardless.
    const hadEnvKey = "OPENROUTER_API_KEY" in process.env;
    const envKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const s = createServer(root, port, { artifactsDir: artifacts2 });
    if (hadEnvKey) process.env.OPENROUTER_API_KEY = envKey;
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "0.0.1" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain("create_image");
      await client.close();
    } finally {
      s.stop(true);
      if (existsSync(artifacts2)) rmSync(artifacts2, { recursive: true, force: true });
    }
  });
});
