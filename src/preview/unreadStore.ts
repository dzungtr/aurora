// Per-session unread artifact counts, derived from the live-update event
// stream. A push/update counts as unread for every session that isn't the
// one currently open; opening a session clears its count. Module-level
// singleton so the count survives the full-tree remounts that navigation
// triggers (PreviewApp is re-keyed on every route change in App.tsx).

import { useSyncExternalStore } from "react";
import type { ArtifactEvent } from "../../lib/liveBus";
import { onArtifactEvent } from "./liveSocket";

export type UnreadCounts = Record<string, number>;

/** Pure reducer: fold one event into the unread-count map, given which
 * session (if any) is currently open. Exported for unit testing. */
export function applyArtifactEvent(
  counts: UnreadCounts,
  evt: ArtifactEvent,
  viewingSessionId: string | null
): UnreadCounts {
  if (evt.session_id === viewingSessionId) return counts;
  return { ...counts, [evt.session_id]: (counts[evt.session_id] ?? 0) + 1 };
}

/** Clear one session's count (e.g. it was just opened). No-op if already 0. */
export function clearSession(counts: UnreadCounts, sessionId: string): UnreadCounts {
  if (!(sessionId in counts)) return counts;
  const next = { ...counts };
  delete next[sessionId];
  return next;
}

export function totalUnread(counts: UnreadCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

let counts: UnreadCounts = {};
let viewingSessionId: string | null = null;
const subscribers = new Set<() => void>();
let started = false;

function notify(): void {
  for (const fn of subscribers) fn();
}

function start(): void {
  if (started) return;
  started = true;
  onArtifactEvent((evt) => {
    const next = applyArtifactEvent(counts, evt, viewingSessionId);
    if (next !== counts) {
      counts = next;
      notify();
    }
  });
}

/** Mark which session (if any) is currently open; clears its own count. */
export function setViewingSession(sessionId: string | null): void {
  viewingSessionId = sessionId;
  if (sessionId) {
    const next = clearSession(counts, sessionId);
    if (next !== counts) {
      counts = next;
      notify();
    }
  }
}

function getSnapshot(): UnreadCounts {
  start();
  return counts;
}

function subscribe(fn: () => void): () => void {
  start();
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** React hook: live per-session unread counts. */
export function useUnreadCounts(): UnreadCounts {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
