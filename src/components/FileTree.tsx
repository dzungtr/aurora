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
    const raw = localStorage.getItem("zui-explorer:expanded");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>) {
  localStorage.setItem("zui-explorer:expanded", JSON.stringify([...expanded]));
}

function loadWidth(): number {
  const raw = localStorage.getItem("zui-explorer:sidebar-width");
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
        localStorage.setItem("zui-explorer:sidebar-width", String(w));
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
