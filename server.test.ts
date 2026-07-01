import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
