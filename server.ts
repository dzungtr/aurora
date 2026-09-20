import { resolveSafe, PathTraversalError } from "./lib/fsSafe";
import indexHtml from "./index.html";
import { join } from "node:path";
import { homedir } from "node:os";
import { ArtifactStore, InvalidArtifactIdError } from "./lib/artifactStore";
import { LiveBus } from "./lib/liveBus";
import { handleMcpRequest } from "./lib/mcpSurface";
import { readdir, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import pdfWorkerPath from "pdfjs-dist/build/pdf.worker.min.mjs" with { type: "file" };
// pdfjs-dist ships a dead `if (isNodeJS) { await import("fs") ... }` branch for
// server-side use that Bun's bundler can't tree-shake. `bun run compile` marks
// fs/http/https/url external (see package.json) so that branch — never reached
// in the browser, where PDFs load via fetch — doesn't fail the standalone build.

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function handleError(err: unknown) {
  if (err instanceof PathTraversalError) return errorResponse(400, "Invalid path");
  if (err instanceof InvalidArtifactIdError) return errorResponse(404, "Not found");
  if ((err as any)?.code === "ENOENT") return errorResponse(404, "Not found");
  console.error(err);
  return errorResponse(500, "Internal server error");
}

async function readJsonBody(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new SyntaxError("Invalid JSON body");
  }
}

interface TreeNode { path: string; isDir: boolean; size?: number; mtime: number }

async function listTree(dir: string, base: string): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: TreeNode[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();
    const info = await stat(abs);
    results.push({ path: rel, isDir, size: isDir ? undefined : info.size, mtime: info.mtimeMs });
    if (isDir) {
      results.push(...(await listTree(abs, rel)));
    }
  }
  return results;
}

export interface ServerOptions {
  /** Base directory for artifact storage (default ~/.local/share/aurora/artifacts) */
  artifactsDir?: string;
  /** Size cap for base64/url media pushes (default 50 MiB) */
  mediaSizeCap?: number;
}

export function createServer(rootDir: string, port: number, options: ServerOptions = {}) {
  const root = resolve(rootDir);
  const artifactStore = new ArtifactStore(options.artifactsDir ?? join(homedir(), ".local/share/aurora/artifacts"));
  const liveBus = new LiveBus();
  const externalPort = process.env.AURORA_PUBLIC_PORT ? Number(process.env.AURORA_PUBLIC_PORT) : port;
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": indexHtml,
      // SPA deep links for the preview surface: serve the app shell and let the
      // client router resolve the session/artifact.
      "/preview": indexHtml,
      "/preview/:sid": indexHtml,
      "/preview/:sid/:aid": indexHtml,
      "/pdf.worker.min.mjs": {
        async GET() {
          return new Response(Bun.file(pdfWorkerPath));
        },
      },
      "/mcp": {
        async POST(req) {
          try {
            return await handleMcpRequest(req, artifactStore, `http://127.0.0.1:${externalPort}`, options.mediaSizeCap, liveBus);
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
      "/api/tree": {
        async GET() {
          try {
            const tree = await listTree(root, "");
            return Response.json(tree);
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/file": {
        async GET(req) {
          const url = new URL(req.url);
          const path = url.searchParams.get("path");
          if (!path) return errorResponse(400, "Missing path");
          try {
            const abs = resolveSafe(root, path);
            const file = Bun.file(abs);
            if (!(await file.exists())) return errorResponse(404, "Not found");
            return new Response(file);
          } catch (err) {
            return handleError(err);
          }
        },
        async POST(req) {
          try {
            const { path, content } = await readJsonBody(req);
            if (!path || typeof content !== "string") return errorResponse(400, "Missing path or content");
            const abs = resolveSafe(root, path);
            await writeFile(abs, content, "utf-8");
            return Response.json({ ok: true });
          } catch (err) {
            if (err instanceof SyntaxError) return errorResponse(400, "Invalid JSON body");
            return handleError(err);
          }
        },
        async DELETE(req) {
          const url = new URL(req.url);
          const path = url.searchParams.get("path");
          if (!path) return errorResponse(400, "Missing path");
          try {
            const abs = resolveSafe(root, path);
            if (abs === root) return errorResponse(400, "Cannot delete root");
            const info = await stat(abs);
            if (info.isDirectory()) return errorResponse(400, "Cannot delete a directory via /api/file");
            await rm(abs);
            return Response.json({ ok: true });
          } catch (err) {
            return handleError(err);
          }
        },
      },
      "/api/dir": {
        async POST(req) {
          try {
            const { path } = await readJsonBody(req);
            if (!path) return errorResponse(400, "Missing path");
            const abs = resolveSafe(root, path);
            await mkdir(abs, { recursive: true });
            return Response.json({ ok: true });
          } catch (err) {
            if (err instanceof SyntaxError) return errorResponse(400, "Invalid JSON body");
            return handleError(err);
          }
        },
      },
      "/api/rename": {
        async POST(req) {
          try {
            const { from, to } = await readJsonBody(req);
            if (!from || !to) return errorResponse(400, "Missing from or to");
            const absFrom = resolveSafe(root, from);
            const absTo = resolveSafe(root, to);
            await rename(absFrom, absTo);
            return Response.json({ ok: true });
          } catch (err) {
            if (err instanceof SyntaxError) return errorResponse(400, "Invalid JSON body");
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
