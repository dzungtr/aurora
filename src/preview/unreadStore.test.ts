// Pure reducer tests for unread-count tracking. The module-level singleton
// (start/subscribe, which opens the live-update WebSocket) is intentionally
// not exercised here — these cover only applyArtifactEvent/clearSession/
// totalUnread, the extracted pure logic.
import { describe, expect, test } from "bun:test";
import { applyArtifactEvent, clearSession, totalUnread } from "./unreadStore";

describe("applyArtifactEvent", () => {
  test("increments the pushed-to session when it isn't the one being viewed", () => {
    const c = applyArtifactEvent({}, { event: "pushed", session_id: "a", artifact_id: "x" }, null);
    expect(c).toEqual({ a: 1 });
  });

  test("accumulates across repeated events for the same session", () => {
    let c: Record<string, number> = {};
    c = applyArtifactEvent(c, { event: "pushed", session_id: "a", artifact_id: "x" }, null);
    c = applyArtifactEvent(c, { event: "updated", session_id: "a", artifact_id: "x" }, null);
    expect(c).toEqual({ a: 2 });
  });

  test("ignores events for the session currently being viewed", () => {
    const c = applyArtifactEvent({}, { event: "pushed", session_id: "a", artifact_id: "x" }, "a");
    expect(c).toEqual({});
  });

  test("tracks multiple sessions independently, still ignoring the viewed one", () => {
    let c: Record<string, number> = {};
    c = applyArtifactEvent(c, { event: "pushed", session_id: "a", artifact_id: "x" }, "a");
    c = applyArtifactEvent(c, { event: "pushed", session_id: "b", artifact_id: "y" }, "a");
    expect(c).toEqual({ b: 1 });
  });

  test("returns the same reference when the event is ignored", () => {
    const start: Record<string, number> = { a: 1 };
    expect(applyArtifactEvent(start, { event: "pushed", session_id: "a", artifact_id: "x" }, "a")).toBe(start);
  });
});

describe("clearSession", () => {
  test("removes a session's count", () => {
    expect(clearSession({ a: 3, b: 1 }, "a")).toEqual({ b: 1 });
  });

  test("is a no-op when the session has no count", () => {
    const c = { b: 1 };
    expect(clearSession(c, "a")).toBe(c);
  });
});

describe("totalUnread", () => {
  test("sums all sessions", () => {
    expect(totalUnread({ a: 2, b: 3 })).toBe(5);
  });

  test("is zero for an empty map", () => {
    expect(totalUnread({})).toBe(0);
  });
});
