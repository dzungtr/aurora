// ArtifactStage (issue #99, spec #98 M10/D17): the per-type renderer switch
// extracted from StackView. frame="card" must keep today's markup for every
// type; frame="page" drops the card box and caption for ui artifacts only.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactStage } from "./ArtifactStage";
import type { Artifact } from "./previewApi";

const make = (type: string, content: string): Artifact =>
  ({
    session_id: "s1",
    artifact_id: "a1",
    type,
    title: "t",
    content,
    seq: 1,
    created_at: "2026-11-18T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
  }) as unknown as Artifact;

const html = (a: Artifact, frame: "card" | "page") =>
  renderToStaticMarkup(<ArtifactStage artifact={a} frame={frame} />);

const CHART = JSON.stringify({
  chart_type: "bar",
  title: "c",
  x: ["a", "b"],
  series: [{ name: "s", data: [1, 2] }],
});
const UI = 'root = Stack([t], "column")\nt = TextContent("hello")';

describe("ArtifactStage frame=card", () => {
  test("markdown uses the md pane with no card box", () => {
    const out = html(make("markdown", "# Hi"), "card");
    expect(out).toContain("aur-stack3__pane-md");
    expect(out).not.toContain("aur-stack3__cardbox");
  });

  test("chart: card box + caption, or the invalid-contract error", () => {
    const ok = html(make("chart", CHART), "card");
    expect(ok).toContain("aur-stack3__pane-card");
    expect(ok).toContain("aur-stack3__cardbox");
    expect(ok).toContain("push_chart");
    const bad = html(make("chart", "{not json"), "card");
    expect(bad).toContain("Invalid chart artifact — malformed contract JSON.");
    expect(bad).not.toContain("aur-stack3__caption");
  });

  test("mermaid: centred card box + caption", () => {
    const out = html(make("mermaid", "graph TD; A-->B"), "card");
    expect(out).toContain("aur-stack3__cardbox aur-stack3__cardbox--center");
    expect(out).toContain("push_mermaid · rendered client-side, house theme");
  });

  test("ui: card box + caption", () => {
    const out = html(make("ui", UI), "card");
    expect(out).toContain("aur-stack3__cardbox aur-ui__pane");
    expect(out).toContain("push_ui · composed with the aurora component library");
  });

  test("image / video / audio: card box + per-type caption, video modifier", () => {
    const img = html(make("image", ""), "card");
    expect(img).toContain("push_image");
    expect(img).not.toContain("cardbox--video");
    expect(html(make("video", ""), "card")).toContain("aur-stack3__cardbox aur-stack3__cardbox--video");
    expect(html(make("video", ""), "card")).toContain("push_video");
    expect(html(make("audio", ""), "card")).toContain("push_audio");
  });

  test("unknown type renders nothing", () => {
    expect(html(make("hologram", "x"), "card")).toBe("");
    expect(html(make("hologram", "x"), "page")).toBe("");
  });
});

describe("ArtifactStage frame=page", () => {
  test("ui drops the card box and the caption", () => {
    const out = html(make("ui", UI), "page");
    expect(out).not.toContain("aur-stack3__cardbox");
    expect(out).not.toContain("push_ui");
    expect(out).toContain("aur-ui");
  });

  test("other types look the same in both frames", () => {
    for (const [type, content] of [
      ["markdown", "# Hi"],
      ["chart", CHART],
      ["mermaid", "graph TD; A-->B"],
      ["image", ""],
      ["video", ""],
      ["audio", ""],
    ] as const) {
      const a = make(type, content);
      expect(html(a, "page")).toBe(html(a, "card"));
    }
  });
});
