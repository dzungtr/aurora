# Aurora

Single-instance artifact host for TUI coding agents. Agents push artifacts over MCP and read them back over the same surface; aurora renders artifacts with house styling and live-updates the human's browser. Aurora does exactly one job — there is no file explorer (ADR-0007).

## Language

### Artifacts & sessions

**Artifact**:
One pushed item — markdown report, mermaid diagram, chart, image, or video — stored as an immutable snapshot.
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
The single styling definition (ECharts theme JSON, markdown/mermaid styling) applied to every artifact. Agents never control styling.
_Avoid_: skin, template

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

### Agent read surface

**Read surface**:
The three read tools (`list_sessions`, `list_artifacts`, `read_artifact`) alongside the push/generate tools; the surface is no longer write-only (ADR-0008).
_Avoid_: query API, download tools

**Content-type awareness**:
The contract that `list_artifacts` returns type/mime/size per artifact so the model decides what it can understand before reading, and `read_artifact` responses are mapped by artifact type so a model only receives content it can consume.
_Avoid_: content negotiation, transcoding

**Type-mapped response**:
`read_artifact`'s per-type output: markdown → full text; mermaid/chart/ui → capped text with offset continuation; image → MCP image content block; audio/video → unsupported-type message, bytes never cross MCP.
_Avoid_: raw download, blob response

### Live updates

**Live bus**:
The WebSocket channel broadcasting thin push/update events; clients refetch content over HTTP.
_Avoid_: notifier, push channel

**Deep link**:
`/s/<session_id>` URL returned in every tool response so agents can surface a clickable link in the TUI.
_Avoid_: preview link (retired — `/preview/*` is dead, ADR-0007)

**Session mount**:
Clicking a session in the session list scopes the artifact view to that session only.
_Avoid_: open folder, navigate into

**Auto-advance**:
Behavior where a viewed session's stack advances to a newly pushed artifact. Never navigates the user away from a different session — that gets a badge.

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
