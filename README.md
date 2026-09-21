# aurora

A local-first file explorer and MCP artifact-preview host for agents. aurora serves a project directory over a web UI (file tree, markdown, mermaid, ECharts, images, video, PDFs) and exposes an MCP server over Streamable HTTP so coding agents can push artifacts (markdown, charts, mermaid diagrams, images, videos) into an always-visible preview window.

## Quick start

```sh
bun install
bun cli.ts .            # serve the current directory on port 7634
bun cli.ts /path/to/project --port 8080
```

Run tests: `bun test`

### Docker

```sh
docker run -p 127.0.0.1:7634:7634 ghcr.io/dzungtr/aurora
# serve a host directory + persist artifacts:
docker run -p 127.0.0.1:7634:7634 \
  -v "$PWD:/workspace" \
  -v aurora-artifacts:/root/.local/share/aurora/artifacts \
  ghcr.io/dzungtr/aurora
```

The container publishes on `127.0.0.1` only — aurora's "localhost is the security boundary" guarantee is preserved at the publish step.

## Adding aurora as an MCP server

Aurora exposes MCP over **Streamable HTTP** at a fixed localhost URL (default `http://127.0.0.1:7634/mcp`). One running aurora instance serves all agents on the machine — install the URL once, per agent config. Artifacts are stored machine-globally (default `~/.local/share/aurora/artifacts`), independent of which directory the explorer is browsing.

> **Security:** aurora has no authentication — the localhost bind *is* the security boundary. Never expose port 7634 to the network.

1. Start aurora and leave it running:

   ```sh
   bun cli.ts .
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

All artifacts are **immutable snapshots** copied into `~/.local/share/aurora/artifacts` at receipt time — the original source may disappear without breaking the preview (see [ADR 0002](docs/adr/0002-immutable-snapshot-artifact-store.md)).

### Configuration

| Env / arg | Default | Notes |
| --- | --- | --- |
| positional `<path>` | (required) | Root directory to explore |
| `--port` | `7634` | HTTP + MCP port |
| `AURORA_HOST` | `127.0.0.1` | Bind address (container images set `0.0.0.0`) |

## Docs

- [ADR 0001 — MCP over Streamable HTTP, single instance](docs/adr/0001-single-instance-streamable-http-mcp.md)
- [ADR 0002 — Immutable artifact snapshots](docs/adr/0002-immutable-snapshot-artifact-store.md)
- [ADR 0003 — Typed artifact contracts](docs/adr/0003-typed-artifact-contracts.md)
