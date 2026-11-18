import { describe, expect, test } from "bun:test";
import { FEED_ROUTE_PREFIX, feedPath } from "./routePaths";

describe("feedPath", () => {
  test("prefix is /feed", () => {
    expect(FEED_ROUTE_PREFIX).toBe("/feed");
  });

  test("no args is the bare Feed", () => {
    expect(feedPath()).toBe("/feed");
  });

  test("session only", () => {
    expect(feedPath("feed-tech")).toBe("/feed/feed-tech");
  });

  test("session and artifact", () => {
    expect(feedPath("feed-tech", "a1")).toBe("/feed/feed-tech/a1");
  });

  test("ids are percent-encoded", () => {
    expect(feedPath("a b/c", "x?y")).toBe("/feed/a%20b%2Fc/x%3Fy");
  });
});
