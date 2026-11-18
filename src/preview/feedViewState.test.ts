import { describe, expect, test } from "bun:test";
import { feedViewState } from "./feedModel";

describe("feedViewState", () => {
  const list = [
    { session_id: "scratch" },
    { session_id: "feed-b", kind: "channel" as const },
    { session_id: "feed-a", kind: "channel" as const },
  ];
  test("loading while sessions are unloaded", () => {
    expect(feedViewState(undefined, null, null)).toEqual({ kind: "loading" });
    expect(feedViewState("x", null, null)).toEqual({ kind: "loading" });
  });
  test("bare route with no channels is the empty state", () => {
    expect(feedViewState(undefined, [{ session_id: "scratch" }], null)).toEqual({ kind: "empty" });
    expect(feedViewState(undefined, [], null)).toEqual({ kind: "empty" });
  });
  test("bare route resolves to last-viewed, else first tab", () => {
    expect(feedViewState(undefined, list, "feed-b")).toEqual({ kind: "resolve", channel: "feed-b" });
    expect(feedViewState(undefined, list, null)).toEqual({ kind: "resolve", channel: "feed-a" });
  });
  test("a channel id shows the channel", () => {
    expect(feedViewState("feed-b", list, "feed-a")).toEqual({ kind: "channel", sid: "feed-b" });
  });
  test("an ordinary session is a notice, not a channel", () => {
    expect(feedViewState("scratch", list, null)).toEqual({ kind: "not-channel", sid: "scratch" });
  });
  test("an unknown id is no-session", () => {
    expect(feedViewState("nope", list, null)).toEqual({ kind: "no-session", sid: "nope" });
  });
});
