// Opt-in DOM environment for render-level tests. Bun runs every test file in
// one process, so globals are installed per file and restored afterwards
// instead of being preloaded for the whole suite (server/MCP tests must keep
// seeing no `window`).
import { Window } from "happy-dom";

const KEYS = ["window", "document", "navigator", "location", "history", "HTMLElement", "Node", "Event", "localStorage"] as const;

export function installDom(url = "http://localhost/"): { window: Window; restore: () => void } {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>(KEYS.map((k) => [k, g[k]]));
  const window = new Window({ url });
  for (const k of KEYS) g[k] = (window as unknown as Record<string, unknown>)[k];
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    window,
    restore: () => {
      for (const [k, v] of saved) g[k] = v;
      delete g.IS_REACT_ACT_ENVIRONMENT;
      void window.happyDOM.close();
    },
  };
}
