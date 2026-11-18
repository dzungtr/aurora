// Pure Feed logic (spec #98 M4, M5, M8): which sessions are tabs, which tab a
// bare Feed route opens, what "live" means, and which state the view is in.

export const FEED_LIVE_WINDOW_MS = 15 * 60 * 1000;

/** Tabs are every channel session, ordered by code unit (not locale) so the
 * "first tab" is the same in every browser. Does not mutate its input. */
export function feedTabs<T extends { session_id: string; kind?: "channel" }>(sessions: T[]): T[] {
  return sessions
    .filter((s) => s.kind === "channel")
    .sort((a, b) => (a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0));
}

/** The channel a bare Feed route opens: last-viewed if it is still a tab, else the first tab. */
export function resolveFeedChannel(tabs: { session_id: string }[], lastViewed: string | null): string | null {
  if (lastViewed !== null && tabs.some((t) => t.session_id === lastViewed)) return lastViewed;
  return tabs[0]?.session_id ?? null;
}

/** True iff `iso` is no older than the live window and not in the future. */
export function isLive(iso: string, now: number): boolean {
  const age = now - Date.parse(iso);
  return age >= 0 && age <= FEED_LIVE_WINDOW_MS;
}

/** Feed nav badge (D15): unread summed over channel sessions only. */
export function feedUnread(counts: Record<string, number>, channels: { session_id: string }[] | null): number {
  return (channels ?? []).reduce((sum, c) => sum + (counts[c.session_id] ?? 0), 0);
}

export type FeedViewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "resolve"; channel: string }
  | { kind: "no-session"; sid: string }
  | { kind: "not-channel"; sid: string }
  | { kind: "channel"; sid: string };

/** What the Feed shows for a route, given the session list (null = not loaded)
 * and the last-viewed channel. A non-channel id is a notice, never a redirect. */
export function feedViewState(
  sessionId: string | undefined,
  sessions: { session_id: string; kind?: "channel" }[] | null,
  lastViewed: string | null
): FeedViewState {
  if (sessions === null) return { kind: "loading" };
  if (sessionId === undefined) {
    const channel = resolveFeedChannel(feedTabs(sessions), lastViewed);
    return channel === null ? { kind: "empty" } : { kind: "resolve", channel };
  }
  const found = sessions.find((s) => s.session_id === sessionId);
  if (!found) return { kind: "no-session", sid: sessionId };
  if (found.kind !== "channel") return { kind: "not-channel", sid: sessionId };
  return { kind: "channel", sid: sessionId };
}
