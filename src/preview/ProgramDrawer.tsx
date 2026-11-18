// Program drawer (spec #98 M17, D8): the open UI artifact's OpenUI Lang source,
// read-only and uncoloured. The source is `current.content` already in memory,
// so opening the drawer makes no request.

import { useEffect } from "react";
import { Icon } from "../components/Icon";
import { countStatements, MAX_STATEMENTS, MAX_STRING_LENGTH } from "../../lib/openuiLibrary";

export interface ProgramDrawerProps {
  source: string;
  onClose: () => void;
}

export const isProgramKey = (key: string) => key === "Escape";

export function ProgramDrawer({ source, onClose }: ProgramDrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isProgramKey(e.key)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="aur-feed__drawer" aria-label="OpenUI program">
      <div className="aur-feed__drawerhead">
        <span className="aur-feed__drawertitle">OpenUI program</span>
        <button className="aur-feed__asidebtn" onClick={onClose} aria-label="Close program" title="Close">
          <Icon name="uil:times" size={15} />
        </button>
      </div>
      <pre className="aur-feed__drawerbody">{source}</pre>
      <div className="aur-feed__drawerfoot">
        {countStatements(source)} / {MAX_STATEMENTS} statements · max {MAX_STRING_LENGTH} chars / string
      </div>
    </aside>
  );
}
