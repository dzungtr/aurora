# Aurora generates media server-side; async video is submit-and-notify with a SQLite job registry

The generation tools make aurora itself an OpenRouter client, so agents need no provider keys and every generated artifact lands under the same immutable snapshot discipline as pushed media (ADR-0002). Video generation takes minutes, so `create_video` is submit-and-notify: the tool returns a job id immediately and a server-side poller pushes the artifact when the provider completes — a blocking call would hit MCP client timeouts and strand billed jobs on failure. Pending jobs persist in a SQLite registry (`bun:sqlite`, zero new dependencies, verified inside the compiled build) because operational state updated at a 30-second poll cadence with boot-time re-attachment is a database's job, not a write-per-poll JSON file's; the registry holds only operational state, artifact content stays file-snapshots. Provider webhooks were rejected: they require a public HTTPS callback, which a localhost-first app cannot offer.

## Considered Options

- Blocking video generation in one tool call — simpler contract, but minutes-long calls hit client timeouts and lose billed output on failure.
- JSON-file job ledger (matching the artifact store's substrate) — rejected: high-frequency status writes and boot re-attachment want transactions and indexes, and SQLite ships inside Bun with no new dependency.
- Webhook completion — rejected: OpenRouter callbacks require public HTTPS; localhost aurora cannot receive them. Polling is the design.
