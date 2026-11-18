import { describe, expect, test } from "bun:test";
import { FEED_LIVE_WINDOW_MS, feedTabs, isArchived, isLive, pruneEligibleAt, resolveFeedChannel } from "./feedModel";

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

// Local-time fixtures: the day boundary is the viewer's, so the tests build
// timestamps from local calendar fields and hold in any timezone.
const local = (day: number, hour: number) => new Date(2026, 10, day, hour, 0, 0).toISOString();
const m = (updated_at: string) => ({ updated_at });

describe("isArchived", () => {
  const all = [m(local(15, 9)), m(local(18, 8)), m(local(18, 18))];
  test("false for a same-day sibling of the newest", () => {
    expect(isArchived(m(local(18, 8)), all)).toBe(false);
    expect(isArchived(m(local(18, 18)), all)).toBe(false);
  });
  test("true for an earlier local calendar day", () => {
    expect(isArchived(m(local(15, 9)), all)).toBe(true);
  });
  test("true one day earlier even when under 24 hours apart", () => {
    const pair = [m(local(17, 23)), m(local(18, 1))];
    expect(isArchived(pair[0]!, pair)).toBe(true);
  });
  test("false for the only artifact", () => {
    const only = [m(local(10, 9))];
    expect(isArchived(only[0]!, only)).toBe(false);
  });
  test("false for an empty list", () => {
    expect(isArchived(m(local(10, 9)), [])).toBe(false);
  });
  test("false for an unparseable date", () => {
    expect(isArchived(m("nope"), all)).toBe(false);
  });
  test("ignores unparseable siblings when finding the newest day", () => {
    expect(isArchived(m(local(15, 9)), [m("nope"), m(local(15, 9))])).toBe(false);
  });
});

describe("pruneEligibleAt", () => {
  test("is updated_at plus retention days in milliseconds", () => {
    const u = "2026-11-15T09:30:00.000Z";
    expect(pruneEligibleAt(u, 30).getTime()).toBe(Date.parse(u) + 30 * 86_400_000);
    expect(pruneEligibleAt(u, 0).getTime()).toBe(Date.parse(u));
  });
});
