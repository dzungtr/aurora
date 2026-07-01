export interface TreeEntry {
  path: string;
  isDir: boolean;
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
    await handle(await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }));
  },
};
