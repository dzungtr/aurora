// Shared session/channel list (spec #98 M7, D15): one fetch feeds the Feed
// tabs and the top-bar badge. Module-level singleton so it survives the
// remounts navigation causes; refetched on every live event.

import { useSyncExternalStore } from "react";
import { previewApi, type SessionWithCount } from "./previewApi";
import { onArtifactEvent } from "./liveSocket";
import { feedTabs } from "./feedModel";

export interface ChannelStore {
  getSessions(): SessionWithCount[] | null;
  getChannels(): SessionWithCount[] | null;
  subscribe(fn: () => void): () => void;
}

/** Factory so the fetch and event source can be faked in tests. */
export function createChannelStore(
  fetchSessions: () => Promise<SessionWithCount[]>,
  onEvent: (fn: () => void) => () => void
): ChannelStore {
  let sessions: SessionWithCount[] | null = null;
  let channels: SessionWithCount[] | null = null;
  let started = false;
  const subscribers = new Set<() => void>();

  const refetch = () => {
    fetchSessions()
      .then((list) => {
        sessions = list;
        channels = feedTabs(list);
        for (const fn of subscribers) fn();
      })
      .catch(() => {}); // a failed refetch keeps the previous list
  };

  return {
    getSessions: () => sessions,
    getChannels: () => channels,
    subscribe(fn) {
      subscribers.add(fn);
      if (!started) {
        started = true;
        onEvent(refetch);
        refetch();
      }
      return () => subscribers.delete(fn);
    },
  };
}

const store = createChannelStore(() => previewApi.listSessions(), onArtifactEvent);

/** All sessions; null until the first fetch lands. */
export function useSessions(): SessionWithCount[] | null {
  return useSyncExternalStore(store.subscribe, store.getSessions, store.getSessions);
}

/** Channel sessions only (the Feed tabs), sorted; null until loaded. */
export function useChannels(): SessionWithCount[] | null {
  return useSyncExternalStore(store.subscribe, store.getChannels, store.getChannels);
}
