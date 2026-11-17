# Channel sessions prune their own artifacts by retention, on push

A session pushed with `session_kind: "channel"` (on `push_ui` or `push_markdown`) becomes a **channel**: a durable, agent-named session the agent re-opens across days (e.g. `feed-tech` for a daily reading briefing). A channel carries `retention_days` (1–365, default 30, last supplied value wins), and every successful push into it — from any tool — deletes that channel's artifacts whose `updated_at` is older than `now − retention_days`, never the artifact just pushed. Kind is sticky: once a channel, always a channel over MCP. Ordinary sessions are unchanged: no TTL, deletion stays an explicit human action (ADR-0002). This is the one place aurora deletes data without a human asking, and it is scoped to sessions the agent explicitly declared as channels.

## Considered Options

- **A new `open_channel` MCP tool** — rejected: the digest epic (#78) adds no tools; channel declaration rides on the two push tools the briefing agent already uses.
- **Channel by id convention (`channel-*` prefix)** — rejected: invisible in the tool schema and easy to trigger by accident, which is unacceptable for a mode that deletes data.
- **Timer/cron pruning** — rejected: aurora has no scheduler; prune-on-push is deterministic and testable, and a channel that receives no pushes does not grow.
- **Prune by `created_at`** — rejected: would delete a long-lived artifact (a tracked thread, today's briefing) the agent is still patching.
- **Pin channels by reordering `listSessions` in the store** — rejected: that changes the MCP `list_sessions` order; pinning is presentation only (a "Channels" group in the session list).

## Consequences

- `SessionMeta` gains optional `kind: "channel"` and `retention_days`; absent means an ordinary session, so existing `meta.json` files need no migration.
- `retention_days` without `session_kind: "channel"` on a non-channel session is a tool error, so an agent cannot silently believe a session is retained.
- Pruning is store-level (`ArtifactStore`), so every push path honours it; clients drop pruned artifacts on their normal post-push refetch.
