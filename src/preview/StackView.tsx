// Session stack view: renders the selected artifact as markdown and provides
// slide-rail navigation (prev/next buttons + a strip of the session's
// artifacts). Missing artifact id resolves to the latest (highest seq).

import { useEffect, useMemo, useRef, useState } from "react";
import { previewApi, latestOf, previewUrl, navigate, onRouteChange, type Artifact, type ArtifactMeta } from "./previewApi";
import { onArtifactEvent } from "./liveSocket";
import { MarkdownArtifact } from "./MarkdownArtifact";
import { Icon } from "../components/Icon";

export interface StackViewProps {
  sessionId: string;
  /** artifact id from the deep link; undefined → latest */
  artifactId?: string;
}

export function StackView({ sessionId, artifactId }: StackViewProps) {
  const [artifacts, setArtifacts] = useState<ArtifactMeta[] | null>(null);
  const [current, setCurrent] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

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
  const go = (delta: number) => {
    if (!artifacts || index < 0) return;
    const next = artifacts[index + delta];
    if (next) navigate(previewUrl(sessionId, next.artifact_id));
  };
  // Re-render on popstate / in-app navigate so prev/next stay in sync.
  const [, setTick] = useState(0);
  useEffect(() => onRouteChange(() => setTick((t) => t + 1)), []);

  // Live updates: a push to this session slides onto the stack and the view
  // auto-advances; an in-place replace refreshes the open artifact in place.
  useEffect(() => {
    return onArtifactEvent((evt) => {
      if (evt.session_id !== sessionId) return;
      if (evt.event === "pushed") {
        previewApi
          .listArtifacts(sessionId)
          .then((list) => {
            if (!aliveRef.current) return;
            setArtifacts(list);
            const latest = latestOf(list);
            if (latest) navigate(previewUrl(sessionId, latest.artifact_id));
          })
          .catch(() => {});
      } else {
        // "updated": refresh the stack (meta may have changed) and, when the
        // open artifact is the replaced one, refetch its content in place.
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
  }, [sessionId, current]);

  return (
    <div className="aur-preview">
      <header className="aur-preview__top">
        <a className="aur-btn aur-btn--ghost" href="/preview"><Icon name="uil:arrow-left" size={15} /> Sessions</a>
        <div className="aur-brand aur-brand--center">{current?.title ?? "…"}</div>
        <div className="aur-spacer" />
        <a className="aur-btn" href="/">Files</a>
      </header>

      <div className="aur-preview__body aur-stack">
        {error && <p className="aur-preview__error">{error}</p>}
        {!error && artifacts === null && <p className="aur-preview__empty">Loading…</p>}
        {!error && artifacts !== null && artifacts.length === 0 && (
          <p className="aur-preview__empty">No artifacts in this session yet.</p>
        )}

        {current && (
          <>
            <div className="aur-stack__stage">
              <MarkdownArtifact content={current.content} />
            </div>
            <nav className="aur-stack__rail" aria-label="Artifact stack">
              <button
                className="aur-stack__nav"
                disabled={index <= 0}
                onClick={() => go(-1)}
                title="Previous artifact"
              >
                <Icon name="uil:arrow-left" size={16} />
              </button>
              <div className="aur-stack__strip">
                {(artifacts ?? []).map((a) => (
                  <a
                    key={a.artifact_id}
                    href={previewUrl(sessionId, a.artifact_id)}
                    className={
                      "aur-stack__chip" +
                      (a.artifact_id === current.artifact_id ? " is-active" : "")
                    }
                    title={a.title}
                  >
                    <span className="aur-stack__chip-type">{a.type}</span>
                    <span className="aur-stack__chip-title">{a.title}</span>
                  </a>
                ))}
              </div>
              <button
                className="aur-stack__nav"
                disabled={index < 0 || index >= (artifacts?.length ?? 0) - 1}
                onClick={() => go(1)}
                title="Next artifact"
              >
                <Icon name="uil:arrow-right" size={16} />
              </button>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
