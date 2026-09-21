// Shared header for the preview surface: brand, Files/Artifacts nav (with a
// real unread badge summed across sessions), and the same-origin MCP
// connection pill. The endpoint is always "connected" — this page loaded
// from that same server, so there is nothing to health-check.

import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { totalUnread, useUnreadCounts } from "./unreadStore";

export function PreviewTopBar() {
  const unread = totalUnread(useUnreadCounts());
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copyEndpoint = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/mcp`).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <header className="aur-preview__top">
      <div className="aur-brand">
        <div className="aur-brand__mark"><span /></div>
        <div className="aur-brand__name">Aurora</div>
      </div>

      <nav className="aur-preview__nav">
        <a className="aur-preview__navlink" href="/">
          <Icon name="uil:folder" size={16} /> Files
        </a>
        <a className="aur-preview__navlink is-active" href="/preview">
          <Icon name="uil:presentation-play" size={16} /> Artifacts
          {unread > 0 && <span className="aur-preview__navbadge">{unread}</span>}
        </a>
      </nav>

      <div className="aur-spacer" />

      <div className="aur-conn">
        <span className="aur-conn__dot" />
        <code className="aur-conn__ep">{window.location.host}/mcp</code>
        <button
          className={"aur-conn__copy" + (copied ? " is-copied" : "")}
          onClick={copyEndpoint}
          title="Copy MCP endpoint"
        >
          <Icon name={copied ? "uil:check" : "uil:copy"} size={14} />
        </button>
      </div>
    </header>
  );
}
