// The Feed (spec #98, ADR-0011): channels as tabs, the open channel's latest
// (or deep-linked) artifact as a full-width page. Mount points for later
// slices are marked below: aside / banner (#102). The drawer (#103) mounts in
// FeedStage, inside the centre column. The toolbar
// lives in FeedToolbar.tsx (#101).

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Icon } from "../components/Icon";
import { feedPath, SESSION_ROUTE_PREFIX } from "../../lib/routePaths";
import { PreviewTopBar } from "./PreviewTopBar";
import { ArchivedBanner, DEFAULT_RETENTION_DAYS, FeedAside } from "./FeedAside";
import { ArtifactStage } from "./ArtifactStage";
import { useArtifactStack } from "./useArtifactStack";
import { useChannels, useSessions } from "./channelStore";
import { feedViewState, isArchived, isLive } from "./feedModel";
import { getLastFeedChannel, setLastFeedChannel } from "./feedLastStore";
import { navigate, previewUrl, type SessionWithCount } from "./previewApi";
import { FeedToolbar } from "./FeedToolbar";
import { ProgramDrawer } from "./ProgramDrawer";
import { useUnreadCounts, type UnreadCounts } from "./unreadStore";

const TICK_MS = 60_000;

export interface FeedTabsProps {
  tabs: { session_id: string; last_activity: string }[];
  activeId: string | null;
  unread: UnreadCounts;
  now: number;
  /** retention of the open channel, shown to the right of the tabs */
  retentionDays?: number;
  onSelect: (id: string) => void;
}

export function FeedTabs({ tabs, activeId, unread, now, retentionDays, onSelect }: FeedTabsProps) {
  const pick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onSelect(id);
  };
  return (
    <div className="aur-feed__tabs">
      {tabs.map((t) => {
        const active = t.session_id === activeId;
        const badge = active ? 0 : unread[t.session_id] ?? 0;
        return (
          <a
            key={t.session_id}
            className={"aur-feed__tab" + (active ? " is-active" : "")}
            href={feedPath(t.session_id)}
            onClick={(e) => pick(e, t.session_id)}
          >
            <Icon name="uil:channel" size={15} />
            <span>{t.session_id}</span>
            {badge > 0 && <span className="aur-feed__badge">{badge}</span>}
            {isLive(t.last_activity, now) && <span className="aur-feed__dot" title="Active in the last 15 minutes" />}
          </a>
        );
      })}
      <div className="aur-feed__tabsfill" />
      {retentionDays !== undefined && <span className="aur-feed__retention">retention {retentionDays}d</span>}
    </div>
  );
}

export function FeedNotice({ kind, sid }: { kind: "not-channel" | "no-session"; sid: string }) {
  return (
    <div className="aur-feed__notice">
      {kind === "not-channel" ? (
        <>
          <p><code>{sid}</code> is not a channel.</p>
          <a href={previewUrl(sid)}>Open in Artifacts</a>
        </>
      ) : (
        <p>No session <code>{sid}</code>.</p>
      )}
    </div>
  );
}

export function FeedEmpty() {
  return (
    <div className="aur-feed__empty">
      <h2 className="aur-preview__h">No channels yet</h2>
      <p>A channel appears here when an agent pushes with <code>session_kind: "channel"</code>.</p>
      <a href={SESSION_ROUTE_PREFIX}>Browse artifacts</a>
    </div>
  );
}

function FeedStage({ sessionId, artifactId, retentionDays }: { sessionId: string; artifactId?: string; retentionDays?: number }) {
  // feedPath is a module-level function: a stable reference for the hook's effect deps.
  const { artifacts, current, error, follow, toggleFollow } = useArtifactStack({ sessionId, artifactId, urlFor: feedPath });
  // Deliberately component state, not a store: it must reset when the open artifact changes.
  const [programOpen, setProgramOpen] = useState(false);
  const currentId = current?.artifact_id;
  useEffect(() => setProgramOpen(false), [currentId]);
  const closeProgram = useCallback(() => setProgramOpen(false), []);
  const showProgram = programOpen && current?.type === "ui";
  return (
    <>
      <FeedToolbar
        sessionId={sessionId}
        current={current}
        follow={follow}
        onToggleFollow={toggleFollow}
        programOpen={showProgram}
        onToggleProgram={() => setProgramOpen((o) => !o)}
      />
      {current && artifacts && isArchived(current, artifacts) && (
        <ArchivedBanner artifact={current} sessionId={sessionId} retentionDays={retentionDays ?? DEFAULT_RETENTION_DAYS} />
      )}
      <div className="aur-feed__stage">
        {error && <p className="aur-preview__error">{error}</p>}
        {!error && artifacts === null && <p className="aur-preview__empty">Loading…</p>}
        {!error && artifacts !== null && artifacts.length === 0 && (
          <p className="aur-preview__empty">No artifacts in this channel yet.</p>
        )}
        {current && (
          <div className="aur-stack3__stageinner">
            <ArtifactStage artifact={current} frame="page" />
          </div>
        )}
      </div>
      {showProgram && current && <ProgramDrawer source={current.content} onClose={closeProgram} />}
    </>
  );
}

export interface FeedViewProps {
  sessionId?: string;
  /** artifact id from the deep link; undefined → latest */
  artifactId?: string;
}

export function FeedView({ sessionId, artifactId }: FeedViewProps) {
  const sessions = useSessions();
  const channels = useChannels();
  const unread = useUnreadCounts();
  const [, setTick] = useState(0);
  // Re-render every minute so a live dot expires without needing an event.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  // Read at render, not at mount: a push after mount must not look like the future.
  const now = Date.now();

  const state = feedViewState(sessionId, sessions, getLastFeedChannel());

  const resolveTo = state.kind === "resolve" ? state.channel : null;
  const activeId = state.kind === "channel" ? state.sid : null;

  // Bare Feed route → replace with the resolved channel so Back skips it.
  useEffect(() => {
    if (resolveTo) navigate(feedPath(resolveTo), { replace: true });
  }, [resolveTo]);
  useEffect(() => {
    if (activeId) setLastFeedChannel(activeId);
  }, [activeId]);

  const meta: SessionWithCount | undefined = channels?.find((c) => c.session_id === activeId);

  let body;
  if (state.kind === "loading" || state.kind === "resolve") body = <p className="aur-preview__empty">Loading…</p>;
  else if (state.kind === "empty") body = <FeedEmpty />;
  else if (state.kind === "channel") body = <FeedStage sessionId={state.sid} artifactId={artifactId} retentionDays={meta?.retention_days} />;
  else body = <FeedNotice kind={state.kind} sid={state.sid} />;

  return (
    <div className="aur-preview">
      <PreviewTopBar active="feed" />
      <FeedTabs
        tabs={channels ?? []}
        activeId={activeId}
        unread={unread}
        now={now}
        retentionDays={meta?.retention_days}
        onSelect={(id) => navigate(feedPath(id))}
      />
      <div className="aur-feed__body">
        {/* Centre column: the Program drawer anchors to this column's right edge. */}
        <main className="aur-feed__center">{body}</main>
        {state.kind === "channel" && (
          <FeedAside sessionId={state.sid} artifactId={artifactId} retentionDays={meta?.retention_days} now={now} />
        )}
      </div>
    </div>
  );
}
