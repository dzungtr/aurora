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
import { DigestCardView } from "../src/preview/DigestCardView";
import {
  BriefingHeaderView,
  DoneMarkerView,
  SectionHeaderView,
  SkipListView,
  ThreadUpdateView,
} from "../src/preview/BriefingViews";

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

/**
 * What a Card may hold. Exported so digest cards (#90) reuse the same union;
 * the aurora-side child-type check derives each parent's allowed set from the
 * generated JSON Schema, so this union is the only place it is declared.
 */
export const CardChild = z.union([Text.ref, Chart.ref, Mermaid.ref]);

/** A bordered card grouping child elements. */
export const Card = defineComponent({
  name: "Card",
  description: "Bordered card.",
  props: z.object({
    children: z.array(CardChild).describe("Card contents"),
  }),
  component: (p: any) => <div className="aur-ui__card">{p.renderNode(p.props.children)}</div>,
});

/**
 * One kept story with editorial weight (issue #90, spec #86 D6). `variant` is
 * the only weight control; `story_id` is the copyable handle. Expand/collapse
 * is client-side (src/preview/expandState.tsx).
 */
export const DigestCard = defineComponent({
  name: "DigestCard",
  description: "Digest story card; patch by statement name (itm_1 = \"itm-1\").",
  props: z.object({
    story_id: z.string().describe("Handle, unique in the program"),
    variant: z.enum(["hero", "rail", "list"]),
    title: z.string(),
    source: z.string(),
    lang: z.string(),
    minutes: z.number(),
    sapo: z.string(),
    why: z.string(),
    body: z.string().optional().describe("Paragraphs split on blank lines"),
    children: z.array(CardChild).optional(),
    url: z.string().optional().describe("https:// link"),
  }),
  component: (p: any) => (
    <DigestCardView
      {...p.props}
      hasChildren={Array.isArray(p.props.children) && p.props.children.length > 0}
    >
      {p.renderNode(p.props.children)}
    </DigestCardView>
  ),
});

/**
 * Briefing frame (issue #91, spec #86 D9). Five components around the digest
 * cards; aurora enforces no ordering between them (header first / done last is
 * agent convention) and `kept` is whatever the agent states.
 */
export const BriefingHeader = defineComponent({
  name: "BriefingHeader",
  description: "Briefing masthead; passes = patch timeline.",
  props: z.object({
    date: z.string(),
    scanned: z.number(),
    kept: z.number(),
    minutes: z.number().optional().describe("Total read minutes"),
    live: z.boolean().optional().describe("Show the Live pill"),
    kicker: z.string().optional(),
    passes: z
      .array(z.object({ time: z.string(), label: z.string(), state: z.enum(["done", "running", "queued"]) }))
      .optional(),
  }),
  component: (p: any) => <BriefingHeaderView {...p.props} />,
});

export const SectionHeader = defineComponent({
  name: "SectionHeader",
  description: "Section rule with a label.",
  props: z.object({
    label: z.string(),
    note: z.string().optional().describe("Right-aligned note, e.g. a count"),
  }),
  component: (p: any) => <SectionHeaderView {...p.props} />,
});

export const ThreadUpdate = defineComponent({
  name: "ThreadUpdate",
  description: "Tracked thread; patch by statement name (thr_x = \"thr-x\").",
  props: z.object({
    thread_id: z.string().describe("Handle, unique among threads in the program"),
    title: z.string(),
    update: z.string(),
    day: z.string().optional(),
    history: z.array(z.object({ when: z.string(), text: z.string() })).optional(),
  }),
  component: (p: any) => <ThreadUpdateView {...p.props} />,
});

export const SkipList = defineComponent({
  name: "SkipList",
  description: "Collapsed skipped list; count may exceed items.",
  props: z.object({
    count: z.number(),
    items: z.array(z.object({ title: z.string(), reason: z.string() })),
  }),
  component: (p: any) => <SkipListView {...p.props} />,
});

export const DoneMarker = defineComponent({
  name: "DoneMarker",
  description: "End-of-briefing line.",
  props: z.object({
    title: z.string(),
    text: z.string().optional(),
  }),
  component: (p: any) => <DoneMarkerView {...p.props} />,
});

/** Layout container arranging children in a row or column. */
export const Stack = defineComponent({
  name: "Stack",
  description: "Layout container (row or column); may nest Stack.",
  props: z.object({
    children: z
      .array(
        z.union([
          Card.ref, DigestCard.ref, Text.ref, Chart.ref, Mermaid.ref,
          BriefingHeader.ref, SectionHeader.ref, ThreadUpdate.ref, SkipList.ref, DoneMarker.ref,
        ])
      )
      .describe("Child elements"),
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
  components: [Stack, Card, Text, Chart, Mermaid, BriefingHeader, DigestCard, SectionHeader, ThreadUpdate, SkipList, DoneMarker],
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

  // The OpenUI parser does not enforce union member types on `children`
  // (ADR-0010), so out-of-union children are rejected here.
  errors.push(...childTypeErrors(result.root, auroraUiLibrary.toJSONSchema(), source));

  // Digest handles and links (issues #90, #91; D8/D6). Uniqueness is per kind.
  const digestNodes = collectNodes(result.root, "DigestCard");
  errors.push(
    ...handleErrors(digestNodes, "story_id", "duplicate-handle", source),
    ...urlErrors(digestNodes, source),
    // ThreadUpdate.thread_id: same checks, its own uniqueness namespace (issue #91).
    ...handleErrors(collectNodes(result.root, "ThreadUpdate"), "thread_id", "duplicate-handle", source)
  );

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

/** Depth-first collection of element nodes of one component type. */
function collectNodes(node: unknown, typeName: string, out: ParsedNode[] = []): ParsedNode[] {
  if (!node || typeof node !== "object") return out;
  const n = node as ParsedNode;
  if (n.type === "element" && n.typeName === typeName) out.push(n);
  const children = n.props?.children;
  if (Array.isArray(children)) for (const c of children) collectNodes(c, typeName, out);
  return out;
}

/** Longest allowed handle (spec #86 D8). */
export const MAX_HANDLE_LENGTH = 64;

/** Why a handle is invalid (empty, over the length cap, or containing whitespace); null when valid. */
export function handleProblem(handle: string): string | null {
  if (handle.length === 0) return "is empty";
  if (handle.length > MAX_HANDLE_LENGTH) return `is ${handle.length} chars, over the ${MAX_HANDLE_LENGTH}-char cap`;
  if (/\s/.test(handle)) return "contains whitespace";
  return null;
}

/**
 * Handle checks for one kind of node (D8): each handle must be valid and unique
 * within the program. Reusable for other handle kinds (e.g. ThreadUpdate.thread_id)
 * — pass that kind's prop and duplicate code; namespaces stay separate because
 * each call only sees its own nodes.
 */
function handleErrors(nodes: ParsedNode[], prop: string, duplicateCode: string, source: string): UiProgramError[] {
  const errors: UiProgramError[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const handle = node.props?.[prop];
    if (typeof handle !== "string") continue; // shape errors already reported by the parser
    const base = { line: node.statementId ? lineOfStatement(source, node.statementId) : undefined, statementId: node.statementId };
    const problem = handleProblem(handle);
    if (problem) {
      errors.push({
        ...base,
        code: "invalid-handle",
        message: `${prop} ${JSON.stringify(handle)} ${problem}. Handles are non-empty, at most ${MAX_HANDLE_LENGTH} chars, no whitespace.`,
      });
    } else if (seen.has(handle)) {
      errors.push({
        ...base,
        code: duplicateCode,
        message: `${prop} ${JSON.stringify(handle)} is used more than once in this program. Handles must be unique.`,
      });
    }
    seen.add(handle);
  }
  return errors;
}

/** `url` must be an https:// link (rendered as an outbound anchor, never fetched). */
function urlErrors(nodes: ParsedNode[], source: string): UiProgramError[] {
  return nodes.flatMap((node) => {
    const url = node.props?.url;
    if (typeof url !== "string" || url.startsWith("https://")) return [];
    return [
      {
        line: node.statementId ? lineOfStatement(source, node.statementId) : undefined,
        statementId: node.statementId,
        code: "invalid-url",
        message: `url ${JSON.stringify(url)} must start with https://.`,
      },
    ];
  });
}

/** The one hand-written exception to the schema-derived allowed children: Stack nests Stack. */
const EXTRA_ALLOWED_CHILDREN: Record<string, string[]> = { Stack: ["Stack"] };

/** Allowed child type names per parent, read from the library's JSON Schema. */
function allowedChildren(jsonSchema: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const defs = (jsonSchema as { $defs?: Record<string, any> }).$defs ?? {};
  for (const [parent, def] of Object.entries(defs)) {
    const items = def?.properties?.children?.items;
    if (!items) continue;
    const refs: { $ref?: string }[] = Array.isArray(items.anyOf) ? items.anyOf : [items];
    const names = refs.flatMap((r) => (r.$ref ? [r.$ref.split("/").pop()!] : []));
    out.set(parent, [...names, ...(EXTRA_ALLOWED_CHILDREN[parent] ?? [])]);
  }
  return out;
}

/**
 * Walk the parsed tree; every child's typeName must be in its parent's allowed
 * set. Reports the child's statement, or the nearest enclosing statement when
 * the child is inline.
 */
function childTypeErrors(root: unknown, jsonSchema: unknown, source: string): UiProgramError[] {
  const allowed = allowedChildren(jsonSchema);
  const errors: UiProgramError[] = [];
  const visit = (node: unknown, enclosingId?: string) => {
    if (!node || typeof node !== "object") return;
    const n = node as ParsedNode;
    const children = n.props?.children;
    if (n.type !== "element" || !Array.isArray(children)) return;
    const parentId = n.statementId ?? enclosingId;
    const allowedNames = n.typeName ? allowed.get(n.typeName) : undefined;
    for (const child of children) {
      const c = child as ParsedNode | null;
      if (!c || typeof c !== "object" || c.type !== "element") continue;
      if (allowedNames && c.typeName && !allowedNames.includes(c.typeName)) {
        const id = c.statementId ?? parentId;
        errors.push({
          line: id ? lineOfStatement(source, id) : undefined,
          statementId: id,
          code: "child-type",
          message: `${n.typeName} children must be ${allowedNames.join(" | ")}; got ${c.typeName}.`,
        });
      }
      visit(c, parentId);
    }
  };
  visit(root);
  return errors;
}

/**
 * Remove a generated-prompt section: from its exact `## ` heading up to (not
 * including) the next `## ` heading, or the end of the text.
 */
function stripSection(prompt: string, heading: string): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("## ")) skipping = line === heading;
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

/** Generic sections of the generated prompt that push_ui drops to stay within budget. */
const STRIPPED_SECTIONS = ["## Hoisting & Streaming (CRITICAL)", "## Important Rules"];

/**
 * Worked example embedded in the generated description (single source of
 * truth with validation — the example must parse cleanly against this
 * library; the test suite enforces that).
 */
export const WORKED_EXAMPLE = `root = Stack([c, m], "column")
c = Chart("pie", {kind: "pie", points: [{label: "Q1", value: 12}]})
m = Mermaid("flowchart TD\\nA-->B")`;

/**
 * Digest worked example (issue #91): a compact briefing using every digest
 * component and the hero+rail row Stack. Handle convention: a statement name is
 * its handle with `-` as `_` (itm_001 holds "itm-001"), so a later
 * mode:"patch" push replaces that card by name. Parsed and validated clean by
 * the test suite, like WORKED_EXAMPLE.
 */
export const DIGEST_WORKED_EXAMPLE = `root = Stack([hdr, top, sec1, itm_003, thr_graph, skips, done], "column")
hdr = BriefingHeader("Wed 4 Nov", 142, 3, 12, true)
top = Stack([itm_001, rail], "row")
rail = Stack([itm_002], "column")
itm_001 = DigestCard("itm-001", "hero", "Title", "HN", "EN", 6, "Sapo.", "Why you.", "Para one.\\n\\nPara two.", [prov])
prov = Mermaid("graph LR\\nA-->B")
itm_002 = DigestCard("itm-002", "rail", "Title", "LWN", "EN", 2, "Sapo.", "Why you.")
sec1 = SectionHeader("Agent infra")
itm_003 = DigestCard("itm-003", "list", "Title", "GitHub", "EN", 2, "Sapo.", "Why you.")
thr_graph = ThreadUpdate("thr-graph", "Graph memory", "New benchmark.", "Day 3")
skips = SkipList(12, [{title: "Listicle", reason: "low signal"}])
done = DoneMarker("You're done.")`;

/** Cross-guidance appended to the generated prompt (also present on push_chart). */
export const PUSH_UI_CROSS_GUIDANCE =
  'push_chart: one chart artifact. push_ui: composed dashboards (layout, multiple charts/diagrams, or text).';

/**
 * Generate the push_ui tool description from the library definition itself.
 * Two generic sections of the generated prompt are removed (STRIPPED_SECTIONS)
 * to make room for the component set. Hard cap 1,300 tokens (#86); enforced by test.
 */
export function generateUiToolDescription(): string {
  const generated = generateSystemPrompt({
    library: auroraUiLibrary.toSpec(),
    promptOptions: {
      toolCalls: false,
      bindings: false,
      editMode: false,
      inlineMode: false,
      examples: [WORKED_EXAMPLE, DIGEST_WORKED_EXAMPLE],
    },
  });
  return STRIPPED_SECTIONS.reduce(stripSection, generated) + "\n\n" + PUSH_UI_CROSS_GUIDANCE;
}
