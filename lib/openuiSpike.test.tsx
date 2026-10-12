// Spike tests for dzungtr/aurora#38 — proves @openuidev/react-lang@0.4.1 +
// @openuidev/lang-core@0.4.1 work under aurora's stack (Bun + React 19) before
// any push_ui feature lands. Measures the generated tool description for the
// planned five-component library against the 800-token hard cap.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createLibrary,
  createParser,
  defineComponent,
  generateSystemPrompt,
  mergeStatements,
  Renderer,
} from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { encode } from "gpt-tokenizer";


// Minimal throwaway component definitions with aurora-shaped renderers. The
// real aurora library (lib/openuiLibrary.ts) lands with ticket #39; these are
// only what the smoke tests need.
const Text = defineComponent({
  name: "Text",
  description: "A line of text content.",
  props: z.object({ content: z.string().describe("The text to display") }),
  component: (p: any) => <span>{p.props.content}</span>,
});
const Card = defineComponent({
  name: "Card",
  description: "A bordered card grouping child elements.",
  props: z.object({ children: z.array(Text.ref).describe("Card contents") }),
  component: (p: any) => <div>{p.renderNode(p.props.children)}</div>,
});
const Stack = defineComponent({
  name: "Stack",
  description: "Layout container arranging children in a direction.",
  props: z.object({
    children: z.array(z.union([Card.ref, Text.ref])).describe("Child elements"),
    direction: z.enum(["row", "column"]).describe("Layout direction"),
  }),
  component: (p: any) => <div>{p.renderNode(p.props.children)}</div>,
});

// The planned five-component library, used for the description budget test.
// Chart wraps the existing chart data contract verbatim (flat object so
// positional args stay schema-order mapped); Mermaid takes the source string.
const Chart = defineComponent({
  name: "Chart",
  description: "A chart rendered with the house theme. Data uses the push_chart contract.",
  props: z.object({
    title: z.string().describe("Chart title"),
    data: z
      .object({
        kind: z.enum(["pie", "categorical", "line", "scatter"]),
        points: z.array(z.object({ label: z.string(), value: z.number() })).optional().describe("pie only"),
        categories: z.array(z.string()).optional().describe("categorical only"),
        x: z.array(z.union([z.string(), z.number()])).optional().describe("line only"),
        series: z
          .array(z.object({ name: z.string(), values: z.array(z.number()) }))
          .optional()
          .describe("categorical/line/scatter"),
      })
      .describe("Chart data in the push_chart contract shape"),
  }),
  component: () => null,
});
const Mermaid = defineComponent({
  name: "Mermaid",
  description: "A mermaid diagram rendered from source.",
  props: z.object({ source: z.string().describe("Mermaid diagram source") }),
  component: () => null,
});

const fullLibrary = createLibrary({
  components: [Stack, Card, Text, Chart, Mermaid],
  root: "Stack",
});

const sampleProgram = `root = Stack([card], "column")
card = Card([t])
t = Text("hello aurora")`;

describe("openui spike: renderer compat under Bun + React 19", () => {
  test("minimal program renders through <Renderer> with react-dom/server", () => {
    const html = renderToStaticMarkup(
      <Renderer library={StackAndFriends()} response={sampleProgram} isStreaming={false} />,
    );
    expect(html).toContain("hello aurora");
  });
});

function StackAndFriends() {
  return createLibrary({ components: [Stack, Card, Text], root: "Stack" });
}

describe("openui spike: framework-free server-side path", () => {
  test("parse of a valid program produces a root node and no errors", () => {
    const parser = createParser(StackAndFriends().toJSONSchema());
    const result = parser.parse(sampleProgram);
    expect(result.root).not.toBeNull();
    expect(result.meta.errors).toHaveLength(0);
  });

  test("mergeStatements applies patch statements by name server-side", () => {
    const merged = mergeStatements(sampleProgram, 't = Text("patched")');
    expect(merged).toContain('t = Text("patched")');
    expect(merged).toContain("root = Stack([card]");
    const parser = createParser(StackAndFriends().toJSONSchema());
    expect(parser.parse(merged).meta.errors).toHaveLength(0);
  });

  test("parse errors are structured with codes, statement ids and hints", () => {
    const parser = createParser(StackAndFriends().toJSONSchema());
    const result = parser.parse('root = Stack([x], "column")\nx = Bogus("nope")');
    const codes = result.meta.errors.map((e) => e.code);
    expect(codes).toContain("unknown-component");
    const unknown = result.meta.errors.find((e) => e.code === "unknown-component")!;
    expect(unknown.statementId).toBe("x");
    expect(unknown.message).toContain("Available components");
  });
});

describe("openui spike: generated description budget (hard cap 800 tokens)", () => {
  test("five-component library prompt is at or under the hard cap", () => {
    const prompt = generateSystemPrompt({
      library: fullLibrary.toSpec(),
      promptOptions: {
        toolCalls: false,
        bindings: false,
        editMode: false,
        inlineMode: false,
        examples: [
          `root = Stack([card1, card2], "row")
card1 = Card([t1, c1])
t1 = Text("Revenue by quarter")
c1 = Chart("Revenue", {kind: "categorical", categories: ["Q1", "Q2"], series: [{name: "2025", values: [10, 20]}]})
card2 = Card([t2, m1])
t2 = Text("Architecture")
m1 = Mermaid("graph TD; A-->B")`,
        ],
      },
    });
    const tokens = encode(prompt).length;
    // Budget measured and recorded in #37's handoffs; hard cap is 800.
    expect(tokens).toBeLessThanOrEqual(800);
  });
});