import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactStore,
  InvalidArtifactIdError,
  artifactDir,
  sessionDir,
} from "./artifactStore";

let baseDir: string;
let store: ArtifactStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "aurora-store-"));
  store = new ArtifactStore(baseDir);
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("ArtifactStore.pushMarkdown", () => {
  it("implicitly creates the session on first push, honoring session_title", async () => {
    const { session, artifact, created } = await store.pushMarkdown({
      session_id: "agent-1",
      title: "Report",
      content: "# hi",
      session_title: "Agent One Run",
    });
    expect(created).toBe(true);
    expect(session.title).toBe("Agent One Run");
    expect(artifact.type).toBe("markdown");
    expect(existsSync(join(sessionDir(baseDir, "agent-1"), "meta.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(sessionDir(baseDir, "agent-1"), "meta.json"), "utf-8")).title
    ).toBe("Agent One Run");
  });

  it("ignores session_title on later pushes to an existing session", async () => {
    await store.pushMarkdown({
      session_id: "agent-1",
      title: "First",
      content: "a",
      session_title: "Real Title",
    });
    const { session } = await store.pushMarkdown({
      session_id: "agent-1",
      title: "Second",
      content: "b",
      session_title: "Ignored Title",
    });
    expect(session.title).toBe("Real Title");
  });

  it("appends artifacts when artifact_id is omitted", async () => {
    await store.pushMarkdown({ session_id: "s", title: "A", content: "a" });
    await store.pushMarkdown({ session_id: "s", title: "B", content: "b" });
    const artifacts = await store.listArtifacts("s");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.title)).toEqual(["A", "B"]);
  });

  it("replaces in place when a known artifact_id is reused", async () => {
    const first = await store.pushMarkdown({
      session_id: "s",
      title: "v1",
      content: "old",
      artifact_id: "chart-x",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.pushMarkdown({
      session_id: "s",
      title: "v2",
      content: "new",
      artifact_id: "chart-x",
    });
    expect(second.created).toBe(false);
    const artifacts = await store.listArtifacts("s");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("v2");
    expect(artifacts[0].created_at).toBe(first.artifact.created_at);
    expect(artifacts[0].updated_at >= first.artifact.updated_at).toBe(true);
    const got = await store.getArtifact("s", "chart-x");
    expect(got?.content).toBe("new");
  });

  it("writes content atomically under the expected disk layout", async () => {
    await store.pushMarkdown({ session_id: "s", title: "T", content: "# body" });
    const dir = artifactDir(baseDir, "s", (await store.listArtifacts("s"))[0].artifact_id);
    expect(readFileSync(join(dir, "meta.json"), "utf-8")).toContain("markdown");
    expect(readFileSync(join(dir, "content.md"), "utf-8")).toBe("# body");
    expect(readdirSync(join(baseDir, "sessions", "s")).sort()).toEqual(["artifacts", "meta.json"]);
  });

  it("isolates sessions: one session never sees another's artifacts", async () => {
    await store.pushMarkdown({ session_id: "s1", title: "One", content: "1" });
    await store.pushMarkdown({ session_id: "s2", title: "Two", content: "2" });
    expect(await store.listArtifacts("s1")).toHaveLength(1);
    expect(await store.listArtifacts("s2")).toHaveLength(1);
    expect(await store.getArtifact("s1", "missing")).toBeNull();
    const onlyS1 = (await store.listArtifacts("s1"))[0];
    expect(onlyS1.title).toBe("One");
    expect(await store.getArtifact("s2", onlyS1.artifact_id)).toBeNull();
  });

  it("rejects unsafe session or artifact ids", async () => {
    expect(() => store.pushMarkdown({ session_id: "../evil", title: "x", content: "y" })).toThrow(
      InvalidArtifactIdError
    );
    await store.pushMarkdown({ session_id: "s", title: "x", content: "y" });
    await expect(
      store.pushMarkdown({ session_id: "s", title: "x", content: "y", artifact_id: "a/b" })
    ).rejects.toBeInstanceOf(InvalidArtifactIdError);
    expect(existsSync(join(baseDir, "sessions", "evil"))).toBe(false);
  });

  it("persists across store recreation (server restart)", async () => {
    await store.pushMarkdown({
      session_id: "s",
      title: "Persisted",
      content: "# still here",
      artifact_id: "a1",
    });
    const store2 = new ArtifactStore(baseDir);
    const got = await store2.getArtifact("s", "a1");
    expect(got?.content).toBe("# still here");
    expect(got?.meta.title).toBe("Persisted");
    expect((await store2.listSessions()).map((s) => s.session_id)).toEqual(["s"]);
  });
});

describe("ArtifactStore.getArtifact/getArtifactMeta (id validation)", () => {
  it("rejects traversal ids on the read path", async () => {
    await expect(store.getArtifact("s", "../../escape")).rejects.toThrow(InvalidArtifactIdError);
    await expect(store.getArtifact("../../escape", "a")).rejects.toThrow(InvalidArtifactIdError);
    await expect(store.getArtifactMeta("s", "a/b")).rejects.toThrow(InvalidArtifactIdError);
  });

  it("returns null (not a throw) for valid ids that do not exist", async () => {
    expect(await store.getArtifact("s", "missing")).toBeNull();
  });
});

describe("ArtifactStore.pushMarkdown seq assignment", () => {
  it("assigns max(seq)+1 so ordering stays stable after a deletion", async () => {
    const a = await store.pushMarkdown({ session_id: "s", title: "a", content: "a" });
    const b = await store.pushMarkdown({ session_id: "s", title: "b", content: "b" });
    expect(b.artifact.seq).toBe(a.artifact.seq + 1);
    // simulate T7-style deletion of the OLDEST artifact: length+1 would reuse
    // the still-live seq 2; max(seq)+1 must yield 3
    rmSync(artifactDir(baseDir, "s", a.artifact.artifact_id), { recursive: true, force: true });
    const c = await store.pushMarkdown({ session_id: "s", title: "c", content: "c" });
    expect(c.artifact.seq).toBe(b.artifact.seq + 1);
    const seqs = (await store.listArtifacts("s")).map((x) => x.seq).sort();
    expect(seqs).toEqual([2, 3]);
  });
});

describe("ArtifactStore.pushMedia", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]);

  it("snapshots from a local absolute path; source file can be deleted afterward", async () => {
    const src = join(baseDir, "tmp-src.png");
    writeFileSync(src, PNG);
    const { artifact } = await store.pushMedia({
      session_id: "s",
      title: "Shot",
      type: "image",
      source: { path: src },
    });
    rmSync(src);
    expect(artifact.type).toBe("image");
    expect(artifact.mime).toBe("image/png");
    expect(artifact.size).toBe(PNG.byteLength);
    const blob = readFileSync(join(artifactDir(baseDir, "s", artifact.artifact_id), "blob"));
    expect(blob).toEqual(PNG);
  });

  it("rejects relative path sources", async () => {
    expect(
      store.pushMedia({ session_id: "s", title: "t", type: "image", source: { path: "rel.png" } })
    ).rejects.toMatchObject({ name: "MediaSourceError" });
  });

  it("rejects path sources that do not exist", async () => {
    expect(
      store.pushMedia({
        session_id: "s",
        title: "t",
        type: "video",
        source: { path: join(baseDir, "nope.mp4") },
      })
    ).rejects.toMatchObject({ name: "MediaSourceError" });
  });

  it("snapshots base64 sources with their declared mime", async () => {
    const { artifact } = await store.pushMedia({
      session_id: "s",
      title: "Inline",
      type: "video",
      source: { base64: PNG.toString("base64"), mime: "video/mp4" },
    });
    expect(artifact.mime).toBe("video/mp4");
    expect(artifact.size).toBe(PNG.byteLength);
  });

  it("snapshots url sources via server-side fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(PNG, { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    try {
      const { artifact } = await store.pushMedia({
        session_id: "s",
        title: "Remote",
        type: "image",
        source: { url: "https://example.com/pic.png" },
      });
      expect(artifact.mime).toBe("image/png");
      expect(artifact.size).toBe(PNG.byteLength);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects oversized base64 with an actionable cap error", async () => {
    const err = await store
      .pushMedia({
        session_id: "s",
        title: "t",
        type: "image",
        source: { base64: PNG.toString("base64"), mime: "image/png" },
        size_cap: 4,
      })
      .catch((e) => e);
    expect(err.name).toBe("MediaSizeCapError");
    expect(err.message).toContain("path");
  });

  it("rejects oversized url sources before downloading when content-length over cap", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { "content-length": String(PNG.byteLength) },
      })) as unknown as typeof fetch;
    try {
      await expect(
        store.pushMedia({
          session_id: "s",
          title: "t",
          type: "video",
          source: { url: "https://example.com/big.mp4" },
          size_cap: 4,
        })
      ).rejects.toMatchObject({ name: "MediaSizeCapError" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("replaces in place via artifact_id and appends without it", async () => {
    const a = await store.pushMedia({
      session_id: "s",
      title: "v1",
      type: "image",
      source: { base64: PNG.toString("base64"), mime: "image/png" },
      artifact_id: "pic",
    });
    const b = await store.pushMedia({
      session_id: "s",
      title: "v2",
      type: "image",
      source: { base64: Buffer.from([9, 9]).toString("base64"), mime: "image/png" },
      artifact_id: "pic",
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect((await store.listArtifacts("s")).length).toBe(1);
  });

  it("keeps sessions isolated", async () => {
    await store.pushMedia({
      session_id: "s1",
      title: "a",
      type: "image",
      source: { base64: PNG.toString("base64"), mime: "image/png" },
    });
    const aid = (await store.listArtifacts("s1"))[0].artifact_id;
    expect(await store.getArtifactMeta("s2", aid)).toBeNull();
  });
});

describe("ArtifactStore.deleteSession", () => {
  it("removes the session directory and all artifacts from disk", async () => {
    await store.pushMarkdown({ session_id: "gone", title: "t", content: "c" });
    const aid = (await store.listArtifacts("gone"))[0].artifact_id;
    expect(await store.deleteSession("gone")).toBe(true);
    expect(existsSync(sessionDir(baseDir, "gone"))).toBe(false);
    expect(await store.getSession("gone")).toBeNull();
    expect(await store.getArtifactMeta("gone", aid)).toBeNull();
    expect(await store.listSessions().then((s) => s.some((x) => x.session_id === "gone"))).toBe(false);
  });

  it("returns false for an unknown session without touching disk", async () => {
    expect(await store.deleteSession("nope")).toBe(false);
  });

  it("leaves other sessions intact", async () => {
    await store.pushMarkdown({ session_id: "keep", title: "t", content: "c" });
    await store.pushMarkdown({ session_id: "kill", title: "t", content: "c" });
    await store.deleteSession("kill");
    expect(await store.listSessions().then((s) => s.map((x) => x.session_id))).toEqual(["keep"]);
  });
});

describe("ArtifactStore.pushMermaid", () => {
  it("pushes with type mermaid, same append/replace semantics as markdown", async () => {
    const first = await store.pushMermaid({
      session_id: "diag",
      title: "Auth flow",
      code: "flowchart TD\n  A --> B",
      session_title: "Diagrams",
    });
    expect(first.created).toBe(true);
    expect(first.artifact.type).toBe("mermaid");
    const got = await store.getArtifact("diag", first.artifact.artifact_id);
    expect(got?.content).toBe("flowchart TD\n  A --> B");

    const second = await store.pushMermaid({
      session_id: "diag",
      title: "Auth flow v2",
      code: "flowchart TD\n  A --> C",
      artifact_id: first.artifact.artifact_id,
    });
    expect(second.created).toBe(false);
    const artifacts = await store.listArtifacts("diag");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe("Auth flow v2");
    expect(artifacts[0].type).toBe("mermaid");
    expect((await store.getArtifact("diag", first.artifact.artifact_id))?.content).toBe(
      "flowchart TD\n  A --> C"
    );
  });

  it("keeps mermaid and markdown artifacts isolated within one session", async () => {
    await store.pushMarkdown({ session_id: "mix", title: "Doc", content: "# doc" });
    const d = await store.pushMermaid({ session_id: "mix", title: "Diagram", code: "sequenceDiagram\nA->>B: hi" });
    const artifacts = await store.listArtifacts("mix");
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((a) => a.type).sort()).toEqual(["markdown", "mermaid"]);
    expect(d.artifact.seq).toBe(2);
  });
});
