// Live-update bus: fan-out of thin artifact events to WebSocket clients.
// Events carry no payload — clients refetch content over HTTP. See spec
// issue #1 "Live updates" and the Handoffs table for the event envelope.

export interface ArtifactEvent {
  event: "pushed" | "updated";
  session_id: string;
  artifact_id: string;
}

export function artifactEvent(result: { session: { session_id: string }; artifact: { artifact_id: string }; created: boolean }): ArtifactEvent {
  return {
    event: result.created ? "pushed" : "updated",
    session_id: result.session.session_id,
    artifact_id: result.artifact.artifact_id,
  };
}

export class LiveBus {
  private sockets = new Set<{ send(data: string): void }>();
  private listeners = new Set<(evt: ArtifactEvent) => void>();

  /** Register an in-process listener (tests, UI-side mirroring). Returns unsubscribe. */
  subscribe(fn: (evt: ArtifactEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Broadcast an event to in-process listeners and all connected WS clients. */
  broadcast(evt: ArtifactEvent): void {
    for (const fn of this.listeners) fn(evt);
    const data = JSON.stringify(evt);
    for (const ws of this.sockets) ws.send(data);
  }

  /** Handlers for Bun.serve's `websocket` option. */
  get websocket() {
    return {
      open: (ws: { send(data: string): void }) => {
        this.sockets.add(ws);
      },
      // A live-updates channel has no client→server messages; ignore anything sent.
      message: () => {},
      close: (ws: { send(data: string): void }) => {
        this.sockets.delete(ws);
      },
    };
  }

  /** Number of currently connected WebSocket clients (observability/tests). */
  get connectionCount(): number {
    return this.sockets.size;
  }
}
