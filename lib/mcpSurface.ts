import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ArtifactStore } from "./artifactStore";

export const MCP_PATH = "/mcp";

/**
 * Handle one request to the MCP endpoint. Stateless mode: a fresh transport
 * (and server instance) per request, no session id issued, per the official
 * SDK guidance for serverless/stateless Streamable HTTP.
 */
export async function handleMcpRequest(req: Request, store: ArtifactStore, baseUrl: string) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = new McpServer(
    { name: "aurora", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "push_markdown",
    {
      title: "Push markdown artifact",
      description:
        "Push a markdown artifact to an aurora preview session. Creates the session implicitly on first push. Returns a deep link the human can open.",
      inputSchema: {
        session_id: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "session_id: alphanumerics, dot, underscore, hyphen; max 128 chars"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        content: z.string().describe("Markdown source"),
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
    async ({ session_id, title, content, artifact_id, session_title }) => {
      const { artifact, created } = await store.pushMarkdown({
        session_id,
        title,
        content,
        artifact_id,
        session_title,
      });
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
