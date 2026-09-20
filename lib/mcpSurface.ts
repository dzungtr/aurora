import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ArtifactStore } from "./artifactStore";
import { CHART_TYPES, chartContractError, chartPushSchema } from "./chartContract";

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

  server.registerTool(
    "push_chart",
    {
      title: "Push chart artifact",
      description:
        'Push a data chart rendered with aurora\'s house theme. chart_type is one of ' +
        CHART_TYPES.join("|") +
        '. data must match the per-type contract: pie → {kind:"pie", points:[{label,value}]}; bar/column → {kind:"categorical", categories:[string], series:[{name, values:[number]}]}; line/area → {kind:"line", x:[string|number], series:[{name, values:[number]}]}; scatter → {kind:"scatter", series:[{name, points:[[x,y]]}]}. Agents never send raw chart-lib specs.',
      inputSchema: {
        session_id: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "session_id: alphanumerics, dot, underscore, hyphen; max 128 chars"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        chart_type: z.enum(CHART_TYPES).describe("Chart kind aurora renders under its house theme"),
        data: chartPushSchema.shape.data.describe(
          'Typed data contract; the `kind` field must match chart_type (categorical for bar/column, line for line/area)'
        ),
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
    async ({ session_id, title, chart_type, data, artifact_id, session_title }) => {
      const contractError = chartContractError(chart_type, data);
      if (contractError) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: contractError }],
        };
      }
      const { artifact, created } = await store.pushChart({
        session_id,
        title,
        chart_type,
        data,
        artifact_id,
        session_title,
      });
      const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
      const text = `${created ? "Pushed" : "Replaced"} chart artifact ${artifact.artifact_id} in session ${session_id}. Preview: ${deep_link}`;
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
