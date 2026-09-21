// Session stack view: 3-pane layout — left session rail (all sessions,
// unread badges), center (session header + artifact toolbar + content
// stage), right artifact stack (newest-on-top). Missing artifact id resolves
// to the latest (highest seq). Content renderers (ChartView, MermaidArtifact,
// MediaArtifact, MarkdownArtifact) are reused unchanged inside the stage.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  previewApi,
  latestOf,
  previewUrl,
  navigate,
  onRouteChange,
  type Artifact,
  type ArtifactMeta,
  type SessionWithCount,
} from "./previewApi";
import { onArtifactEvent } from "./liveSocket";
import { MarkdownArtifact } from "./MarkdownArtifact";
import { ChartView, parseChartContract, type ChartContract } from "./ChartView";
import { MediaArtifact } from "./MediaArtifact";
import { MermaidArtifact } from "./MermaidArtifact";
import { Icon } from "../components/Icon";
import { PreviewTopBar } from "./PreviewTopBar";
import { getFollow, setFollow } from "./followStore";
import { useUnreadCounts } from "./unreadStore";

export interface StackViewProps {
  sessionId: string;
  /** artifact id from the deep link; undefined → latest */
  artifactId?: string;
}

const TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  markdown: { label: "Markdown", icon: "uil:file-alt", color: "#64b5f6" },
  chart: { label: "Chart", icon: "uil:chart", color: "#9575cd" },
  mermaid: { label: "Diagram", icon: "uil:sitemap", color: "#4db6ac" },
  image: { label: "Image", icon: "uil:image", color: "#ffb74d" },
  video: { label: "Video", icon: "uil:video", color: "#f06292" },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, icon: "uil:file", color: "#9e9e9e" };
}

function fmtActivity(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

function fmtTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Parse a chart contract, or null when the payload isn't a valid chart. */
function parseChartSafe(content: string): ChartContract | null {
  try {
    return parseChartContract(content);
  } catch {
    return null;
  }
}

export function StackView({ sessionId, artifactId }: StackViewProps) {
  const [sessions, setSessions] = useState<SessionWithCount[] | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactMeta[] | null>(null);
  const [current, setCurrent] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollowState] = useState(() => getFollow(sessionId));
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const aliveRef = useRef(true);
  const unread = useUnreadCounts();
  useEffect(() => () => { aliveRef.current = false; clearTimeout(copyTimer.current); }, []);

  // All sessions, for the left rail. Refreshed on every live event so counts
  // and last-activity stay current without a reload.
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      previewApi.listSessions().then((s) => alive && setSessions(s)).catch(() => {});
    refresh();
    const unsub = onArtifactEvent(() => refresh());
    return () => { alive = false; unsub(); };
  }, []);

  // Resolve the effective artifact id: deep-link id, else latest.
  const effectiveId = useMemo(() => artifactId ?? latestOf(artifacts ?? [])?.artifact_id, [artifactId, artifacts]);

  useEffect(() => {
    let alive = true;
    previewApi
      .listArtifacts(sessionId)
      .then((list) => alive && setArtifacts(list))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!effectiveId) { setCurrent(null); return; }
    let alive = true;
    previewApi
      .getArtifact(sessionId, effectiveId)
      .then((a) => alive && setCurrent(a))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [sessionId, effectiveId]);

  const index = current ? artifacts?.findIndex((a) => a.artifact_id === current.artifact_id) ?? -1 : -1;
  const chart = current?.type === "chart" ? parseChartSafe(current.content) : null;
  const go = (delta: number) => {
    if (!artifacts || index < 0) return;
    const next = artifacts[index + delta];
    if (next) navigate(previewUrl(sessionId, next.artifact_id));
  };
  // Re-render on popstate / in-app navigate so prev/next stay in sync.
  const [, setTick] = useState(0);
  useEffect(() => onRouteChange(() => setTick((t) => t + 1)), []);

  // Live updates: a push to this session slides onto the stack; auto-advance
  // to it only when "Follow latest" is on. An in-place replace always
  // refreshes the stack meta, and refetches the open artifact's content when
  // it's the one that was replaced.
  useEffect(() => {
    return onArtifactEvent((evt) => {
      if (evt.session_id !== sessionId) return;
      if (evt.event === "pushed") {
        previewApi
          .listArtifacts(sessionId)
          .then((list) => {
            if (!aliveRef.current) return;
            setArtifacts(list);
            if (follow) {
              const latest = latestOf(list);
              if (latest) navigate(previewUrl(sessionId, latest.artifact_id));
            }
          })
          .catch(() => {});
      } else {
        previewApi
          .listArtifacts(sessionId)
          .then((list) => aliveRef.current && setArtifacts(list))
          .catch(() => {});
        if (!current || evt.artifact_id === current.artifact_id) {
          const id = evt.artifact_id;
          previewApi
            .getArtifact(sessionId, id)
            .then((a) => aliveRef.current && setCurrent(a))
            .catch(() => {});
        }
      }
    });
  }, [sessionId, current, follow]);

  const toggleFollow = () => {
    const next = !follow;
    setFollow(sessionId, next);
    setFollowState(next);
  };

  const copyLink = () => {
    if (!current) return;
    navigator.clipboard?.writeText(window.location.origin + previewUrl(sessionId, current.artifact_id)).catch(() => {});
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  const openStandalone = () => {
    if (!current) return;
    window.open(previewUrl(sessionId, current.artifact_id), "_blank", "noopener,noreferrer");
  };

  const sessionMeta = sessions?.find((s) => s.session_id === sessionId);
  const sessionTitle = sessionMeta?.title ?? sessionId;
  const isReplaced = !!current && current.updated_at !== current.created_at;
  const t = current ? typeMeta(current.type) : null;
  const stackItems = artifacts ? artifacts.map((a, i) => ({ a, num: i + 1 })).slice().reverse() : [];

  return (
    <div className="aur-preview">
      <PreviewTopBar />

      <div className="aur-stack3">
        {/* LEFT: SESSION RAIL */}
        <aside className="aur-stack3__rail">
          <a className="aur-stack3__railback" href="/preview">
            <Icon name="uil:angle-left" size={17} /> All sessions
          </a>
          <div className="aur-stack3__raillist">
            {(sessions ?? []).map((s) => {
              const active = s.session_id === sessionId;
              const badge = unread[s.session_id] ?? 0;
              return (
                <a
                  key={s.session_id}
                  className={"aur-stack3__railitem" + (active ? " is-active" : "")}
                  href={previewUrl(s.session_id)}
                >
                  <div className="aur-stack3__railrow">
                    <Icon name="uil:layer-group" size={14} className="aur-stack3__railicon" />
                    <span className="aur-stack3__railtitle">{s.title}</span>
                    {badge > 0 && <span className="aur-stack3__railbadge">{badge}</span>}
                  </div>
                  <div className="aur-stack3__railmeta">
                    {s.artifact_count} artifact{s.artifact_count === 1 ? "" : "s"} · {fmtActivity(s.last_activity)}
                  </div>
                </a>
              );
            })}
          </div>
        </aside>

        {/* CENTER */}
        <main className="aur-stack3__main">
          <div className="aur-stack3__sessionhead">
            <span className="aur-stack3__sessiontitle">{sessionTitle}</span>
            <button
              className={"aur-stack3__ghostbtn" + (follow ? " is-on" : "")}
              onClick={toggleFollow}
              title="Auto-advance to newest artifact"
            >
              <Icon name={follow ? "uil:play-circle" : "uil:pause-circle"} size={15} /> Follow latest
            </button>
            <button className="aur-stack3__ghostbtn" onClick={copyLink} disabled={!current}>
              <Icon name={copied ? "uil:check" : "uil:link"} size={15} /> {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          {current && t && (
            <div className="aur-stack3__toolbar">
              <span
                className="aur-stack3__typechip"
                style={{ background: t.color + "22", color: t.color }}
              >
                <Icon name={t.icon} size={13} /> {t.label}
              </span>
              <span className="aur-stack3__artifacttitle">{current.title}</span>
              {isReplaced && (
                <span className="aur-stack3__replaced" title="Replaced in place">
                  <Icon name="uil:history" size={15} />
                </span>
              )}

              <div className="aur-stack3__pager">
                <button className="aur-stack3__pagerbtn" disabled={index <= 0} onClick={() => go(-1)}>
                  <Icon name="uil:angle-left" size={18} />
                </button>
                <span className="aur-stack3__counter">{index + 1} / {artifacts?.length ?? 0}</span>
                <button
                  className="aur-stack3__pagerbtn"
                  disabled={index < 0 || index >= (artifacts?.length ?? 0) - 1}
                  onClick={() => go(1)}
                >
                  <Icon name="uil:angle-right" size={18} />
                </button>
              </div>
              <button className="aur-stack3__iconbtn" onClick={openStandalone} title="Open standalone">
                <Icon name="uil:external-link-alt" size={15} />
              </button>
            </div>
          )}

          <div className="aur-stack3__stage">
            {error && <p className="aur-preview__error">{error}</p>}
            {!error && artifacts === null && <p className="aur-preview__empty">Loading…</p>}
            {!error && artifacts !== null && artifacts.length === 0 && (
              <p className="aur-preview__empty">No artifacts in this session yet.</p>
            )}

            {current && (
              <div className="aur-stack3__stageinner">
                {current.type === "markdown" ? (
                  <div className="aur-stack3__pane-md">
                    <MarkdownArtifact content={current.content} />
                  </div>
                ) : current.type === "chart" ? (
                  <div className="aur-stack3__pane-card">
                    <div className="aur-stack3__cardbox">
                      {chart ? (
                        <ChartView contract={chart} />
                      ) : (
                        <p className="aur-preview__error">Invalid chart artifact — malformed contract JSON.</p>
                      )}
                    </div>
                    {chart && (
                      <div className="aur-stack3__caption">
                        <span className="aur-stack3__captionmono">push_chart</span>
                        <span className="aur-stack3__dot" />
                        <span>chart_type: <span className="aur-stack3__captionmono">{chart.chart_type}</span></span>
                        <span className="aur-stack3__dot" />
                        <span>Aurora house theme</span>
                      </div>
                    )}
                  </div>
                ) : current.type === "mermaid" ? (
                  <div className="aur-stack3__pane-card">
                    <div className="aur-stack3__cardbox aur-stack3__cardbox--center">
                      <MermaidArtifact content={current.content} />
                    </div>
                    <div className="aur-stack3__caption aur-stack3__captionmono">
                      push_mermaid · rendered client-side, dark theme
                    </div>
                  </div>
                ) : current.type === "image" || current.type === "video" ? (
                  <div className="aur-stack3__pane-card">
                    <div className={"aur-stack3__cardbox" + (current.type === "video" ? " aur-stack3__cardbox--video" : "")}>
                      <MediaArtifact artifact={current} />
                    </div>
                    <div className="aur-stack3__caption aur-stack3__captionmono">
                      {current.type === "image" ? "push_image" : "push_video"}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </main>

        {/* RIGHT: ARTIFACT STACK */}
        <aside className="aur-stack3__side">
          <div className="aur-stack3__sidehead">
            <span className="aur-overline">Stack</span>
            <span className="aur-stack3__sidecount">
              {artifacts ? `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>
          <div className="aur-stack3__sidelist">
            {stackItems.map(({ a, num }) => {
              const m = typeMeta(a.type);
              return (
                <a
                  key={a.artifact_id}
                  className={"aur-stack3__sideitem" + (a.artifact_id === current?.artifact_id ? " is-active" : "")}
                  href={previewUrl(sessionId, a.artifact_id)}
                >
                  <div className="aur-stack3__siderow">
                    <Icon name={m.icon} size={14} style={{ color: m.color }} />
                    <span className="aur-stack3__sidetitle">{a.title}</span>
                  </div>
                  <div className="aur-stack3__sidemeta">
                    <span className="aur-stack3__sidetime">{fmtTime(a.created_at)}</span>
                    <span className="aur-stack3__sideindex">#{num}</span>
                  </div>
                </a>
              );
            })}
          </div>
          <div className="aur-stack3__sidefoot">Newest on top. New pushes slide on here live.</div>
        </aside>
      </div>
    </div>
  );
}
