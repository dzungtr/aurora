// lib/fsSafe.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSafe, PathTraversalError } from "./fsSafe";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zui-explorer-test-"));
  mkdirSync(join(root, "a", "b"), { recursive: true });
  writeFileSync(join(root, "a", "b", "c.txt"), "hello");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveSafe", () => {
  it("resolves a legitimate nested path", () => {
    const result = resolveSafe(root, "a/b/c.txt");
    expect(result).toBe(join(root, "a", "b", "c.txt"));
  });

  it("rejects a ../ traversal", () => {
    expect(() => resolveSafe(root, "../escape.txt")).toThrow(PathTraversalError);
  });

  it("rejects a deep ../ traversal", () => {
    expect(() => resolveSafe(root, "a/../../escape.txt")).toThrow(PathTraversalError);
  });

  it("sandboxes an absolute-path override under root instead of escaping", () => {
    const result = resolveSafe(root, "/etc/passwd");
    expect(result.startsWith(root)).toBe(true);
    expect(result).not.toBe("/etc/passwd");
  });

  it("rejects a symlink that escapes root", () => {
    const outside = mkdtempSync(join(tmpdir(), "zui-explorer-outside-"));
    writeFileSync(join(outside, "secret.txt"), "nope");
    symlinkSync(outside, join(root, "escape-link"));
    expect(() => resolveSafe(root, "escape-link/secret.txt")).toThrow(PathTraversalError);
    rmSync(outside, { recursive: true, force: true });
  });

  it("resolves a path to a not-yet-existing file for creation", () => {
    const result = resolveSafe(root, "a/new-file.txt");
    expect(result).toBe(join(root, "a", "new-file.txt"));
  });
});
