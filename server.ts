import indexHtml from "./index.html";
import { join } from "node:path";
import { homedir } from "node:os";
import { ArtifactStore, InvalidArtifactIdError } from "./lib/artifactStore";
import { LiveBus } from "./lib/liveBus";
import { handleMcpRequest, type GenerationOptions } from "./lib/mcpSurface";
import { loadPublicUrl } from "./lib/whitelist";
import { OpenRouterClient, priceHintForEntry, videoPriceHintForEntry } from "./lib/openrouter";
import { JobRegistry } from "./lib/jobRegistry";
import { VideoJobService } from "./lib/videoGeneration";

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function handleError(err: unknown) {
  if (err instanceof InvalidArtifactIdError) return errorResponse(404, "Not found");
  if ((err as any)?.code === "ENOENT") return errorResponse(404, "Not found");
  console.error(err);
  return errorResponse(500, "Internal server error");
}

export interface ServerOptions {
  /** Base directory for artifact storage (default ~/.local/share/aurora/artifacts) */
  artifactsDir?: string;
  /** Size cap for base64/url media pushes (default 50 MiB) */
  mediaSizeCap?: number;
  /**
   * Generation config injection point (tests point baseUrl at a fake
   * OpenRouter). Defaults to OPENROUTER_API_KEY from the environment, read
   * once at server start; when absent, generation tools are not registered.
   */
  generation?: GenerationOptions;
}

/**
 * Best-effort startup catalog fetch: enriches the shared catalog map with
 * price hints for tool descriptions. Offline or unreachable → static notes
 * only; never a startup failure.
 */
function startCatalogRefresh(generation: GenerationOptions): void {
  const client = new OpenRouterClient({ apiKey: generation.apiKey, baseUrl: generation.baseUrl });
  void (async () => {
    try {
      const entries = await client.fetchModelCatalog();
      const catalog = (generation.catalog ??= new Map());
      for (const entry of entries) {
        const hint = priceHintForEntry(entry);
        if (hint) catalog.set(entry.id, { priceHint: hint });
      }
    } catch (err) {
      console.error("generation catalog fetch unavailable; using static notes:", err);
    }
    try {
      // Video models carry per-second pricing in a dedicated catalog endpoint.
      const videoEntries = await client.fetchVideoModelCatalog();
      const catalog = (generation.catalog ??= new Map());
      for (const entry of videoEntries) {
        const hint = videoPriceHintForEntry(entry);
        if (hint) catalog.set(entry.id, { priceHint: hint });
      }
    } catch (err) {
      console.error("video catalog fetch unavailable; using static notes:", err);
    }
  })();
}

/**
 * Boot the async video job infrastructure: SQLite registry (injectable path),
 * poller service, and recovery of pending jobs from a previous run so
 * already-billed jobs still land after a restart (ADR-0004).
 */
function startVideoJobService(generation: GenerationOptions, store: ArtifactStore, liveBus: LiveBus): void {
  try {
    const client = new OpenRouterClient({ apiKey: generation.apiKey, baseUrl: generation.baseUrl });
    const registry = new JobRegistry(generation.dbPath ?? join(homedir(), ".local/share/aurora/generations.db"));
    const service = new VideoJobService({
      client,
      registry,
      store,
      liveBus,
      pollIntervalMs: generation.pollIntervalMs,
      ceilingMs: generation.jobCeilingMs,
      log: (m) => console.error(`video job service: ${m}`),
    });
    generation.videoService = service;
    // Same registry, exposed for check_generation's job lookups and for
    // create_image to record its inline-completed jobs.
    generation.jobRegistry = registry;
    service.recoverPending();
  } catch (err) {
    // An unusable registry (unwritable data dir) disables create_video only;
    // synchronous generation tools keep working.
    console.error("video job registry unavailable; create_video disabled:", err);
  }
}

/**
 * Resolve the base URL used in preview deep links returned by MCP tools.
 *
 * Precedence:
 * 1. publicUrl from the generation config (~/.config/aurora/generation.json),
 *    re-read per request (e.g. a remote ingress).
 * 2. Fallback to loopback with the external (published) port.
 */
export function resolvePublicBaseUrl(externalPort: number, publicUrl?: string): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, "");
  return `http://127.0.0.1:${externalPort}`;
}

export function createServer(port: number, options: ServerOptions = {}) {
  const artifactStore = new ArtifactStore(options.artifactsDir ?? join(homedir(), ".local/share/aurora/artifacts"));
  const liveBus = new LiveBus();
  let generation: GenerationOptions | undefined = options.generation;
  if (generation === undefined && process.env.OPENROUTER_API_KEY) {
    generation = { apiKey: process.env.OPENROUTER_API_KEY, baseUrl: "https://openrouter.ai/api/v1" };
  }
  if (generation) {
    startCatalogRefresh(generation);
    startVideoJobService(generation, artifactStore, liveBus);
  }
  const externalPort = process.env.AURORA_PUBLIC_PORT ? Number(process.env.AURORA_PUBLIC_PORT) : port;
  return Bun.serve({
    port,
    // Defaults to loopback-only, matching aurora's "binds to localhost only"
    // guarantee. Containers need this overridden to 0.0.0.0 — Docker's port
    // publishing forwards to the container's external interface, which a
    // loopback-only bind never receives traffic on (see Dockerfile).
    hostname: process.env.AURORA_HOST ?? "127.0.0.1",
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": indexHtml,
      // SPA deep links for the artifact browser:
      "/s": indexHtml,
      "/s/:sid": indexHtml,
      "/s/:sid/:aid": indexHtml,
      "/mcp": {
        async POST(req) {
          try {
            return await handleMcpRequest(req, artifactStore, resolvePublicBaseUrl(externalPort, loadPublicUrl()), options.mediaSizeCap, liveBus, generation);
          } catch (err) {
            console.error(err);
            return errorResponse(500, "MCP handler error");
          }
        },
        async GET() {
          return errorResponse(405, "SSE streaming not supported in stateless mode");
        },
        async DELETE() {
          return errorResponse(405, "No sessions in stateless mode");
        },
      },
      "/api/preview/sessions/:sid": {
        async DELETE(req) {
          const { sid } = (req as any).params ?? {};
          try {
            const deleted = await artifactStore.deleteSession(sid);
            if (!deleted) return errorResponse(404, "Not found");
            return Response.json({ ok: true });
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/preview/sessions/:sid/artifacts/:aid/blob": {
        // Media snapshot serving. Range support (206) is implemented manually
        // so video seeking works; Bun routes don't apply Range to Blob parts.
        async GET(req) {
          const { sid, aid } = (req as any).params ?? {};
          try {
            const p = await artifactStore.blobPath(sid, aid);
            if (!p) return errorResponse(404, "Not found");
            const meta = await artifactStore.getArtifactMeta(sid, aid);
            const file = Bun.file(p);
            const size = file.size;
            const range = req.headers.get("range");
            const baseHeaders: Record<string, string> = {
              "content-type": meta?.mime ?? "application/octet-stream",
              "accept-ranges": "bytes",
            };
            const m = range?.match(/^bytes=(\d*)-(\d*)$/);
            if (m && (m[1] !== "" || m[2] !== "")) {
              let start = m[1] === "" ? null : Number(m[1]);
              let end = m[2] === "" ? null : Number(m[2]);
              if (start === null) {
                // suffix range: last N bytes
                start = Math.max(0, size - (end ?? 0));
                end = size - 1;
              } else if (end === null || end >= size) {
                end = size - 1;
              }
              if (start >= size || start > end) {
                return new Response(null, {
                  status: 416,
                  headers: { "content-range": `bytes */${size}` },
                });
              }
              return new Response(file.slice(start, end + 1), {
                status: 206,
                headers: {
                  ...baseHeaders,
                  "content-range": `bytes ${start}-${end}/${size}`,
                  "content-length": String(end - start + 1),
                },
              });
            }
            return new Response(file, { headers: baseHeaders });
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/preview/sessions/:sid/artifacts/:aid": {
        async GET(req) {
          const { sid, aid } = (req as any).params ?? {};
          try {
            const artifact = await artifactStore.getArtifact(sid, aid);
            if (!artifact) return errorResponse(404, "Not found");
            return Response.json({ session_id: sid, ...artifact });
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/preview/sessions/:sid/artifacts": {
        async GET(req) {
          const { sid } = (req as any).params ?? {};
          try {
            const session = await artifactStore.getSession(sid);
            if (!session) return errorResponse(404, "Not found");
            return Response.json(await artifactStore.listArtifacts(sid));
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/preview/sessions": {
        async GET() {
          try {
            const sessions = await artifactStore.listSessions();
            const withCounts = await Promise.all(
              sessions.map(async (s) => ({
                ...s,
                artifact_count: (await artifactStore.listArtifacts(s.session_id)).length,
              }))
            );
            return Response.json(withCounts);
          } catch (err) {
            return handleError(err);
          }
        },
      },
    },
    websocket: liveBus.websocket,
    fetch(req, server) {
      if (new URL(req.url).pathname === "/ws") {
        // Thin live-update channel; clients refetch artifact content over HTTP.
        server.upgrade(req);
        return;
      }
      return errorResponse(404, "Not found");
    },
    error(err) {
      console.error(err);
      return errorResponse(500, "Internal server error");
    },
  });
}
