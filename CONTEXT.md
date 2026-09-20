# Aurora

Local-first web app that doubles as a file explorer and a live artifact preview host for TUI coding agents. Agents push artifacts over MCP; aurora renders them with house styling and live-updates the human's browser.

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
A session's artifacts ordered oldest→newest; the newest sits on top and the preview auto-advances to it.
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

### Live preview

**Live bus**:
The WebSocket channel broadcasting thin push/update events; clients refetch content over HTTP.
_Avoid_: notifier, push channel

**Deep link**:
`/preview/<session_id>` URL returned in every tool response so agents can surface a clickable link in the TUI.

**Auto-advance**:
Behavior where a viewed session's stack advances to a newly pushed artifact. Never navigates the user away from a different session — that gets a badge.
