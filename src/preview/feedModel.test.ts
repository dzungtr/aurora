import { describe, expect, test } from "bun:test";
import { FEED_LIVE_WINDOW_MS, feedTabs, fmtUpdated, isLive, resolveFeedChannel, toastViewPath } from "./feedModel";

const s = (session_id: string, kind?: "channel") => ({ session_id, kind });

describe("feedTabs", () => {
  test("keeps only channels", () => {
    expect(feedTabs([s("scratch"), s("feed-tech", "channel")]).map((x) => x.session_id)).toEqual(["feed-tech"]);
  });

  test("sorts by code unit: digits before uppercase before lowercase", () => {
    const out = feedTabs([s("beta", "channel"), s("Zed", "channel"), s("alpha", "channel"), s("9lives", "channel")]);
    expect(out.map((x) => x.session_id)).toEqual(["9lives", "Zed", "alpha", "beta"]);
  });

  test("does not mutate its input", () => {
    const input = [s("b", "channel"), s("a", "channel")];
    const copy = [...input];
    feedTabs(input);
    expect(input).toEqual(copy);
  });

  test("empty in, empty out", () => {
    expect(feedTabs([])).toEqual([]);
  });
});

describe("resolveFeedChannel", () => {
  const tabs = [{ session_id: "a" }, { session_id: "b" }];
  test("last-viewed wins when present", () => {
    expect(resolveFeedChannel(tabs, "b")).toBe("b");
  });
  test("unknown last-viewed falls back to first tab", () => {
    expect(resolveFeedChannel(tabs, "gone")).toBe("a");
  });
  test("null last-viewed falls back to first tab", () => {
    expect(resolveFeedChannel(tabs, null)).toBe("a");
  });
  test("no tabs gives null", () => {
    expect(resolveFeedChannel([], "a")).toBeNull();
  });
});

describe("isLive", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  test("window is 15 minutes", () => {
    expect(FEED_LIVE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
  test("true just now and at the boundary", () => {
    expect(isLive("2026-11-18T12:00:00Z", now)).toBe(true);
    expect(isLive("2026-11-18T11:45:00Z", now)).toBe(true);
  });
  test("false past the window", () => {
    expect(isLive("2026-11-18T11:44:59Z", now)).toBe(false);
  });
  test("false for a future timestamp", () => {
    expect(isLive("2026-11-18T12:00:01Z", now)).toBe(false);
  });
  test("false for unparseable input", () => {
    expect(isLive("nope", now)).toBe(false);
  });
});

describe("toastViewPath", () => {
  const channels = [{ session_id: "feed-tech" }, { session_id: "feed-business" }];

  test("feed surface and a channel opens the channel's Feed tab", () => {
    expect(toastViewPath("feed", "feed-business", channels)).toBe("/feed/feed-business");
  });

  test("feed surface and an ordinary session opens the stack view", () => {
    expect(toastViewPath("feed", "scratch", channels)).toBe("/s/scratch");
  });

  test("stack surface keeps stack links, even for a channel", () => {
    expect(toastViewPath("stack", "feed-tech", channels)).toBe("/s/feed-tech");
  });

  test("feed surface before the channel list has loaded falls back to the stack view", () => {
    expect(toastViewPath("feed", "feed-tech", null)).toBe("/s/feed-tech");
  });

  test("encodes the session id", () => {
    expect(toastViewPath("feed", "a b", [{ session_id: "a b" }])).toBe("/feed/a%20b");
  });
});

describe("fmtUpdated", () => {
  test("zero-padded 24-hour HH:MM in local time", () => {
    expect(fmtUpdated(new Date(2026, 10, 18, 9, 5, 30).toISOString())).toBe("09:05");
    expect(fmtUpdated(new Date(2026, 10, 18, 17, 42).toISOString())).toBe("17:42");
  });

  test("empty string for unparseable input", () => {
    expect(fmtUpdated("nope")).toBe("");
  });
});
