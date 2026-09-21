# aurora Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build aurora, a standalone `bunx aurora <folder>` local file explorer + editor web app, per `docs/superpowers/specs/2026-07-01-aurora-design.md`.

**Architecture:** Single Bun process. `Bun.serve()` serves the bundled React frontend (via HTML import) and handles `/api/*` filesystem routes in the same server. All filesystem access goes through `lib/fsSafe.ts::resolveSafe()`, the single path-traversal guard. No build step — Bun bundles on the fly in dev and "production" alike.

**Tech Stack:** Bun (runtime, bundler, test runner), TypeScript, React 19 (no other frontend deps — no CodeMirror/Monaco/markdown library).

## Global Constraints

- Bun runtime end-to-end (backend + frontend bundling/serving) — no Vite/Express/webpack.
- Dependencies limited to `react` + `react-dom`; devDependencies limited to `@types/bun`, `@types/react`, `@types/react-dom`, `typescript`. No CodeMirror/Monaco, no markdown-rendering library — syntax highlighting and Markdown rendering are hand-rolled regex/line-based passes.
- Single fixed root folder per running instance (no multi-project switching), no auth, localhost-only.
- Every filesystem path from a request MUST go through `lib/fsSafe.ts::resolveSafe(rootDir, userPath)` before touching disk. No handler may call `fs`/`node:fs` directly on an unvalidated path.
- API error responses are always JSON `{error: string}` with status `400` (invalid/outside-root path), `404` (missing path), or `500` (unexpected fs error) — never a raw thrown stack trace.
- No frontend component tests in v1 (personal/local tool — see spec Non-goals). Frontend tasks are verified by typecheck + manual smoke run, not automated tests.
- Dark theme CSS variables must match zui exactly: `--bg: #0b0e14`, `--bg-2: #11151f`, `--border: #232a3a`, `--text: #d6deeb`, `--accent: #5b8cff`.

## Execution Batching (for the orchestrating agent)

Tasks are grouped into batches. Within a batch, tasks touch disjoint files and can be implemented in parallel git worktrees branched from the same base commit. A batch's worktrees must all be reviewed and merged to `main` before the next batch's worktrees are created (so later batches branch from an up-to-date `main`).

- **Batch 0** (sequential, must land first): Task 1.
- **Batch 1** (parallel, 2 worktrees, both branch from `main` after Task 1 is merged): Task 2, Task 3.
- **Batch 2** (parallel, 2 worktrees, both branch from `main` after Tasks 2 and 3 are merged): Task 4, Task 5.
- **Batch 3** (sequential, branches from `main` after Tasks 4 and 5 are merged): Task 6.

---

### Task 1: Project scaffolding + path-safety module

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `index.html`
- Create: `src/styles.css`
- Create: `lib/fsSafe.ts`
- Test: `lib/fsSafe.test.ts`

**Interfaces:**
- Produces: `resolveSafe(rootDir: string, userPath: string): string` — resolves `userPath` against `rootDir`, throws `PathTraversalError` if the result escapes `rootDir` (via `../`, absolute-path override, or symlink). Both `server.ts` (Task 2) and no frontend code call this directly — it's backend-only.
- Produces: `PathTraversalError` class (exported from `lib/fsSafe.ts`).
- Produces: `index.html` referencing `./src/index.tsx` (script) and `./src/styles.css` (stylesheet) — Task 3 creates `src/index.tsx`; until then the file reference is dangling but that's fine, nothing resolves it until Task 6's integration run.
- Produces: CSS classes used by later tasks: `.wsp-editor-body`, `.wsp-editor-sidebar`, `.wsp-editor-main`, `.wsp-status`, `.wsp-empty`, `.wsp-tree*`, `.wsp-editor*` (editor pane), `.tok-*` (syntax highlight tokens), `.wsp-markdown-preview`, `.wsp-image-preview`, `.wsp-toggle`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "aurora",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "aurora": "./cli.ts"
  },
  "scripts": {
    "dev": "bun --hot cli.ts .",
    "test": "bun test"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ESNext", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>aurora</title>
    <link rel="stylesheet" href="./src/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/index.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/styles.css`**

```css
:root {
  --bg: #0b0e14;
  --bg-2: #11151f;
  --border: #232a3a;
  --text: #d6deeb;
  --accent: #5b8cff;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
}

.wsp-editor-body {
  display: flex;
  height: 100vh;
}

.wsp-editor-sidebar {
  position: relative;
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wsp-editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.wsp-status {
  padding: 4px 12px;
  color: var(--accent);
  font-size: 12px;
}

.wsp-empty {
  padding: 24px;
  color: #6b7280;
}

.wsp-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.wsp-tree-search {
  margin: 8px;
  padding: 4px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
}

.wsp-tree-list {
  flex: 1;
  overflow-y: auto;
}

.wsp-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.wsp-tree-row:hover {
  background: rgba(91, 140, 255, 0.08);
}

.wsp-tree-row.selected {
  background: rgba(91, 140, 255, 0.18);
}

.wsp-tree-icon {
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.wsp-tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wsp-tree-actions {
  display: none;
  gap: 2px;
}

.wsp-tree-row:hover .wsp-tree-actions {
  display: flex;
}

.wsp-tree-actions button {
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  font-size: 11px;
}

.wsp-tree-resize {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
}

.wsp-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.wsp-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
}

.wsp-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
}

.wsp-dirty-dot.dirty {
  background: var(--accent);
}

.wsp-editor-path {
  flex: 1;
  color: #9aa5b1;
}

.wsp-save-btn {
  background: var(--accent);
  border: none;
  color: white;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.wsp-save-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.wsp-editor-pane {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.wsp-line-numbers {
  padding: 8px 8px 8px 0;
  text-align: right;
  color: #4b5563;
  user-select: none;
  font-family: ui-monospace, monospace;
}

.wsp-editor-code {
  position: relative;
  flex: 1;
  overflow: auto;
}

.wsp-editor-highlight,
.wsp-editor-textarea {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 8px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre;
  box-sizing: border-box;
}

.wsp-editor-highlight {
  color: var(--text);
  pointer-events: none;
}

.wsp-editor-textarea {
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  border: none;
  resize: none;
  outline: none;
  z-index: 1;
}

.tok-key { color: #5b8cff; }
.tok-str { color: #a8cc8c; }
.tok-num { color: #f78c6c; }
.tok-bool, .tok-null { color: #c792ea; }
.tok-tag { color: #5b8cff; }
.tok-attr { color: #a8cc8c; }
.tok-selector { color: #f78c6c; }
.tok-heading { color: #5b8cff; font-weight: bold; }
.tok-bold { font-weight: bold; }
.tok-code { color: #a8cc8c; }
.tok-keyword { color: #c792ea; }

.wsp-toggle {
  position: absolute;
  top: 6px;
  right: 12px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.wsp-markdown-preview {
  padding: 16px 24px;
  overflow: auto;
}

.wsp-markdown-preview h1, .wsp-markdown-preview h2, .wsp-markdown-preview h3 {
  color: var(--text);
}

.wsp-image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
}

.wsp-image-preview img {
  max-width: 100%;
  max-height: 100%;
}
```

- [ ] **Step 6: Write the failing tests for `lib/fsSafe.ts`**

```ts
// lib/fsSafe.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSafe, PathTraversalError } from "./fsSafe";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aurora-test-"));
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "b", "c.txt"), "hello");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSafe", () => {
  it("resolves a legitimate nested path", () => {
    const result = resolveSafe(root, "a/b/c.txt");
    expect(result).toBe(join(root, "a", "b", "c.txt"));
  });

  it("rejects a ../ traversal", () => {
    expect(() => resolveSafe(root, "../escape.txt")).toThrow(PathTraversalError);
  });

  it("rejects a deep ../ traversal", () => {
    expect(() => resolveSafe(root, "a/../../escape.txt")).toThrow(PathTraversalError);
  });

  it("sandboxes an absolute-path override under root instead of escaping", () => {
    const result = resolveSafe(root, "/etc/passwd");
    expect(result.startsWith(root)).toBe(true);
    expect(result).not.toBe("/etc/passwd");
  });

  it("rejects a symlink that escapes root", () => {
    const outside = mkdtempSync(join(tmpdir(), "aurora-outside-"));
    writeFileSync(join(outside, "secret.txt"), "nope");
    symlinkSync(outside, join(root, "escape-link"));
    expect(() => resolveSafe(root, "escape-link/secret.txt")).toThrow(PathTraversalError);
    rmSync(outside, { recursive: true, force: true });
  });

  it("resolves a path to a not-yet-existing file for creation", () => {
    const result = resolveSafe(root, "a/new-file.txt");
    expect(result).toBe(join(root, "a", "new-file.txt"));
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `bun test lib/fsSafe.test.ts`
Expected: FAIL with "Cannot find module './fsSafe'" (file doesn't exist yet).

- [ ] **Step 8: Implement `lib/fsSafe.ts`**

```ts
import { resolve, join, sep } from "node:path";
import { realpathSync } from "node:fs";

export class PathTraversalError extends Error {
  constructor(userPath: string) {
    super(`Path escapes root: ${userPath}`);
    this.name = "PathTraversalError";
  }
}

export function resolveSafe(rootDir: string, userPath: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(join(root, userPath));

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new PathTraversalError(userPath);
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }

  let checkPath = candidate;
  while (true) {
    try {
      const real = realpathSync(checkPath);
      const suffix = candidate.slice(checkPath.length);
      const realCandidate = suffix ? join(real, suffix) : real;
      if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
        throw new PathTraversalError(userPath);
      }
      break;
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      const parent = resolve(checkPath, "..");
      if (parent === checkPath) break;
      checkPath = parent;
    }
  }

  return candidate;
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun test lib/fsSafe.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 10: Install dependencies and commit**

```bash
bun install
git add package.json tsconfig.json .gitignore index.html src/styles.css lib/fsSafe.ts lib/fsSafe.test.ts bun.lock
git commit -m "feat: scaffold project and add path-safety module"
```

---

### Task 2: Backend API server + CLI entrypoint

**Depends on:** Task 1 merged to `main` (needs `lib/fsSafe.ts`, `index.html`, `package.json`).

**Files:**
- Create: `server.ts`
- Create: `cli.ts`
- Test: `server.test.ts`

**Interfaces:**
- Consumes: `resolveSafe(rootDir: string, userPath: string): string`, `PathTraversalError` from `./lib/fsSafe`.
- Produces: `createServer(rootDir: string, port: number)` — returns the value of `Bun.serve(...)` (has `.port`, `.stop(closeActiveConnections?: boolean)`). Task 6 (integration) and this task's own tests call it directly; `cli.ts` calls it too.
- Produces: `cli.ts` — parses `aurora <path> [--port <port>]`, resolves `<path>` to an absolute path, calls `createServer`, logs the listening URL.

- [ ] **Step 1: Write the failing tests for the API routes**

```ts
// server.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";

let root: string;
let server: ReturnType<typeof createServer>;
let base: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aurora-server-"));
  writeFileSync(join(root, "hello.txt"), "hi");
  server = createServer(root, 0);
  base = `http://localhost:${server.port}`;
});

afterEach(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("/api/tree", () => {
  it("lists files under root", async () => {
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ path: "hello.txt", isDir: false }]);
  });
});

describe("/api/file", () => {
  it("reads an existing file", async () => {
    const res = await fetch(`${base}/api/file?path=hello.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("404s on a missing file", async () => {
    const res = await fetch(`${base}/api/file?path=missing.txt`);
    expect(res.status).toBe(404);
  });

  it("400s on an out-of-root path", async () => {
    const res = await fetch(`${base}/api/file?path=../escape.txt`);
    expect(res.status).toBe(400);
  });

  it("writes a file", async () => {
    const res = await fetch(`${base}/api/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.txt", content: "world" }),
    });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=new.txt`);
    expect(await check.text()).toBe("world");
  });

  it("deletes a file", async () => {
    const res = await fetch(`${base}/api/file?path=hello.txt`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=hello.txt`);
    expect(check.status).toBe(404);
  });
});

describe("/api/dir", () => {
  it("creates a folder", async () => {
    const res = await fetch(`${base}/api/dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(200);
    const tree = await (await fetch(`${base}/api/tree`)).json();
    expect(tree.some((e: any) => e.path === "newdir" && e.isDir)).toBe(true);
  });
});

describe("/api/rename", () => {
  it("renames a file", async () => {
    const res = await fetch(`${base}/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "hello.txt", to: "renamed.txt" }),
    });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=renamed.txt`);
    expect(await check.text()).toBe("hi");
  });

  it("404s renaming a missing file", async () => {
    const res = await fetch(`${base}/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "missing.txt", to: "x.txt" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test server.test.ts`
Expected: FAIL with "Cannot find module './server'".

- [ ] **Step 3: Implement `server.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test server.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Implement `cli.ts`**

```ts
#!/usr/bin/env bun
import { resolve } from "node:path";
import { createServer } from "./server";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let port = 3000;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port") {
      port = Number(args[++i]);
    } else {
      positional.push(arg);
    }
  }
  const rootDir = positional[0];
  if (!rootDir) {
    console.error("Usage: aurora <path> [--port <port>]");
    process.exit(1);
  }
  return { rootDir: resolve(rootDir), port };
}

const { rootDir, port } = parseArgs(process.argv);
const server = createServer(rootDir, port);
console.log(`aurora serving ${rootDir} at http://localhost:${server.port}`);
```

- [ ] **Step 6: Manually smoke-test the CLI**

Run: `chmod +x cli.ts && ./cli.ts /tmp --port 4123` then in another terminal `curl http://localhost:4123/api/tree`
Expected: JSON array of `/tmp`'s top-level entries; no thrown errors in the server terminal. Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add server.ts cli.ts server.test.ts
git commit -m "feat: add backend API server and CLI entrypoint"
```

---

### Task 3: Frontend shell + component stubs

**Depends on:** Task 1 merged to `main` (needs `package.json`, `src/styles.css`, `index.html`). Can be implemented concurrently with Task 2 in a separate worktree — touches no files Task 2 touches.

**Files:**
- Create: `src/index.tsx`
- Create: `src/App.tsx`
- Create: `src/lib/api.ts`
- Create (stub, replaced by Task 4): `src/components/FileTree.tsx`
- Create (stub, replaced by Task 5): `src/components/FileEditor.tsx`
- Create (stub, replaced by Task 5): `src/components/MarkdownPreview.tsx`
- Create (stub, replaced by Task 5): `src/components/ImagePreview.tsx`

**Interfaces:**
- Produces: `TreeEntry { path: string; isDir: boolean }` and `api` object (`getTree`, `readFile`, `fileUrl`, `writeFile`, `createDir`, `rename`, `deleteFile`) from `src/lib/api.ts` — consumed by `App.tsx` and by Task 4/5's real component implementations.
- Produces exact prop contracts consumed by Task 4 and Task 5 (documented in each stub below) — Task 4/5 implementers must match these signatures exactly since `App.tsx` will not be edited again to accommodate a different shape.

- [ ] **Step 1: Implement `src/lib/api.ts`**

```ts
export interface TreeEntry {
  path: string;
  isDir: boolean;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getTree(): Promise<TreeEntry[]> {
    return handle(await fetch("/api/tree"));
  },
  async readFile(path: string): Promise<string> {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Request failed: ${res.status}`);
    }
    return res.text();
  },
  fileUrl(path: string): string {
    return `/api/file?path=${encodeURIComponent(path)}`;
  },
  async writeFile(path: string, content: string): Promise<void> {
    await handle(await fetch("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }));
  },
  async createDir(path: string): Promise<void> {
    await handle(await fetch("/api/dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }));
  },
  async rename(from: string, to: string): Promise<void> {
    await handle(await fetch("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }));
  },
  async deleteFile(path: string): Promise<void> {
    await handle(await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }));
  },
};
```

- [ ] **Step 2: Create component stubs with their final prop contracts**

```tsx
// src/components/FileTree.tsx — REPLACED BY TASK 4. Keep the prop interface exact.
import type { TreeEntry } from "../lib/api";

export interface FileTreeProps {
  entries: TreeEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
}

export function FileTree(_props: FileTreeProps) {
  return <div className="wsp-tree">(file tree placeholder)</div>;
}
```

```tsx
// src/components/FileEditor.tsx — REPLACED BY TASK 5. Keep the prop interface exact.
export interface FileEditorProps {
  path: string;
  content: string;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}

export function FileEditor(_props: FileEditorProps) {
  return <div className="wsp-editor">(editor placeholder)</div>;
}
```

```tsx
// src/components/MarkdownPreview.tsx — REPLACED BY TASK 5. Keep the prop interface exact.
export interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview(_props: MarkdownPreviewProps) {
  return <div className="wsp-markdown-preview">(markdown preview placeholder)</div>;
}
```

```tsx
// src/components/ImagePreview.tsx — REPLACED BY TASK 5. Keep the prop interface exact.
export interface ImagePreviewProps {
  path: string;
}

export function ImagePreview(_props: ImagePreviewProps) {
  return <div className="wsp-image-preview">(image preview placeholder)</div>;
}
```

- [ ] **Step 3: Implement `src/App.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type TreeEntry } from "./lib/api";
import { FileTree } from "./components/FileTree";
import { FileEditor } from "./components/FileEditor";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { ImagePreview } from "./components/ImagePreview";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

export function App() {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [diskContent, setDiskContent] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const selectedRef = useRef(selectedPath);
  selectedRef.current = selectedPath;

  const dirty = content !== diskContent;

  const refreshTree = useCallback(async () => {
    try {
      const tree = await api.getTree();
      setEntries(tree);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    refreshTree();
    const id = setInterval(refreshTree, 5000);
    return () => clearInterval(id);
  }, [refreshTree]);

  useEffect(() => {
    const id = setInterval(async () => {
      const path = selectedRef.current;
      if (!path || IMAGE_EXTENSIONS.has(extOf(path))) return;
      try {
        const latest = await api.readFile(path);
        setDiskContent((prev) => (latest !== prev && path === selectedRef.current ? latest : prev));
      } catch {
        // transient poll error — ignore, next tick will retry
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const openFile = useCallback(async (path: string) => {
    if (dirty) {
      const ok = window.confirm(`Discard unsaved changes to ${selectedPath}?`);
      if (!ok) return;
    }
    setSelectedPath(path);
    setPreviewMode(false);
    if (IMAGE_EXTENSIONS.has(extOf(path))) {
      setContent("");
      setDiskContent("");
      return;
    }
    try {
      const text = await api.readFile(path);
      setContent(text);
      setDiskContent(text);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [dirty, selectedPath]);

  const save = useCallback(async () => {
    if (!selectedPath) return;
    try {
      const latest = await api.readFile(selectedPath);
      if (latest !== diskContent) {
        const ok = window.confirm("This file changed on disk since it was loaded. Overwrite with your changes?");
        if (!ok) {
          setDiskContent(latest);
          return;
        }
      }
      await api.writeFile(selectedPath, content);
      setDiskContent(content);
      setStatus("Saved");
      refreshTree();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [selectedPath, content, diskContent, refreshTree]);

  const createFile = useCallback(async (path: string) => {
    try {
      await api.writeFile(path, "");
      await refreshTree();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [refreshTree]);

  const createDir = useCallback(async (path: string) => {
    try {
      await api.createDir(path);
      await refreshTree();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [refreshTree]);

  const renamePath = useCallback(async (from: string, to: string) => {
    try {
      await api.rename(from, to);
      if (selectedPath === from) setSelectedPath(to);
      await refreshTree();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [refreshTree, selectedPath]);

  const deletePath = useCallback(async (path: string) => {
    try {
      await api.deleteFile(path);
      if (selectedPath === path) {
        setSelectedPath(null);
        setContent("");
        setDiskContent("");
      }
      await refreshTree();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [refreshTree, selectedPath]);

  const ext = selectedPath ? extOf(selectedPath) : "";
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);

  return (
    <div className="wsp-editor-body">
      <div className="wsp-editor-sidebar">
        <FileTree
          entries={entries}
          selectedPath={selectedPath}
          onSelect={openFile}
          onCreateFile={createFile}
          onCreateDir={createDir}
          onRename={renamePath}
          onDelete={deletePath}
        />
      </div>
      <div className="wsp-editor-main">
        {status && <div className="wsp-status">{status}</div>}
        {!selectedPath && <div className="wsp-empty">Select a file to view or edit</div>}
        {selectedPath && isImage && <ImagePreview path={selectedPath} />}
        {selectedPath && !isImage && isMarkdown && previewMode && <MarkdownPreview content={content} />}
        {selectedPath && !isImage && (!isMarkdown || !previewMode) && (
          <FileEditor path={selectedPath} content={content} dirty={dirty} onChange={setContent} onSave={save} />
        )}
        {selectedPath && isMarkdown && !isImage && (
          <button className="wsp-toggle" onClick={() => setPreviewMode((v) => !v)}>
            {previewMode ? "Edit" : "Preview"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/index.tsx`**

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root")!;
createRoot(root).render(<App />);
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors (stub components satisfy `App.tsx`'s imports).

- [ ] **Step 6: Commit**

```bash
git add src/index.tsx src/App.tsx src/lib/api.ts src/components/FileTree.tsx src/components/FileEditor.tsx src/components/MarkdownPreview.tsx src/components/ImagePreview.tsx
git commit -m "feat: add frontend shell, api client, and component stubs"
```

---

### Task 4: FileTree component (real implementation)

**Depends on:** Tasks 2 and 3 merged to `main`. Can be implemented concurrently with Task 5 in a separate worktree — touches only `src/components/FileTree.tsx`, which Task 5 does not touch.

**Files:**
- Modify (overwrite stub): `src/components/FileTree.tsx`

**Interfaces:**
- Consumes: `FileTreeProps` (defined in Task 3's stub — `entries`, `selectedPath`, `onSelect`, `onCreateFile`, `onCreateDir`, `onRename`, `onDelete`) and `TreeEntry` from `../lib/api`. Do not change this signature — `App.tsx` (Task 3) already calls `FileTree` with exactly these props.

- [ ] **Step 1: Implement `src/components/FileTree.tsx`**

```tsx
import { useMemo, useState, useRef, useCallback, type MouseEvent } from "react";
import type { TreeEntry } from "../lib/api";

export interface FileTreeProps {
  entries: TreeEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateDir: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
}

interface Node {
  name: string;
  path: string;
  isDir: boolean;
  children: Node[];
}

const EXT_COLORS: Record<string, string> = {
  ts: "#3178c6", tsx: "#3178c6", js: "#f1e05a", jsx: "#f1e05a",
  json: "#cbcb41", md: "#519aba", markdown: "#519aba", css: "#563d7c",
  html: "#e34c26", png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4",
  gif: "#a074c4", svg: "#ffb13b",
};

function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: "", path: "", isDir: true, children: [] };
  const byPath = new Map<string, Node>([["", root]]);
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    const parts = entry.path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parent = byPath.get(parentPath) ?? root;
    const node: Node = { name, path: entry.path, isDir: entry.isDir, children: [] };
    parent.children.push(node);
    if (entry.isDir) byPath.set(entry.path, node);
  }
  const sortNode = (node: Node) => {
    node.children.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem("aurora:expanded");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>) {
  localStorage.setItem("aurora:expanded", JSON.stringify([...expanded]));
}

function loadWidth(): number {
  const raw = localStorage.getItem("aurora:sidebar-width");
  return raw ? Number(raw) : 260;
}

export function FileTree({ entries, selectedPath, onSelect, onCreateFile, onCreateDir, onRename, onDelete }: FileTreeProps) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [width, setWidth] = useState(loadWidth);
  const draggingRef = useRef(false);

  const tree = useMemo(() => buildTree(entries), [entries]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(next);
      return next;
    });
  }, []);

  const matchesFilter = useCallback((node: Node): boolean => {
    if (!filter) return true;
    if (node.name.toLowerCase().includes(filter.toLowerCase())) return true;
    return node.children.some(matchesFilter);
  }, [filter]);

  const startDrag = useCallback((e: MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      setWidth(Math.min(Math.max(ev.clientX, 160), 600));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setWidth((w) => {
        localStorage.setItem("aurora:sidebar-width", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const renderNode = (node: Node, depth: number) => {
    if (!matchesFilter(node)) return null;
    const isExpanded = expanded.has(node.path) || filter.length > 0;
    const color = EXT_COLORS[extOf(node.name)] ?? "#8a94a6";
    return (
      <div key={node.path}>
        <div
          className={`wsp-tree-row ${selectedPath === node.path ? "selected" : ""}`}
          style={{ paddingLeft: depth * 14 }}
          onClick={() => (node.isDir ? toggle(node.path) : onSelect(node.path))}
        >
          <span className="wsp-tree-icon" style={{ color: node.isDir ? "#8a94a6" : color }}>
            {node.isDir ? (isExpanded ? "▾" : "▸") : "●"}
          </span>
          <span className="wsp-tree-name">{node.name}</span>
          <span className="wsp-tree-actions">
            {node.isDir && (
              <>
                <button title="New file" onClick={(e) => { e.stopPropagation(); const name = window.prompt("New file name"); if (name) onCreateFile(node.path ? `${node.path}/${name}` : name); }}>+f</button>
                <button title="New folder" onClick={(e) => { e.stopPropagation(); const name = window.prompt("New folder name"); if (name) onCreateDir(node.path ? `${node.path}/${name}` : name); }}>+d</button>
              </>
            )}
            <button title="Rename" onClick={(e) => { e.stopPropagation(); const name = window.prompt("Rename to", node.name); if (name && name !== node.name) { const parent = node.path.split("/").slice(0, -1).join("/"); onRename(node.path, parent ? `${parent}/${name}` : name); } }}>r</button>
            <button title="Delete" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete ${node.path}?`)) onDelete(node.path); }}>x</button>
          </span>
        </div>
        {node.isDir && isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="wsp-tree" style={{ width }}>
      <input className="wsp-tree-search" placeholder="Filter files..." value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="wsp-tree-list">{tree.map((node) => renderNode(node, 0))}</div>
      <div className="wsp-tree-resize" onMouseDown={startDrag} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/FileTree.tsx
git commit -m "feat: implement FileTree with search, CRUD actions, and resizable width"
```

---

### Task 5: FileEditor, MarkdownPreview, ImagePreview components (real implementation)

**Depends on:** Tasks 2 and 3 merged to `main`. Can be implemented concurrently with Task 4 in a separate worktree — touches `src/components/FileEditor.tsx`, `src/components/MarkdownPreview.tsx`, `src/components/ImagePreview.tsx`, none of which Task 4 touches.

**Files:**
- Modify (overwrite stub): `src/components/FileEditor.tsx`
- Modify (overwrite stub): `src/components/MarkdownPreview.tsx`
- Modify (overwrite stub): `src/components/ImagePreview.tsx`

**Interfaces:**
- Consumes: `FileEditorProps` (`path`, `content`, `dirty`, `onChange`, `onSave`), `MarkdownPreviewProps` (`content`), `ImagePreviewProps` (`path`) — all defined in Task 3's stubs. Do not change these signatures — `App.tsx` already calls each component with exactly these props.
- Consumes: `api.fileUrl(path: string): string` from `../lib/api` (used by `ImagePreview`).

- [ ] **Step 1: Implement `src/components/FileEditor.tsx`**

```tsx
import { useEffect, useRef } from "react";

export interface FileEditorProps {
  path: string;
  content: string;
  dirty: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
}

function extOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightJson(text: string): string {
  return escapeHtml(text).replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "num";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "key" : "str";
      else if (/true|false/.test(match)) cls = "bool";
      else if (/null/.test(match)) cls = "null";
      return `<span class="tok-${cls}">${match}</span>`;
    }
  );
}

function highlightMarkup(text: string): string {
  return escapeHtml(text).replace(
    /(&lt;\/?[a-zA-Z][a-zA-Z0-9-]*)([^&]*?)(\/?&gt;)/g,
    (_m, open, attrs, close) => `<span class="tok-tag">${open}</span><span class="tok-attr">${attrs}</span><span class="tok-tag">${close}</span>`
  );
}

function highlightCss(text: string): string {
  return escapeHtml(text)
    .replace(/([.#]?[a-zA-Z0-9_-]+)(\s*\{)/g, '<span class="tok-selector">$1</span>$2')
    .replace(/([a-zA-Z-]+)(\s*:)/g, '<span class="tok-key">$1</span>$2');
}

function highlightMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/^(#{1,6}\s.*)$/gm, '<span class="tok-heading">$1</span>')
    .replace(/(\*\*[^*]+\*\*)/g, '<span class="tok-bold">$1</span>')
    .replace(/(`[^`]+`)/g, '<span class="tok-code">$1</span>');
}

function highlightGeneric(text: string): string {
  return escapeHtml(text).replace(
    /\b(function|return|const|let|var|if|else|for|while|import|export|from|class|new|await|async)\b/g,
    '<span class="tok-keyword">$1</span>'
  );
}

function highlight(text: string, ext: string): string {
  switch (ext) {
    case "json": return highlightJson(text);
    case "html": case "xml": return highlightMarkup(text);
    case "css": return highlightCss(text);
    case "md": case "markdown": return highlightMarkdown(text);
    default: return highlightGeneric(text);
  }
}

export function FileEditor({ path, content, dirty, onChange, onSave }: FileEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const ext = extOf(path);
  const lines = content.split("\n");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSave]);

  const syncScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="wsp-editor">
      <div className="wsp-editor-toolbar">
        <span className={`wsp-dirty-dot ${dirty ? "dirty" : ""}`} />
        <span className="wsp-editor-path">{path}</span>
        <button className="wsp-save-btn" onClick={onSave} disabled={!dirty}>Save</button>
      </div>
      <div className="wsp-editor-pane">
        <div className="wsp-line-numbers">
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <div className="wsp-editor-code">
          <pre ref={preRef} className="wsp-editor-highlight" dangerouslySetInnerHTML={{ __html: highlight(content, ext) + "\n" }} />
          <textarea
            ref={textareaRef}
            className="wsp-editor-textarea"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/components/MarkdownPreview.tsx`**

```tsx
export interface MarkdownPreviewProps {
  content: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(text: string): string {
  const lines = escapeHtml(text).split("\n");
  const html: string[] = [];
  let inList = false;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (heading) {
      if (inList) { html.push("</ul>"); inList = false; }
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (listItem) {
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${inline(listItem[1])}</li>`);
    } else if (line.trim() === "") {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push("");
    } else {
      if (inList) { html.push("</ul>"); inList = false; }
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  if (inList) html.push("</ul>");
  return html.join("\n");
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return <div className="wsp-markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
}
```

- [ ] **Step 3: Implement `src/components/ImagePreview.tsx`**

```tsx
import { api } from "../lib/api";

export interface ImagePreviewProps {
  path: string;
}

export function ImagePreview({ path }: ImagePreviewProps) {
  return (
    <div className="wsp-image-preview">
      <img src={api.fileUrl(path)} alt={path} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileEditor.tsx src/components/MarkdownPreview.tsx src/components/ImagePreview.tsx
git commit -m "feat: implement FileEditor with syntax highlighting, MarkdownPreview, and ImagePreview"
```

---

### Task 6: Integration verification

**Depends on:** Tasks 4 and 5 merged to `main`. Sequential — run in a worktree branched from `main` after both are in, not in parallel with anything.

**Files:**
- Modify only if a wiring bug surfaces during verification (e.g. `server.ts`, `src/App.tsx`) — no new files expected.

- [ ] **Step 1: Install and run the full test suite**

```bash
bun install
bun test
```

Expected: all `lib/fsSafe.test.ts` and `server.test.ts` tests pass (15 tests total).

- [ ] **Step 2: Typecheck the whole project**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the running app against a scratch folder**

```bash
mkdir -p /tmp/aurora-smoke/sub
echo '# Hello' > /tmp/aurora-smoke/readme.md
echo '{"a":1}' > /tmp/aurora-smoke/data.json
chmod +x cli.ts
./cli.ts /tmp/aurora-smoke --port 4321
```

In another terminal:

```bash
curl -s http://localhost:4321/ | head -5
curl -s http://localhost:4321/api/tree
curl -s "http://localhost:4321/api/file?path=readme.md"
```

Expected: `/` returns HTML (confirms the `index.html` → `src/index.tsx` bundling resolves correctly now that Task 3's files exist); `/api/tree` lists `readme.md`, `data.json`, `sub`; `/api/file?path=readme.md` returns `# Hello`. Then open `http://localhost:4321/` in a browser, confirm the dark-themed tree + editor render, click `readme.md`, edit it, save, and confirm the change persisted with `cat /tmp/aurora-smoke/readme.md`. Stop the server with Ctrl+C.

- [ ] **Step 4: Fix any integration issues found in Steps 1–3**

If `bun test`, `tsc`, or the smoke test surfaces a wiring problem (e.g. a prop mismatch between `App.tsx` and a component, or an unresolved import in `server.ts`), fix it directly in this task's worktree and re-run the failing step until it passes. Do not skip straight to committing on a failing smoke test.

- [ ] **Step 5: Clean up scratch files and commit any fixes**

```bash
rm -rf /tmp/aurora-smoke
git status
```

If Step 4 required changes, `git add` the touched files and commit with a message describing the wiring fix. If no changes were needed, this task produces no commit — report that verification passed clean.

---

## Definition of Done

- `bun test` passes (fsSafe path-traversal cases + all `/api/*` route happy/error paths).
- `bunx tsc --noEmit` passes with no errors.
- `./cli.ts <folder> --port <port>` serves a working dark-themed tree + editor UI at `http://localhost:<port>/`, matching the spec's feature list: browse, create/rename/delete files and folders, edit with syntax highlighting, Markdown preview toggle, image preview, dirty-state indicator, save (button + Cmd/Ctrl+S), and a disk-conflict prompt on external changes to a dirty buffer.
- `main` contains all six tasks' commits, in a single linear history (each batch's worktrees merged before the next batch branched).
