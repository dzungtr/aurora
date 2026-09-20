// Session list page: title, artifact count, last activity, newest first
// (server already sorts by last_activity desc).

import { useEffect, useState } from "react";
import { previewApi, type SessionWithCount, previewUrl } from "./previewApi";
import { Icon } from "../components/Icon";

function fmtActivity(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const d = new Date();
  const mins = Math.max(0, Math.round((d.getTime() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

export function SessionList() {
  const [sessions, setSessions] = useState<SessionWithCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    previewApi
      .listSessions()
      .then((s) => alive && setSessions(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, []);

  return (
    <div className="aur-preview">
      <header className="aur-preview__top">
        <div className="aur-brand">
          <div className="aur-brand__mark"><span /></div>
          <div className="aur-brand__name">Aurora <b>Artifacts</b></div>
        </div>
        <div className="aur-spacer" />
        <a className="aur-btn" href="/">Files</a>
      </header>

      <div className="aur-preview__body">
        <h2 className="aur-preview__h">Sessions</h2>
        {error && <p className="aur-preview__error">{error}</p>}
        {sessions === null && !error && <p className="aur-preview__empty">Loading…</p>}
        {sessions !== null && sessions.length === 0 && (
          <p className="aur-preview__empty">No artifact sessions yet. Agents push via the MCP endpoint at <code className="md-code">/mcp</code>.</p>
        )}
        <div className="aur-sesslist">
          {(sessions ?? []).map((s) => (
            <a key={s.session_id} className="aur-sessrow" href={previewUrl(s.session_id)}>
              <div className="aur-sessrow__icon"><Icon name="uil:layers" size={18} /></div>
              <div className="aur-sessrow__main">
                <div className="aur-sessrow__title">{s.title}</div>
                <div className="aur-sessrow__sub">{s.session_id}</div>
              </div>
              <div className="aur-sessrow__meta">
                <span className="aur-sessrow__count">{s.artifact_count} artifact{s.artifact_count === 1 ? "" : "s"}</span>
                <span className="aur-sessrow__time">{fmtActivity(s.last_activity)}</span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
