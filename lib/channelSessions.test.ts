// Channel sessions (spec #86, ADR-0009): the one place aurora deletes data
// unasked. Pruning assertions use a fixed `now`, never the wall clock, except
// the prune-on-push block where pushes themselves stamp the wall clock.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, artifactDir, sessionDir } from "./artifactStore";

let baseDir: string;
let store: ArtifactStore;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "aurora-channel-"));
  store = new ArtifactStore(baseDir);
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

const DAY_MS = 86_400_000;
const NOW = "2026-06-30T12:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY_MS).toISOString();
const realDaysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();

/** Rewrite an artifact's meta.json updated_at to simulate age. */
function age(sessionId: string, artifactId: string, updatedAt: string) {
  const p = join(artifactDir(baseDir, sessionId, artifactId), "meta.json");
  const meta = JSON.parse(readFileSync(p, "utf-8"));
  writeFileSync(p, JSON.stringify({ ...meta, updated_at: updatedAt }));
}

async function seed(
  sessionId: string,
  artifactId: string,
  updatedAt: string,
  channel?: { retention_days?: number }
) {
  await store.pushMarkdown({
    session_id: sessionId,
    title: artifactId,
    content: "x",
    artifact_id: artifactId,
    channel,
  });
  age(sessionId, artifactId, updatedAt);
}

const exists = (sessionId: string, artifactId: string) =>
  existsSync(artifactDir(baseDir, sessionId, artifactId));

describe("channel session meta", () => {
  it("first channel push stores kind and the default 30-day retention", async () => {
    const { session } = await store.pushMarkdown({ session_id: "feed", title: "t", content: "x", channel: {} });
    expect(session.kind).toBe("channel");
    expect(session.retention_days).toBe(30);
    const onDisk = JSON.parse(readFileSync(join(sessionDir(baseDir, "feed"), "meta.json"), "utf-8"));
    expect(onDisk.kind).toBe("channel");
    expect(onDisk.retention_days).toBe(30);
  });

  it("ordinary sessions carry no kind or retention_days", async () => {
    const { session } = await store.pushMarkdown({ session_id: "plain", title: "t", content: "x" });
    expect(session.kind).toBeUndefined();
    expect(session.retention_days).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(join(sessionDir(baseDir, "plain"), "meta.json"), "utf-8"));
    expect("kind" in onDisk).toBe(false);
  });

  it("upgrades an existing ordinary session to a channel", async () => {
    await store.pushMarkdown({ session_id: "s", title: "a", content: "x" });
    const { session } = await store.pushMarkdown({
      session_id: "s",
      title: "b",
      content: "x",
      channel: { retention_days: 7 },
    });
    expect(session.kind).toBe("channel");
    expect(session.retention_days).toBe(7);
  });

  it("kind is sticky: later pushes without channel keep kind and retention", async () => {
    await store.pushMarkdown({ session_id: "feed", title: "a", content: "x", channel: { retention_days: 14 } });
    const { session } = await store.pushMarkdown({ session_id: "feed", title: "b", content: "x" });
    expect(session.kind).toBe("channel");
    expect(session.retention_days).toBe(14);
  });

  it("last supplied retention wins; omitting it on a later channel push keeps the stored value", async () => {
    await store.pushMarkdown({ session_id: "feed", title: "a", content: "x", channel: { retention_days: 14 } });
    let r = await store.pushMarkdown({ session_id: "feed", title: "b", content: "x", channel: { retention_days: 7 } });
    expect(r.session.retention_days).toBe(7);
    r = await store.pushMarkdown({ session_id: "feed", title: "c", content: "x", channel: {} });
    expect(r.session.retention_days).toBe(7);
  });

  it("listSessions surfaces kind and retention_days", async () => {
    await store.pushMarkdown({ session_id: "feed", title: "a", content: "x", channel: {} });
    const [s] = await store.listSessions();
    expect(s.kind).toBe("channel");
    expect(s.retention_days).toBe(30);
  });
});

describe("ArtifactStore.pruneChannel (fixed now)", () => {
  it("removes artifacts older than retention by updated_at and returns their ids", async () => {
    // push both first, then age: any push into a channel prunes on the real clock
    await store.pushMarkdown({ session_id: "feed", title: "o", content: "x", artifact_id: "old", channel: { retention_days: 30 } });
    await store.pushMarkdown({ session_id: "feed", title: "f", content: "x", artifact_id: "fresh" });
    age("feed", "old", daysAgo(31));
    age("feed", "fresh", daysAgo(29));
    const removed = await store.pruneChannel("feed", NOW, "keep-none");
    expect(removed).toEqual(["old"]);
    expect(exists("feed", "old")).toBe(false);
    expect(exists("feed", "fresh")).toBe(true);
  });

  it("keeps an artifact exactly at the retention boundary", async () => {
    await seed("feed", "edge", daysAgo(30), { retention_days: 30 });
    expect(await store.pruneChannel("feed", NOW, "other")).toEqual([]);
    expect(exists("feed", "edge")).toBe(true);
  });

  it("prunes by updated_at, not created_at (a long-lived patched artifact survives)", async () => {
    await seed("feed", "thread", daysAgo(2), { retention_days: 30 });
    const p = join(artifactDir(baseDir, "feed", "thread"), "meta.json");
    const meta = JSON.parse(readFileSync(p, "utf-8"));
    writeFileSync(p, JSON.stringify({ ...meta, created_at: daysAgo(200) }));
    expect(await store.pruneChannel("feed", NOW, "other")).toEqual([]);
    expect(exists("feed", "thread")).toBe(true);
  });

  it("never removes keepArtifactId even when it is expired", async () => {
    await store.pushMarkdown({ session_id: "feed", title: "k", content: "x", artifact_id: "keepme", channel: { retention_days: 30 } });
    await store.pushMarkdown({ session_id: "feed", title: "o", content: "x", artifact_id: "old" });
    age("feed", "keepme", daysAgo(90));
    age("feed", "old", daysAgo(90));
    expect(await store.pruneChannel("feed", NOW, "keepme")).toEqual(["old"]);
    expect(exists("feed", "keepme")).toBe(true);
  });

  it("never prunes ordinary sessions, however old", async () => {
    await seed("plain", "ancient", daysAgo(4000));
    expect(await store.pruneChannel("plain", NOW, "other")).toEqual([]);
    expect(exists("plain", "ancient")).toBe(true);
  });

  it("returns [] for an unknown session", async () => {
    expect(await store.pruneChannel("nope", NOW, "x")).toEqual([]);
  });

  it("never touches other sessions and never removes the session itself", async () => {
    await seed("feed", "old", daysAgo(90), { retention_days: 30 });
    await seed("other-channel", "old", daysAgo(90), { retention_days: 365 });
    await seed("plain", "old", daysAgo(90));
    await store.pruneChannel("feed", NOW, "none");
    expect(exists("other-channel", "old")).toBe(true);
    expect(exists("plain", "old")).toBe(true);
    expect(existsSync(join(sessionDir(baseDir, "feed"), "meta.json"))).toBe(true);
    expect(await store.listArtifacts("feed")).toEqual([]);
  });

  it("keeps seq numbering monotonic after pruning (max+1, not count+1)", async () => {
    await seed("feed", "a", daysAgo(90), { retention_days: 30 });
    await store.pushMarkdown({ session_id: "feed", title: "b", content: "x", artifact_id: "b" });
    await store.pruneChannel("feed", NOW, "b");
    const { artifact } = await store.pushMarkdown({ session_id: "feed", title: "c", content: "x", artifact_id: "c" });
    expect(artifact.seq).toBe(3);
  });
});

describe("prune-on-push", () => {
  it("pushMarkdown into a channel prunes expired artifacts and reports them", async () => {
    await seed("feed", "old", realDaysAgo(31), { retention_days: 30 });
    const res = await store.pushMarkdown({ session_id: "feed", title: "new", content: "x", artifact_id: "new" });
    expect(res.pruned).toEqual(["old"]);
    expect(exists("feed", "old")).toBe(false);
    expect(exists("feed", "new")).toBe(true);
  });

  it("pushMarkdown into an ordinary session prunes nothing", async () => {
    await seed("plain", "old", realDaysAgo(400));
    const res = await store.pushMarkdown({ session_id: "plain", title: "new", content: "x" });
    expect(res.pruned).toEqual([]);
    expect(exists("plain", "old")).toBe(true);
  });

  it("re-pushing over an expired artifact id keeps it (the just-pushed artifact is never pruned)", async () => {
    await seed("feed", "same", realDaysAgo(90), { retention_days: 30 });
    const res = await store.pushMarkdown({ session_id: "feed", title: "again", content: "y", artifact_id: "same" });
    expect(res.pruned).toEqual([]);
    expect(exists("feed", "same")).toBe(true);
  });

  it("every push path prunes: mermaid, chart, ui, media", async () => {
    const pushers: Array<() => Promise<{ pruned: string[] }>> = [
      () => store.pushMermaid({ session_id: "feed", title: "m", code: "flowchart TD; A-->B" }),
      () =>
        store.pushChart({
          session_id: "feed",
          title: "c",
          chart_type: "bar",
          data: { categories: ["a"], series: [{ name: "s", values: [1] }] } as any,
        }),
      () => store.pushUi({ session_id: "feed", title: "u", program: 'root = Text("x")' }),
      () =>
        store.pushMedia({
          session_id: "feed",
          title: "i",
          type: "image",
          source: { base64: Buffer.from("x").toString("base64"), mime: "image/png" },
        }),
    ];
    for (let i = 0; i < pushers.length; i++) {
      await seed("feed", `old-${i}`, realDaysAgo(31), { retention_days: 30 });
      const res = await pushers[i]();
      expect(res.pruned).toEqual([`old-${i}`]);
      expect(exists("feed", `old-${i}`)).toBe(false);
    }
  });
});
