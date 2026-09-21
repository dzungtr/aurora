// App-wide light/dark theme preference. Module-level singleton (like
// followStore/unreadStore) so it survives the full-tree remounts that
// navigation triggers between the explorer and preview surfaces.

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "aurora:theme";
const subscribers = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

let theme: Theme = readStored() ?? "dark";

function notify(): void {
  for (const fn of subscribers) fn();
}

export function setTheme(next: Theme): void {
  if (next === theme) return;
  theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // best-effort persistence only
  }
  notify();
}

export function toggleTheme(): void {
  setTheme(theme === "dark" ? "light" : "dark");
}

function getSnapshot(): Theme {
  return theme;
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** React hook: the current theme, live-updating across every mounted surface. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
