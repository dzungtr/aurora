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
