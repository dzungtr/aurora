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
import { PreviewApp } from "./preview/PreviewApp";
import { parsePreviewPath, onRouteChange } from "./preview/previewApi";

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

/** Client-side route: re-parsed on popstate and in-app navigate. */
function useRoutePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => onRouteChange(() => setPath(window.location.pathname)), []);
  return path;
}

export function App() {
  const path = useRoutePath();
  const isPreview = parsePreviewPath(path) !== null;
  if (isPreview) return <PreviewApp key={path} />;
  return <ExplorerApp />;
}

function ExplorerApp() {
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
