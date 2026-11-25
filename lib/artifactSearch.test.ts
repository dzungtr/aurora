import { describe, it, expect } from "bun:test";
import { makeSnippet } from "./artifactSearch";

describe("makeSnippet", () => {
  it("returns short text whole, with whitespace collapsed and no ellipsis", () => {
    expect(makeSnippet("a  b\n\nc\td", "zzz")).toBe("a b c d");
  });

  it("starts at the beginning when no query term occurs, ellipsis at the cut end only", () => {
    const text = "start " + "filler ".repeat(100);
    const snippet = makeSnippet(text, "absent");
    expect(snippet.startsWith("start filler")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.startsWith("…")).toBe(false);
    expect(snippet.length).toBeLessThanOrEqual(202);
  });

  it("centres on the first query term found, case-insensitively, with ellipses at both cut ends", () => {
    const text = "lorem ".repeat(100) + "THIRTY days " + "ipsum ".repeat(100);
    const snippet = makeSnippet(text, "missing thirty");
    expect(snippet).toContain("THIRTY days");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(202);
  });

  it("stays inside the text when the term is at the very end", () => {
    const text = "x ".repeat(300) + "needle";
    const snippet = makeSnippet(text, "needle");
    expect(snippet.endsWith("needle")).toBe(true);
    expect(snippet.startsWith("…")).toBe(true);
  });
});
