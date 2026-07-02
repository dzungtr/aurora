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
