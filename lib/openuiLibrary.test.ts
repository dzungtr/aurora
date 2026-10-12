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
    expect(countStatements(VALID)).toBe(5);
    expect(
      countStatements('root = Stack([t], "column")\nt = Text("a = b")\nx = Text("=not-a-statement=")')
    ).toBe(3);
  });
});

describe("generated description (single source of truth)", () => {
  test("budget: at or under the 800-token hard cap", () => {
    const prompt = generateUiToolDescription();
    expect(encode(prompt).length).toBeLessThanOrEqual(800);
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
