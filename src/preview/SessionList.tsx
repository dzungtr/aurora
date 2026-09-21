// Session list page: sessions + a "Connect an Agent" sidebar card. Session
// rows use one consistent icon/style — the data model carries no per-session
// agent identity or live signal to differentiate on (see StackView's rail for
// the real unread badge; the mockup's per-row "Live" pill has no real
// counterpart and is intentionally dropped here).

import { useEffect, useState, type MouseEvent } from "react";
import { previewApi, type SessionWithCount, previewUrl } from "./previewApi";
import { onArtifactEvent } from "./liveSocket";
import { Icon } from "../components/Icon";
import { PreviewTopBar } from "./PreviewTopBar";

const TOOLS = ["push_markdown", "push_mermaid", "push_image", "push_video", "push_chart"];

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

function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => { /* best-effort */ });
}

export function SessionList() {
  const [sessions, setSessions] = useState<SessionWithCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    let alive = true;
    const refresh = () =>
      previewApi
        .listSessions()
        .then((s) => alive && setSessions(s))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    refresh();
    // Live updates: artifact counts / last activity stay fresh without reload.
    const unsub = onArtifactEvent(() => refresh());
    return () => { alive = false; unsub(); };
  };

  useEffect(load, []);

  const remove = async (e: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this session and all its artifacts from disk?")) return;
    try {
      await previewApi.deleteSession(sessionId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const endpoint = `${window.location.origin}/mcp`;

  return (
    <div className="aur-preview">
      <PreviewTopBar />

      <div className="aur-preview__body">
        <div className="aur-sesspage">
          <div className="aur-sesspage__main">
            <div className="aur-sesspage__head">
              <h1 className="aur-preview__h">Sessions</h1>
              {sessions && (
                <span className="aur-sesspage__count">
                  {sessions.length} session{sessions.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="aur-sesspage__sub">Artifacts pushed by connected agents. Newest activity first.</p>

            {error && <p className="aur-preview__error">{error}</p>}
            {sessions === null && !error && <p className="aur-preview__empty">Loading…</p>}

            {sessions !== null && sessions.length > 0 && (
              <div className="aur-sesslist">
                {sessions.map((s) => (
                  <a key={s.session_id} className="aur-sessrow" href={previewUrl(s.session_id)}>
                    <div className="aur-sessrow__avatar"><Icon name="uil:layer-group" size={17} /></div>
                    <div className="aur-sessrow__main">
                      <div className="aur-sessrow__titlerow">
                        <span className="aur-sessrow__title">{s.title}</span>
                      </div>
                      <div className="aur-sessrow__sub">{s.session_id}</div>
                    </div>
                    <div className="aur-sessrow__meta">
                      <span className="aur-sessrow__count">{s.artifact_count} artifact{s.artifact_count === 1 ? "" : "s"}</span>
                    </div>
                    <div className="aur-sessrow__time">{fmtActivity(s.last_activity)}</div>
                    <button
                      className="aur-sessrow__delete"
                      title="Delete session"
                      aria-label={`Delete session ${s.title}`}
                      onClick={(e) => remove(e, s.session_id)}
                    >
                      <Icon name="uil:trash-alt" size={15} />
                    </button>
                  </a>
                ))}
              </div>
            )}

            {sessions !== null && sessions.length === 0 && !error && (
              <div className="aur-sess-empty">
                <Icon name="uil:layers-alt" size={40} color="var(--e3)" />
                <div className="aur-sess-empty__title">No sessions yet</div>
                <div className="aur-sess-empty__body">
                  Connect an agent to the MCP endpoint and push your first artifact. Sessions appear here the moment they do.
                </div>
              </div>
            )}
          </div>

          <aside className="aur-connect">
            <div className="aur-connect__head">
              <Icon name="uil:plug" size={17} color="#9575cd" />
              <span className="aur-connect__title">Connect an Agent</span>
            </div>
            <p className="aur-connect__sub">One-time install. Aurora binds to localhost only, so the endpoint never changes.</p>

            <div className="aur-connect__label">pi</div>
            <div className="aur-connect__snippet">
              <code className="aur-connect__code">mcp install {endpoint}</code>
              <button className="aur-connect__copy" title="Copy" onClick={() => copyText(`mcp install ${endpoint}`)}>
                <Icon name="uil:copy" size={14} />
              </button>
            </div>

            <div className="aur-connect__label">Claude Code</div>
            <div className="aur-connect__snippet">
              <code className="aur-connect__code">claude mcp add --transport http aurora {endpoint}</code>
              <button className="aur-connect__copy" title="Copy" onClick={() => copyText(`claude mcp add --transport http aurora ${endpoint}`)}>
                <Icon name="uil:copy" size={14} />
              </button>
            </div>

            <div className="aur-connect__divider" />
            <div className="aur-connect__label">Available Tools</div>
            <div className="aur-connect__tools">
              {TOOLS.map((t) => <span key={t} className="aur-connect__tool">{t}</span>)}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
