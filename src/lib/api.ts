// HTTP client for the file-explorer backend.
// Matches the existing zui-explorer server contract (/api/tree, /api/file, ...).
// `size` and `mtime` are optional — see README for the small server.ts change
// that populates them so the Inspector can show real metadata.

export interface TreeEntry {
  path: string;
  isDir: boolean;
  /** File size in bytes (optional — requires server support). */
  size?: number;
  /** Last-modified time in epoch milliseconds (optional — requires server support). */
  mtime?: number;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async getTree(): Promise<TreeEntry[]> {
    return handle(await fetch("/api/tree"));
  },

  async readFile(path: string): Promise<string> {
    const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error ?? `Request failed: ${res.status}`);
    }
    return res.text();
  },

  /** URL for streaming a raw file — used by <img>, <video>, <audio>, PDF and "Open in new tab". */
  fileUrl(path: string): string {
    return `/api/file?path=${encodeURIComponent(path)}`;
  },

  async writeFile(path: string, content: string): Promise<void> {
    await handle(await fetch("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }));
  },

  async createDir(path: string): Promise<void> {
    await handle(await fetch("/api/dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }));
  },

  async rename(from: string, to: string): Promise<void> {
    await handle(await fetch("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }));
  },

  async deleteFile(path: string): Promise<void> {
    await handle(await fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }));
  },
};
