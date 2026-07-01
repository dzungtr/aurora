import { resolveSafe, PathTraversalError } from "./lib/fsSafe";
import indexHtml from "./index.html";
import { readdir, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function handleError(err: unknown) {
  if (err instanceof PathTraversalError) return errorResponse(400, "Invalid path");
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

async function listTree(dir: string, base: string): Promise<{ path: string; isDir: boolean }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { path: string; isDir: boolean }[] = [];
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const isDir = entry.isDirectory();
    results.push({ path: rel, isDir });
    if (isDir) {
      results.push(...(await listTree(abs, rel)));
    }
  }
  return results;
}

export function createServer(rootDir: string, port: number) {
  const root = resolve(rootDir);
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": indexHtml,
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
    error(err) {
      console.error(err);
      return errorResponse(500, "Internal server error");
    },
  });
}
