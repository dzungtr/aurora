# The Feed is a second, browser-only route; `/s/` stays the only deep link

Channels get a newspaper-style reading surface — the **Feed** — at `/feed/<channel>[/<artifact>]`: one tab per channel, the channel's stack beside the artifact (epic #97, spec #98). It is added next to the existing stack view, not in place of it. `/s/<session>` keeps rendering the stack view for every session, channels included, and remains the only URL any MCP tool returns. The Feed is presentation over data that already exists: no feed object in the store, no server data route, no tool parameter. The owner chose the separate route so that the `/s/` surface and every deep link already issued to agents and transcripts stay exactly as they are.

## Considered Options

- **Render the Feed at `/s/<channel>` whenever the session is a channel** — rejected: it changes what every already-issued channel deep link shows and takes the stack view away from channels.
- **Return a feed link from push tools for channel sessions (or switch `deep_link` to `/feed/...`)** — rejected: MCP contract churn for installed agents (ADR-0003: tool schemas are append-mostly); `/s/` already works for channels.
- **Redirect `/feed/<sid>` to `/s/<sid>` when the session is not a channel** — rejected: the URL changes under the reader; the Feed shows a notice with a link instead.

## Consequences

- `/feed` is a second reserved root namespace beside `/s` (ADR-0007); both literals live only in `lib/routePaths.ts`.
- A channel is reachable on two surfaces. Shared state (follow/Live, unread counts, stack-sidebar visibility) is keyed by session id so the two never disagree.
- Agents cannot link into the Feed. If that is ever wanted, it is an additive response field and a new decision.
