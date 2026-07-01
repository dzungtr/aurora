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
