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

const render = (props: Partial<Parameters<typeof FeedToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <FeedToolbar sessionId="feed-tech" current={artifact} follow={true} onToggleFollow={() => {}} {...props} />
  );

describe("FeedToolbar", () => {
  test("shows type chip, title and updated time in that order, then Live, Copy link, Open in stack", () => {
    const html = render();
    const order = ["Markdown", "Morning briefing", "updated 09:05", "Live", "Copy link", "Open in stack"].map((x) => html.indexOf(x));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("has no pager and no Program button", () => {
    const html = render();
    expect(html).not.toContain("pager");
    expect(html).not.toContain("Program");
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
    expect(render()).not.toContain("disabled");
  });
});
