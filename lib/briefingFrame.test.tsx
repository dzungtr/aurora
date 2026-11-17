// Briefing frame (issue #91, spec #86 D9): BriefingHeader, SectionHeader,
// ThreadUpdate, SkipList, DoneMarker — library shape, thread_id handles,
// collapsed markup, and the digest worked example. Prior art: digestCard.test.tsx.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createParser, Renderer } from "@openuidev/react-lang";
import { encode } from "gpt-tokenizer";
import {
  auroraUiLibrary,
  DIGEST_WORKED_EXAMPLE,
  generateUiToolDescription,
  statementNames,
  validateUiProgram,
} from "./openuiLibrary";

const render = (src: string) =>
  renderToStaticMarkup(<Renderer library={auroraUiLibrary} response={src} isStreaming={false} />);

/** A full briefing in the shape of the mockup's sample data (lines 479-547). */
const BRIEFING = [
  'root = Stack([hdr, top, sec1, itm_005, itm_006, sec2, itm_007, thr_neo4j, skips, done], "column")',
  'hdr = BriefingHeader("Wednesday, 4 November 2026", 142, 9, 24, true, "Tech · daily briefing", [{time: "06:00", label: "Morning scan", state: "done"}, {time: "08:00", label: "YouTube pass", state: "done"}, {time: "12:00", label: "Breaking pass", state: "running"}])',
  'top = Stack([itm_001, rail], "row")',
  'rail = Stack([itm_002, itm_003], "column")',
  'itm_001 = DigestCard("itm-001", "hero", "Managed Agents go GA", "The Information", "EN", 6, "Sapo.", "Why you.", "Para one.\\n\\nPara two.", [prov], "https://example.com/launch")',
  'prov = Mermaid("graph LR\\nA-->B")',
  'itm_002 = DigestCard("itm-002", "rail", "Postgres 18 async I/O", "Hacker News", "EN", 4, "Sapo.", "Why you.")',
  'itm_003 = DigestCard("itm-003", "rail", "VNG data centre", "VnExpress", "VI", 3, "Sapo.", "Why you.")',
  'sec1 = SectionHeader("Agent infra", "2 items")',
  'itm_005 = DigestCard("itm-005", "list", "MCP resumable sessions", "modelcontextprotocol.io", "EN", 3, "Sapo.", "Why you.")',
  'itm_006 = DigestCard("itm-006", "list", "Orange Pi NPU driver", "LWN", "EN", 2, "Sapo.", "Why you.")',
  'sec2 = SectionHeader("Dev tooling")',
  'itm_007 = DigestCard("itm-007", "list", "Bun test sharding", "bun.sh", "EN", 2, "Sapo.", "Why you.")',
  'thr_neo4j = ThreadUpdate("thr-neo4j", "Graph memory for agents", "Neo4j published the benchmark.", "Day 3", [{when: "Mon 2", text: "Thread opened."}, {when: "Tue 3", text: "Two competing results."}])',
  'skips = SkipList(12, [{title: "Listicle", reason: "low signal"}, {title: "Rust release notes", reason: "already read"}])',
  'done = DoneMarker("You\'re done with Tech.", "9 kept of 142 scanned.")',
].join("\n");

describe("briefing frame library", () => {
  test("component order is the spec'd final order, root Stack", () => {
    const spec: any = auroraUiLibrary.toSpec();
    expect(Object.keys(spec.components)).toEqual([
      "Stack", "Card", "Text", "Chart", "Mermaid", "BriefingHeader", "DigestCard",
      "SectionHeader", "ThreadUpdate", "SkipList", "DoneMarker",
    ]);
  });

  test("Stack children accept all five frame components", () => {
    const schema: any = auroraUiLibrary.toJSONSchema();
    const names = (schema.$defs.Stack.properties.children.items.anyOf as { $ref: string }[]).map((r) =>
      r.$ref.split("/").pop()
    );
    for (const n of ["BriefingHeader", "SectionHeader", "ThreadUpdate", "SkipList", "DoneMarker"]) {
      expect(names).toContain(n);
    }
  });

  test("signatures list props in the exact positional order", () => {
    const d = generateUiToolDescription();
    expect(d).toContain("BriefingHeader(date: string, scanned: number, kept: number, minutes?: number, live?: boolean, kicker?: string, passes?: ");
    expect(d).toContain("SectionHeader(label: string, note?: string)");
    expect(d).toContain("ThreadUpdate(thread_id: string, title: string, update: string, day?: string, history?: ");
    expect(d).toContain("SkipList(count: number, items: ");
    expect(d).toContain("DoneMarker(title: string, text?: string)");
  });

  test("pass state is a closed enum", () => {
    const bad = 'root = Stack([h], "column")\nh = BriefingHeader("d", 1, 1, 1, true, "k", [{time: "6", label: "x", state: "paused"}])';
    expect(validateUiProgram(bad).length).toBeGreaterThan(0);
  });

  test("a frame component may not sit inside a Card", () => {
    const src = 'root = Stack([c], "column")\nc = Card([s])\ns = SectionHeader("x")';
    expect(validateUiProgram(src).length).toBeGreaterThan(0);
  });
});

describe("full briefing round trip", () => {
  test("validates with zero errors", () => {
    expect(validateUiProgram(BRIEFING)).toEqual([]);
  });

  test("statementNames returns every name in source order", () => {
    expect(statementNames(BRIEFING)).toEqual([
      "root", "hdr", "top", "rail", "itm_001", "prov", "itm_002", "itm_003", "sec1", "itm_005",
      "itm_006", "sec2", "itm_007", "thr_neo4j", "skips", "done",
    ]);
  });

  test("order is not enforced: done first, header last is valid (D9)", () => {
    const src = [
      'root = Stack([done, hdr], "column")',
      'done = DoneMarker("Done")',
      'hdr = BriefingHeader("d", 5, 1)',
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("kept is not derived from the card count (D9)", () => {
    const html = render(
      'root = Stack([hdr, c], "column")\nhdr = BriefingHeader("d", 100, 42)\nc = DigestCard("a", "list", "T", "S", "EN", 1, "Sapo", "Why")'
    );
    expect(html).toContain(">42<");
  });
});

describe("thread_id handles", () => {
  const thread = (id: string, name = "t") =>
    `${name} = ThreadUpdate(${JSON.stringify(id)}, "Title", "Update")`;

  test("invalid-handle: whitespace, empty, over 64 chars", () => {
    const wrap = (id: string) => `root = Stack([t], "column")\n${thread(id)}`;
    expect(validateUiProgram(wrap("a b")).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(wrap("")).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(wrap("x".repeat(65))).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(wrap("x".repeat(64)))).toEqual([]);
  });

  test("duplicate-handle names the second statement and line", () => {
    const src = ['root = Stack([a, b], "column")', thread("thr-1", "a"), thread("thr-1", "b")].join("\n");
    const errors = validateUiProgram(src);
    expect(errors.map((e) => e.code)).toEqual(["duplicate-handle"]);
    expect(errors[0].statementId).toBe("b");
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toContain("thread_id");
  });

  test("own uniqueness namespace: the same string as a story_id and a thread_id is valid", () => {
    const src = [
      'root = Stack([c, t], "column")',
      'c = DigestCard("same-1", "list", "T", "S", "EN", 1, "Sapo", "Why")',
      thread("same-1"),
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });
});

describe("frame markup", () => {
  test("BriefingHeader: kicker, date, stats, Live pill, pass timeline", () => {
    const html = render(BRIEFING);
    expect(html).toContain("aur-digest-header");
    expect(html).toContain("Tech · daily briefing");
    expect(html).toContain("<h1");
    expect(html).toContain("Wednesday, 4 November 2026");
    expect(html).toContain(">142<");
    expect(html).toContain(">9<");
    expect(html).toContain(">24<");
    expect(html).toContain("Live");
    expect(html).toContain("06:00");
    expect(html).toContain("Morning scan");
    expect(html).toContain("is-running");
    expect(html).toContain("is-done");
  });

  test("BriefingHeader: optional props omitted means no pill, no minutes, no timeline", () => {
    const html = render('root = Stack([h], "column")\nh = BriefingHeader("Mon 2 Nov", 10, 2)');
    expect(html).toContain("Mon 2 Nov");
    expect(html).not.toContain("Live");
    expect(html).not.toContain("aur-digest-header__passes");
    expect(html).not.toContain(" min<");
  });

  test("SectionHeader: label and optional note", () => {
    const html = render(BRIEFING);
    expect(html).toContain("aur-digest-section");
    expect(html).toContain("Agent infra");
    expect(html).toContain("2 items");
    expect(html).toContain("Dev tooling");
  });

  test("ThreadUpdate: title, day, handle chip, update, history rows", () => {
    const html = render(BRIEFING);
    expect(html).toContain("aur-digest-thread");
    expect(html).toContain("Graph memory for agents");
    expect(html).toContain("Day 3");
    expect(html).toContain(">thr-neo4j<");
    expect(html).toContain("Neo4j published the benchmark.");
    expect(html).toContain("Mon 2");
    expect(html).toContain("Two competing results.");
  });

  test("SkipList: collapsed by default, header counts, items hidden", () => {
    const html = render(BRIEFING);
    expect(html).toContain("Skipped 12");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("low signal");
    expect(html).not.toContain("Rust release notes");
  });

  test("DoneMarker: title and text", () => {
    const html = render(BRIEFING);
    expect(html).toContain("aur-digest-done");
    expect(html).toContain("You&#x27;re done with Tech.");
    expect(html).toContain("9 kept of 142 scanned.");
  });

  test("frame markup emits no inline styles", () => {
    const html = render(BRIEFING);
    const frame = html.match(/<(header|section|div)[^>]*class="aur-digest-(header|section|thread|skips|done)[\s\S]*?(?=<article|$)/g) ?? [];
    expect(frame.length).toBeGreaterThan(0);
    for (const chunk of frame) expect(chunk).not.toContain("style=");
  });
});

describe("digest worked example in the generated description", () => {
  test("parses with zero errors and zero validateUiProgram errors", () => {
    const parser = createParser(auroraUiLibrary.toJSONSchema());
    expect(parser.parse(DIGEST_WORKED_EXAMPLE).meta.errors).toHaveLength(0);
    expect(validateUiProgram(DIGEST_WORKED_EXAMPLE)).toEqual([]);
  });

  test("uses every digest component, the hero+rail row Stack, and handle-as-statement-name", () => {
    for (const c of ["BriefingHeader", "DigestCard", "SectionHeader", "ThreadUpdate", "SkipList", "DoneMarker"]) {
      expect(DIGEST_WORKED_EXAMPLE).toContain(`${c}(`);
    }
    expect(DIGEST_WORKED_EXAMPLE).toMatch(/Stack\(\[itm_001, rail\], "row"\)/);
    // the story_id "itm-001" is the statement name itm_001 with hyphens
    expect(DIGEST_WORKED_EXAMPLE).toMatch(/itm_001 = DigestCard\("itm-001"/);
    expect(DIGEST_WORKED_EXAMPLE).toMatch(/thr_\w+ = ThreadUpdate\("thr-/);
  });

  test("both worked examples ship in the description, under the 1,300-token cap", () => {
    const d = generateUiToolDescription();
    expect(d).toContain('root = Stack([c, m], "column")');
    expect(d).toContain(DIGEST_WORKED_EXAMPLE.split("\n")[0]);
    expect(d).toContain("push_chart");
    expect(d).not.toContain("## Hoisting & Streaming (CRITICAL)");
    expect(d).not.toContain("## Important Rules");
    expect(encode(d).length).toBeLessThanOrEqual(1300);
  });
});
