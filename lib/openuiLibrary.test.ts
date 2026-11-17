// Pure-function seam tests for the aurora UI library + validation wrapper
// (issue #39, spec #37 seam 2). Prior art: lib/chartContract.test.ts.
import { describe, expect, test } from "bun:test";
import { encode } from "gpt-tokenizer";
import {
  MAX_STATEMENTS,
  MAX_STRING_LENGTH,
  WORKED_EXAMPLE,
  auroraUiLibrary,
  countStatements,
  formatUiProgramErrors,
  generateUiToolDescription,
  validateUiProgram,
} from "./openuiLibrary";
import { createParser } from "@openuidev/react-lang";
import { chartDataSchema, chartPushSchema } from "./chartContract";

const VALID = WORKED_EXAMPLE;

describe("validateUiProgram (pure seam)", () => {
  test("a valid program returns no errors", () => {
    expect(validateUiProgram(VALID)).toEqual([]);
  });

  test("unknown component: error carries line, statement, code, and available-components hint", () => {
    const src = `root = Stack([bogus], "column")\nbogus = Bogus("nope")`;
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.statementId === "bogus");
    expect(e).toBeDefined();
    expect(e!.code).toBe("unknown-component");
    expect(e!.line).toBe(2);
    expect(e!.message).toContain("Available components");
  });

  test("missing required argument: statement named, expected shape actionable", () => {
    const src = `root = Stack([t3], "column")\nt3 = Text()`;
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.statementId === "t3");
    expect(e).toBeDefined();
    expect(e!.code).toBe("missing-required");
    expect(e!.line).toBe(2);
    expect(e!.message).toContain("content");
  });

  test("excess arguments are rejected with the statement named", () => {
    const src = `root = Stack([t3], "column")\nt3 = Text("hi", "extra")`;
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.statementId === "t3");
    expect(e).toBeDefined();
    expect(e!.code).toBe("excess-args");
  });

  test("orphaned (dropped) statement is surfaced, never silently hidden", () => {
    const src = `root = Stack([card1], "column")
card1 = Card([t1])
t1 = Text("shown")
lost = Text("dropped")`;
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.statementId === "lost");
    expect(e).toBeDefined();
    expect(e!.code).toBe("orphaned-statement");
    expect(e!.message).toContain("dropped");
  });

  test("unresolved reference is surfaced with the statement name", () => {
    const src = 'root = Stack([missing], "column")';
    const errors = validateUiProgram(src);
    expect(errors.some((x) => x.statementId === "missing")).toBe(true);
  });

  test("chart contract accepted verbatim: every chart kind parses cleanly (issue #40)", () => {
    const src = [
      'root = Stack([pie1, bar1, line1, scat1, m1], "column")',
      'pie1 = Chart("pie", {kind: "pie", points: [{label: "A", value: 1}]})',
      'bar1 = Chart("bar", {kind: "categorical", categories: ["x", "y"], series: [{name: "s", values: [1, 2]}]})',
      'line1 = Chart("line", {kind: "line", x: ["a", "b"], series: [{name: "s", values: [1, 2]}]})',
      'scat1 = Chart("scatter", {kind: "scatter", series: [{name: "s", points: [[1, 2], [3, 4]]}]})',
      'm1 = Mermaid("flowchart TD\\n  A-->B")',
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("chart kind mismatch: the SAME error string as the single-chart tool (chartContractError)", () => {
    const src = 'root = Stack([c], "column")\nc = Chart("bar", {kind: "pie", points: [{label: "A", value: 1}]})';
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.statementId === "c");
    expect(e).toBeDefined();
    expect(e!.code).toBe("chart-contract");
    // verbatim message from lib/chartContract.ts, exactly as push_chart returns it
    expect(e!.message).toContain('chart_type "bar" requires data of kind "categorical" (got "pie")');
    expect(e!.line).toBe(2);
  });

  test("chart data shape: push_ui errors are IDENTICAL to push_chart's chartDataSchema rejections", () => {
    // Malformed payloads the OpenUI parser's top-level checks miss entirely.
    const malformed = [
      { kind: "pie" }, // missing required points
      { kind: "pie", points: [{ label: "A", value: "x" }] }, // wrong point value type
      { kind: "bogus" }, // unknown kind
    ];
    malformed.forEach((data, i) => {
      const src = `root = Stack([c${i}], "column")\nc${i} = Chart("pie", ${JSON.stringify(data)})`;
      const errors = validateUiProgram(src).filter((x) => x.code === "chart-data");
      // push_chart rejects the same payload through the same contract schema.
      expect(chartPushSchema.safeParse({ chart_type: "pie", data }).success).toBe(false);
      const contractParse = chartDataSchema.safeParse(data);
      const pushChartIssues = contractParse.success ? [] : contractParse.error.issues;
      expect(pushChartIssues.length).toBeGreaterThan(0);
      expect(errors.length).toBe(pushChartIssues.length);
      // Every zod issue from the push_chart contract is wrapped verbatim.
      pushChartIssues.forEach((issue) => {
        const e = errors.find((x) => x.message.includes(`at "${issue.path.join(".")}": ${issue.message}`));
        expect(e).toBeDefined();
        expect(e!.line).toBe(2);
        expect(e!.statementId).toBe(`c${i}`);
      });
    });
  });

  test("mermaid newlines: \\n escapes in the source string become real newlines", () => {
    const src = 'root = Stack([m], "column")\nm = Mermaid("flowchart TD\\n  A-->B")';
    const parser = createParser(auroraUiLibrary.toJSONSchema());
    const result = parser.parse(src);
    expect(result.meta.errors).toHaveLength(0);
    const props = (result.root as any)?.props?.children?.[0]?.props;
    expect(props.source).toBe("flowchart TD\n  A-->B");
  });

  test("statement cap: 201 statements rejected with an actionable message", () => {
    const lines = [`root = Stack([c0], "column")`, `c0 = Card([t0])`];
    // Extra sibling cards not in root stay orphaned — the cap fires before
    // parse, so use standalone text statements on one line each.
    const src = [lines.join("\n"), ...Array.from({ length: MAX_STATEMENTS }, (_, i) => `t${i} = Text("x")`)].join("\n");
    const errors = validateUiProgram(src);
    expect(errors.some((x) => x.code === "statement-cap" && x.message.includes("200"))).toBe(true);
  });

  test("string cap: an over-long string is rejected with line and cap", () => {
    const big = "x".repeat(MAX_STRING_LENGTH + 1);
    const src = `root = Stack([t], "column")\nt = Text("${big}")`;
    const errors = validateUiProgram(src);
    const e = errors.find((x) => x.code === "string-cap");
    expect(e).toBeDefined();
    expect(e!.line).toBe(2);
    expect(e!.message).toContain("10,000");
  });

  test("Card holds a Mermaid: no errors (validation scenario 1)", () => {
    const src = 'root = Stack([c], "column")\nc = Card([m])\nm = Mermaid("flowchart TD\\nA-->B")';
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("Card holds Text, Chart, and Mermaid together", () => {
    const src = [
      'root = Stack([c], "column")',
      "c = Card([t, ch, m])",
      't = Text("hi")',
      'ch = Chart("pie", {kind: "pie", points: [{label: "A", value: 1}]})',
      'm = Mermaid("flowchart TD\\nA-->B")',
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("Chart inside a Card hits the same chart-contract check as standalone (scenario 2)", () => {
    const chart = 'Chart("pie", {kind: "categorical", categories: ["a"], series: [{name: "s", values: [1]}]})';
    const nested = validateUiProgram(`root = Stack([c], "column")\nc = Card([ch])\nch = ${chart}`);
    const standalone = validateUiProgram(`root = Stack([ch], "column")\nch = ${chart}`);
    const n = nested.find((x) => x.code === "chart-contract");
    const s = standalone.find((x) => x.code === "chart-contract");
    expect(n).toBeDefined();
    expect(s).toBeDefined();
    expect(n!.message).toBe(s!.message);
    expect(n!.statementId).toBe("ch");
    expect(n!.line).toBe(3);
  });

  test("Chart inside a Card hits the same chart-data check as standalone", () => {
    const src = 'root = Stack([c], "column")\nc = Card([ch])\nch = Chart("pie", {kind: "pie"})';
    const e = validateUiProgram(src).find((x) => x.code === "chart-data");
    expect(e).toBeDefined();
    expect(e!.statementId).toBe("ch");
  });

  test("Stack inside Card: one child-type error naming the allowed types (scenario 3)", () => {
    const src = 'root = Stack([c], "column")\nc = Card([s])\ns = Stack([t], "row")\nt = Text("x")';
    const errors = validateUiProgram(src).filter((x) => x.code === "child-type");
    expect(errors).toHaveLength(1);
    expect(errors[0].statementId).toBe("s");
    expect(errors[0].line).toBe(3);
    expect(errors[0].message).toContain("Text | Chart | Mermaid");
    expect(errors[0].message).toContain("Card");
    expect(errors[0].message).toContain("Stack");
  });

  test("Card inside Card is rejected (Card is not in Card's union)", () => {
    const src = 'root = Stack([c], "column")\nc = Card([d])\nd = Card([t])\nt = Text("x")';
    const errors = validateUiProgram(src).filter((x) => x.code === "child-type");
    expect(errors).toHaveLength(1);
    expect(errors[0].statementId).toBe("d");
  });

  test("inline out-of-union child reports the parent's statement and line", () => {
    const src = 'root = Stack([c], "column")\nc = Card([Stack([Text("x")], "row")])';
    const errors = validateUiProgram(src).filter((x) => x.code === "child-type");
    expect(errors).toHaveLength(1);
    expect(errors[0].statementId).toBe("c");
    expect(errors[0].line).toBe(2);
  });

  test("Stack nests Stack (scenario 4)", () => {
    const src = 'root = Stack([s], "column")\ns = Stack([t], "row")\nt = Text("x")';
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("Stack nests Stack with siblings and deeper levels", () => {
    const src = [
      'root = Stack([a, b], "column")',
      'a = Stack([c], "row")',
      'b = Stack([t2], "row")',
      "c = Card([t1])",
      't1 = Text("x")',
      't2 = Text("y")',
    ].join("\n");
    expect(validateUiProgram(src)).toEqual([]);
  });

  test("allowed-children sets come from the JSON Schema (Card = Text | Chart | Mermaid)", () => {
    const schema: any = auroraUiLibrary.toJSONSchema();
    const names = (schema.$defs.Card.properties.children.items.anyOf as { $ref: string }[]).map((r) =>
      r.$ref.split("/").pop()
    );
    expect(names).toEqual(["Text", "Chart", "Mermaid"]);
  });

  test("formatUiProgramErrors lists every error on its own line", () => {
    const text = formatUiProgramErrors([
      { line: 3, statementId: "b", code: "unknown-component", message: "nope" },
      { statementId: "c", code: "orphaned-statement", message: "dropped" },
    ]);
    expect(text.split("\n").length).toBe(3);
    expect(text).toContain("line 3");
    expect(text).toContain("dropped");
  });
});

describe("countStatements", () => {
  test("counts depth-0 assignments, ignoring brackets, strings, and == ", () => {
    expect(countStatements(VALID)).toBe(3);
    expect(
      countStatements('root = Stack([t], "column")\nt = Text("a = b")\nx = Text("=not-a-statement=")')
    ).toBe(3);
  });
});

describe("generated description (single source of truth)", () => {
  test("budget: at or under the 1,300-token hard cap", () => {
    const prompt = generateUiToolDescription();
    expect(encode(prompt).length).toBeLessThanOrEqual(1300);
  });

  test("strips the generic Hoisting & Important Rules sections", () => {
    const prompt = generateUiToolDescription();
    expect(prompt).not.toContain("## Hoisting & Streaming (CRITICAL)");
    expect(prompt).not.toContain("## Important Rules");
    expect(prompt).toContain("## Component Signatures");
    expect(prompt).toContain("## Examples");
    expect(prompt).toContain("## Final Verification");
  });

  test("signatures show Card's widened children and Stack nesting", () => {
    const prompt = generateUiToolDescription();
    expect(prompt).toContain("Card(children: (Text | Chart | Mermaid)[])");
    expect(prompt).toMatch(/Stack\(.*— .*nest/i);
  });

  test("carries the cross-guidance line and the worked example", () => {
    const prompt = generateUiToolDescription();
    expect(prompt).toContain("push_chart");
    expect(prompt).toContain("push_ui");
    expect(prompt).toContain(WORKED_EXAMPLE.split("\n")[0]);
  });

  test("worked example parses cleanly against the shipped library (no drift)", () => {
    const parser = createParser(auroraUiLibrary.toJSONSchema());
    expect(parser.parse(WORKED_EXAMPLE).meta.errors).toHaveLength(0);
  });
});
