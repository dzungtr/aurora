// Session list grouping (ADR-0009): channels are pinned above ordinary
// sessions in the UI only. The store/MCP order is untouched, and each group
// keeps the incoming (most-recent-activity-first) order.
import type { SessionMeta } from "./previewApi";

export function groupSessions<T extends SessionMeta>(sessions: T[]): { channels: T[]; others: T[] } {
  const channels: T[] = [];
  const others: T[] = [];
  for (const s of sessions) (s.kind === "channel" ? channels : others).push(s);
  return { channels, others };
}
