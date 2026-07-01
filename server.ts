import { resolveSafe } from "./lib/fsSafe";
import indexHtml from "./index.html";
import { readdir, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
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
  return Bun.serve({
    port,
    development: process.env.NODE_ENV !== "production",
    routes: {
      "/": indexHtml,
      "/api/tree": {
        async GET() {
          try {
            const tree = await listTree(rootDir, "");
            return Response.json(tree);
          } catch (err) {
            return errorResponse(500, String(err));
          }
        },
      },
      "/api/file": {
        async GET(req) {
          const url = new URL(req.url);
          const path = url.searchParams.get("path");
          if (!path) return errorResponse(400, "Missing path");
          try {
            const abs = resolveSafe(rootDir, path);
            const file = Bun.file(abs);
            if (!(await file.exists())) return errorResponse(404, "Not found");
            return new Response(file);
          } catch (err) {
            return errorResponse(400, String(err));
          }
        },
        async POST(req) {
          try {
            const { path, content } = await req.json();
            if (!path || typeof content !== "string") return errorResponse(400, "Missing path or content");
            const abs = resolveSafe(rootDir, path);
            await writeFile(abs, content, "utf-8");
            return Response.json({ ok: true });
          } catch (err: any) {
            if (err?.code === "ENOENT") return errorResponse(404, "Not found");
            return errorResponse(400, String(err));
          }
        },
        async DELETE(req) {
          const url = new URL(req.url);
          const path = url.searchParams.get("path");
          if (!path) return errorResponse(400, "Missing path");
          try {
            const abs = resolveSafe(rootDir, path);
            await rm(abs, { recursive: true });
            return Response.json({ ok: true });
          } catch (err: any) {
            if (err?.code === "ENOENT") return errorResponse(404, "Not found");
            return errorResponse(500, String(err));
          }
        },
      },
      "/api/dir": {
        async POST(req) {
          try {
            const { path } = await req.json();
            if (!path) return errorResponse(400, "Missing path");
            const abs = resolveSafe(rootDir, path);
            await mkdir(abs, { recursive: true });
            return Response.json({ ok: true });
          } catch (err) {
            return errorResponse(400, String(err));
          }
        },
      },
      "/api/rename": {
        async POST(req) {
          try {
            const { from, to } = await req.json();
            if (!from || !to) return errorResponse(400, "Missing from or to");
            const absFrom = resolveSafe(rootDir, from);
            const absTo = resolveSafe(rootDir, to);
            await rename(absFrom, absTo);
            return Response.json({ ok: true });
          } catch (err: any) {
            if (err?.code === "ENOENT") return errorResponse(404, "Not found");
            return errorResponse(400, String(err));
          }
        },
      },
    },
    error(err) {
      return errorResponse(500, String(err));
    },
  });
}
