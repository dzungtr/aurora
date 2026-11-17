import { describe, expect, test } from "bun:test";
import { groupSessions } from "./sessionGroups";

const s = (id: string, kind?: "channel") => ({
  session_id: id,
  title: id,
  created_at: "2026-01-01T00:00:00Z",
  last_activity: "2026-01-01T00:00:00Z",
  artifact_count: 0,
  ...(kind ? { kind, retention_days: 30 } : {}),
});

describe("groupSessions", () => {
  test("splits channels from the rest", () => {
    const { channels, others } = groupSessions([s("a"), s("feed", "channel"), s("b")]);
    expect(channels.map((x) => x.session_id)).toEqual(["feed"]);
    expect(others.map((x) => x.session_id)).toEqual(["a", "b"]);
  });

  test("keeps incoming order inside each group", () => {
    const { channels, others } = groupSessions([
      s("c1", "channel"), s("a"), s("c2", "channel"), s("b"), s("c3", "channel"),
    ]);
    expect(channels.map((x) => x.session_id)).toEqual(["c1", "c2", "c3"]);
    expect(others.map((x) => x.session_id)).toEqual(["a", "b"]);
  });

  test("no channels yields an empty channels group", () => {
    const { channels, others } = groupSessions([s("a")]);
    expect(channels).toEqual([]);
    expect(others).toHaveLength(1);
  });
});
