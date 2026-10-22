import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, resolvePublicBaseUrl } from "./server";
import { loadPublicUrl } from "./lib/whitelist";

let artifactsDir: string;
let server: ReturnType<typeof createServer>;
let base: string;

// The sandbox forbids ephemeral ports (port 0), so tests pin a fixed loopback
// port from the allowed dev range (3000-3999 / 5000-5999 / 7634). The previous
// server is stopped in afterEach, so sequential reuse of the port is safe.
const TEST_PORT = 5270;

// Hermetic tests: a real OPENROUTER_API_KEY in the environment would make
// createServer fall back to a fire-and-forget live catalog fetch. PRD #24
// Testing Decisions: tests run against the fake only, never live network.
delete process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-server-"));
  server = createServer(TEST_PORT, { artifactsDir });
  base = `http://localhost:${TEST_PORT}`;
});

afterEach(() => {
  server.stop(true);
  rmSync(artifactsDir, { recursive: true, force: true });
});

describe("createServer", () => {
  it("binds only to loopback, never to all interfaces", () => {
    expect(server.hostname).toBe("127.0.0.1");
  });
});

// The explorer is deleted, not deprecated (epic #67 D1): every file API route
// must be gone, with no read-only fallback.
describe("resolvePublicBaseUrl", () => {
  it("falls back to loopback with the external port", () => {
    expect(resolvePublicBaseUrl(7634)).toBe("http://127.0.0.1:7634");
  });

  it("publicUrl overrides the fallback, trailing slashes trimmed", () => {
    expect(resolvePublicBaseUrl(7634, "https://aurora.ts.net/")).toBe("https://aurora.ts.net");
  });
});

describe("loadPublicUrl (generation config)", () => {
  let cfg: string;
  beforeEach(() => {
    cfg = mkdtempSync(join(tmpdir(), "aurora-cfg-"));
  });
  afterEach(() => {
    rmSync(cfg, { recursive: true, force: true });
  });

  it("reads publicUrl from the generation config file", () => {
    writeFileSync(join(cfg, "gen.json"), JSON.stringify({ publicUrl: "https://aurora.ts.net" }));
    expect(loadPublicUrl(join(cfg, "gen.json"))).toBe("https://aurora.ts.net");
  });

  it("returns undefined when the config is missing or has no publicUrl", () => {
    expect(loadPublicUrl(join(cfg, "missing.json"))).toBeUndefined();
    writeFileSync(join(cfg, "no-url.json"), JSON.stringify({ image: [] }));
    expect(loadPublicUrl(join(cfg, "no-url.json"))).toBeUndefined();
  });
});

// SPA routing for the artifact browser (issue #69): the app shell is served on
// / and /s/* so the client router can resolve the session/artifact; the old
// /preview surface is gone — no redirect, just 404.
describe("SPA routing", () => {
  it.each(["/", "/s", "/s/test-session", "/s/test-session/art-1"])("serves the SPA shell at %s", async (path) => {
    const res = await fetch(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<script");
  });

  it.each(["/preview", "/preview/foo", "/preview/foo/bar"])("%s returns 404 with no redirect", async (path) => {
    const res = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("does not serve the pdf worker", async () => {
    const res = await fetch(`${base}/pdf.worker.min.mjs`);
    expect(res.status).toBe(404);
  });
});
