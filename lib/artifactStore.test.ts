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
