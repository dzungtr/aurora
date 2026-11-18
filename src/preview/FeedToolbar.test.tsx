// Feed toolbar (issue #101, M13): contents and order per D23, rendered
// statically. Click behaviour (clipboard, follow store) is covered by the
// browser validation scenarios; the pure pieces are in feedModel.test.ts.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedToolbar } from "./FeedToolbar";
import type { Artifact } from "./previewApi";

const artifact: Artifact = {
  artifact_id: "a1",
  session_id: "feed-tech",
  seq: 1,
  type: "markdown",
  title: "Morning briefing",
  created_at: new Date(2026, 10, 18, 8, 0).toISOString(),
  updated_at: new Date(2026, 10, 18, 9, 5).toISOString(),
  content: "# hi",
};

const uiArtifact: Artifact = { ...artifact, type: "ui", content: 'root = Text("hi")' };

const render = (props: Partial<Parameters<typeof FeedToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <FeedToolbar
      sessionId="feed-tech"
      current={artifact}
      follow={true}
      onToggleFollow={() => {}}
      programOpen={false}
      onToggleProgram={() => {}}
      {...props}
    />
  );

describe("FeedToolbar", () => {
  test("shows type chip, title and updated time in that order, then Live, Program, Copy link, Open in stack", () => {
    const html = render({ current: uiArtifact });
    const order = ["UI", "Morning briefing", "updated 09:05", "Live", "Program", "Copy link", "Open in stack"].map((x) => html.indexOf(x));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("has no pager", () => {
    expect(render()).not.toContain("pager");
  });

  test("Program is disabled for a non-ui artifact and when nothing is open", () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>.*?Program/);
    expect(render({ current: null })).toMatch(/<button[^>]*disabled=""[^>]*>.*?Program/);
  });

  test("Program is enabled for a ui artifact and carries the on state iff the drawer is open", () => {
    const closed = render({ current: uiArtifact, follow: false });
    expect(closed).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?Program/);
    expect(closed).not.toContain("is-on");
    expect(render({ current: uiArtifact, follow: false, programOpen: true })).toMatch(/is-on[^>]*>.*?Program/);
  });

  test("Live carries the on state iff follow is on", () => {
    expect(render({ follow: true })).toContain("aur-stack3__ghostbtn is-on");
    expect(render({ follow: false })).not.toContain("is-on");
  });

  test("Open in stack links to the artifact's stack URL", () => {
    expect(render()).toContain('href="/s/feed-tech/a1"');
  });

  test("with no open artifact Copy link is disabled and Open in stack links to the session", () => {
    const html = render({ current: null });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Copy link/);
    expect(html).toContain('href="/s/feed-tech"');
    expect(html).not.toContain("updated");
  });

  test("Copy link is enabled when an artifact is open", () => {
    expect(render({ current: uiArtifact })).not.toContain("disabled");
  });
});
