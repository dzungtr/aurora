import { describe, expect, test } from "bun:test";
import { createChannelStore } from "./channelStore";
import type { SessionWithCount } from "./previewApi";

const sess = (session_id: string, kind?: "channel"): SessionWithCount => ({
  session_id,
  title: session_id,
  created_at: "2026-11-18T00:00:00Z",
  last_activity: "2026-11-18T00:00:00Z",
  kind,
  artifact_count: 1,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(initial: SessionWithCount[]) {
  let list = initial;
  let fail = false;
  let calls = 0;
  let fire: () => void = () => {};
  const store = createChannelStore(
    async () => {
      calls++;
      if (fail) throw new Error("boom");
      return list;
    },
    (fn) => { fire = fn; return () => {}; }
  );
  return {
    store,
    calls: () => calls,
    fire: () => fire(),
    set: (l: SessionWithCount[]) => { list = l; },
    failNext: (f: boolean) => { fail = f; },
  };
}

describe("channelStore", () => {
  test("null until the first fetch lands, then sessions and sorted channels", async () => {
    const h = harness([sess("scratch"), sess("b", "channel"), sess("a", "channel")]);
    expect(h.store.getSessions()).toBeNull();
    expect(h.store.getChannels()).toBeNull();
    h.store.subscribe(() => {});
    await flush();
    expect(h.store.getSessions()?.map((s) => s.session_id)).toEqual(["scratch", "b", "a"]);
    expect(h.store.getChannels()?.map((s) => s.session_id)).toEqual(["a", "b"]);
  });

  test("fetched once on first use, not per subscriber", async () => {
    const h = harness([]);
    h.store.subscribe(() => {});
    h.store.subscribe(() => {});
    await flush();
    expect(h.calls()).toBe(1);
  });

  test("refetches on every live event and notifies subscribers", async () => {
    const h = harness([sess("a", "channel")]);
    let notified = 0;
    h.store.subscribe(() => notified++);
    await flush();
    h.set([sess("a", "channel"), sess("b", "channel")]);
    h.fire();
    await flush();
    expect(h.calls()).toBe(2);
    expect(notified).toBe(2);
    expect(h.store.getChannels()?.length).toBe(2);
  });

  test("a failed refetch keeps the previous list", async () => {
    const h = harness([sess("a", "channel")]);
    h.store.subscribe(() => {});
    await flush();
    h.failNext(true);
    h.fire();
    await flush();
    expect(h.store.getChannels()?.map((s) => s.session_id)).toEqual(["a"]);
  });

  test("snapshots are referentially stable between fetches", async () => {
    const h = harness([sess("a", "channel")]);
    h.store.subscribe(() => {});
    await flush();
    expect(h.store.getChannels()).toBe(h.store.getChannels());
  });
});
