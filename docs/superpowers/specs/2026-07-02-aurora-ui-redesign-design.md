# Aurora UI redesign — Design Spec

Date: 2026-07-02
Status: Draft (brainstorming session; user unavailable to confirm scope choice —
proceeded with the recommended full-swap option per Auto Mode guidance. Flagged
for review before implementation starts.)

## Summary

Replace the current `src/` frontend (React 19, tree + text/markdown/image only,
hand-rolled highlighting, no tabs) with the "Aurora Files" design delivered in
`implementation/` (dark Oolio-themed React app with tabs, a Workspace/Focus
layout switch, an Inspector metadata panel, and viewers for text, markdown,
image, video, audio, and PDF). The backend (`server.ts`, `lib/fsSafe.ts`) is
reused with targeted additions; the API contract shape is unchanged.

## Why full swap, not partial

`implementation/`'s own README frames it as a "drop-in" replacement matching
the existing `/api/*` contract, and its component set (Tabs, Toolbar, Inspector,
per-kind viewers) is designed as one coherent system, not modular pieces meant
to be mixed with the current simpler UI. Cherry-picking would mean re-deriving
the `styles.css` token system and layout shell piecemeal for partial benefit.
This choice was offered to the user as the recommended option; no objection was
raised (no response received), so it proceeds as-is.

## Critical gap found during review: CRUD is not implemented in Aurora

`implementation/src/lib/api.ts` still defines `createDir`, `rename`, and
`deleteFile`, but **nothing in the Aurora UI calls them**:
- `TopBar.tsx`'s "New" button has no `onClick`.
- `FileTree.tsx` has no context menu, no inline rename, no delete affordance.

The current `src/App.tsx` + `src/components/FileTree.tsx` support create
file/folder, rename, and delete today. Adopting Aurora as-is would silently
regress this. **This spec requires reintroducing CRUD** in the new tree/toolbar
before the swap is considered complete — it is not optional polish.

## Goals

- Replace `src/` with the Aurora component set and dark theme, preserving all
  current functionality (browse, view, edit, save, disk-conflict detection,
  create file/folder, rename, delete) and adding the new viewers (video, audio,
  PDF) and UI (tabs, Workspace/Focus layouts, Inspector).
- Keep the existing `/api/*` contract's URL shape; extend it only additively
  (new optional fields, unchanged existing behavior) so `server.test.ts` needs
  no rewrites, only additions.
- Keep the app fully offline/local — no CDN dependency for the PDF worker.
- Stay on React 19 (already in use); Aurora's code has no React-18-only APIs
  (`createRoot` is stable since 18 and works unchanged on 19), so no downgrade
  is needed. `implementation/package.json`'s `^18.3.1` pin was just what the
  design was built against — not a hard requirement.

## Non-goals

- No change to `lib/fsSafe.ts`'s path-traversal enforcement.
- No multi-root / auth / remote-deployment features (unchanged from original
  spec's non-goals).
- No new automated frontend component tests (matches original spec's
  non-goal — this is still a personal/local tool). Manual verification via
  `/verify`-style exercising of the running app before calling this done.

## Architecture

```
src/
├── index.tsx                # unchanged shape: createRoot(...).render(<App />)
├── App.tsx                  # replaced: Aurora orchestrator + reinstated CRUD wiring
├── styles.css                # replaced: Aurora dark theme (Oolio tokens)
├── lib/
│   ├── api.ts                # replaced: Aurora's client (already has CRUD methods
│   │                          #   defined — this task wires them into the UI)
│   ├── fileTypes.ts           # new: kind/icon/colour detection
│   └── highlight.ts           # new: syntax highlighter + markdown renderer
└── components/
    ├── Icon.tsx                # new: @iconify/react wrapper (Unicons)
    ├── TopBar.tsx              # replaced: + New-file/New-folder menu (wired)
    ├── CommandBar.tsx          # new: focus-layout breadcrumb bar
    ├── Breadcrumb.tsx          # new
    ├── FileTree.tsx            # replaced: + context menu (rename/delete) and
    │                            #   inline "new file/folder" row, reusing Aurora's
    │                            #   tree build/filter/flatten logic
    ├── Tabs.tsx                # new
    ├── Toolbar.tsx             # new: per-kind controls + Save + actions
    ├── Inspector.tsx           # new: metadata Details panel
    └── viewers/
        ├── Viewer.tsx, TextViewer.tsx, MarkdownViewer.tsx, ImageViewer.tsx,
        └── VideoViewer.tsx, AudioViewer.tsx, PdfViewer.tsx   # all new
```

`server.ts` and `lib/fsSafe.ts` stay largely as-is with two additive changes
(see Backend changes below).

## CRUD reinstatement (the part Aurora didn't build)

- **New file / New folder**: `TopBar`'s "New" button becomes a small dropdown
  (New File / New Folder), prompting for a name via the same inline-input
  pattern Aurora already uses for its filter box (no `window.prompt`, to match
  the design's visual language) — text input appears inline at tree root.
- **Rename / Delete**: `FileTree` row gains a right-click context menu (and a
  hover "more" icon button as a discoverable non-right-click affordance) with
  Rename and Delete actions. Rename swaps the row label for an inline text
  input (Escape cancels, Enter commits). Delete uses `window.confirm` for the
  destructive action, consistent with the existing app's pattern (`server.ts`
  itself has no undo).
- All three call the existing `api.createDir` / `api.rename` / `api.deleteFile`
  methods already present in Aurora's `lib/api.ts` — no new backend endpoints.
- Directory delete: current `/api/file DELETE` explicitly rejects directories
  ("Cannot delete a directory via /api/file"). Reuse this as-is — directory
  delete from the UI is out of scope for this spec, matching current
  behavior. The context menu's Delete option is disabled (not hidden, so it's
  discoverable but explained via a disabled-state title) for directories.

## Backend changes

1. **File metadata for the Inspector** — `listTree` in `server.ts` adds a
   `stat()` call per entry and includes `size` and `mtime` in the response,
   per the optional enhancement Aurora's README documents. `TreeEntry` on both
   client and server already declare these as optional, so this is additive
   and requires no `server.test.ts` changes to existing assertions — only new
   assertions for the added fields.
2. **Binary streaming correctness** — verify `GET /api/file`'s
   `new Response(file)` (via `Bun.file`) serves correct `Content-Type` per
   extension and honors `Range` request headers for smooth video/audio
   scrubbing. Bun infers content-type from extension and supports Range on
   `Bun.file`-backed responses natively; this spec calls for **adding a test**
   that asserts a `Range: bytes=0-3` request against a binary file returns
   `206 Partial Content` with the correct `Content-Range`/`Content-Length`,
   rather than assuming it. If Bun's default response does not satisfy this,
   the handler adds explicit Range handling.
3. **PDF worker stays local** — per Aurora's README, `PdfViewer` defaults to
   pointing `pdfjs.GlobalWorkerOptions.workerSrc` at a CDN. Since this tool is
   meant to run fully offline, the matching `pdf.worker.min.js` (from the
   installed `pdfjs-dist` version, a transitive dep of `react-pdf`) is copied
   into a new `public/` directory served as static files, and `PdfViewer` is
   changed to point there instead of a CDN URL.

## Dependencies

Add to `package.json`: `@iconify/react` and `react-pdf` (matching
`implementation/package.json`'s versions: `^5.0.2` and `^9.1.1`). `react` /
`react-dom` stay pinned at `^19.0.0` (no downgrade).

## Error handling

Unchanged from the original spec — structured JSON errors from every
`/api/*` handler, inline status/toast display on the frontend (Aurora's
`toast` state replaces the old `status` div), dirty buffers preserved on save
failure, disk-conflict-before-overwrite prompt preserved (Aurora's `save()`
already implements this — confirmed by reading `App.tsx`).

## Testing

- Existing `server.test.ts` suite must continue to pass unmodified in its
  current assertions.
- New backend tests: `/api/tree` entries include numeric `size`/`mtime`;
  `/api/file` GET with a `Range` header returns `206` with correct byte range
  for a binary file.
- No new frontend automated tests (non-goal, matches original spec). Manual
  verification pass required before calling implementation complete: open the
  app, exercise create/rename/delete file and folder, edit+save a text file,
  trigger the disk-conflict prompt, preview an image/markdown/PDF file, and
  confirm Workspace/Focus layout toggle works.

## Open questions / deferred decisions

- **Scope confirmation was not obtained from the user** (question asked,
  no response within the session). Proceeding on the recommended "full swap"
  option per Auto Mode guidance; this is flagged prominently for the user to
  redirect if they intended a narrower change (visual-polish-only or
  cherry-pick).
- Whether to keep both Workspace and Focus layouts or drop one: kept both,
  since dropping either would be scope-narrowing without an explicit request,
  and Aurora's own `Layout` type / `TopBar` toggle wires it into a first-class
  navigation choice, not one that hides half-broken UI.
