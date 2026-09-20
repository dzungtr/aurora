import { describe, it, expect } from "bun:test";
import { LiveBus, artifactEvent, type ArtifactEvent } from "./liveBus";

describe("LiveBus", () => {
  it("broadcasts to in-process subscribers with the thin envelope", () => {
    const bus = new LiveBus();
    const seen: ArtifactEvent[] = [];
    const unsub = bus.subscribe((e) => seen.push(e));
    bus.broadcast({ event: "pushed", session_id: "s1", artifact_id: "a1" });
    unsub();
    bus.broadcast({ event: "updated", session_id: "s1", artifact_id: "a1" });
    expect(seen).toEqual([{ event: "pushed", session_id: "s1", artifact_id: "a1" }]);
  });

  it("maps a store push result to pushed vs updated by `created`", () => {
    const session = { session_id: "s1" };
    const artifact = { artifact_id: "a1" };
    expect(artifactEvent({ session, artifact, created: true })).toEqual({
      event: "pushed", session_id: "s1", artifact_id: "a1",
    });
    expect(artifactEvent({ session, artifact, created: false })).toEqual({
      event: "updated", session_id: "s1", artifact_id: "a1",
    });
  });
});
