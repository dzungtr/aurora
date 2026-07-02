# Aurora UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/`'s current simple file explorer UI with the "Aurora Files" design from `implementation/` — tabs, Workspace/Focus layouts, an Inspector metadata panel, and text/markdown/image/video/audio/PDF viewers — while reinstating the create/rename/delete functionality Aurora's reference code never wired up, and extending the backend just enough to support it (file metadata, a locally-served PDF worker).

**Architecture:** Frontend components and lib modules are copied from `implementation/src/` into `src/` (mostly verbatim; `FileTree.tsx`, `TopBar.tsx`, and `App.tsx` get real modifications to add CRUD). `server.ts` gains one additive change (stat-based `size`/`mtime` in `/api/tree`) and one new static route (the PDF worker asset, embedded via Bun's `with { type: "file" }` import so it also works inside the `bun build --compile` binary). No changes to `lib/fsSafe.ts` or the `/api/*` URL contract.

**Tech Stack:** Bun (server + bundler + test runner), React 19, TypeScript, `@iconify/react` (Unicons icon set), `react-pdf`/`pdfjs-dist` (PDF rendering).

## Global Constraints

- Stay on React 19 (`react`/`react-dom` remain pinned `^19.0.0` in `package.json`) — do not downgrade to React 18, even though `implementation/package.json` pins `^18.3.1`. Verified: Aurora's code only uses `createRoot`, which is unchanged between 18 and 19.
- Pin new deps to the versions the reference code was authored against: `@iconify/react@^5.0.2`, `react-pdf@^9.1.1` (this resolves `pdfjs-dist@4.8.69` as a transitive dependency — do not add `pdfjs-dist` directly to `package.json`).
- `lib/fsSafe.ts`'s path-traversal enforcement is unchanged — no task in this plan touches it.
- The `/api/*` URL shape (`GET/POST /api/file`, `POST /api/dir`, `POST /api/rename`, `GET /api/tree`) is unchanged. `TreeEntry.size`/`.mtime` are additive optional fields.
- No new frontend automated tests (matches the original project spec's non-goal — personal/local tool). Every task's frontend changes are verified via `bunx tsc --noEmit` (typecheck) plus the final manual verification task (Task 14).
- Every backend behavior change gets a `bun test` case in `server.test.ts`.
- Directory delete stays unsupported through the UI (existing `server.ts` behavior: `DELETE /api/file` on a directory returns 400) — the new context menu disables Delete for directories rather than adding directory-delete support.
- Root-level file/folder creation only (via the TopBar "New" menu) — no nested "new file inside this folder" affordance. This matches the approved design spec; do not add it as a bonus.

---

### Task 1: Add and pin the new dependencies

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@iconify/react` (icon components used by every subsequent frontend task), `react-pdf` (used by Task 9's `PdfViewer.tsx`).

- [ ] **Step 1: Install pinned versions**

```bash
bun add @iconify/react@^5.0.2 react-pdf@^9.1.1
```

- [ ] **Step 2: Verify resolved versions**

Run: `grep -A1 '"@iconify/react"\|"react-pdf"\|"pdfjs-dist"' bun.lock | head -20`

Expected: `@iconify/react` resolves to a `5.x` version, `react-pdf` to a `9.x` version, and `pdfjs-dist` appears as a transitive dependency at `4.8.69` (or another `4.x` — exact patch version may drift, that's fine).

- [ ] **Step 3: Confirm existing tests still pass**

Run: `bun test`
Expected: `19 pass, 0 fail` (unchanged from before this task — this task touches no runtime code).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @iconify/react and react-pdf dependencies"
```

---

### Task 2: Add `lib/fileTypes.ts` and `lib/highlight.ts`

**Files:**
- Create: `src/lib/fileTypes.ts` (copy of `implementation/src/lib/fileTypes.ts`)
- Create: `src/lib/highlight.ts` (copy of `implementation/src/lib/highlight.ts`)

**Interfaces:**
- Produces (from `fileTypes.ts`): `type FileKind`, `extOf(path): string`, `baseName(path): string`, `kindOf(path): FileKind`, `isTextKind(k): boolean`, `isEditable(k): boolean`, `colorFor(path, isDir): string`, `FOLDER_COLOR: string`, `iconFor(path, isDir, expanded?): string`, `badgeFor(path): string`, `kindLabel(k): string`, `formatTime(sec): string`, `formatBytes(bytes?): string`, `formatDate(ms?): string`.
- Produces (from `highlight.ts`): `highlight(text, kind): string`, `renderMarkdown(text): string`. Both HTML-escape their input before emitting markup (confirmed by reading the source — `esc()` runs first in every code path, and Markdown link URLs are additionally passed through `sanitizeUrl`/`isSafeUrl`), so `dangerouslySetInnerHTML` on their output is safe. Do not alter this escaping when copying.

- [ ] **Step 1: Copy the two files verbatim**

```bash
cp implementation/src/lib/fileTypes.ts src/lib/fileTypes.ts
cp implementation/src/lib/highlight.ts src/lib/highlight.ts
```

- [ ] **Step 2: Typecheck (will show unused-file warnings only, since nothing imports these yet — that's expected)**

Run: `bunx tsc --noEmit`
Expected: no errors originating from `src/lib/fileTypes.ts` or `src/lib/highlight.ts` themselves (pre-existing errors about other files not yet updated, if any at this point, are expected and resolved by later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/lib/fileTypes.ts src/lib/highlight.ts
git commit -m "feat: add Aurora file-type and syntax-highlight helpers"
```

---

### Task 3: Add `components/Icon.tsx`

**Files:**
- Create: `src/components/Icon.tsx` (copy of `implementation/src/components/Icon.tsx`)

**Interfaces:**
- Produces: `interface IconProps { name: string; size?: number; color?: string; className?: string; style?: CSSProperties }`, `function Icon(props: IconProps): JSX.Element`.

- [ ] **Step 1: Copy the file verbatim**

```bash
cp implementation/src/components/Icon.tsx src/components/Icon.tsx
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Icon.tsx
git commit -m "feat: add Icon component (Iconify/Unicons wrapper)"
```

---

### Task 4: Replace `lib/api.ts` with Aurora's client

**Files:**
- Modify (full replace): `src/lib/api.ts`

**Interfaces:**
- Consumes: none (leaf module, only calls `fetch`).
- Produces: `interface TreeEntry { path: string; isDir: boolean; size?: number; mtime?: number }`, `api.getTree(): Promise<TreeEntry[]>`, `api.readFile(path): Promise<string>`, `api.fileUrl(path): string`, `api.writeFile(path, content): Promise<void>`, `api.createDir(path): Promise<void>`, `api.rename(from, to): Promise<void>`, `api.deleteFile(path): Promise<void>`. Every subsequent frontend task imports from this module.

- [ ] **Step 1: Copy the file verbatim**

```bash
cp implementation/src/lib/api.ts src/lib/api.ts
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: errors now appear in `src/App.tsx` and `src/components/*` that still reference the old API shape or old components (`FileEditor`, `ImagePreview`, `MarkdownPreview` imports) — expected at this point in the migration, resolved by later tasks. Confirm no error originates from `src/lib/api.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: replace API client with Aurora's version (adds size/mtime, fileUrl)"
```

---

### Task 5: Add the read-only viewer components (Text, Markdown, Image, Video, Audio)

**Files:**
- Create: `src/components/viewers/TextViewer.tsx` (copy)
- Create: `src/components/viewers/MarkdownViewer.tsx` (copy)
- Create: `src/components/viewers/ImageViewer.tsx` (copy)
- Create: `src/components/viewers/VideoViewer.tsx` (copy)
- Create: `src/components/viewers/AudioViewer.tsx` (copy)

**Interfaces:**
- Consumes: `Buffer` type from `../../App` (defined in Task 8), `kindOf`/`highlight`/`baseName`/`formatTime` from Task 2's `lib` modules, `api` from Task 4, `Icon` from Task 3.
- Produces: `TextViewer({ path, buffer, onChange, wrap })`, `MarkdownViewer({ buffer, onChange, mode })`, `ImageViewer({ path, fit, zoom, rotate })`, `VideoViewer({ path })`, `AudioViewer({ path })` — all consumed by `Viewer.tsx` in Task 6.

- [ ] **Step 1: Copy all five files verbatim**

```bash
cp implementation/src/components/viewers/TextViewer.tsx src/components/viewers/TextViewer.tsx
cp implementation/src/components/viewers/MarkdownViewer.tsx src/components/viewers/MarkdownViewer.tsx
cp implementation/src/components/viewers/ImageViewer.tsx src/components/viewers/ImageViewer.tsx
cp implementation/src/components/viewers/VideoViewer.tsx src/components/viewers/VideoViewer.tsx
cp implementation/src/components/viewers/AudioViewer.tsx src/components/viewers/AudioViewer.tsx
```

- [ ] **Step 2: Commit**

```bash
git add src/components/viewers/TextViewer.tsx src/components/viewers/MarkdownViewer.tsx src/components/viewers/ImageViewer.tsx src/components/viewers/VideoViewer.tsx src/components/viewers/AudioViewer.tsx
git commit -m "feat: add text/markdown/image/video/audio viewer components"
```

---

### Task 6: Add `PdfViewer.tsx` and `Viewer.tsx`, point the PDF worker at a local route

**Files:**
- Create: `src/components/viewers/PdfViewer.tsx` (copy, then modify the `workerSrc` line)
- Create: `src/components/viewers/Viewer.tsx` (copy)

**Interfaces:**
- Consumes: `api.fileUrl` from Task 4, `Buffer`/`ViewState` from `../../App` (Task 8), all five viewers from Task 5.
- Produces: `Viewer({ path, buffer, onChange, view, onPdfPage })` — the single viewer entry point `App.tsx` renders.

- [ ] **Step 1: Copy both files verbatim**

```bash
cp implementation/src/components/viewers/PdfViewer.tsx src/components/viewers/PdfViewer.tsx
cp implementation/src/components/viewers/Viewer.tsx src/components/viewers/Viewer.tsx
```

- [ ] **Step 2: Point the PDF worker at the local route added in Task 13, not a CDN**

In `src/components/viewers/PdfViewer.tsx`, replace:

```ts
// pdf.js worker — served from CDN to match the bundled pdfjs-dist version.
// For an offline/local-only deployment, copy pdf.worker.min.js into /public
// and point workerSrc at it instead.
pdfjs.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
```

with:

```ts
// pdf.js worker — served locally by server.ts (see the "/pdf.worker.min.mjs"
// route), so PDF viewing works fully offline.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```

- [ ] **Step 3: Commit**

```bash
git add src/components/viewers/PdfViewer.tsx src/components/viewers/Viewer.tsx
git commit -m "feat: add PDF viewer, point pdf.js worker at local server route"
```

---

### Task 7: Add `Tabs.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `CommandBar.tsx`, `Breadcrumb.tsx`

**Files:**
- Create: `src/components/Tabs.tsx` (copy)
- Create: `src/components/Toolbar.tsx` (copy)
- Create: `src/components/Inspector.tsx` (copy)
- Create: `src/components/CommandBar.tsx` (copy)
- Create: `src/components/Breadcrumb.tsx` (copy)

**Interfaces:**
- Consumes: `Layout`/`Buffer`/`ViewState` from `../App` (Task 8), `fileTypes`/`Icon` helpers from Tasks 2–3.
- Produces: `Tabs({ tabs, selectedPath, buffers, onSelect, onClose })`, `Toolbar({ path, layout, dirty, onSave, view, onView, pdfPage, pdfCount, onOpen, inspectorOpen, onToggleInspector })`, `Inspector({ path, entry, buffer, isFocus, onClose, onOpen, onCopyPath })`, `CommandBar({ path, inspectorOpen, onToggleInspector })`, `Breadcrumb({ path })` — all consumed directly by `App.tsx` in Task 8.

- [ ] **Step 1: Copy all five files verbatim**

```bash
cp implementation/src/components/Tabs.tsx src/components/Tabs.tsx
cp implementation/src/components/Toolbar.tsx src/components/Toolbar.tsx
cp implementation/src/components/Inspector.tsx src/components/Inspector.tsx
cp implementation/src/components/CommandBar.tsx src/components/CommandBar.tsx
cp implementation/src/components/Breadcrumb.tsx src/components/Breadcrumb.tsx
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Tabs.tsx src/components/Toolbar.tsx src/components/Inspector.tsx src/components/CommandBar.tsx src/components/Breadcrumb.tsx
git commit -m "feat: add Tabs, Toolbar, Inspector, CommandBar, Breadcrumb components"
```

---

### Task 8: Replace `App.tsx` with the Aurora orchestrator, plus CRUD state

This is the task that reinstates create/rename/delete, which Aurora's reference `App.tsx` never wired up (see the design spec's "Critical gap" section). `commitCreate`, `renamePath`, and `deleteEntry` below are **new** — they do not exist in `implementation/src/App.tsx`.

**Files:**
- Modify (full replace): `src/App.tsx`

**Interfaces:**
- Consumes: `api`/`TreeEntry` (Task 4), `isEditable`/`kindOf` (Task 2), `TopBar` (Task 9, not yet created — this task references it ahead of Task 9's creation; typecheck will fail until Task 9 lands, which is expected and called out in Step 2), `CommandBar`/`FileTree`/`Tabs`/`Toolbar`/`Inspector` (Tasks 5–7, 10), `Viewer` (Task 6), `Icon` (Task 3).
- Produces: `type Layout = "workspace" | "focus"`, `interface Buffer { content: string; disk: string }`, `interface ViewState { fit: boolean; zoom: number; rotate: number; mdMode: "edit"|"split"|"preview"; wrap: boolean; pdfZoom: number }` — all three types are imported by name (`../App`) from every component in Tasks 5–10. `function App(): JSX.Element`.

- [ ] **Step 1: Write the new `src/App.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type TreeEntry } from "./lib/api";
import { isEditable, kindOf } from "./lib/fileTypes";
import { TopBar } from "./components/TopBar";
import { CommandBar } from "./components/CommandBar";
import { FileTree } from "./components/FileTree";
import { Tabs } from "./components/Tabs";
import { Toolbar } from "./components/Toolbar";
import { Inspector } from "./components/Inspector";
import { Viewer } from "./components/viewers/Viewer";
import { Icon } from "./components/Icon";

export type Layout = "workspace" | "focus";

/** Editable text buffer: `content` is the working copy, `disk` the last-saved value. */
export interface Buffer {
  content: string;
  disk: string;
}

/** Per-file view controls surfaced in the toolbar. Reset when the file changes. */
export interface ViewState {
  fit: boolean;
  zoom: number;
  rotate: number;
  mdMode: "edit" | "split" | "preview";
  wrap: boolean;
  pdfZoom: number;
}

const DEFAULT_VIEW: ViewState = {
  fit: true, zoom: 1, rotate: 0, mdMode: "split", wrap: false, pdfZoom: 1,
};

const EXPANDED_KEY = "aurora:expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

export function App() {
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [filter, setFilter] = useState("");
  const [layout, setLayout] = useState<Layout>("workspace");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [pdf, setPdf] = useState({ page: 1, count: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);

  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  /* ------------------------------- Data + tree ------------------------------ */
  const refreshTree = useCallback(async () => {
    try { setEntries(await api.getTree()); } catch { /* transient — next poll retries */ }
  }, []);

  useEffect(() => {
    refreshTree();
    const id = window.setInterval(refreshTree, 5000);
    return () => clearInterval(id);
  }, [refreshTree]);

  const entryFor = useMemo(() => {
    const map = new Map(entries.map((e) => [e.path, e]));
    return (p: string | null) => (p ? map.get(p) : undefined);
  }, [entries]);

  /* ------------------------------ File actions ------------------------------ */
  const openFile = useCallback(async (path: string) => {
    setSelectedPath(path);
    setOpenTabs((t) => (t.includes(path) ? t : [...t, path]));
    setView(DEFAULT_VIEW);
    setPdf({ page: 1, count: 0 });
    if (!isEditable(kindOf(path))) return; // binary → streamed, no buffer needed
    if (buffers[path]) return;             // already loaded
    try {
      const text = await api.readFile(path);
      setBuffers((prev) => ({ ...prev, [path]: { content: text, disk: text } }));
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }, [buffers, flash]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const closeTab = useCallback((path: string) => {
    setOpenTabs((tabs) => {
      const idx = tabs.indexOf(path);
      const next = tabs.filter((p) => p !== path);
      setSelectedPath((sel) => (sel === path ? (next[idx - 1] ?? next[idx] ?? next[next.length - 1] ?? null) : sel));
      return next;
    });
  }, []);

  const buffer = selectedPath ? buffers[selectedPath] : undefined;
  const dirty = !!buffer && buffer.content !== buffer.disk;

  const setContent = useCallback((v: string) => {
    if (!selectedPath) return;
    setBuffers((b) => ({ ...b, [selectedPath]: { content: v, disk: b[selectedPath]?.disk ?? v } }));
  }, [selectedPath]);

  const save = useCallback(async () => {
    if (!selectedPath || !buffer || !dirty) return;
    try {
      // Optimistic conflict check, mirroring the original server flow.
      const latest = await api.readFile(selectedPath);
      if (latest !== buffer.disk && !window.confirm("This file changed on disk since it was loaded. Overwrite with your changes?")) {
        setBuffers((b) => ({ ...b, [selectedPath]: { ...b[selectedPath], disk: latest } }));
        return;
      }
      await api.writeFile(selectedPath, buffer.content);
      setBuffers((b) => ({ ...b, [selectedPath]: { content: buffer.content, disk: buffer.content } }));
      flash("Saved " + selectedPath.split("/").pop());
      refreshTree();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }, [selectedPath, buffer, dirty, flash, refreshTree]);

  const openInNewTab = useCallback(() => {
    if (selectedPath) window.open(api.fileUrl(selectedPath), "_blank", "noopener,noreferrer");
  }, [selectedPath]);

  const copyPath = useCallback(() => {
    if (!selectedPath) return;
    navigator.clipboard?.writeText(selectedPath).catch(() => { /* ignore */ });
    flash("Path copied");
  }, [selectedPath, flash]);

  /* ---------------------------------- CRUD ----------------------------------- */
  /** Kicks off inline creation in FileTree's root row; `creating` drives what it renders. */
  const commitCreate = useCallback(async (name: string) => {
    const kind = creating;
    setCreating(null);
    const trimmed = name.trim();
    if (!kind || !trimmed) return;
    try {
      if (kind === "dir") await api.createDir(trimmed);
      else await api.writeFile(trimmed, "");
      await refreshTree();
      if (kind === "file") openFile(trimmed);
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }, [creating, refreshTree, openFile, flash]);

  const cancelCreate = useCallback(() => setCreating(null), []);

  const renamePath = useCallback(async (from: string, to: string) => {
    try {
      await api.rename(from, to);
      setOpenTabs((tabs) => tabs.map((p) => (p === from ? to : p)));
      setBuffers((b) => {
        if (!(from in b)) return b;
        const next = { ...b };
        next[to] = next[from];
        delete next[from];
        return next;
      });
      setSelectedPath((sel) => (sel === from ? to : sel));
      await refreshTree();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }, [refreshTree, flash]);

  const deleteEntry = useCallback(async (path: string) => {
    try {
      await api.deleteFile(path);
      setOpenTabs((tabs) => tabs.filter((p) => p !== path));
      setBuffers((b) => {
        if (!(path in b)) return b;
        const next = { ...b };
        delete next[path];
        return next;
      });
      setSelectedPath((sel) => (sel === path ? null : sel));
      await refreshTree();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }, [refreshTree, flash]);

  /* --------------------------------- Keyboard ------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const patchView = useCallback((p: Partial<ViewState>) => setView((v) => ({ ...v, ...p })), []);
  const onPdfPage = useCallback((page: number, count: number) => setPdf({ page, count }), []);

  /* --------------------------------- Render --------------------------------- */
  return (
    <div className="aur" data-theme="dark">
      <TopBar
        filter={filter}
        onFilter={setFilter}
        layout={layout}
        onLayout={setLayout}
        onNewFile={() => setCreating("file")}
        onNewFolder={() => setCreating("dir")}
      />

      {layout === "focus" && (
        <CommandBar
          path={selectedPath}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((o) => !o)}
        />
      )}

      <div className="aur-body">
        <FileTree
          entries={entries}
          filter={filter}
          onFilter={setFilter}
          expanded={expanded}
          onToggle={toggleDir}
          selectedPath={selectedPath}
          onSelect={openFile}
          creating={creating}
          onCommitCreate={commitCreate}
          onCancelCreate={cancelCreate}
          onRename={renamePath}
          onDelete={deleteEntry}
        />

        <main className="aur-main">
          <Tabs
            tabs={openTabs}
            selectedPath={selectedPath}
            buffers={buffers}
            onSelect={openFile}
            onClose={closeTab}
          />

          {selectedPath ? (
            <>
              <Toolbar
                path={selectedPath}
                layout={layout}
                dirty={dirty}
                onSave={save}
                view={view}
                onView={patchView}
                pdfPage={pdf.page}
                pdfCount={pdf.count}
                onOpen={openInNewTab}
                inspectorOpen={inspectorOpen}
                onToggleInspector={() => setInspectorOpen((o) => !o)}
              />
              <div className="aur-content">
                <Viewer
                  key={selectedPath}
                  path={selectedPath}
                  buffer={buffer}
                  onChange={setContent}
                  view={view}
                  onPdfPage={onPdfPage}
                />
              </div>
            </>
          ) : (
            <div className="aur-content">
              <div className="aur-empty">
                <Icon name="uil:file-search-alt" size={52} color="var(--e3)" />
                <div>Select a file to view or edit</div>
              </div>
            </div>
          )}
        </main>

        {selectedPath && inspectorOpen && (
          <Inspector
            path={selectedPath}
            entry={entryFor(selectedPath)}
            buffer={buffer}
            isFocus={layout === "focus"}
            onClose={() => setInspectorOpen(false)}
            onOpen={openInNewTab}
            onCopyPath={copyPath}
          />
        )}
      </div>

      {toast && (
        <div className="aur-toast">
          <Icon name="uil:check-circle" size={18} color="var(--positive)" />
          {toast}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Note the expected typecheck state**

Run: `bunx tsc --noEmit`
Expected: errors referencing `./components/TopBar` and `./components/FileTree` not matching this new shape yet (they're replaced in Tasks 9–10). No error should originate from `src/App.tsx`'s own syntax/types.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: replace App with Aurora orchestrator, add create/rename/delete state"
```

---

### Task 9: Replace `TopBar.tsx` — wire the "New" button to file/folder creation

Aurora's reference `TopBar.tsx` has a "New" button with no `onClick` at all. This task turns it into a two-item dropdown that calls the `onNewFile`/`onNewFolder` props `App.tsx` (Task 8) already passes in.

**Files:**
- Modify (full replace): `src/components/TopBar.tsx`

**Interfaces:**
- Consumes: `Layout` from `../App`, `Icon` from `./Icon`.
- Produces: `interface TopBarProps { filter: string; onFilter: (v: string) => void; layout: Layout; onLayout: (l: Layout) => void; onNewFile: () => void; onNewFolder: () => void }`, `function TopBar(props: TopBarProps): JSX.Element`.

- [ ] **Step 1: Write the new `src/components/TopBar.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { Layout } from "../App";

export interface TopBarProps {
  filter: string;
  onFilter: (v: string) => void;
  layout: Layout;
  onLayout: (l: Layout) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}

export function TopBar({ filter, onFilter, layout, onLayout, onNewFile, onNewFolder }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <header className="aur-top">
      <div className="aur-brand">
        <div className="aur-brand__mark"><span /></div>
        <div className="aur-brand__name">Aurora <b>Files</b></div>
      </div>

      <div className="aur-spacer" />

      <div className="aur-search">
        <Icon name="uil:search" size={17} />
        <input
          placeholder="Search files and content…"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
        />
        <span className="aur-kbd">⌘K</span>
      </div>

      <div className="aur-seg">
        <button className={layout === "workspace" ? "is-active" : ""} onClick={() => onLayout("workspace")}>Workspace</button>
        <button className={layout === "focus" ? "is-active" : ""} onClick={() => onLayout("focus")}>Focus</button>
      </div>

      <div className="aur-newmenu">
        <button className="aur-btn" onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}>
          <Icon name="uil:plus" size={17} /> New
        </button>
        {menuOpen && (
          <div className="aur-ctxmenu aur-ctxmenu--under" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setMenuOpen(false); onNewFile(); }}>
              <Icon name="uil:file-plus-alt" size={14} /> New File
            </button>
            <button onClick={() => { setMenuOpen(false); onNewFolder(); }}>
              <Icon name="uil:folder-plus" size={14} /> New Folder
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "feat: wire TopBar New button to file/folder creation"
```

---

### Task 10: Replace `FileTree.tsx` — reinstate rename/delete via context menu, plus inline creation row

**Files:**
- Modify (full replace): `src/components/FileTree.tsx`

**Interfaces:**
- Consumes: `TreeEntry` from `../lib/api`, `baseName`/`colorFor`/`iconFor` from `../lib/fileTypes`, `Icon` from `./Icon`, and the CRUD props `App.tsx` (Task 8) already passes: `creating`, `onCommitCreate`, `onCancelCreate`, `onRename`, `onDelete`.
- Produces: `function FileTree(props: FileTreeProps): JSX.Element` — same tree-building/filtering behavior as Aurora's reference, plus a right-click (and hover "⋮" button) context menu with Rename/Delete, and an inline create row at the top of the list when `creating` is non-null.

- [ ] **Step 1: Write the new `src/components/FileTree.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeEntry } from "../lib/api";
import { baseName, colorFor, iconFor } from "../lib/fileTypes";
import { Icon } from "./Icon";

export interface FileTreeProps {
  entries: TreeEntry[];
  filter: string;
  onFilter: (v: string) => void;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  creating: "file" | "dir" | null;
  onCommitCreate: (name: string) => void;
  onCancelCreate: () => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
}

interface Node {
  name: string;
  path: string;
  isDir: boolean;
  children: Node[];
}

interface FlatRow {
  node: Node;
  depth: number;
  expanded: boolean;
}

interface MenuState {
  path: string;
  isDir: boolean;
  x: number;
  y: number;
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
  const sortNode = (n: Node) => {
    n.children.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}

export function FileTree({
  entries, filter, onFilter, expanded, onToggle, selectedPath, onSelect,
  creating, onCommitCreate, onCancelCreate, onRename, onDelete,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(entries), [entries]);
  const q = filter.trim().toLowerCase();

  const matches = useMemo(() => {
    const fn = (node: Node): boolean => {
      if (!q) return true;
      if (node.name.toLowerCase().includes(q)) return true;
      return node.children.some(fn);
    };
    return fn;
  }, [q]);

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    const walk = (nodes: Node[], depth: number) => {
      for (const node of nodes) {
        if (!matches(node)) continue;
        const isOpen = expanded.has(node.path) || (!!q && node.isDir);
        out.push({ node, depth, expanded: isOpen });
        if (node.isDir && isOpen) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, expanded, q, matches]);

  const fileCount = entries.filter((e) => !e.isDir).length;

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createValue, setCreateValue] = useState("");
  const createRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  useEffect(() => {
    if (creating) {
      setCreateValue("");
      requestAnimationFrame(() => createRef.current?.focus());
    }
  }, [creating]);

  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => { renameRef.current?.focus(); renameRef.current?.select(); });
    }
  }, [renaming]);

  const openMenu = (e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ path, isDir, x: e.clientX, y: e.clientY });
  };

  const startRename = (path: string) => {
    setMenu(null);
    setRenaming(path);
    setRenameValue(baseName(path));
  };

  const commitRename = (path: string) => {
    const name = renameValue.trim();
    setRenaming(null);
    if (!name || name === baseName(path)) return;
    const parts = path.split("/");
    parts[parts.length - 1] = name;
    onRename(path, parts.join("/"));
  };

  const requestDelete = (path: string, isDir: boolean) => {
    setMenu(null);
    if (isDir) return;
    if (window.confirm(`Delete ${baseName(path)}? This cannot be undone.`)) onDelete(path);
  };

  const commitCreateRow = () => {
    const name = createValue.trim();
    if (!name) { onCancelCreate(); return; }
    onCommitCreate(name);
  };

  return (
    <aside className="aur-tree">
      <div className="aur-tree__filter">
        <div className="aur-tree__filterbox">
          <Icon name="uil:filter" size={15} />
          <input placeholder="Filter files…" value={filter} onChange={(e) => onFilter(e.target.value)} />
        </div>
      </div>

      <div className="aur-tree__head">
        <span className="aur-overline">Explorer</span>
      </div>

      <div className="aur-tree__list">
        {creating && (
          <div className="aur-row aur-row--create" style={{ paddingLeft: 10 + (creating === "dir" ? 0 : 22) }}>
            <Icon
              className="aur-row__icon"
              name={creating === "dir" ? "uil:folder" : "uil:file-alt"}
              size={16}
              color={creating === "dir" ? "#c7a15a" : "#9aa3b0"}
            />
            <input
              ref={createRef}
              className="aur-row__input"
              value={createValue}
              placeholder={creating === "dir" ? "New folder name" : "New file name"}
              onChange={(e) => setCreateValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={onCancelCreate}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreateRow();
                if (e.key === "Escape") onCancelCreate();
              }}
            />
          </div>
        )}

        {rows.map(({ node, depth, expanded: isOpen }) => (
          <div
            key={node.path}
            className={`aur-row${selectedPath === node.path ? " is-selected" : ""}`}
            style={{ paddingLeft: 10 + depth * 14 + (node.isDir ? 0 : 22) }}
            onClick={() => (renaming === node.path ? undefined : node.isDir ? onToggle(node.path) : onSelect(node.path))}
            onContextMenu={(e) => openMenu(e, node.path, node.isDir)}
          >
            {node.isDir && (
              <Icon
                className="aur-row__chev"
                name={isOpen ? "uil:angle-down" : "uil:angle-right"}
                size={15}
                color="var(--text-light)"
              />
            )}
            <Icon
              className="aur-row__icon"
              name={iconFor(node.path, node.isDir, isOpen)}
              size={16}
              color={colorFor(node.path, node.isDir)}
            />
            {renaming === node.path ? (
              <input
                ref={renameRef}
                className="aur-row__input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(node.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(node.path);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span className="aur-row__name">{baseName(node.path)}</span>
            )}
            <button
              className="aur-row__more"
              onClick={(e) => openMenu(e, node.path, node.isDir)}
              title="More actions"
            >
              <Icon name="uil:ellipsis-v" size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="aur-tree__foot">{fileCount} files</div>

      {menu && (
        <div className="aur-ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => startRename(menu.path)}>
            <Icon name="uil:edit-alt" size={14} /> Rename
          </button>
          <button
            className="is-danger"
            disabled={menu.isDir}
            title={menu.isDir ? "Directory delete isn't supported yet" : undefined}
            onClick={() => requestDelete(menu.path, menu.isDir)}
          >
            <Icon name="uil:trash-alt" size={14} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/FileTree.tsx
git commit -m "feat: reinstate rename/delete via FileTree context menu, add inline create row"
```

---

### Task 11: Replace `styles.css`, add CSS for the context menu and inline rows

**Files:**
- Modify (full replace): `src/styles.css`

**Interfaces:**
- Consumes: none (pure CSS).
- Produces: the `.aur-*` class names every component from Tasks 5–10 renders with, plus new classes `.aur-ctxmenu`, `.aur-ctxmenu--under`, `.aur-newmenu`, `.aur-row__more`, `.aur-row__input`, `.aur-row--create` used by Tasks 9–10's new markup.

- [ ] **Step 1: Copy Aurora's stylesheet verbatim**

```bash
cp implementation/src/styles.css src/styles.css
```

- [ ] **Step 2: Append the new rules for the context menu and inline create/rename rows**

Add this block to the end of `src/styles.css`:

```css

/* ================================ Additions ================================
   Context menu (rename/delete on FileTree rows, New-file/New-folder on TopBar)
   and inline create/rename inputs — not present in the original Aurora design,
   added to reinstate CRUD functionality.
   ========================================================================== */

.aur-newmenu { position: relative; }

.aur-ctxmenu {
  position: fixed; z-index: 50; min-width: 160px; padding: 6px;
  background: var(--e1); border: 1px solid var(--border); border-radius: var(--rm);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .45); display: flex; flex-direction: column; gap: 2px;
}
.aur-ctxmenu--under { position: absolute; top: 44px; right: 16px; left: auto; }
.aur-ctxmenu button {
  display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px;
  border: none; background: transparent; color: var(--text-body); font-size: 12.5px;
  border-radius: var(--r); cursor: pointer; text-align: left; font-family: inherit;
}
.aur-ctxmenu button:hover { background: var(--e2); }
.aur-ctxmenu button:disabled { color: var(--text-light); cursor: not-allowed; }
.aur-ctxmenu button:disabled:hover { background: transparent; }
.aur-ctxmenu button.is-danger { color: #ff8a80; }
.aur-ctxmenu button.is-danger:hover { background: rgba(244, 67, 54, .12); }

.aur-row { position: relative; }
.aur-row__more {
  margin-left: auto; flex: none; width: 22px; height: 22px; border: none; background: transparent;
  color: var(--text-light); border-radius: 5px; display: none; align-items: center; justify-content: center; cursor: pointer;
}
.aur-row:hover .aur-row__more { display: inline-flex; }
.aur-row__more:hover { background: var(--e2); color: var(--text); }
.aur-row__input {
  flex: 1; min-width: 0; background: var(--e0); border: 1px solid var(--accent); border-radius: 5px;
  color: var(--text); font-size: 13px; font-family: inherit; padding: 2px 6px;
}
.aur-row--create { cursor: default; }
```

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "feat: add Aurora stylesheet plus context-menu/inline-input styles"
```

---

### Task 12: Remove the superseded old components; typecheck and manually smoke-test the frontend

**Files:**
- Delete: `src/components/FileEditor.tsx`
- Delete: `src/components/ImagePreview.tsx`
- Delete: `src/components/MarkdownPreview.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only removes dead code now that `Viewer.tsx` (Task 6) covers text/image/markdown rendering.

- [ ] **Step 1: Confirm nothing still imports the old components**

Run: `grep -rn "FileEditor\|ImagePreview\|MarkdownPreview" src/`
Expected: no output (only `App.tsx` used to import them, and Task 8 already replaced `App.tsx`).

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/FileEditor.tsx src/components/ImagePreview.tsx src/components/MarkdownPreview.tsx
```

- [ ] **Step 3: Typecheck the whole frontend**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove FileEditor/ImagePreview/MarkdownPreview, superseded by Viewer"
```

(Manual smoke-testing of the running app happens in Task 14, after the backend changes in Task 13 land — video/audio/PDF viewers need the backend's Range/content-type behavior and the local PDF worker route to actually work.)

---

### Task 13: Backend — file metadata, a locally-served PDF worker, and a Range-request regression test

Empirically verified during planning (against this exact Bun version): `Bun.file()`-backed `Response`s already return the correct `Content-Type` per extension (`video/mp4`, `image/png`, `application/pdf`, etc.) and already honor `Range` request headers (a `Range: bytes=0-3` request returns `206` with correct `Content-Range`/`Content-Length`/body). **No changes to the `GET /api/file` handler are needed for streaming** — this task only adds a regression test that locks that behavior in, plus the `size`/`mtime` addition to `/api/tree` and the new PDF worker route.

**Files:**
- Modify: `server.ts`
- Modify: `server.test.ts`

**Interfaces:**
- Consumes: `stat` (already imported in `server.ts`).
- Produces: `/api/tree` entries now include `size?: number` (file size in bytes, omitted for directories) and `mtime: number` (epoch ms) — matching `TreeEntry`'s optional fields from Task 4's `lib/api.ts`. New route `GET /pdf.worker.min.mjs` serves the pdf.js worker script.

- [ ] **Step 1: Update the failing test for `/api/tree`'s new fields first**

In `server.test.ts`, replace:

```ts
describe("/api/tree", () => {
  it("lists files under root", async () => {
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ path: "hello.txt", isDir: false }]);
  });
});
```

with:

```ts
describe("/api/tree", () => {
  it("lists files under root, including size and mtime", async () => {
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].path).toBe("hello.txt");
    expect(body[0].isDir).toBe(false);
    expect(body[0].size).toBe(2); // "hi" is 2 bytes
    expect(typeof body[0].mtime).toBe("number");
  });

  it("omits size for directories", async () => {
    mkdirSync(join(root, "subdir"));
    const res = await fetch(`${base}/api/tree`);
    const body = await res.json();
    const dir = body.find((e: any) => e.path === "subdir");
    expect(dir.isDir).toBe(true);
    expect(dir.size).toBeUndefined();
    expect(typeof dir.mtime).toBe("number");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test server.test.ts`
Expected: `FAIL` — `body[0].size` is `undefined`, not `2` (current `listTree` doesn't stat entries yet).

- [ ] **Step 3: Update `listTree` in `server.ts` to stat each entry**

Replace:

```ts
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
```

with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test server.test.ts`
Expected: `PASS`, all tests in the file green.

- [ ] **Step 5: Add the Range-request regression test**

In `server.test.ts`, add to the `describe("/api/file", ...)` block:

```ts
  it("supports Range requests for streaming (video/audio/PDF scrubbing)", async () => {
    writeFileSync(join(root, "data.bin"), Buffer.from("0123456789"));
    const res = await fetch(`${base}/api/file?path=data.bin`, { headers: { Range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(await res.text()).toBe("0123");
  });

  it("infers Content-Type from the file extension", async () => {
    writeFileSync(join(root, "clip.mp4"), Buffer.from("fake"));
    const res = await fetch(`${base}/api/file?path=clip.mp4`);
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });
```

- [ ] **Step 6: Run the tests to verify they pass without any handler changes**

Run: `bun test server.test.ts`
Expected: `PASS` — confirms Bun's default `Bun.file`-backed `Response` already satisfies both, exactly as verified during planning.

- [ ] **Step 7: Add the local PDF worker route**

`react-pdf`/`pdfjs-dist` must already be installed (Task 1) for this import to resolve. At the top of `server.ts`, add:

```ts
import pdfWorkerPath from "pdfjs-dist/build/pdf.worker.min.mjs" with { type: "file" };
```

In `createServer`'s `routes` object (alongside `"/"` and the `/api/*` entries), add:

```ts
      "/pdf.worker.min.mjs": {
        async GET() {
          return new Response(Bun.file(pdfWorkerPath));
        },
      },
```

- [ ] **Step 8: Add a test for the new route**

In `server.test.ts`, add a new top-level `describe`:

```ts
describe("/pdf.worker.min.mjs", () => {
  it("serves the pdf.js worker script", async () => {
    const res = await fetch(`${base}/pdf.worker.min.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 9: Run the full test suite**

Run: `bun test`
Expected: all tests pass (the original 19, plus the new ones added in this task).

- [ ] **Step 10: Commit**

```bash
git add server.ts server.test.ts
git commit -m "feat: add file size/mtime to /api/tree, serve pdf.js worker locally"
```

---

### Task 14: Remove the reference `implementation/` directory; final manual verification

**Files:**
- Delete: `implementation/` (entire directory — its content now lives in `src/`, keeping it around would be dead reference material inside the repo)

**Interfaces:** none — this is cleanup plus manual QA, no code interfaces produced.

- [ ] **Step 1: Delete the reference directory**

```bash
rm -rf implementation
git add -A implementation
git commit -m "chore: remove implementation/ reference directory, now merged into src/"
```

- [ ] **Step 2: Start the app**

Run: `bun run dev -- /tmp/some-test-folder` (or any local folder with a mix of file types — text, an image, a markdown file, and ideally a small mp4/mp3/pdf to exercise every viewer)

- [ ] **Step 3: Manually verify each of the following (check off as confirmed)**

- [ ] File tree loads and shows type-colored icons
- [ ] Clicking a text file opens it in a tab, editing it flips the dirty dot, ⌘/Ctrl+S saves
- [ ] Opening the same file externally-modified while dirty triggers the overwrite-confirmation prompt
- [ ] Markdown file: Edit/Split/Preview toggle all render correctly
- [ ] Image file: fit/1:1/zoom/rotate controls work
- [ ] Video file (if available): plays, scrubber seeks, volume/mute/speed/fullscreen work
- [ ] Audio file (if available): plays, waveform seek works
- [ ] PDF file (if available): thumbnail rail + continuous scroll render, zoom works, and the browser's Network tab shows `/pdf.worker.min.mjs` loading from the local server (not a CDN)
- [ ] TopBar "New" → "New File" creates a file at root, opens it for editing
- [ ] TopBar "New" → "New Folder" creates a folder at root
- [ ] Right-click a file row → "Rename" renames it; open tabs/selection follow the rename
- [ ] Right-click a file row → "Delete" (after confirming) removes it; if it was open, the tab closes
- [ ] Right-click a directory row → "Delete" is visibly disabled
- [ ] Workspace ↔ Focus layout toggle both render correctly, including the Focus-only CommandBar
- [ ] Inspector panel shows Type/Size/Modified/Path (and Lines for text files) and toggles open/closed

- [ ] **Step 4: Report results**

If every item above passes, the migration is complete. If any item fails, treat it as a bug against the specific task that introduced the affected component and fix there rather than patching around it in `App.tsx`.
