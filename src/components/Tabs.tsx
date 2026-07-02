import type { Buffer } from "../App";
import { baseName, colorFor, iconFor } from "../lib/fileTypes";
import { Icon } from "./Icon";

export interface TabsProps {
  tabs: string[];
  selectedPath: string | null;
  buffers: Record<string, Buffer>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function Tabs({ tabs, selectedPath, buffers, onSelect, onClose }: TabsProps) {
  return (
    <div className="aur-tabs">
      {tabs.map((path) => {
        const active = path === selectedPath;
        const buf = buffers[path];
        const dirty = !!buf && buf.content !== buf.disk;
        return (
          <div
            key={path}
            className={`aur-tab${active ? " is-active" : ""}`}
            onClick={() => onSelect(path)}
          >
            <Icon name={iconFor(path, false)} size={14} color={colorFor(path, false)} />
            <span className="aur-tab__name">{baseName(path)}</span>
            {dirty && <span className="aur-tab__dot" />}
            <span
              className="aur-tab__close"
              onClick={(e) => { e.stopPropagation(); onClose(path); }}
            >
              <Icon name="uil:times" size={13} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
