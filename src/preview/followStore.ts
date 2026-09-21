// Per-session "follow latest" preference. Module-level singleton because
// PreviewApp is re-keyed on every navigation (see App.tsx), which would
// otherwise reset a component-local toggle back to its default on every
// artifact change within the same session.

const follow = new Map<string, boolean>();

export function getFollow(sessionId: string): boolean {
  return follow.get(sessionId) ?? true;
}

export function setFollow(sessionId: string, value: boolean): void {
  follow.set(sessionId, value);
}
