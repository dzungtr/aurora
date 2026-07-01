import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";

let root: string;
let server: ReturnType<typeof createServer>;
let base: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zui-explorer-server-"));
  writeFileSync(join(root, "hello.txt"), "hi");
  server = createServer(root, 0);
  base = `http://localhost:${server.port}`;
});

afterEach(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("createServer", () => {
  it("binds only to loopback, never to all interfaces", () => {
    expect(server.hostname).toBe("127.0.0.1");
  });
});

describe("/api/tree", () => {
  it("lists files under root", async () => {
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ path: "hello.txt", isDir: false }]);
  });
});

describe("/api/file", () => {
  it("reads an existing file", async () => {
    const res = await fetch(`${base}/api/file?path=hello.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("404s on a missing file", async () => {
    const res = await fetch(`${base}/api/file?path=missing.txt`);
    expect(res.status).toBe(404);
  });

  it("400s on an out-of-root path", async () => {
    const res = await fetch(`${base}/api/file?path=../escape.txt`);
    expect(res.status).toBe(400);
  });

  it("writes a file", async () => {
    const res = await fetch(`${base}/api/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "new.txt", content: "world" }),
    });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=new.txt`);
    expect(await check.text()).toBe("world");
  });

  it("deletes a file", async () => {
    const res = await fetch(`${base}/api/file?path=hello.txt`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=hello.txt`);
    expect(check.status).toBe(404);
  });

  it("refuses to delete the root via path=.", async () => {
    const res = await fetch(`${base}/api/file?path=.`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "hello.txt"))).toBe(true);
  });

  it("refuses to delete a directory via /api/file", async () => {
    mkdirSync(join(root, "subdir"));
    const res = await fetch(`${base}/api/file?path=subdir`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(existsSync(join(root, "subdir"))).toBe(true);
  });

  it("never leaks the server's absolute root path in error bodies", async () => {
    rmSync(root, { recursive: true, force: true });
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).not.toContain(root);
  });
});

describe("/api/dir", () => {
  it("creates a folder", async () => {
    const res = await fetch(`${base}/api/dir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(200);
    const tree = await (await fetch(`${base}/api/tree`)).json();
    expect(tree.some((e: any) => e.path === "newdir" && e.isDir)).toBe(true);
  });
});

describe("/api/rename", () => {
  it("renames a file", async () => {
    const res = await fetch(`${base}/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "hello.txt", to: "renamed.txt" }),
    });
    expect(res.status).toBe(200);
    const check = await fetch(`${base}/api/file?path=renamed.txt`);
    expect(await check.text()).toBe("hi");
  });

  it("404s renaming a missing file", async () => {
    const res = await fetch(`${base}/api/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "missing.txt", to: "x.txt" }),
    });
    expect(res.status).toBe(404);
  });
});
