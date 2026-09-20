import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ArtifactStore, PushResult } from "./artifactStore";
import { artifactEvent, type LiveBus } from "./liveBus";

export const MCP_PATH = "/mcp";

/**
 * Handle one request to the MCP endpoint. Stateless mode: a fresh transport
 * (and server instance) per request, no session id issued, per the official
 * SDK guidance for serverless/stateless Streamable HTTP.
 */
export async function handleMcpRequest(req: Request, store: ArtifactStore, baseUrl: string, liveBus?: LiveBus) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = new McpServer(
    { name: "aurora", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const pushTextTool = (
    name: string,
    title: string,
    description: string,
    valueField: "content" | "code",
    valueDescription: string,
    push: (input: { session_id: string; title: string; artifact_id?: string; session_title?: string }) => Promise<PushResult>
  ) => {
    // Shared shape: session/title/value + optional artifact_id/session_title;
    // response carries the preview deep link either way.
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {
          session_id: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "session_id: alphanumerics, dot, underscore, hyphen; max 128 chars"),
          title: z.string().min(1).describe("Human-visible artifact title"),
          [valueField]: z.string().min(1).describe(valueDescription),
          artifact_id: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
            .optional()
            .describe("Replace an existing artifact in place when provided"),
          session_title: z
            .string()
            .optional()
            .describe("Session title, honored only when the session is created by this push"),
        },
      },
      async (args) => {
        const { session_id, title, artifact_id, session_title } = args as {
          session_id: string;
          title: string;
          artifact_id?: string;
          session_title?: string;
        };
        const result = await push(args as any);
        // Thin live-update event: clients refetch content over HTTP.
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Pushed" : "Replaced"} artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
          },
        };
      }
    );
  };

  pushTextTool(
    "push_markdown",
    "Push markdown artifact",
    "Push a markdown artifact to an aurora preview session. Creates the session implicitly on first push. Returns a deep link the human can open.",
    "content",
    "Markdown source",
    (input) => store.pushMarkdown(input as any)
  );

  pushTextTool(
    "push_mermaid",
    "Push mermaid diagram",
    "Push a mermaid diagram (as source code) to an aurora preview session, rendered with the house dark theme. Creates the session implicitly on first push. Returns a deep link the human can open.",
    "code",
    "Mermaid diagram source (e.g. 'flowchart TD; A --> B')",
    (input) => store.pushMermaid(input as any)
  );

  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    // Stateless mode: the transport must not be closed before its response
    // body (often an SSE stream) is fully written. Buffer the body here and
    // re-emit it as a plain Response so the route handler can return it safely.
    const body = res.body ? await res.text() : null;
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } finally {
    await transport.close();
    await server.close();
  }
}
