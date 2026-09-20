// HTTP client for the preview surface (/preview routes + artifact read API).
// Mirrors the ArtifactStore shapes served by server.ts; UI logic stays here,
// the server stays storage-shaped.

export interface SessionMeta {
  session_id: string;
  title: string;
  created_at: string;
  last_activity: string;
}

export interface SessionWithCount extends SessionMeta {
  artifact_count: number;
}

export interface ArtifactMeta {
  artifact_id: string;
  seq: number;
  type: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Artifact extends ArtifactMeta {
  session_id: string;
  content: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const previewApi = {
  async listSessions(): Promise<SessionWithCount[]> {
    return handle(await fetch("/api/preview/sessions"));
  },

  async listArtifacts(sessionId: string): Promise<ArtifactMeta[]> {
    return handle(await fetch(`/api/preview/sessions/${encodeURIComponent(sessionId)}/artifacts`));
  },

  async getArtifact(sessionId: string, artifactId: string): Promise<Artifact> {
    // Server shape: { session_id, meta, content } — flatten meta for the UI.
    const raw = await handle<{ session_id: string; meta: ArtifactMeta; content: string }>(
      await fetch(`/api/preview/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`)
    );
    return { ...raw.meta, session_id: raw.session_id, content: raw.content };
  },

  /** Delete a session and all its artifacts from the store. */
  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`/api/preview/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Request failed: ${res.status}`);
    }
  },
};

/** The artifact the user lands on when the deep link omits the id (latest = highest seq). */
export function latestOf(artifacts: ArtifactMeta[]): ArtifactMeta | null {
  if (artifacts.length === 0) return null;
  return artifacts.reduce((a, b) => (b.seq > a.seq ? b : a));
}

/** Parse /preview[/:sid[/:aid]] into { sid, aid }; null when not a preview route. */
export function parsePreviewPath(pathname: string): { sid?: string; aid?: string } | null {
  const m = pathname.match(/^\/preview(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/);
  if (!m) return null;
  try {
    return {
      sid: m[1] ? decodeURIComponent(m[1]) : undefined,
      aid: m[2] ? decodeURIComponent(m[2]) : undefined,
    };
  } catch {
    return { sid: undefined, aid: undefined };
  }
}

export function previewUrl(sid: string, aid?: string): string {
  return aid ? `/preview/${encodeURIComponent(sid)}/${encodeURIComponent(aid)}` : `/preview/${encodeURIComponent(sid)}`;
}

/** Client-side navigation: pushState + notify subscribers (App's router). */
export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("aurora:navigate"));
}

/** Subscribe to route changes (popstate and in-app navigate). */
export function onRouteChange(fn: () => void): () => void {
  window.addEventListener("popstate", fn);
  window.addEventListener("aurora:navigate", fn);
  return () => {
    window.removeEventListener("popstate", fn);
    window.removeEventListener("aurora:navigate", fn);
  };
}
