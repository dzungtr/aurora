import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
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

describe("ArtifactStore.pushChart", () => {
  const pieData = { kind: "pie" as const, points: [{ label: "a", value: 1 }, { label: "b", value: 3 }] };

  it("stores a chart artifact as content.json with the contract, creating the session", async () => {
    const { session, artifact, created } = await store.pushChart({
      session_id: "chart-s",
      title: "Split",
      chart_type: "pie",
      data: pieData,
    });
    expect(created).toBe(true);
    expect(session.title).toBe("chart-s");
    expect(artifact.type).toBe("chart");
    const dir = artifactDir(baseDir, "chart-s", artifact.artifact_id);
    expect(existsSync(join(dir, "content.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "content.json"), "utf-8"))).toEqual({
      chart_type: "pie",
      data: pieData,
    });
  });

  it("getArtifact reads chart contracts back from content.json", async () => {
    const { artifact } = await store.pushChart({
      session_id: "chart-r",
      title: "T",
      chart_type: "pie",
      data: pieData,
    });
    const got = await store.getArtifact("chart-r", artifact.artifact_id);
    expect(JSON.parse(got!.content).chart_type).toBe("pie");
  });

  it("appends by default and replaces in place with artifact_id", async () => {
    const first = await store.pushChart({
      session_id: "chart-x",
      title: "v1",
      chart_type: "pie",
      data: pieData,
      artifact_id: "one",
    });
    const second = await store.pushChart({
      session_id: "chart-x",
      title: "v2",
      chart_type: "pie",
      data: { kind: "pie", points: [{ label: "a", value: 9 }] },
      artifact_id: "one",
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.artifact.created_at).toBe(first.artifact.created_at);
    const list = await store.listArtifacts("chart-x");
    expect(list.length).toBe(1);
    const got = await store.getArtifact("chart-x", "one");
    expect(JSON.parse(got!.content).data.points[0].value).toBe(9);
    expect(got!.meta.title).toBe("v2");
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
