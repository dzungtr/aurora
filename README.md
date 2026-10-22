# aurora

A local-first MCP artifact-preview host for agents. aurora exposes an MCP server over Streamable HTTP so coding agents can push artifacts (markdown, charts, mermaid diagrams, images, videos) into an always-visible preview window. There is no file explorer — aurora serves its artifact store and nothing else (see [ADR 0007](docs/adr/0007-explorer-decommissioned-artifact-only-host.md)).

## Quick start

```sh
bun install
bun cli.ts              # serve on port 7634
bun cli.ts --port 8080
```

Run tests: `bun test`

### Docker

```sh
docker run -p 127.0.0.1:7634:7634 ghcr.io/dzungtr/aurora
# persist artifacts across container restarts:
docker run -p 127.0.0.1:7634:7634 \
  -v aurora-artifacts:/root/.local/share/aurora/artifacts \
  ghcr.io/dzungtr/aurora
```

The container publishes on `127.0.0.1` only — aurora's "localhost is the security boundary" guarantee is preserved at the publish step.

## Adding aurora as an MCP server

Aurora exposes MCP over **Streamable HTTP** at a fixed localhost URL (default `http://127.0.0.1:7634/mcp`). One running aurora instance serves all agents on the machine — install the URL once, per agent config. Artifacts are stored machine-globally (default `~/.local/share/aurora/artifacts`), the only state aurora keeps.

> **Security:** aurora has no authentication — the localhost bind *is* the security boundary. Never expose port 7634 to the network.

1. Start aurora and leave it running:

   ```sh
   bun cli.ts
   ```

2. Point your agent at the endpoint. Examples:

   **Claude Code** (`~/.claude.json` or `claude mcp add`):

   ```sh
   claude mcp add --transport http aurora http://127.0.0.1:7634/mcp
   ```

   **Cursor / generic config** (`.cursor/mcp.json` or similar):

   ```json
   {
     "mcpServers": {
       "aurora": {
         "url": "http://127.0.0.1:7634/mcp"
       }
     }
   }
   ```

   **Codex / clients that only speak stdio**: bridge with `mcp-remote`:

   ```json
   {
     "mcpServers": {
       "aurora": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "http://127.0.0.1:7634/mcp"]
       }
     }
   }
   ```

3. Restart the agent. You should see aurora's tools listed.

### Available tools

| Tool | Description |
| --- | --- |
| `push_markdown` | Render a markdown document in the preview |
| `push_mermaid` | Render a mermaid diagram |
| `push_chart` | Render an ECharts chart (typed contract — `chart_type` + data, not raw options) |
| `push_image` | Push an image artifact (path, base64, or URL — snapshotted into aurora's store) |
| `push_video` | Push a video artifact (same snapshot semantics) |
| `list_sessions` | List sessions, most recent activity first, paginated (`offset`, `limit`, plus `total`) |
| `list_artifacts` | List a session's artifacts with type, mime, and size — decide what is readable before reading |
| `read_artifact` | Read one artifact, mapped by type: markdown full text; mermaid/chart/ui capped at 256 KiB with `offset` continuation; image as an MCP image block (≤4 MiB); audio/video as an unsupported-type message with the deep link |

All artifacts are **immutable snapshots** copied into `~/.local/share/aurora/artifacts` at receipt time — the original source may disappear without breaking the preview (see [ADR 0002](docs/adr/0002-immutable-snapshot-artifact-store.md)).

### Configuration

| Env / arg | Default | Notes |
| --- | --- | --- |
| `--port` | `7634` | HTTP + MCP port |
| `AURORA_HOST` | `127.0.0.1` | Bind address (container images set `0.0.0.0`) |

Deep links returned by MCP tools use the canonical `/s/<session_id>` form (ADR-0007) and are prefixed with, in order of precedence: `publicUrl` from the generation config (`~/.config/aurora/generation.json`, e.g. a remote ingress URL), then `http://127.0.0.1:<port>`.

## Docs

- [ADR 0007 — Explorer decommissioned, artifact-only host](docs/adr/0007-explorer-decommissioned-artifact-only-host.md)
- [ADR 0002 — Immutable artifact snapshots](docs/adr/0002-immutable-snapshot-artifact-store.md)
- [ADR 0003 — Typed artifact contracts](docs/adr/0003-typed-artifact-contracts.md)
