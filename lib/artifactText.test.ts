import { describe, it, expect } from "bun:test";
import { chunksFor, embedInput, searchableText, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS } from "./artifactText";

const meta = (type: string, title = "My title") => ({ type, title });

describe("searchableText", () => {
  const cases: { name: string; type: string; content: string; expected: string | null }[] = [
    { name: "markdown: title, blank line, source", type: "markdown", content: "# H\nbody", expected: "My title\n\n# H\nbody" },
    { name: "mermaid: title, blank line, source", type: "mermaid", content: "flowchart TD\n A --> B", expected: "My title\n\nflowchart TD\n A --> B" },
    {
      name: "chart: string values in document order, keys and numbers dropped",
      type: "chart",
      content: JSON.stringify({
        chart_type: "line",
        data: { kind: "line", x: ["Mon", "Tue"], series: [{ name: "Latency p99", values: [1, 2.5] }], note: "ok" },
      }),
      expected: "My title\n\nline\nline\nMon\nTue\nLatency p99\nok",
    },
    { name: "chart: unparseable JSON yields the title alone", type: "chart", content: "{not json", expected: "My title" },
    { name: "chart: no string values yields the title alone", type: "chart", content: "[1,2,3]", expected: "My title" },
    {
      name: "ui: double-quoted literals in source order, identifiers dropped",
      type: "ui",
      content: 'root = Stack([card1], "column")\ncard1 = Card([t1])\nt1 = Text("hello aurora")',
      expected: "My title\n\ncolumn\nhello aurora",
    },
    {
      name: "ui: escapes are resolved",
      type: "ui",
      content: 't = Text("say \\"hi\\"\\nthere")',
      expected: 'My title\n\nsay "hi"\nthere',
    },
    { name: "ui: no literals yields the title alone", type: "ui", content: "root = Stack([a])", expected: "My title" },
    { name: "ui: an unterminated literal is ignored", type: "ui", content: 'a = Text("fine")\nb = Text("dangling', expected: "My title\n\nfine" },
    { name: "image: title alone", type: "image", content: "", expected: "My title" },
    { name: "audio: not indexed", type: "audio", content: "", expected: null },
    { name: "video: not indexed", type: "video", content: "", expected: null },
    { name: "unknown type: title, blank line, source", type: "widget", content: "src", expected: "My title\n\nsrc" },
  ];

  it.each(cases)("$name", ({ type, content, expected }) => {
    expect(searchableText(meta(type), content)).toBe(expected);
  });

  it("drops chart keys even when a key equals a searched word", () => {
    const text = searchableText(meta("chart"), JSON.stringify({ chart_type: "line", data: { kind: "line" } }))!;
    expect(text).not.toContain("chart_type");
    expect(text).not.toContain("kind");
  });
});

describe("chunksFor", () => {
  it("returns no chunks for audio and video", () => {
    expect(chunksFor(meta("audio"), "")).toEqual([]);
    expect(chunksFor(meta("video"), "")).toEqual([]);
  });

  it("returns one chunk numbered 0 for short text, for every indexed type", () => {
    for (const type of ["markdown", "mermaid", "chart", "ui", "image"]) {
      const chunks = chunksFor(meta(type), "");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.chunk_no).toBe(0);
    }
  });

  it("keeps text of exactly 1,500 characters as one chunk", () => {
    const content = "x".repeat(CHUNK_MAX_CHARS - "My title\n\n".length);
    expect(chunksFor(meta("markdown"), content)).toHaveLength(1);
  });

  it("is deterministic", () => {
    const content = "word ".repeat(2000);
    expect(chunksFor(meta("mermaid"), content)).toEqual(chunksFor(meta("mermaid"), content));
  });

  it("splits long non-markdown text into windows of at most 1,500 characters that overlap", () => {
    const content = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunksFor(meta("mermaid"), content);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.chunk_no)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    for (let i = 1; i < chunks.length; i++) {
      // the tail of the previous window reappears at the head of the next
      const tail = chunks[i - 1]!.text.slice(-(CHUNK_OVERLAP_CHARS / 3));
      expect(chunks[i]!.text).toContain(tail.trim());
    }
  });

  it("breaks windows at whitespace so words are not cut at the end of a chunk", () => {
    const content = Array.from({ length: 1200 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunksFor(meta("ui"), content);
    for (const c of chunks.slice(0, -1)) expect(c.text).toMatch(/w\d+$/);
  });

  it("hard-cuts long text that has no whitespace and still terminates", () => {
    const chunks = chunksFor(meta("mermaid"), "x".repeat(5000));
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
  });

  it("splits long markdown at heading lines first", () => {
    const section = (n: number) => `## Section ${n}\n${"alpha ".repeat(100)}`;
    const content = [1, 2, 3, 4, 5].map(section).join("\n");
    const chunks = chunksFor(meta("markdown"), content);
    expect(chunks).toHaveLength(6); // title preamble + five sections
    expect(chunks[0]!.text.startsWith("My title")).toBe(true);
    chunks.slice(1).forEach((c, i) => expect(c.text.startsWith(`## Section ${i + 1}`)).toBe(true));
  });

  it("window-splits a markdown section that is still over 1,500 characters", () => {
    const content = `## Big\n${"beta ".repeat(1000)}\n## Small\nshort`;
    const chunks = chunksFor(meta("markdown"), content);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.at(-1)!.text).toBe("## Small\nshort");
  });

  it("does not treat # inside a line or without a space as a heading", () => {
    const content = `intro\n#nospace\nx # y\n${"gamma ".repeat(400)}`;
    const chunks = chunksFor(meta("markdown"), content);
    // no heading line: windows only, so the head of the text stays in chunk 0
    expect(chunks[0]!.text).toContain("#nospace");
  });
});

describe("embedInput", () => {
  it("prefixes the chunk with session and artifact title", () => {
    expect(embedInput("Session A", "Report", "body text")).toBe("Session A › Report\n\nbody text");
  });
});
