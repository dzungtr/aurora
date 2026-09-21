# aurora — Design Spec

Date: 2026-07-01
Status: Approved (via superpowers:brainstorming session)

## Summary

A standalone, local, single-command web-based file explorer + editor. Visually and
behaviorally modeled on the right-hand workspace pane of zui's web app
(`apps/web` — `WorkspacePlaceholder` → `WebCodeEditor`, at
`/Users/tony/project/dzungtr/zui/apps/web/src/components/WebCodeEditor.tsx`),
but implemented as a fully independent project with its own runtime — no shared
code or dependency on the zui monorepo.

## Goals

- Point the tool at one local folder and get a file-tree + editor UI in the browser,
  no separate build/deploy step: `bunx aurora ./some-folder`.
- Browse, view, and edit files: syntax-highlighted text, rendered Markdown preview,
  image preview, and full CRUD on files/folders (create, rename, delete, save).
- Match zui's dark visual theme and file-tree/editor interaction patterns closely
  enough that it feels like the same UI, without importing any of zui's code.

## Non-goals

- Multi-project/root switching (single root folder per running instance).
- Remote/multi-user deployment, authentication, or authorization.
- A full IDE experience (no LSP, no plugin system, no heavy editor library).
- Frontend component test coverage in v1 (personal/local tool; add later if this
  becomes a shared/team tool).

## Reference: what's being visually matched

From zui's `apps/web`:
- Split-pane layout: chat pane (not applicable here) + a workspace pane containing
  a resizable file-tree sidebar and a main editor/preview area
  (`.wsp-editor-body`, `.wsp-editor-sidebar`, `.wsp-editor-main` in
  `apps/web/src/styles.css`).
- Dark theme CSS variables: `--bg: #0b0e14`, `--bg-2: #11151f`,
  `--border: #232a3a`, `--text: #d6deeb`, `--accent: #5b8cff`.
- File tree: expand/collapse persisted per-folder, search filter, type-colored SVG
  icons per extension, inline new-file/new-folder/rename/delete actions, resizable
  width via a drag handle (persisted).
- Editor: plain `<textarea>` + `<pre>` overlay, syntax highlighting done via
  hand-rolled per-extension regex passes (JSON, HTML/XML, CSS, Markdown, generic
  fallback) — no CodeMirror/Monaco dependency. Markdown files get an Edit/Preview
  toggle; image files render directly.
- Dirty-state indicator, save button, and disk-conflict detection (external change
  while a buffer is dirty prompts before overwrite) — background poll every ~5s.

## Architecture

Single Bun process, in both dev and "production" (no separate build artifact to
manage): Bun's full-stack `Bun.serve()` bundles and serves the frontend (HTML/TSX
imports, JSX/TSX transform, CSS) and handles `/api/*` routes in the same server.
Dev mode adds `--hot` for HMR; there's no meaningfully different "production build"
step — Bun bundles on the fly either way, which keeps the CLI's distribution story
to "install + run, nothing to compile."

```
aurora/
├── cli.ts                  # #!/usr/bin/env bun — parses `aurora <path> [--port]`,
│                             # sets ROOT_DIR, starts server.ts
├── server.ts                # Bun.serve({ routes: { "/": index.html import,
│                             #   "/api/tree": ..., "/api/file": ..., ... },
│                             #   development: process.env.NODE_ENV !== "production" })
├── index.html               # <script type="module" src="./src/index.tsx">
├── src/
│   ├── index.tsx             # React root
│   ├── App.tsx                # top-level layout: sidebar (tree) + main (editor/preview)
│   ├── components/
│   │   ├── FileTree.tsx        # recursive tree, expand/collapse, search, CRUD actions
│   │   ├── FileEditor.tsx      # textarea + <pre> overlay, regex syntax highlighter
│   │   ├── MarkdownPreview.tsx
│   │   └── ImagePreview.tsx
│   ├── lib/api.ts              # thin fetch wrapper over /api/* endpoints
│   └── styles.css              # dark theme, same CSS variables as zui
├── lib/fsSafe.ts             # server-side: resolves + validates every path stays
│                             # inside ROOT_DIR (blocks path traversal)
├── package.json               # "bin": { "aurora": "./cli.ts" };
│                             # deps: react, react-dom; devDeps: @types/bun, typescript
└── tsconfig.json
```

## API

All handlers in `server.ts` route filesystem paths through
`lib/fsSafe.ts::resolveSafe(ROOT_DIR, userPath)`, which throws if the resolved
absolute path is not inside `ROOT_DIR` (rejects `../` traversal and absolute-path
overrides).

| Method | Path              | Body / Query           | Purpose                                   |
|--------|-------------------|-------------------------|--------------------------------------------|
| GET    | `/api/tree`       | —                        | Recursively list `{path, isDir}[]` under root |
| GET    | `/api/file`       | `?path=`                | Read file content (text or binary stream) |
| POST   | `/api/file`       | `{path, content}`       | Write file content                        |
| POST   | `/api/dir`        | `{path}`                | Create a folder                           |
| POST   | `/api/rename`     | `{from, to}`            | Rename or move a file/folder              |
| DELETE | `/api/file`       | `?path=`                | Delete a file or folder                   |

Error responses are JSON `{error: string}` with status codes: `400` invalid or
outside-root path, `404` missing path, `500` unexpected filesystem error.

## Frontend components

- **`App`** — owns selected-file state, save-status, dirty flag; polls `/api/tree`
  every ~5s to detect out-of-band filesystem changes; on external change to the
  currently-open dirty file, prompts before overwrite.
- **`FileTree`** — builds a nested tree client-side from the flat `/api/tree`
  response; expand/collapse persisted to `localStorage`; search-filter input;
  type-colored SVG icons per extension (same icon set/approach as zui's
  `WebCodeEditor`); inline new-file/new-folder/rename/delete; resizable width via
  drag handle (persisted to `localStorage`).
- **`FileEditor`** — `<textarea>` + `<pre>` overlay; syntax highlighting via
  per-extension regex passes (JSON, HTML/XML, CSS, Markdown, generic fallback);
  line numbers; dirty-state dot; save action (button + keyboard shortcut).
- **`MarkdownPreview`** — Edit/Preview toggle for `.md`/`.markdown` files.
- **`ImagePreview`** — renders image files via `<img src="/api/file?path=...">`.

## Error handling

- Every `/api/*` handler wraps filesystem calls in try/catch; failures return
  structured JSON errors (see API table) instead of throwing raw stack traces.
- `fsSafe.resolveSafe` is the single enforcement point for path-traversal
  prevention — applied even though this is a localhost-only tool, since it's cheap
  insurance against operator error (e.g. passing an untrusted path via a future
  integration).
- Frontend shows API errors as inline status text; a failed save keeps the local
  edit buffer intact (no data loss on network/API failure).
- Disk-conflict handling: if the currently-open file changed on disk since it was
  loaded, and the in-memory buffer is dirty, the user is prompted before any save
  can overwrite the external change.

## Testing

- `bun test` for `lib/fsSafe.ts`: path-traversal cases (`../`, absolute-path
  override, symlink escape) must all be rejected; legitimate nested paths must
  resolve correctly.
- `bun test` for each `/api/*` route handler: happy-path (list/read/write/rename/
  delete) and error-path (missing file, outside-root path) cases, using a fresh
  temp directory fixture per test.
- No frontend component tests in v1 (see Non-goals).

## Open questions / deferred decisions

None outstanding — all decisions below were made during the brainstorming session
and are considered final for v1:

- Standalone project (not part of the zui monorepo).
- Feature scope: browse + edit (matches `WebCodeEditor` feature set).
- Single fixed root folder per instance (no multi-project switching).
- Local CLI tool only (no auth, localhost-only).
- Bun runtime end-to-end (backend + frontend bundling/serving), no Vite/Express.
