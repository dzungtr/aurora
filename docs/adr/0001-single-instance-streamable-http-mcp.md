# Single aurora instance serves MCP over Streamable HTTP on a fixed localhost port

Aurora is a per-project file explorer, but the artifact-preview MCP endpoint is served by a **single instance on a fixed localhost port (default 7634)**, not one per project. Agents install one stable URL (`http://127.0.0.1:7634/mcp`) once; artifacts come from agents, not the file tree, so they are global to the machine and independent of the explorer root. We rejected stdio (spawns a process per agent, incompatible with a shared always-open preview) and per-project instances with a shared store (unstable URLs for agent configs). No auth — the localhost bind *is* the security boundary. MCP-level sessions are unused (stateless transport, fresh per request); aurora "sessions" are an application-level concept keyed by agent-supplied ids.

## Consequences

- Claude *Desktop* custom connectors cannot reach localhost (they route via Anthropic's cloud) — accepted, TUI agents are the target.
- Only one aurora may run at a time on a machine; a second start must fail loudly on port bind.
