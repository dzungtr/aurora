import type { TreeEntry } from "../lib/api";
import type { Buffer } from "../App";
import {
  baseName, colorFor, formatBytes, formatDate, iconFor, kindLabel, kindOf,
} from "../lib/fileTypes";
import { Icon } from "./Icon";

export interface InspectorProps {
  path: string;
  entry?: TreeEntry;
  buffer?: Buffer;
  isFocus: boolean;
  onClose: () => void;
  onOpen: () => void;
  onCopyPath: () => void;
}

/** Compact metadata panel — no preview thumbnail. Togglable from the toolbar. */
export function Inspector({ path, entry, buffer, isFocus, onClose, onOpen, onCopyPath }: InspectorProps) {
  const kind = kindOf(path);
  const lines = buffer ? buffer.content.split("\n").length : undefined;

  const rows: { k: string; v: string }[] = [
    { k: "Type", v: kindLabel(kind) },
    { k: "Size", v: formatBytes(entry?.size) },
    { k: "Modified", v: formatDate(entry?.mtime) },
  ];
  if (lines != null) rows.push({ k: "Lines", v: String(lines) });
  rows.push({ k: "Path", v: path });

  return (
    <aside className="aur-insp">
      <div className="aur-insp__head">
        <span className="aur-overline">Details</span>
        {isFocus && (
          <button className="aur-iconbtn aur-iconbtn--plain" onClick={onClose} title="Close">
            <Icon name="uil:times" size={16} />
          </button>
        )}
      </div>

      <div className="aur-insp__title">
        <Icon name={iconFor(path, false)} size={20} color={colorFor(path, false)} />
        <span className="aur-insp__name">{baseName(path)}</span>
      </div>

      <div className="aur-insp__meta">
        {rows.map((r) => (
          <div className="aur-insp__row" key={r.k}>
            <span className="k">{r.k}</span>
            <span className="v">{r.v}</span>
          </div>
        ))}
      </div>

      <div className="aur-insp__actions">
        <button onClick={onOpen}><Icon name="uil:external-link-alt" size={16} /> Open in new tab</button>
        <button onClick={onCopyPath}><Icon name="uil:copy" size={16} /> Copy path</button>
      </div>
    </aside>
  );
}
