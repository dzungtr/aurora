/**
 * Canonical page routes (spec #67 D5, ADR-0007). The `/s/` prefix is a
 * reserved namespace shared by the SPA path parser and the MCP deep-link
 * builder — this module is its single source of truth, so the literal never
 * appears anywhere else.
 */
export const SESSION_ROUTE_PREFIX = "/s";

/** Session page path: `/s/<sid>`. */
export function sessionPath(sessionId: string): string {
  return `${SESSION_ROUTE_PREFIX}/${encodeURIComponent(sessionId)}`;
}

/** Artifact page path: `/s/<sid>/<aid>`, where an artifact id exists. */
export function artifactPath(sessionId: string, artifactId: string): string {
  return `${sessionPath(sessionId)}/${encodeURIComponent(artifactId)}`;
}
