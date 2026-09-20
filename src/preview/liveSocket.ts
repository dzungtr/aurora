// Client side of the live-update channel: a singleton WebSocket to /ws that
// survives SPA navigation (App mounts it once) and reconnects on drop.
// Events are thin — {event, session_id, artifact_id} — content is refetched
// over HTTP by the subscribing views.

import type { ArtifactEvent } from "../../lib/liveBus";

type Listener = (evt: ArtifactEvent) => void;

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  ws.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data) as ArtifactEvent;
      for (const fn of listeners) fn(evt);
    } catch {
      // Malformed frame — ignore; the channel is best-effort.
    }
  };
  ws.onclose = () => {
    ws = null;
    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
  };
}

/** Open the live-update connection once at app root; returns a noop cleanup. */
export function startLiveSocket(): () => void {
  connect();
  return () => {};
}

/** Subscribe to artifact events; the connection is opened lazily on first use. */
export function onArtifactEvent(fn: Listener): () => void {
  connect();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
