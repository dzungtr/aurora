import type { Layout, ViewState } from "../App";
import { baseName, colorFor, iconFor, kindOf } from "../lib/fileTypes";
import { Icon } from "./Icon";
import { Breadcrumb } from "./Breadcrumb";

export interface ToolbarProps {
  path: string;
  layout: Layout;
  dirty: boolean;
  onSave: () => void;
  view: ViewState;
  onView: (patch: Partial<ViewState>) => void;
  pdfPage: number;
  pdfCount: number;
  onOpen: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function Toolbar({
  path, layout, dirty, onSave, view, onView, pdfPage, pdfCount, onOpen, inspectorOpen, onToggleInspector,
}: ToolbarProps) {
  const kind = kindOf(path);

  return (
    <div className="aur-toolbar">
      <span className={`aur-dot${dirty ? " is-dirty" : ""}`} />

      {layout === "workspace"
        ? <Breadcrumb path={path} />
        : (
          <>
            <Icon name={iconFor(path, false)} size={17} color={colorFor(path, false)} />
            <span className="aur-filename">{baseName(path)}</span>
          </>
        )}

      <div className="aur-spacer" />

      {/* Text / code controls */}
      {(kind === "code" || kind === "css" || kind === "json" || kind === "text") && (
        <>
          <button
            className={`aur-iconbtn${view.wrap ? " is-active" : ""}`}
            onClick={() => onView({ wrap: !view.wrap })}
            title="Toggle word wrap"
          >
            <Icon name="uil:align-left" size={17} />
          </button>
          <SaveButton dirty={dirty} onSave={onSave} />
        </>
      )}

      {/* Markdown controls */}
      {kind === "markdown" && (
        <>
          <div className="aur-seg" style={{ height: 32 }}>
            {(["edit", "split", "preview"] as const).map((m) => (
              <button key={m} className={view.mdMode === m ? "is-active" : ""} onClick={() => onView({ mdMode: m })}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <SaveButton dirty={dirty} onSave={onSave} />
        </>
      )}

      {/* Image controls */}
      {kind === "image" && (
        <>
          <div className="aur-zoom">
            <button onClick={() => onView({ fit: false, zoom: clamp((view.fit ? 1 : view.zoom) - 0.25, 0.25, 5) })}><Icon name="uil:search-minus" size={17} /></button>
            <span className="aur-zoom__val">{view.fit ? "Fit" : Math.round(view.zoom * 100) + "%"}</span>
            <button onClick={() => onView({ fit: false, zoom: clamp((view.fit ? 1 : view.zoom) + 0.25, 0.25, 5) })}><Icon name="uil:search-plus" size={17} /></button>
          </div>
          <button className={`aur-pill${view.fit ? " is-active" : ""}`} onClick={() => onView({ fit: true, zoom: 1 })}>Fit</button>
          <button className="aur-pill" onClick={() => onView({ fit: false, zoom: 1 })}>1:1</button>
          <button className="aur-iconbtn" onClick={() => onView({ rotate: (view.rotate + 90) % 360 })} title="Rotate"><Icon name="uil:redo" size={16} /></button>
        </>
      )}

      {/* PDF controls */}
      {kind === "pdf" && (
        <>
          <div className="aur-zoom">
            <button onClick={() => onView({ pdfZoom: clamp(+(view.pdfZoom - 0.15).toFixed(2), 0.5, 2) })}><Icon name="uil:search-minus" size={17} /></button>
            <span className="aur-zoom__val">{Math.round(view.pdfZoom * 100) + "%"}</span>
            <button onClick={() => onView({ pdfZoom: clamp(+(view.pdfZoom + 0.15).toFixed(2), 0.5, 2) })}><Icon name="uil:search-plus" size={17} /></button>
          </div>
          <span className="aur-time" style={{ minWidth: 0 }}>Page {pdfPage} / {pdfCount || "–"}</span>
        </>
      )}

      <div className="aur-divider" />
      <button className="aur-iconbtn" onClick={onOpen} title="Open in new tab"><Icon name="uil:external-link-alt" size={16} /></button>
      <button className={`aur-iconbtn${inspectorOpen ? " is-active" : ""}`} onClick={onToggleInspector} title="Toggle details"><Icon name="uil:info-circle" size={16} /></button>
    </div>
  );
}

function SaveButton({ dirty, onSave }: { dirty: boolean; onSave: () => void }) {
  return (
    <button className={`aur-save${dirty ? " is-dirty" : ""}`} onClick={dirty ? onSave : undefined}>
      <Icon name="uil:save" size={16} /> Save
    </button>
  );
}
