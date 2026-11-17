// DigestCard (issue #90, spec #86 D6/D7/D8): library shape, validation codes,
// and collapsed-markup tests per variant. Prior art: lib/openuiLibrary.test.ts.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Renderer } from "@openuidev/react-lang";
import { auroraUiLibrary, generateUiToolDescription, handleProblem, validateUiProgram } from "./openuiLibrary";
import { splitParagraphs } from "../src/preview/DigestCardView";
import { toggleKey } from "../src/preview/expandState";

const HERO = (id = "itm-001", extra = "") =>
  [`root = Stack([h], "column")`, `h = DigestCard("${id}", "hero", "T", "Src", "EN", 5, "Sapo", "Why"${extra})`].join("\n");

const render = (src: string) =>
  renderToStaticMarkup(<Renderer library={auroraUiLibrary} response={src} isStreaming={false} />);

describe("DigestCard validation", () => {
  test("a minimal hero parses cleanly", () => {
    expect(validateUiProgram(HERO())).toEqual([]);
  });

  test("hero + rail column + list in nested row Stacks parses cleanly", () => {
    const src = [
      'root = Stack([top, l1], "column")',
      'top = Stack([h, rail], "row")',
      'rail = Stack([r1, r2], "column")',
      'h = DigestCard("a-1", "hero", "T", "S", "EN", 5, "Sapo", "Why", "p1\\n\\np2", [m], "https://example.com/x")',
      'm = Mermaid("flowchart TD\\nA-->B")',
      'r1 = DigestCard("a-2", "rail", "T", "S", "VI", 2, "Sapo", "Why")',
      'r2 = DigestCard("a-3", "rail", "T", "S", "VI", 2, "Sapo", "Why")',
      'l1 = DigestCard("a-4", "list", "T", "S", "EN", 3, "Sapo", "Why")',
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("unknown variant is rejected", () => {
    const src = 'root = Stack([h], "column")\nh = DigestCard("a", "huge", "T", "S", "EN", 5, "Sapo", "Why")';
    expect(validateUiProgram(src).length).toBeGreaterThan(0);
  });

  test("duplicate-handle: same story_id twice names the second statement", () => {
    const src = [
      'root = Stack([a, b], "column")',
      'a = DigestCard("itm-001", "list", "T", "S", "EN", 5, "Sapo", "Why")',
      'b = DigestCard("itm-001", "list", "T", "S", "EN", 5, "Sapo", "Why")',
    ].join("\n");
    const errors = validateUiProgram(src);
    expect(errors.map((e) => e.code)).toEqual(["duplicate-handle"]);
    expect(errors[0].statementId).toBe("b");
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toContain("itm-001");
  });

  test("invalid-handle: whitespace, empty, and over 64 chars", () => {
    expect(validateUiProgram(HERO("a b")).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(HERO("")).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(HERO("x".repeat(65))).map((e) => e.code)).toEqual(["invalid-handle"]);
    expect(validateUiProgram(HERO("x".repeat(64)))).toEqual([]);
  });

  test("invalid-url: anything not starting with https://", () => {
    expect(validateUiProgram(HERO("a", ', "", [], "http://x"')).map((e) => e.code)).toEqual(["invalid-url"]);
    expect(validateUiProgram(HERO("a", ', "", [], "javascript:alert(1)"')).map((e) => e.code)).toEqual(["invalid-url"]);
    expect(validateUiProgram(HERO("a", ', "", [], "https://x.dev/a"'))).toEqual([]);
  });

  test("DigestCard children accept Text | Chart | Mermaid only", () => {
    const schema: any = auroraUiLibrary.toJSONSchema();
    const names = (schema.$defs.DigestCard.properties.children.items.anyOf as { $ref: string }[]).map((r) =>
      r.$ref.split("/").pop()
    );
    expect(names).toEqual(["Text", "Chart", "Mermaid"]);
    const src = [
      'root = Stack([h], "column")',
      'h = DigestCard("a", "hero", "T", "S", "EN", 5, "Sapo", "Why", "", [s])',
      's = Stack([], "row")',
    ].join("\n");
    expect(validateUiProgram(src).map((e) => e.code)).toContain("child-type");
  });

  test("DigestCard is allowed as a Stack child but not inside a Card", () => {
    const src = [
      'root = Stack([c], "column")',
      "c = Card([h])",
      'h = DigestCard("a", "hero", "T", "S", "EN", 5, "Sapo", "Why")',
    ].join("\n");
    expect(validateUiProgram(src).map((e) => e.code)).toContain("child-type");
  });
});

describe("handleProblem (reusable by ThreadUpdate.thread_id)", () => {
  test("describes why a handle is invalid, null when valid", () => {
    expect(handleProblem("")).toMatch(/empty/i);
    expect(handleProblem("a b")).toMatch(/whitespace/i);
    expect(handleProblem("x".repeat(65))).toMatch(/64/);
    expect(handleProblem("itm-001")).toBeNull();
  });
});

describe("DigestCard in the generated description", () => {
  test("signature lists props in the exact positional order", () => {
    expect(generateUiToolDescription()).toContain(
      'DigestCard(story_id: string, variant: "hero" | "rail" | "list", title: string, source: string, lang: string, minutes: number, sapo: string, why: string, body?: string, children?: (Text | Chart | Mermaid)[], url?: string)'
    );
  });

  test("Stack signature lists DigestCard among its children", () => {
    expect(generateUiToolDescription()).toMatch(/Stack\(children: \([^)]*DigestCard/);
  });
});

describe("DigestCard markup, collapsed", () => {
  const full = (variant: string) =>
    `root = Stack([h], "column")\nh = DigestCard("itm-9", "${variant}", "Big headline", "Reuters", "EN", 4, "The sapo.", "Because you follow it", "Para one.\\n\\nPara two.", [], "https://example.com/a")`;

  test("hero: badges, handle chip, title, sapo, why callout; expanded region hidden", () => {
    const html = render(full("hero"));
    expect(html).toContain("aur-digest--hero");
    expect(html).toContain("is-expandable");
    expect(html).toContain("Reuters");
    expect(html).toContain("4 min");
    expect(html).toContain(">itm-9<");
    expect(html).toContain("<h2");
    expect(html).toContain("The sapo.");
    expect(html).toContain("Why you");
    expect(html).toContain("Because you follow it");
    expect(html).toContain("Read digest");
    expect(html).not.toContain("Para one.");
    expect(html).not.toContain("Original source");
    expect(html).not.toContain("is-open");
  });

  test("rail: compact card with why line, no Why-you label", () => {
    const html = render(full("rail"));
    expect(html).toContain("aur-digest--rail");
    expect(html).toContain("Because you follow it");
    expect(html).not.toContain("Why you");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("Para one.");
  });

  test("list: one row, byline, why hidden until expanded", () => {
    const html = render(full("list"));
    expect(html).toContain("aur-digest--list");
    expect(html).toContain("Reuters · EN · 4 min");
    expect(html).toContain("The sapo.");
    expect(html).not.toContain("Because you follow it");
    expect(html).not.toContain("Para one.");
  });

  test("not expandable without body, children, or url", () => {
    const html = render(HERO());
    expect(html).not.toContain("is-expandable");
    expect(html).not.toContain("Read digest");
  });

  test("card markup emits no inline styles (the Renderer's own wrapper is not ours)", () => {
    const card = /<article[\s\S]*<\/article>/.exec(render(full("hero")))![0];
    expect(card).not.toContain("style=");
  });
});

describe("digest helpers", () => {
  test("splitParagraphs splits on blank lines and drops empties", () => {
    expect(splitParagraphs("a\n\nb\n \n c ")).toEqual(["a", "b", "c"]);
    expect(splitParagraphs(undefined)).toEqual([]);
    expect(splitParagraphs("single\nline")).toEqual(["single\nline"]);
  });

  test("toggleKey flips one key and leaves others", () => {
    const s1 = toggleKey({}, "a");
    expect(s1).toEqual({ a: true });
    expect(toggleKey(s1, "b")).toEqual({ a: true, b: true });
    expect(toggleKey(s1, "a")).toEqual({ a: false });
  });
});
