// Artifact list + current artifact + live-event handling for one session,
// shared by every reading surface. `urlFor` lets each surface navigate to its
// own URLs (previewUrl for StackView). Follow state is the module-level
// followStore keyed by sessionId, so it survives the per-navigation remount.

import { useEffect, useMemo, useRef, useState } from "react";
import { previewApi, latestOf, navigate, type Artifact, type ArtifactMeta } from "./previewApi";
import { onArtifactEvent } from "./liveSocket";
import { getFollow, setFollow } from "./followStore";

export interface UseArtifactStackArgs {
  sessionId: string;
  /** artifact id from the deep link; undefined → latest */
  artifactId?: string;
  urlFor: (sessionId: string, artifactId?: string) => string;
}

export interface UseArtifactStackResult {
  artifacts: ArtifactMeta[] | null;
  current: Artifact | null;
  error: string | null;
  follow: boolean;
  toggleFollow: () => void;
}

export function useArtifactStack({ sessionId, artifactId, urlFor }: UseArtifactStackArgs): UseArtifactStackResult {
  const [artifacts, setArtifacts] = useState<ArtifactMeta[] | null>(null);
  const [current, setCurrent] = useState<Artifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollowState] = useState(() => getFollow(sessionId));
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
              if (latest) navigate(urlFor(sessionId, latest.artifact_id));
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
  }, [sessionId, current, follow, urlFor]);

  const toggleFollow = () => {
    const next = !follow;
    setFollow(sessionId, next);
    setFollowState(next);
  };

  return { artifacts, current, error, follow, toggleFollow };
}
