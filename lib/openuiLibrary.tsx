// Aurora-owned component library for the push_ui tool (issue #39; spec #37).
// This module is the single source of truth: the tool description is GENERATED
// from these component definitions (never hand-written) and push-time
// validation parses against this same library, so docs and validation cannot
// drift. All OpenUI imports live here — the swap boundary.
// Chart (issue #40) wraps the existing chart data contract verbatim — the
// same zod schemas and validation errors as push_chart — and the Mermaid
// component wraps the existing mermaid render path (src/preview/MermaidView).
import { z } from "zod";
import {
  createLibrary,
  createParser,
  defineComponent,
  generateSystemPrompt,
} from "@openuidev/react-lang";
import { CHART_TYPES, chartContractError, chartDataSchema, type ChartData, type ChartType } from "./chartContract";
import { ChartView } from "../src/preview/ChartView";
import { MermaidView } from "../src/preview/MermaidView";

/** The text content string cap: no single string literal may exceed this. */
export const MAX_STRING_LENGTH = 10_000;
/** The statement cap: a program may not exceed this many statements. */
export const MAX_STATEMENTS = 200;

/** A line of text content. Use for titles, captions, and narrative. */
export const Text = defineComponent({
  name: "Text",
  description: "A line of text.",
  props: z.object({
    content: z.string().describe("The text to display"),
  }),
  component: (p: any) => <p className="aur-ui__text">{p.props.content}</p>,
});

/**
 * A chart rendered with the house theme. The data payload is the existing
 * push_chart contract VERBATIM (lib/chartContract.ts) — same shapes, same
 * rejection set; agents learn nothing new for data payloads. The render path
 * is the same chartToOption translation + ECharts used by standalone charts,
 * so house styling is shared, never restyled.
 */
export const Chart = defineComponent({
  name: "Chart",
  description: "House-themed chart from the push_chart data contract.",
  props: z.object({
    chart_type: z.enum(CHART_TYPES).describe("Chart kind aurora renders under its house theme"),
    data: chartDataSchema.describe(
      "The push_chart data contract; `kind` must match chart_type (categorical for bar/column, line for line/area)"
    ),
  }),
  component: (p: any) => (
    <ChartView contract={{ chart_type: p.props.chart_type, data: p.props.data }} />
  ),
});

/**
 * A mermaid diagram rendered through the existing render path with the house
 * theme; render failures surface as the visible error block. Newlines in the
 * source are written as \\n escapes inside a quoted string.
 */
export const Mermaid = defineComponent({
  name: "Mermaid",
  description: "House-themed mermaid diagram; newlines in source as \\n escapes.",
  props: z.object({
    source: z.string().describe("Mermaid diagram source (flowchart, sequence, …); newlines as \\n escapes"),
  }),
  component: (p: any) => <MermaidView source={p.props.source} />,
});

/** A bordered card grouping child elements. */
export const Card = defineComponent({
  name: "Card",
  description: "Bordered card of Text children.",
  props: z.object({
    children: z.array(Text.ref).describe("Card contents"),
  }),
  component: (p: any) => <div className="aur-ui__card">{p.renderNode(p.props.children)}</div>,
});

/** Layout container arranging children in a row or column. */
export const Stack = defineComponent({
  name: "Stack",
  description: "Layout container (row or column).",
  props: z.object({
    children: z.array(z.union([Card.ref, Text.ref, Chart.ref, Mermaid.ref])).describe("Child elements"),
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
  components: [Stack, Card, Text, Chart, Mermaid],
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

/**
 * Final statement names of a program in source order (merge echo, issue #41).
 * Same depth-0 `identifier =` scan as countStatements.
 */
export function statementNames(source: string): string[] {
  const names: string[] = [];
  let depth = 0;
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
      if (rest.startsWith("=") && !rest.startsWith("==")) names.push(m[0]);
      i += m[0].length - 1;
    }
    i++;
  }
  return names;
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
  // Chart kind coherence (issue #40): the single-chart tool rejects a
  // chart_type/data mismatch with chartContractError — the SAME check and
  // message run here, so the chart contract behaves verbatim inside a program.
  collectChartNodes(result.root).forEach((node) => {
    const { chart_type, data } = node.props as { chart_type?: ChartType; data?: ChartData };
    if (!chart_type || !data) return; // shape errors already reported by the parser
    // The OpenUI parser only enforces top-level props — the nested zod shape of
    // `data` must be checked here, or a malformed payload passes validation and
    // crashes the viewer (chartToOption dereferences data.points). Same
    // chartDataSchema.safeParse push_chart enforces, so the rejection set is
    // identical; kind coherence below assumes a valid shape.
    const parsed = chartDataSchema.safeParse(data);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        errors.push({
          line: node.statementId ? lineOfStatement(source, node.statementId) : undefined,
          statementId: node.statementId,
          code: "chart-data",
          message: `Chart data does not match the push_chart data contract at "${issue.path.join(".")}": ${issue.message}. Use the push_chart data contract for the "${chart_type}" chart_type.`,
        });
      });
      return; // kind coherence is meaningless for an invalid shape
    }
    const contractError = chartContractError(chart_type, data);
    if (contractError) {
      errors.push({
        line: node.statementId ? lineOfStatement(source, node.statementId) : undefined,
        statementId: node.statementId,
        code: "chart-contract",
        message: `${contractError}. Use the push_chart data contract for the "${chart_type}" chart_type.`,
      });
    }
  });

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

/** Parsed element node shape (subset) used to walk a program tree. */
interface ParsedNode {
  type?: string;
  typeName?: string;
  statementId?: string;
  props?: Record<string, unknown> & { children?: unknown };
}

/** Depth-first collection of Chart element nodes from a parsed program tree. */
function collectChartNodes(node: unknown, out: ParsedNode[] = []): ParsedNode[] {
  if (!node || typeof node !== "object") return out;
  const n = node as ParsedNode;
  if (n.type === "element" && n.typeName === "Chart") out.push(n);
  const children = n.props?.children;
  if (Array.isArray(children)) for (const c of children) collectChartNodes(c, out);
  return out;
}

/**
 * Worked example embedded in the generated description (single source of
 * truth with validation — the example must parse cleanly against this
 * library; the test suite enforces that).
 */
export const WORKED_EXAMPLE = `root = Stack([c, m], "column")
c = Chart("pie", {kind: "pie", points: [{label: "Q1", value: 12}]})
m = Mermaid("flowchart TD\\nA-->B")`;

/** Cross-guidance appended to the generated prompt (also present on push_chart). */
export const PUSH_UI_CROSS_GUIDANCE =
  'push_chart: one chart artifact. push_ui: composed dashboards (layout, multiple charts/diagrams, or text).';

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
