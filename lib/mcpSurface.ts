import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { ArtifactStore, MediaSource, PushResult } from "./artifactStore";
import { DEFAULT_MEDIA_SIZE_CAP } from "./artifactStore";
import { artifactEvent, type LiveBus } from "./liveBus";
import { CHART_TYPES, chartContractError, chartPushSchema } from "./chartContract";
import {
  buildImageToolDescription,
  buildVideoToolDescription,
  defaultGenerationConfigPath,
  loadWhitelist,
  modelIds,
  preflightParamError,
  videoPreflightError,
  type GenerationWhitelist,
  type ModelCatalogInfo,
  type WhitelistModelEntry,
} from "./whitelist";
import { OpenRouterClient } from "./openrouter";
import type { VideoJobService } from "./videoGeneration";

/**
 * Generation configuration injected through server options. The whitelist is
 * re-read per request (stateless handler) so config edits apply without a
 * restart; the catalog map is refreshed best-effort at startup.
 */
export interface GenerationOptions {
  apiKey: string;
  baseUrl: string;
  whitelistPath?: string;
  /** Shared, mutable: startup catalog enrichment writes price hints here */
  catalog?: Map<string, ModelCatalogInfo>;
  /** SQLite job registry location (default ~/.local/share/aurora/generations.db) */
  dbPath?: string;
  /** Poller cadence override (tests; default 30s per PRD #24) */
  pollIntervalMs?: number;
  /** Pending-job ceiling override (tests; default 15 minutes) */
  jobCeilingMs?: number;
  /** Constructed by the server at boot; create_video is registered only with one */
  videoService?: VideoJobService;
}

function resolveWhitelist(generation: GenerationOptions): GenerationWhitelist {
  return loadWhitelist(generation.whitelistPath ?? defaultGenerationConfigPath());
}

function registerCreateImageTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  liveBus: LiveBus | undefined,
  generation: GenerationOptions
) {
  const whitelist = resolveWhitelist(generation);
  const client = new OpenRouterClient({ apiKey: generation.apiKey, baseUrl: generation.baseUrl });
  server.registerTool(
    "create_image",
    {
      title: "Generate image",
      description: buildImageToolDescription(whitelist, generation.catalog),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        prompt: z.string().min(1).describe("Text prompt describing the image to generate"),
        model: z
          .enum(modelIds(whitelist.image) as [string, ...string[]])
          .describe("OpenRouter image model from the active whitelist"),
        resolution: z.string().optional().describe("Resolution hint, validated against the model's capabilities"),
        aspect_ratio: z.string().optional().describe("Aspect ratio hint, validated against the model's capabilities"),
        quality: z.string().optional().describe("Quality hint, validated against the model's capabilities"),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, prompt, model, artifact_id, session_title, resolution, aspect_ratio, quality }) => {
      try {
        // Pre-flight: validate optional params for actionable errors instead of
        // upstream 400s (PRD #24 story 16). Caps come from the operator-curated
        // whitelist entry, not the OpenRouter catalog: the public catalog
        // exposes pricing only, so the whitelist is the only curated cap source
        // (amendment 2026-10-11 in issue #24).
        const entry: WhitelistModelEntry | undefined = resolveWhitelist(generation).image.find(
          (m) => m.id === model
        );
        if (!entry) return toolError(`model ${model} is not on the active whitelist`);
        for (const [param, value] of [
          ["resolution", resolution],
          ["aspect_ratio", aspect_ratio],
          ["quality", quality],
        ] as const) {
          if (value === undefined) continue;
          const key = param === "resolution" ? "resolutions" : param === "aspect_ratio" ? "aspect_ratios" : "qualities";
          const err = preflightParamError(entry, key, value);
          if (err) return toolError(err);
        }
        const generated = await client.generateImage({ model, prompt, resolution, aspect_ratio, quality });
        const image = generated.images[0];
        const result = await store.pushMedia({
          session_id,
          title,
          type: "image",
          source: { base64: image.base64, mime: image.mime },
          artifact_id,
          session_title,
        });
        liveBus?.broadcast(artifactEvent(result));
        const { artifact, created } = result;
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const text = `${created ? "Generated" : "Replaced"} image artifact ${artifact.artifact_id} in session ${session_id} with ${model}. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            artifact_id: artifact.artifact_id,
            created,
            deep_link,
            model,
            cost: generated.cost,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

function registerCreateVideoTool(
  server: McpServer,
  store: ArtifactStore,
  baseUrl: string,
  liveBus: LiveBus | undefined,
  generation: GenerationOptions
) {
  const whitelist = resolveWhitelist(generation);
  const service = generation.videoService!;
  server.registerTool(
    "create_video",
    {
      title: "Generate video",
      description: buildVideoToolDescription(whitelist, generation.catalog),
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        prompt: z.string().min(1).describe("Text prompt describing the video to generate"),
        model: z
          .enum(modelIds(whitelist.video) as [string, ...string[]])
          .describe("OpenRouter video model from the active whitelist"),
        duration: z.number().int().positive().optional().describe("Video duration in seconds, validated against the model's capabilities"),
        resolution: z.string().optional().describe("Resolution hint, validated against the model's capabilities"),
        aspect_ratio: z.string().optional().describe("Aspect ratio hint, validated against the model's capabilities"),
        generate_audio: z.boolean().optional().describe("Generate audio alongside the video"),
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, prompt, model, duration, resolution, aspect_ratio, generate_audio, artifact_id, session_title }) => {
      try {
        // Pre-flight validation against the model's whitelist entry caps for
        // actionable errors instead of upstream 400s (PRD #24 story 16).
        const entry: WhitelistModelEntry | undefined = resolveWhitelist(generation).video.find(
          (m) => m.id === model
        );
        if (!entry) return toolError(`model ${model} is not on the active whitelist`);
        const preflightError = videoPreflightError(entry, { duration, resolution, aspect_ratio, generate_audio });
        if (preflightError) return toolError(preflightError);
        // Immediate response: registry row is pending before we return; the
        // background poller owns everything after this point.
        const job = await service.submit({
          session_id,
          target_artifact_id: artifact_id,
          title,
          model,
          prompt,
          duration,
          resolution,
          aspect_ratio,
          generate_audio,
        });
        const deep_link = `${baseUrl}/preview/${encodeURIComponent(session_id)}`;
        const priceHint = generation.catalog?.get(model)?.priceHint ?? entry.note;
        const text =
          `Submitted video generation job ${job.job_id} with ${model}` +
          (priceHint ? ` (~${priceHint})` : "") +
          `. It will appear in session ${session_id} when complete. Preview: ${deep_link}`;
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: {
            session_id,
            job_id: job.job_id,
            deep_link,
            model,
            price_hint: priceHint,
          },
        };
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

export const MCP_PATH = "/mcp";

/**
 * Tool-level error: returned as an isError result with an actionable message
 * so the agent can fall back (e.g. write to disk and push by path) instead of
 * the transport failing.
 */
function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const ID_SCHEMA = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "alphanumerics, dot, underscore, hyphen; max 128 chars");

const OPTIONAL_ID_SCHEMA = ID_SCHEMA.optional().describe(
  "Replace an existing artifact in place when provided"
);

const SESSION_TITLE_SCHEMA = z
  .string()
  .optional()
  .describe("Session title, honored only when the session is created by this push");

/** Media source: exactly one variant. Validated by the store on push. */
const MEDIA_SOURCE_SCHEMA = z
  .object({
    path: z.string().optional().describe("Absolute local file path to snapshot"),
    base64: z.string().optional().describe("Inline base64-encoded media bytes (size-capped)"),
    mime: z.string().optional().describe("Mime type, required with base64"),
    url: z.string().optional().describe("Remote URL, fetched server-side (size-capped)"),
  })
  .describe("Media source: provide exactly one of path, base64+mime, or url");

function registerMediaTool(
  server: McpServer,
  name: "push_image" | "push_video",
  artifactType: "image" | "video",
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number,
  liveBus?: LiveBus
) {
  server.registerTool(
    name,
    {
      title: `Push ${artifactType} artifact`,
      description:
        `Push an ${artifactType} artifact to an aurora preview session. ` +
        "Source is an absolute local path, inline base64+mime, or a remote url; " +
        "bytes are snapshotted into the store on receipt. " +
        "Creates the session implicitly on first push. Returns a deep link.",
      inputSchema: {
        session_id: ID_SCHEMA.describe("Session id; agent-minted, unique per agent run"),
        title: z.string().min(1).describe("Human-visible artifact title"),
        source: MEDIA_SOURCE_SCHEMA,
        artifact_id: OPTIONAL_ID_SCHEMA,
        session_title: SESSION_TITLE_SCHEMA,
      },
    },
    async ({ session_id, title, source, artifact_id, session_title }) => {
      try {
        const result = await store.pushMedia({
          session_id,
          title,
          type: artifactType,
          source: source as MediaSource,
          artifact_id,
          session_title,
          size_cap: mediaSizeCap,
        });
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
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }
  );
}

/**
 * Handle one request to the MCP endpoint. Stateless mode: a fresh transport
 * (and server instance) per request, no session id issued, per the official
 * SDK guidance for serverless/stateless Streamable HTTP.
 */
export async function handleMcpRequest(
  req: Request,
  store: ArtifactStore,
  baseUrl: string,
  mediaSizeCap: number = DEFAULT_MEDIA_SIZE_CAP,
  liveBus?: LiveBus,
  generation?: GenerationOptions
) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = new McpServer(
    { name: "aurora", version: "0.2.0" },
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

  registerMediaTool(server, "push_image", "image", store, baseUrl, mediaSizeCap, liveBus);
  registerMediaTool(server, "push_video", "video", store, baseUrl, mediaSizeCap, liveBus);

  // Generation tools are registered only when an OpenRouter API key is
  // configured (env var read once at server start, or injected via options).
  if (generation?.apiKey) {
    registerCreateImageTool(server, store, baseUrl, liveBus, generation);
    // The video tool needs the boot-owned poller service (submit-and-notify);
    // it also needs at least one whitelisted video model for a valid enum.
    if (generation.videoService && modelIds(resolveWhitelist(generation).video).length > 0) {
      registerCreateVideoTool(server, store, baseUrl, liveBus, generation);
    }
  }

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
      const result = await store.pushChart({
        session_id,
        title,
        chart_type,
        data,
        artifact_id,
        session_title,
      });
      // Thin live-update event: clients refetch content over HTTP.
      liveBus?.broadcast(artifactEvent(result));
      const { artifact, created } = result;
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
