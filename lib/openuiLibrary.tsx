// Aurora-owned component library for the push_ui tool (issue #39; spec #37).
// This module is the single source of truth: the tool description is GENERATED
// from these component definitions (never hand-written) and push-time
// validation parses against this same library, so docs and validation cannot
// drift. All OpenUI imports live here — the swap boundary.
// v1 scope (tracer bullet): layout + card + text only. Chart/Mermaid land
// with issue #40.
import { z } from "zod";
import {
  createLibrary,
  createParser,
  defineComponent,
  generateSystemPrompt,
} from "@openuidev/react-lang";

/** The text content string cap: no single string literal may exceed this. */
export const MAX_STRING_LENGTH = 10_000;
/** The statement cap: a program may not exceed this many statements. */
export const MAX_STATEMENTS = 200;

/** A line of text content. Use for titles, captions, and narrative. */
export const Text = defineComponent({
  name: "Text",
  description: "A line of text content. Use for titles, captions, and narrative lines.",
  props: z.object({
    content: z.string().describe("The text to display"),
  }),
  component: (p: any) => <p className="aur-ui__text">{p.props.content}</p>,
});

/** A bordered card grouping child elements. */
export const Card = defineComponent({
  name: "Card",
  description: "A bordered card grouping child elements (Text children).",
  props: z.object({
    children: z.array(Text.ref).describe("Card contents"),
  }),
  component: (p: any) => <div className="aur-ui__card">{p.renderNode(p.props.children)}</div>,
});

/** Layout container arranging children in a row or column. */
export const Stack = defineComponent({
  name: "Stack",
  description: "Layout container arranging children (Card, Text, or nested Stack) in a direction.",
  props: z.object({
    children: z.array(z.union([Card.ref, Text.ref])).describe("Child elements"),
    direction: z.enum(["row", "column"]).describe("Layout direction"),
  }),
  component: (p: any) => (
    <div className="aur-ui__stack" data-direction={p.props.direction}>
      {p.renderNode(p.props.children)}
    </div>
  ),
});

/**
 * The aurora UI library. Root is Stack — every program renders a top-level
 * layout container. The client viewer (src/preview/UiArtifact.tsx) imports
 * this same instance so server validation and client rendering share one
 * definition.
 */
export const auroraUiLibrary = createLibrary({
  components: [Stack, Card, Text],
  root: "Stack",
});

/** One validation failure in an agent-submitted UI program. */
export interface UiProgramError {
  /** 1-indexed source line of the offending statement, when locatable. */
  line?: number;
  /** Statement name (e.g. "card1") that triggered the error. */
  statementId?: string;
  /** Machine-readable code (unknown-component, missing-required, excess-args, cap, …). */
  code: string;
  /** Human/LLM-readable description including the expected shape. */
  message: string;
}

/** Format errors into one actionable tool-error string (one line per error). */
export function formatUiProgramErrors(errors: UiProgramError[]): string {
  return (
    "push_ui rejected the program — every invalid or dropped statement is listed. Fix and re-push:\n" +
    errors
      .map((e) => `- ${e.line ? `line ${e.line}: ` : ""}${e.statementId ? `statement "${e.statementId}": ` : ""}${e.code} — ${e.message}`)
      .join("\n")
  );
}

/** Count `identifier = expression` statements at bracket depth 0 (outside strings). */
export function countStatements(source: string): number {
  let depth = 0;
  let count = 0;
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
    } else if (depth === 0 && /[$A-Za-z_]/.test(c)) {
      const m = /^[$A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(i))!;
      const rest = source.slice(i + m[0].length).replace(/^[ \t]*/, "");
      if (rest.startsWith("=") && !rest.startsWith("==")) count++;
      i += m[0].length - 1;
    }
    i++;
  }
  return count;
}

/** 1-indexed line of `id = …`, or undefined when the statement name isn't in the source. */
function lineOfStatement(source: string, id: string): number | undefined {
  const idx = source.search(new RegExp(`^${id.replace(/\$/g, "\\$")}\\s*=`, "m"));
  return idx === -1 ? undefined : source.slice(0, idx).split("\n").length;
}

/** Longest string literal (single/double/backtick, escape-aware) with its line. */
function longestStringLiteral(source: string): { value: string; line: number } | null {
  let quote: string | null = null;
  let start = -1;
  let best: { value: string; line: number } | null = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i++;
      } else if (c === quote) {
        const value = source.slice(start + 1, i);
        const line = source.slice(0, start).split("\n").length;
        if (!best || value.length > best.value.length) best = { value, line };
        quote = null;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      start = i;
    }
  }
  return best;
}

/**
 * Validate a UI program before snapshot: caps first (cheap, guards pathological
 * input), then a full parse against the library. Returns one entry per invalid
 * or dropped statement — the caller surfaces all of them, never silently hides
 * any. Empty array = valid.
 */
export function validateUiProgram(source: string): UiProgramError[] {
  const errors: UiProgramError[] = [];

  // Cap 1: statement count.
  const statements = countStatements(source);
  if (statements > MAX_STATEMENTS) {
    errors.push({
      code: "statement-cap",
      message:
        `Program has ${statements} statements, over the ${MAX_STATEMENTS}-statement cap. ` +
        "Split the dashboard across multiple push_ui artifacts.",
    });
    return errors; // parsing a pathological program serves nothing
  }

  // Cap 2: single string length.
  const longest = longestStringLiteral(source);
  if (longest && longest.value.length > MAX_STRING_LENGTH) {
    errors.push({
      line: longest.line,
      code: "string-cap",
      message:
        `String literal on line ${longest.line} is ${longest.value.length} chars, over the ` +
        `${MAX_STRING_LENGTH.toLocaleString("en-US")}-char cap. Split it across multiple Text statements.`,
    });
  }

  // Full parse against the same library the viewer renders with. Dropped
  // statements (schema errors, unresolved references, orphans) are all surfaced.
  const parser = createParser(auroraUiLibrary.toJSONSchema());
  const result = parser.parse(source);
  const shape = (e: { component?: string; path?: string; message: string }) =>
    `${e.component ?? "program"}${e.path && e.path !== "" ? ` at "${e.path}"` : ""}: ${e.message}`;
  for (const e of result.meta.errors) {
    const line = e.statementId ? lineOfStatement(source, e.statementId) : undefined;
    errors.push({
      line,
      statementId: e.statementId,
      code: e.code,
      message: shape(e) + (e.statementId ? `. Expected shape: see the ${e.component} signature in the tool description.` : ""),
    });
  }
  for (const id of result.meta.unresolved) {
    errors.push({
      line: lineOfStatement(source, id),
      statementId: id,
      code: "unresolved-reference",
      message: `Statement "${id}" is referenced but never defined. Define it (e.g. "${id} = Card([…])") or remove the reference.`,
    });
  }
  for (const id of result.meta.orphaned) {
    errors.push({
      line: lineOfStatement(source, id),
      statementId: id,
      code: "orphaned-statement",
      message: `Statement "${id}" is defined but not reachable from the root Stack — it would be silently dropped. Add it to the root's children.`,
    });
  }
  if (result.root === null && errors.length === 0) {
    errors.push({
      code: "no-root",
      message:
        "Program produced no root. Start with a root statement: root = Stack([…], \"column\").",
    });
  }
  return errors;
}

/**
 * Worked example embedded in the generated description (single source of
 * truth with validation — the example must parse cleanly against this
 * library; the test suite enforces that).
 */
export const WORKED_EXAMPLE = `root = Stack([card1, card2], "row")
card1 = Card([t1])
t1 = Text("Revenue by quarter: $1.2M")
card2 = Card([t2])
t2 = Text("Down 8% versus last quarter")`;

/** Cross-guidance appended to the generated prompt (also present on push_chart). */
export const PUSH_UI_CROSS_GUIDANCE =
  'Use push_chart for a single chart artifact; use push_ui when composing layout (Stack/Card) or weaving text between content blocks in one artifact.';

/**
 * Generate the push_ui tool description from the library definition itself.
 * Budget: target ~600 tokens, hard cap 800 (spec #37); enforced by test.
 */
export function generateUiToolDescription(): string {
  return (
    generateSystemPrompt({
      library: auroraUiLibrary.toSpec(),
      promptOptions: {
        toolCalls: false,
        bindings: false,
        editMode: false,
        inlineMode: false,
        examples: [WORKED_EXAMPLE],
      },
    }) +
    "\n\n" +
    PUSH_UI_CROSS_GUIDANCE
  );
}
