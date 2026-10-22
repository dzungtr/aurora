# Agent read surface with content-type-mapped responses

Aurora's MCP surface was write-only (11 push/generate tools, zero reads). Epic #67 adds three read tools — `list_sessions` (paginated, `last_activity` desc, default page 50, includes total), `list_artifacts(session_id)` (type/mime/size per artifact), and `read_artifact(session_id, artifact_id, offset?)` — so agents can discover and re-inspect their own and other runs' output.

The core decision: **`read_artifact` responses are mapped by artifact type so a model only ever receives content it can understand.** The awareness decision happens at `list_artifacts` (type/mime/size metadata); reads then never ship unusable bytes. The mapping: markdown → full text (uncapped — the primary report format, human-ruled); mermaid/chart/ui → text capped at 256 KiB with an `offset` continuation param and a truncation marker carrying total size; image → MCP `image` content block (base64, ≤4 MiB decoded, else a text error naming the HTTP blob URL); audio/video → unsupported-type message with the deep link, bytes never cross MCP.

## Considered options

- **Audio content blocks / inline video** — rejected: MCP spec (2025-11-25 schema) defines text/image/audio/resource_link/embedded-resource blocks and *no video type*; audio blocks exist but real clients document audio/blob omission behavior (acplause#23); even dedicated vision servers handle video out-of-band (Z.AI vision MCP docs). Audio transcripts are deliberately not wired into reads yet — deferred, not forgotten.
- **Cap all text types including markdown** — rejected by the human: markdown reports must be readable in full.
- **`read_artifact` alone, without list tools** — rejected: no discovery; cross-run reads (a later agent inspecting an earlier run) are inevitable.

## Consequences

- All mapping logic lives in one pure deep module (`lib/artifactReads.ts`); caps are module constants — changing them is a deliberate, testable act.
- Tool descriptions carry the type→response table verbatim; they are the agent-facing contract and must not drift from the implementation.
- Evidence anchors (verified 2026-10-19, re-verify before changing the mapping): MCP spec 2025-11-25 ContentBlock schema; Claude platform vision docs; acplause GitHub issue #23; Z.AI vision MCP server docs.
