// Feed toolbar (spec #98 M13, D23): type chip, title, "updated HH:MM", then the
// action buttons. Live is the shared per-channel follow toggle (D7), so it
// reads and writes through useArtifactStack, never its own state.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Icon } from "../components/Icon";
import { feedPath } from "../../lib/routePaths";
import { navigate, previewUrl, type Artifact } from "./previewApi";
import { fmtUpdated } from "./feedModel";
import { typeMeta } from "./StackView";
import { useTheme } from "../lib/themeStore";

export interface FeedToolbarProps {
  sessionId: string;
  current: Artifact | null;
  follow: boolean;
  onToggleFollow: () => void;
}

const COPIED_MS = 1400;

export function FeedToolbar({ sessionId, current, follow, onToggleFollow }: FeedToolbarProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copyLink = () => {
    if (!current) return;
    navigator.clipboard?.writeText(window.location.origin + feedPath(sessionId, current.artifact_id)).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const stackHref = previewUrl(sessionId, current?.artifact_id);
  // In-app navigation keeps the module-level follow state; a full load would reset it.
  const openInStack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(stackHref);
  };

  const t = current ? typeMeta(current.type, theme) : null;
  return (
    <div className="aur-feed__toolbar">
      {current && t && (
        <>
          <span className="aur-stack3__typechip" style={{ background: t.color + "22", color: t.color }}>
            <Icon name={t.icon} size={13} /> {t.label}
          </span>
          <span className="aur-stack3__artifacttitle">{current.title}</span>
          <span className="aur-feed__updated">updated {fmtUpdated(current.updated_at)}</span>
        </>
      )}
      <div className="aur-feed__toolbarfill" />
      <button
        className={"aur-stack3__ghostbtn" + (follow ? " is-on" : "")}
        onClick={onToggleFollow}
        title="Auto-advance to newest artifact"
      >
        <Icon name={follow ? "uil:play-circle" : "uil:pause-circle"} size={15} /> Live
      </button>
      {/* #103 adds the Program button here, between Live and Copy link. */}
      <button className="aur-stack3__ghostbtn" onClick={copyLink} disabled={!current}>
        <Icon name={copied ? "uil:check" : "uil:link"} size={15} /> {copied ? "Copied" : "Copy link"}
      </button>
      <a className="aur-stack3__ghostbtn" href={stackHref} onClick={openInStack}>
        <Icon name="uil:layer-group" size={15} /> Open in stack
      </a>
    </div>
  );
}
