// Last-viewed Feed channel (spec #98 M6, D13): per-browser, raw channel id
// under localStorage. Module-level so it survives navigation remounts; storage
// failures (private mode) degrade to memory for the page's life.

const KEY = "aurora:feed:last";

let memory: string | null = null;

export function getLastFeedChannel(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return raw;
  } catch {
    // fall through to memory
  }
  return memory;
}

export function setLastFeedChannel(id: string): void {
  memory = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // memory only
  }
}
