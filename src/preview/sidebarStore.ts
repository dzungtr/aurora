// Left/right sidebar visibility for the stack view, persisted to
// localStorage. Module-level singleton because PreviewApp is re-keyed on
// every navigation (see App.tsx), which would reset a component-local toggle
// on every artifact change. Simple pub/sub so both StackView instances stay
// in sync across navigations.

const KEY = "aur.sidebar";

export interface SidebarState {
  left: boolean;
  right: boolean;
}

const DEFAULT: SidebarState = { left: true, right: true };

function load(): SidebarState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<SidebarState>;
    return { left: parsed.left ?? true, right: parsed.right ?? true };
  } catch {
    return { ...DEFAULT };
  }
}

let state: SidebarState = load();
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode) — session-only is fine.
  }
}

export function getSidebar(): SidebarState {
  return state;
}

export function setSidebar(patch: Partial<SidebarState>): void {
  state = { ...state, ...patch };
  save();
  listeners.forEach((fn) => fn());
}

export function subscribeSidebar(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}