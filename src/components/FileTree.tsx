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
