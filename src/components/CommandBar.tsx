import { Icon } from "./Icon";
import { Breadcrumb } from "./Breadcrumb";

export interface CommandBarProps {
  path: string | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

/** Full-width breadcrumb + actions bar shown only in the Focus layout. */
export function CommandBar({ path, inspectorOpen, onToggleInspector }: CommandBarProps) {
  return (
    <div className="aur-cmd">
      <Icon name="uil:location-arrow" size={16} color="var(--text-light)" />
      {path ? <Breadcrumb path={path} /> : <span className="aur-crumb">No file selected</span>}
      <div className="aur-spacer" />
      <button
        className={`aur-iconbtn${inspectorOpen ? " is-active" : ""}`}
        onClick={onToggleInspector}
        title="Toggle details"
      >
        <Icon name="uil:info-circle" size={18} />
      </button>
    </div>
  );
}
