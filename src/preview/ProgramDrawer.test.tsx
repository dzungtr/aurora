// Program drawer (issue #103, M17): rendered statically. Escape and click
// behaviour are covered by the browser validation scenarios.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgramDrawer, isProgramKey } from "./ProgramDrawer";
import { countStatements, MAX_STATEMENTS, MAX_STRING_LENGTH } from "../../lib/openuiLibrary";

const SOURCE = [
  'root = Stack([head, body])',
  'head = Text("Digest <b> & more")',
  'body = Text("Line one\\nLine two")',
].join("\n");

const render = (source = SOURCE) => renderToStaticMarkup(<ProgramDrawer source={source} onClose={() => {}} />);

describe("ProgramDrawer", () => {
  test("header names the program and offers a close button", () => {
    const html = render();
    expect(html).toContain("OpenUI program");
    expect(html).toMatch(/<button[^>]*aria-label="Close program"/);
  });

  test("body is the source verbatim in a pre, with markup escaped and no highlighting", () => {
    const html = render();
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html);
    expect(pre).not.toBeNull();
    expect(pre![1]).toBe(
      SOURCE.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    );
    expect(pre![1]).not.toContain("<span");
    expect(html).not.toContain("contenteditable");
  });

  test("footer counts statements with the existing parser against the caps", () => {
    expect(countStatements(SOURCE)).toBe(3);
    expect(render()).toContain(`3 / ${MAX_STATEMENTS} statements · max ${MAX_STRING_LENGTH} chars / string`);
  });

  test("footer count follows the source", () => {
    expect(render(SOURCE + '\nextra = Text("x")')).toContain("4 / 200 statements");
  });

  test("isProgramKey matches Escape only", () => {
    expect(isProgramKey("Escape")).toBe(true);
    expect(isProgramKey("Enter")).toBe(false);
  });
});
