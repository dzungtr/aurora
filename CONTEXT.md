# Aurora

Single-instance artifact host for TUI coding agents. Agents push artifacts over MCP and read them back over the same surface; aurora renders artifacts with house styling and live-updates the human's browser. Aurora does exactly one job — there is no file explorer (ADR-0007).

## Language

### Artifacts & sessions

**Artifact**:
One pushed item — markdown report, mermaid diagram, chart, UI artifact, image, audio, or video — stored as an immutable snapshot.
_Avoid_: page, document, file

**Session**:
An agent-minted, free-form string id namespacing a stack of artifacts from one agent conversation.
_Avoid_: conversation, run, workspace

**Push**:
A tool call adding an artifact. Without `artifact_id` it appends a new artifact to the session stack; with a known `artifact_id` it replaces that artifact in place (idempotent update).
_Avoid_: publish, upload, post

**Stack**:
A session's artifacts ordered oldest→newest; the newest sits on top and the artifact view auto-advances to it.
_Avoid_: history, feed

**Snapshot**:
The copy of artifact bytes in aurora's store, taken at push time. Sources (paths, URLs) are never referenced live.
_Avoid_: cache, copy, blob

### Rendering

**House theme**:
The single styling definition (ECharts theme JSON, markdown/mermaid styling) applied to every artifact. Agents never control styling. Dark mode has one look; light mode offers viewer-chosen palettes (ADR-0012).
_Avoid_: skin, template

**Palette**:
One of the named light-mode colour sets (Paper, Broadsheet, Slate & coral, Cobalt & tangerine) the viewer picks in the top bar. A per-browser preference — never set by an agent, never stored with an artifact.
_Avoid_: theme, skin, colour scheme

**Chart contract**:
The per-`chart_type` data shape accepted by `push_chart`, translated to chart-lib options by a pure function.

### Agent-composed UI

**UI artifact**:
An artifact whose snapshot is an OpenUI Lang program composed against the aurora component library; rendered client-side with the house theme.
_Avoid_: dashboard, page, screen

**Component library**:
The aurora-defined component set (with Zod schemas) agents may compose into a UI artifact; the single source of truth for validation and the generated `push_ui` description.
_Avoid_: design system, widget set, default library

**Program**:
The OpenUI Lang source that is a UI artifact's snapshot; lines of `identifier = Expression` statements.
_Avoid_: spec, layout, source file

**Patch**:
A push mode sending only changed statements; merged server-side into a new full-program snapshot, never stored as a delta.
_Avoid_: diff, delta, partial update

### Reading briefing

**Channel**:
A session the agent declared with `session_kind: "channel"`: durable, re-opened by the same agent-minted id across days, pinned in the session list, and pruned by its retention on every push (ADR-0009).
_Avoid_: topic, inbox

**Retention**:
A channel's `retention_days`; artifacts whose `updated_at` is older are deleted on the next push into that channel.
_Avoid_: TTL, expiry

**Briefing**:
One UI artifact per day in a channel, composed from the digest components and patched in place as scans complete.
_Avoid_: newsletter, digest page, feed

**Digest**:
The agent's written summary of one kept story (sapo, why-you line, body) — the product aurora shows; the original source stays an external link.
_Avoid_: article, summary card

**Variant**:
A `DigestCard`'s editorial weight — `hero`, `rail`, or `list`. The agent ranks; the house theme decides what each rank looks like.
_Avoid_: size, style, layout

**Handle**:
An agent-minted, program-unique label (`story_id` on a `DigestCard`, `thread_id` on a `ThreadUpdate`) used in chat references and as the patch anchor. Not looked up server-side.
_Avoid_: key, slug, item id

### Feed

**Feed**:
The browser reading surface at `/feed` that shows every channel as a tab and one channel's stack at a time. A surface, not data: there is no feed object in the store or on MCP, and a single channel, stack or briefing is never "a feed" (ADR-0011).
_Avoid_: timeline, home, newspaper view

**Tab**:
A channel's entry in the Feed, labelled with the channel id verbatim and ordered alphabetically.
_Avoid_: topic, section

**Archived**:
A Feed display state for a channel artifact last updated on an earlier day than the channel's newest artifact. It is still the real artifact, shown under a banner, until retention prunes it.
_Avoid_: frozen, expired, placeholder

### Agent read surface

**Read surface**:
The four read tools (`list_sessions`, `list_artifacts`, `read_artifact`, `search_artifacts`) alongside the push/generate tools; the surface is no longer write-only (ADR-0008, ADR-0013).
_Avoid_: query API, download tools

**Content-type awareness**:
The contract that `list_artifacts` returns type/mime/size per artifact so the model decides what it can understand before reading, and `read_artifact` responses are mapped by artifact type so a model only receives content it can consume.
_Avoid_: content negotiation, transcoding

**Type-mapped response**:
`read_artifact`'s per-type output: markdown → full text; mermaid/chart/ui → capped text with offset continuation; image → MCP image content block; audio/video → unsupported-type message, bytes never cross MCP.
_Avoid_: raw download, blob response

### Search

**Search**:
Finding artifacts by meaning or wording, across the whole store or within one session.
_Avoid_: query, lookup, find

**Search index**:
The derived, rebuildable record of artifact content that search reads; never the source of truth (ADR-0013).
_Avoid_: cache, database, vector store

**Hit**:
One artifact returned by a search, with a snippet of its best-matching passage.
_Avoid_: result, match

**Reindex**:
The human-triggered, store-wide pass that brings the search index in line with the store.
_Avoid_: rebuild, sync, refresh

### Live updates

**Live bus**:
The WebSocket channel broadcasting thin push/update events; clients refetch content over HTTP.
_Avoid_: notifier, push channel

**Deep link**:
`/s/<session_id>` URL returned in every tool response so agents can surface a clickable link in the TUI. Feed URLs (`/feed/...`) are browser-only and never returned by a tool (ADR-0011).
_Avoid_: preview link (retired — `/preview/*` is dead, ADR-0007)

**Session mount**:
Clicking a session in the session list scopes the artifact view to that session only.
_Avoid_: open folder, navigate into

**Auto-advance**:
Behavior where a viewed session's stack advances to a newly pushed artifact. Never navigates the user away from a different session — that gets a badge. The toggle is labelled "Follow latest" in the stack view and "Live" in the Feed; it is one preference per session.

### Generation

**Generation**:
Synthesis of new media by aurora calling a provider model server-side; the output is snapshotted as an artifact. Contrast with Push, which snapshots bytes the agent already has.
_Avoid_: render, draw, AI call

**Job**:
One async generation unit tracked in the job registry from submit to a terminal state (completed, failed, cancelled, expired), landing as an artifact or a visible failure artifact.
_Avoid_: task, request

**Whitelist**:
The operator-curated allowlist of provider models exposed to agents as the generation tools' model enum.
_Avoid_: catalog, allowlist, model list
