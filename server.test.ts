import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";

let root: string;
let server: ReturnType<typeof createServer>;
let base: string;

// The sandbox forbids ephemeral ports (port 0), so tests pin a fixed loopback
// port from the allowed dev range (3000-3999 / 5000-5999 / 7634). The previous
// server is stopped in afterEach, so sequential reuse of the port is safe.
const TEST_PORT = 5270;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aurora-server-"));
  writeFileSync(join(root, "hello.txt"), "hi");
  server = createServer(root, TEST_PORT);
  base = `http://localhost:${TEST_PORT}`;
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
  it("lists files under root, including size and mtime", async () => {
    const res = await fetch(`${base}/api/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].path).toBe("hello.txt");
    expect(body[0].isDir).toBe(false);
    expect(body[0].size).toBe(2); // "hi" is 2 bytes
    expect(typeof body[0].mtime).toBe("number");
  });

  it("omits size for directories", async () => {
    mkdirSync(join(root, "subdir"));
    const res = await fetch(`${base}/api/tree`);
    const body = await res.json();
    const dir = body.find((e: any) => e.path === "subdir");
    expect(dir.isDir).toBe(true);
    expect(dir.size).toBeUndefined();
    expect(typeof dir.mtime).toBe("number");
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

  it("supports Range requests for streaming (video/audio/PDF scrubbing)", async () => {
    writeFileSync(join(root, "data.bin"), Buffer.from("0123456789"));
    const res = await fetch(`${base}/api/file?path=data.bin`, { headers: { Range: "bytes=0-3" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-3/10");
    expect(await res.text()).toBe("0123");
  });

  it("infers Content-Type from the file extension", async () => {
    writeFileSync(join(root, "clip.mp4"), Buffer.from("fake"));
    const res = await fetch(`${base}/api/file?path=clip.mp4`);
    expect(res.headers.get("content-type")).toBe("video/mp4");
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

describe("/pdf.worker.min.mjs", () => {
  it("serves the pdf.js worker script", async () => {
    const res = await fetch(`${base}/pdf.worker.min.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(1000);
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
