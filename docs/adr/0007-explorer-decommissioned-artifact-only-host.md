# Explorer decommissioned — aurora is an artifact-only host

Aurora's original second role — a per-project host file explorer (CLI `rootDir`, `/workspace` mounts, `/api/tree|file|dir|rename`, an explorer frontend) — is deleted outright (epic #67). The explorer was what forced per-project plumbing that contradicted the single-global-instance model, and the artifact browser fully replaces its human-facing value. Aurora now does exactly one job: artifact host.

Carried forward from the deleted ADR-0001, still true: aurora is a **single instance on a fixed localhost port (default 7634)** serving MCP over Streamable HTTP; agents install one stable URL (`http://127.0.0.1:7634/mcp`); there is no auth — the localhost bind is the security boundary; MCP-level sessions are unused (stateless transport, fresh per request), aurora "sessions" are application-level, keyed by agent-supplied ids.

## Considered options

- **Read-only explorer keep** — rejected: retains per-project plumbing and a second UI surface for near-zero value.
- **`/preview/*` redirects or dual-serve** — rejected: a permanent compat shim for transient benefit. Hard cut: `/preview/*` 404s; canonical deep links are `/s/<sid>[/<aid>]`. Links in historical agent transcripts go dead — accepted.
- **Root-level `/<sid>` paths** — rejected: session ids are agent-minted free strings and would collide with app routes; the `/s/` prefix is a reserved namespace.

## Consequences

- The CLI is flags-only (`bun cli.ts [--port N]`); deployments passing a positional rootDir break loudly. Docker/k8s manifests mounting `/workspace` must drop it on image bump (homelab follow-up, out of epic scope).
- The internal `/api/preview/*` data routes keep their names this epic — renaming is churn without user-facing value; a later epic may align them.
