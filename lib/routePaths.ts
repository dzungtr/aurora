/**
 * Canonical page routes (spec #67 D5, ADR-0007). The `/s/` prefix is a
 * reserved namespace shared by the SPA path parser and the MCP deep-link
 * builder — this module is its single source of truth, so the literal never
 * appears anywhere else.
 */
export const SESSION_ROUTE_PREFIX = "/s";

/** Feed namespace (spec #98 M1, ADR-0011): `/feed`, `/feed/<sid>`, `/feed/<sid>/<aid>`. Browser-only; MCP deep links stay on `/s/`. */
export const FEED_ROUTE_PREFIX = "/feed";

/** Session page path: `/s/<sid>`. */
export function sessionPath(sessionId: string): string {
  return `${SESSION_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`;
}

/** Artifact page path: `/s/<sid>/<aid>`, where an artifact id exists. */
export function artifactPath(sessionId: string, artifactId: string): string {
  return `${sessionPath(sessionId)}/${encodeURIComponent(artifactId)}`;
}

/** Feed page path: `/feed`, `/feed/<sid>`, or `/feed/<sid>/<aid>` (an artifact id needs a session id). */
export function feedPath(sessionId?: string, artifactId?: string): string {
  if (sessionId === undefined) return FEED_ROUTE_PREFIX;
  const base = `${FEED_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`;
  return artifactId === undefined ? base : `${base}/${encodeURIComponent(artifactId)}`;
}
