// Feed right-hand "Channel stack" aside and the Archived banner (spec #98 M16,
// D6, D9, D18, D19). Both render from artifact metadata only; the open
// artifact's content is never fetched here.

import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import { Icon } from "../components/Icon";
import { artifactPath, feedPath } from "../../lib/routePaths";
import { isLive, pruneEligibleAt } from "./feedModel";
import { onArtifactEvent } from "./liveSocket";
import { navigate, previewApi, latestOf, type ArtifactMeta } from "./previewApi";
import { getSidebar, setSidebar, subscribeSidebar } from "./sidebarStore";
import { typeMeta } from "./StackView";
import { useTheme } from "../lib/themeStore";

/** Store default, used while the channel list has not loaded or omits the field. */
export const DEFAULT_RETENTION_DAYS = 30;

const fmtDay = (iso: string | number | Date) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const fmtLongDay = (iso: string | number | Date) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Plain left-click navigates in-app; modified clicks keep the browser default. */
function inApp(path: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
}

function useSidebarRight(): boolean {
  return useSyncExternalStore(subscribeSidebar, () => getSidebar().right, () => getSidebar().right);
}

export interface ChannelStackAsideProps {
  sessionId: string;
  artifacts: ArtifactMeta[];
  /** open artifact id; undefined or unknown highlights nothing */
  currentId?: string;
  retentionDays: number;
  /** clock for the live dot; defaults to render time */
  now?: number;
}

export function ChannelStackAside({ sessionId, artifacts, currentId, retentionDays, now = Date.now() }: ChannelStackAsideProps) {
  const open = useSidebarRight();
  const theme = useTheme();

  if (!open) {
    return (
      <div className="aur-feed__asidestrip">
        <button
          className="aur-feed__asidebtn aur-feed__asidebtn--strip"
          onClick={() => setSidebar({ right: true })}
          title="Show channel stack"
          aria-label="Show channel stack"
        >
          <Icon name="uil:angle-left" size={18} />
        </button>
      </div>
    );
  }

  const items = [...artifacts].sort((a, b) => b.seq - a.seq);
  const oldest = artifacts.reduce<string | null>(
    (min, a) => (min === null || Date.parse(a.created_at) < Date.parse(min) ? a.created_at : min),
    null
  );
  return (
    <aside className="aur-feed__aside">
      <div className="aur-feed__asidehead">
        <span className="aur-overline">Channel stack</span>
        <span className="aur-feed__asideheadright">
          <span className="aur-feed__asidecount">
            {artifacts.length} artifact{artifacts.length === 1 ? "" : "s"}
          </span>
          <button
            className="aur-feed__asidebtn"
            onClick={() => setSidebar({ right: false })}
            title="Collapse channel stack"
            aria-label="Collapse channel stack"
          >
            <Icon name="uil:angle-right" size={17} />
          </button>
        </span>
      </div>
      <div className="aur-feed__asidelist">
        {items.map((a, i) => {
          const m = typeMeta(a.type, theme);
          const href = feedPath(sessionId, a.artifact_id);
          return (
            <a
              key={a.artifact_id}
              className={"aur-feed__asideitem" + (a.artifact_id === currentId ? " is-active" : "")}
              href={href}
              onClick={inApp(href)}
            >
              <div className="aur-feed__asiderow">
                <Icon name={m.icon} size={14} style={{ color: m.color }} />
                <span className="aur-feed__asidetitle">{a.title}</span>
                {i === 0 && isLive(a.updated_at, now) && (
                  <span className="aur-feed__dot" title="Updated in the last 15 minutes" />
                )}
              </div>
              <div className="aur-feed__asidemeta">
                <span>
                  {fmtDay(a.created_at)} · updated {fmtTime(a.updated_at)}
                </span>
                <span className="aur-feed__asidekind">{m.label}</span>
              </div>
            </a>
          );
        })}
      </div>
      <div className="aur-feed__asidefoot">
        <div className="aur-feed__asideretention">
          <Icon name="uil:history-alt" size={13} /> Retention {retentionDays} days
        </div>
        Pruned on the next push.{oldest !== null && <> Oldest kept: {fmtDay(oldest)}.</>}
      </div>
    </aside>
  );
}

export interface FeedAsideProps {
  sessionId: string;
  /** artifact id from the deep link; undefined → latest */
  artifactId?: string;
  retentionDays?: number;
  now?: number;
}

/** Metadata-only list of the channel, refetched on this channel's live events. */
function useChannelArtifacts(sessionId: string): ArtifactMeta[] | null {
  const [list, setList] = useState<ArtifactMeta[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      previewApi.listArtifacts(sessionId).then((l) => alive && setList(l)).catch(() => {});
    load();
    const off = onArtifactEvent((evt) => {
      if (evt.session_id === sessionId) load();
    });
    return () => { alive = false; off(); };
  }, [sessionId]);
  return list;
}

/** The aside as mounted by FeedView: owns its metadata fetch so FeedStage is untouched. */
export function FeedAside({ sessionId, artifactId, retentionDays, now }: FeedAsideProps) {
  const artifacts = useChannelArtifacts(sessionId);
  if (artifacts === null) return null;
  const currentId = artifactId ?? latestOf(artifacts)?.artifact_id;
  return (
    <ChannelStackAside
      sessionId={sessionId}
      artifacts={artifacts}
      currentId={currentId}
      retentionDays={retentionDays ?? DEFAULT_RETENTION_DAYS}
      now={now}
    />
  );
}

export interface ArchivedBannerProps {
  artifact: ArtifactMeta;
  sessionId: string;
  retentionDays: number;
}

export function ArchivedBanner({ artifact, sessionId, retentionDays }: ArchivedBannerProps) {
  const latest = feedPath(sessionId);
  const stack = artifactPath(sessionId, artifact.artifact_id);
  return (
    <div className="aur-feed__archived" role="note">
      <Icon name="uil:archive" size={16} className="aur-feed__archivedicon" />
      <div className="aur-feed__archivedtext">
        <div className="aur-feed__archivedhead">
          Archived · {fmtLongDay(artifact.updated_at)} · pruned after {retentionDays} days
        </div>
        <div className="aur-feed__archivedsub">
          Eligible for pruning from {fmtLongDay(pruneEligibleAt(artifact.updated_at, retentionDays))} — removed on the
          next push after that.
        </div>
      </div>
      <a className="aur-feed__archivedbtn" href={latest} onClick={inApp(latest)}>Back to latest</a>
      <a className="aur-feed__archivedbtn" href={stack} onClick={inApp(stack)}>Open in stack</a>
    </div>
  );
}
