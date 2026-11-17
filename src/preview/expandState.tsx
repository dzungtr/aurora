// Client-side expand/collapse state for digest cards (issue #90, spec #86 D7).
// UiArtifact mounts <ExpandProvider key={artifactId}> so state survives live
// re-renders of the same artifact and resets when the viewed artifact changes.
// State is in-memory only: never persisted, never sent over the network.
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type ExpandMap = Record<string, boolean>;

interface ExpandContextValue {
  open: ExpandMap;
  toggle: (key: string) => void;
}

/** Pure toggle step, exported so the state transition is unit-testable without a DOM. */
export function toggleKey(state: ExpandMap, key: string): ExpandMap {
  return { ...state, [key]: !state[key] };
}

const ExpandContext = createContext<ExpandContextValue | null>(null);

export function ExpandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<ExpandMap>({});
  const toggle = useCallback((key: string) => setOpen((s) => toggleKey(s, key)), []);
  return <ExpandContext.Provider value={{ open, toggle }}>{children}</ExpandContext.Provider>;
}

/**
 * `[open, toggle]` for one key. Outside an ExpandProvider (static markup,
 * isolated render) it falls back to component-local state.
 */
export function useExpanded(key: string): [boolean, () => void] {
  const ctx = useContext(ExpandContext);
  const [local, setLocal] = useState<ExpandMap>({});
  const toggleLocal = useCallback(() => setLocal((s) => toggleKey(s, key)), [key]);
  const toggleCtx = ctx?.toggle;
  const toggleShared = useCallback(() => toggleCtx?.(key), [toggleCtx, key]);
  return ctx ? [!!ctx.open[key], toggleShared] : [!!local[key], toggleLocal];
}
