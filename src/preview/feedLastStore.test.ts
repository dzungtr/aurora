import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getLastFeedChannel, setLastFeedChannel } from "./feedLastStore";

const g = globalThis as Record<string, unknown>;
let saved: unknown;
let backing: Map<string, string>;

beforeEach(() => {
  saved = g.localStorage;
  backing = new Map();
  g.localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
  };
});

afterEach(() => {
  g.localStorage = saved;
});

describe("feedLastStore", () => {
  test("persists under aurora:feed:last as the raw id", () => {
    setLastFeedChannel("feed-tech");
    expect(backing.get("aurora:feed:last")).toBe("feed-tech");
    expect(getLastFeedChannel()).toBe("feed-tech");
  });

  test("reads a value stored by an earlier page load", () => {
    backing.set("aurora:feed:last", "feed-business");
    expect(getLastFeedChannel()).toBe("feed-business");
  });

  test("never throws and degrades to memory when storage throws", () => {
    g.localStorage = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(() => setLastFeedChannel("mem")).not.toThrow();
    expect(getLastFeedChannel()).toBe("mem");
  });
});
