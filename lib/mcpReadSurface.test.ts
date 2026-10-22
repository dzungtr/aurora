import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";
import { IMAGE_READ_CAP_BYTES, TEXT_READ_CAP_BYTES } from "./artifactReads";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5141;
const BASE = `http://127.0.0.1:${PORT}`;

/** A minimal valid openui-lang program (same fixture as lib/pushUi.test.ts). */
const VALID_UI_PROGRAM = `root = Stack([card1], "column")
card1 = Card([t1])
t1 = Text("hello aurora")`;

// Hermetic: no generation config leaves the three read tools the whole surface
// under test (they need no provider).
delete process.env.OPENROUTER_API_KEY;

let root: string;
let artifactsDir: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "read-surface-test", version: "0.0.1" });
  return { client, transport };
}

async function call(name: string, args: Record<string, unknown>) {
  const { client, transport } = makeClient();
  await client.connect(transport);
  const res = await client.callTool({ name, arguments: args });
  await client.close();
  return res;
}

function textBlock(res: Awaited<ReturnType<typeof call>>) {
  const content = res.content as any[];
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe("text");
  return content[0].text as string;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aurora-read-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-read-artifacts-"));
  server = createServer(root, PORT, { artifactsDir });
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

/** Write a session's meta directly so last_activity is fully controlled. */
function writeSession(id: string, lastActivity: string) {
  const dir = join(artifactsDir, "sessions", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ session_id: id, title: `Title ${id}`, created_at: lastActivity, last_activity: lastActivity })
  );
}

describe("read tools are registered", () => {
  it("exposes list_sessions, list_artifacts, and read_artifact", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_sessions", "list_artifacts", "read_artifact"])
    );
    const read = tools.find((t) => t.name === "read_artifact")!;
    // Descriptions are the agent-facing contract for content-type awareness.
    for (const type of ["markdown", "mermaid", "chart", "ui", "image", "audio", "video"]) {
      expect(read.description).toContain(type);
    }
    await client.close();
  });
});

describe("list_sessions", () => {
  it("paginates newest-activity-first and reports the unpaginated total", async () => {
    writeSession("ls-old", "2026-01-01T00:00:00.000Z");
    writeSession("ls-mid", "2026-01-02T00:00:00.000Z");
    writeSession("ls-new", "2026-01-03T00:00:00.000Z");

    const page1 = await call("list_sessions", { limit: 2 });
    const sc1 = page1.structuredContent as any;
    expect(sc1.total).toBe(3);
    expect(sc1.offset).toBe(0);
    expect(sc1.limit).toBe(2);
    expect(sc1.sessions.map((s: any) => s.session_id)).toEqual(["ls-new", "ls-mid"]);
    expect(sc1.sessions[0].title).toBe("Title ls-new");
    expect(sc1.sessions[0].last_activity).toBe("2026-01-03T00:00:00.000Z");

    const page2 = await call("list_sessions", { offset: 2, limit: 2 });
    const sc2 = page2.structuredContent as any;
    expect(sc2.total).toBe(3);
    expect(sc2.sessions.map((s: any) => s.session_id)).toEqual(["ls-old"]);
  });

  it("defaults to a page of 50", async () => {
    const sc = (await call("list_sessions", {})).structuredContent as any;
    expect(sc.limit).toBe(50);
    expect(sc.sessions.length).toBeLessThanOrEqual(50);
  });
});

describe("list_artifacts + read_artifact", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  /** One session holding one artifact of every type. */
  async function seedEveryType() {
    const session_id = `all-types-${crypto.randomUUID().slice(0, 8)}`;
    await call("push_markdown", { session_id, title: "Report", content: "# Report\nAll good." });
    await call("push_mermaid", { session_id, title: "Flow", code: "flowchart TD\n  A --> B" });
    await call("push_chart", {
      session_id,
      title: "Scores",
      chart_type: "pie",
      data: { kind: "pie", points: [{ label: "a", value: 1 }] },
    });
    await call("push_ui", { session_id, title: "Dashboard", program: VALID_UI_PROGRAM });
    await call("push_image", {
      session_id,
      title: "Shot",
      source: { base64: PNG.toString("base64"), mime: "image/png" },
    });
    await call("push_audio", {
      session_id,
      title: "Narration",
      source: { base64: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0]).toString("base64"), mime: "audio/mpeg" },
    });
    await call("push_video", {
      session_id,
      title: "Clip",
      source: { base64: Buffer.from("0123456789").toString("base64"), mime: "video/mp4" },
    });
    return session_id;
  }

  it("lists every artifact with type, mime (media), and size (media)", async () => {
    const session_id = await seedEveryType();
    const res = await call("list_artifacts", { session_id });
    const sc = res.structuredContent as any;
    expect(res.isError).toBeFalsy();
    expect(sc.total).toBe(7);
    expect(sc.deep_link).toBe(`${BASE}/s/${session_id}`);

    const byType = Object.fromEntries(sc.artifacts.map((a: any) => [a.type, a]));
    expect(Object.keys(byType).sort()).toEqual(
      ["audio", "chart", "image", "markdown", "mermaid", "ui", "video"].sort()
    );
    expect(byType.image).toMatchObject({ mime: "image/png", size: PNG.byteLength });
    expect(byType.video).toMatchObject({ mime: "video/mp4", size: 10 });
    expect(byType.audio.mime).toBe("audio/mpeg");
    expect(byType.audio.size).toBe(7);
    expect(byType.markdown.mime).toBeUndefined();
    expect(byType.markdown.size).toBeUndefined();
    for (const artifact of sc.artifacts) {
      expect(typeof artifact.title).toBe("string");
      expect(typeof artifact.seq).toBe("number");
      expect(typeof artifact.updated_at).toBe("string");
    }
    // Each entry names its id so the model can immediately read it.
    expect(textBlock(res)).toContain(byType.image.artifact_id);
  });

  it("returns a 1 MiB markdown artifact in full", async () => {
    const session_id = `big-md-${crypto.randomUUID().slice(0, 8)}`;
    const source = "# Report\n" + "x".repeat(1024 * 1024 - 9);
    const pushed = await call("push_markdown", { session_id, title: "Big", content: source });
    const artifact_id = (pushed.structuredContent as any).artifact_id;

    const res = await call("read_artifact", { session_id, artifact_id });
    expect(textBlock(res)).toBe(source);
    expect((res.structuredContent as any).type).toBe("markdown");
  });

  it("truncates a 400 KiB mermaid source and continues from the stated offset", async () => {
    const session_id = `big-diagram-${crypto.randomUUID().slice(0, 8)}`;
    const source = "flowchart TD\n" + "x".repeat(400 * 1024 - 13);
    const total = source.length;
    const pushed = await call("push_mermaid", { session_id, title: "Big diagram", code: source });
    const artifact_id = (pushed.structuredContent as any).artifact_id;

    const first = textBlock(await call("read_artifact", { session_id, artifact_id }));
    expect(first).toContain(`of ${total} total`);
    expect(first).toContain(`offset=${TEXT_READ_CAP_BYTES}`);

    const rest = textBlock(
      await call("read_artifact", { session_id, artifact_id, offset: TEXT_READ_CAP_BYTES })
    );
    expect(rest).not.toContain("[truncated");
    expect(rest.length).toBe(total - TEXT_READ_CAP_BYTES);
  });

  it("returns an image as an MCP image content block", async () => {
    const session_id = `img-${crypto.randomUUID().slice(0, 8)}`;
    const png = Buffer.alloc(2 * 1024 * 1024, 7);
    const pushed = await call("push_image", {
      session_id,
      title: "Two MiB PNG",
      source: { base64: png.toString("base64"), mime: "image/png" },
    });
    const artifact_id = (pushed.structuredContent as any).artifact_id;

    const res = await call("read_artifact", { session_id, artifact_id });
    const content = res.content as any[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image");
    expect(content[0].mimeType).toBe("image/png");
    expect(Buffer.from(content[0].data, "base64").equals(png)).toBe(true);
    expect((res.structuredContent as any).deep_link).toBe(`${BASE}/s/${session_id}/${artifact_id}`);
  });

  it("rejects an over-cap image with a text error naming the blob URL", async () => {
    const session_id = `img-big-${crypto.randomUUID().slice(0, 8)}`;
    const huge = Buffer.alloc(IMAGE_READ_CAP_BYTES + 1024, 3);
    const pushed = await call("push_image", {
      session_id,
      title: "Six MiB PNG",
      source: { base64: huge.toString("base64"), mime: "image/png" },
    });
    const artifact_id = (pushed.structuredContent as any).artifact_id;

    const res = await call("read_artifact", { session_id, artifact_id });
    const text = textBlock(res);
    expect(text).toContain("over the 4.0 MiB inline read cap");
    expect(text).toContain(`${BASE}/api/preview/sessions/${session_id}/artifacts/${artifact_id}/blob`);
  });

  it("returns unsupported-type messages for audio and video, carrying the deep link", async () => {
    const session_id = `av-${crypto.randomUUID().slice(0, 8)}`;
    const audio = await call("push_audio", {
      session_id,
      title: "Narration",
      source: { base64: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0]).toString("base64"), mime: "audio/mpeg" },
    });
    const video = await call("push_video", {
      session_id,
      title: "Clip",
      source: { base64: Buffer.from("0123456789").toString("base64"), mime: "video/mp4" },
    });

    for (const [pushed, type] of [
      [audio, "audio"],
      [video, "video"],
    ] as const) {
      const artifact_id = (pushed.structuredContent as any).artifact_id;
      const res = await call("read_artifact", { session_id, artifact_id });
      const text = textBlock(res);
      expect(text).toContain(`${type} artifact ${artifact_id}`);
      expect(text).toContain("cannot be read over MCP");
      expect(text).toContain(`${BASE}/s/${session_id}/${artifact_id}`);
    }
  });

  it("fails fast on an unknown session or artifact", async () => {
    const noSession = await call("list_artifacts", { session_id: "no-such-session" });
    expect(noSession.isError).toBe(true);
    expect(textBlock(noSession)).toContain("list_sessions");

    const session_id = `miss-${crypto.randomUUID().slice(0, 8)}`;
    await call("push_markdown", { session_id, title: "t", content: "c" });
    const noArtifact = await call("read_artifact", { session_id, artifact_id: "nope" });
    expect(noArtifact.isError).toBe(true);
    expect(textBlock(noArtifact)).toContain("list_artifacts");
  });
});

describe("deep links", () => {
  it("every push tool response carries /s/<sid> and never /preview/", async () => {
    const session_id = `links-${crypto.randomUUID().slice(0, 8)}`;
    const pushes: [string, Record<string, unknown>][] = [
      ["push_markdown", { title: "m", content: "c" }],
      ["push_mermaid", { title: "d", code: "flowchart TD\n A --> B" }],
      [
        "push_chart",
        {
          title: "ch",
          chart_type: "bar",
          data: { kind: "categorical", categories: ["a"], series: [{ name: "s", values: [1] }] },
        },
      ],
      ["push_ui", { title: "u", program: VALID_UI_PROGRAM }],
      ["push_image", { title: "i", source: { base64: Buffer.from([1, 2, 3]).toString("base64"), mime: "image/png" } }],
      [
        "push_audio",
        {
          title: "a",
          source: { base64: Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0]).toString("base64"), mime: "audio/mpeg" },
        },
      ],
      ["push_video", { title: "v", source: { base64: Buffer.from("abc").toString("base64"), mime: "video/mp4" } }],
    ];
    for (const [name, args] of pushes) {
      const res = await call(name, { session_id, ...args });
      const deep_link = (res.structuredContent as any).deep_link;
      expect(deep_link).toBe(`${BASE}/s/${session_id}`);
      expect(JSON.stringify(res)).not.toContain("/preview/");
      expect(textBlock(res)).toContain(`/s/${session_id}`);
    }
  });
});
