// Feed aside and Archived banner (issue #102): rendered statically, since the
// store and live socket behind the container are covered elsewhere.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchivedBanner, ChannelStackAside } from "./FeedAside";
import { setSidebar } from "./sidebarStore";
import type { ArtifactMeta } from "./previewApi";

const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min, 0).toISOString();

const art = (n: number, over: Partial<ArtifactMeta> = {}): ArtifactMeta => ({
  artifact_id: `a${n}`,
  seq: n,
  type: "markdown",
  title: `Title ${n}`,
  created_at: at(10 + n, 9),
  updated_at: at(10 + n, 9),
  ...over,
});

const stack = [art(1), art(2, { type: "ui" }), art(3, { updated_at: at(18, 11, 55), created_at: at(18, 8) })];

const render = (props: Partial<Parameters<typeof ChannelStackAside>[0]> = {}) =>
  renderToStaticMarkup(
    <ChannelStackAside sessionId="feed-tech" artifacts={stack} currentId="a3" retentionDays={30} now={NOW} {...props} />
  );

const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

afterEach(() => setSidebar({ right: true }));

describe("ChannelStackAside", () => {
  test("header shows the title and the artifact count", () => {
    const html = render();
    expect(html).toContain("Channel stack");
    expect(html).toContain("3 artifacts");
    expect(render({ artifacts: [art(1)] })).toContain("1 artifact<");
  });

  test("lists newest first, each linking to its feed path", () => {
    const html = render();
    expect(html.indexOf("Title 3")).toBeLessThan(html.indexOf("Title 2"));
    expect(html.indexOf("Title 2")).toBeLessThan(html.indexOf("Title 1"));
    expect(html).toContain('href="/feed/feed-tech/a3"');
    expect(html).toContain('href="/feed/feed-tech/a1"');
  });

  test("orders by seq whatever the input order, without mutating it", () => {
    const shuffled = [stack[1]!, stack[2]!, stack[0]!];
    const html = render({ artifacts: shuffled });
    expect(html.indexOf("Title 3")).toBeLessThan(html.indexOf("Title 1"));
    expect(shuffled.map((a) => a.seq)).toEqual([2, 3, 1]);
  });

  test("each item shows created date, updated HH:MM and the type label", () => {
    const html = render();
    const time = new Date(stack[1]!.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(html).toContain(shortDay(stack[1]!.created_at));
    expect(html).toContain(`updated ${time}`);
    expect(html).toContain("UI");
    expect(html).toContain("Markdown");
  });

  test("marks only the open item active", () => {
    const html = render();
    expect(html.match(/is-active/g)?.length).toBe(1);
    expect(html).toContain('class="aur-feed__asideitem is-active" href="/feed/feed-tech/a3"');
  });

  test("live dot on the newest item only, and only when recently updated", () => {
    expect(render().match(/aur-feed__dot/g)?.length).toBe(1);
    expect(render().indexOf("aur-feed__dot")).toBeLessThan(render().indexOf("Title 2"));
    expect(render({ now: NOW + 3_600_000 })).not.toContain("aur-feed__dot");
  });

  test("an older item updated recently gets no dot", () => {
    const html = render({ artifacts: [art(1, { updated_at: at(18, 11, 58) }), art(2)] });
    expect(html).not.toContain("aur-feed__dot");
  });

  test("footer shows retention and the oldest kept date", () => {
    const html = render();
    expect(html).toContain("Retention 30 days");
    expect(html).toContain(`Pruned on the next push. Oldest kept: ${shortDay(stack[0]!.created_at)}.`);
  });

  test("empty stack has no oldest-kept line", () => {
    const html = render({ artifacts: [] });
    expect(html).toContain("0 artifacts");
    expect(html).toContain("Retention 30 days");
    expect(html).not.toContain("Oldest kept");
  });

  test("collapsed through sidebarStore.right: a strip replaces the aside", () => {
    setSidebar({ right: false });
    const html = render();
    expect(html).not.toContain("Channel stack");
    expect(html).toContain("aur-feed__asidestrip");
    expect(html).toContain("Show channel stack");
  });
});

describe("ArchivedBanner", () => {
  const old = { ...art(1, { updated_at: at(15, 9) }), session_id: "feed-tech", content: "" };
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const html = renderToStaticMarkup(<ArchivedBanner artifact={old} sessionId="feed-tech" retentionDays={30} />);

  test("headline is exactly Archived · date · pruned after N days", () => {
    expect(html).toContain(`Archived · ${date(old.updated_at)} · pruned after 30 days`);
  });

  test("eligibility line is updated + N days and never promises a deletion", () => {
    const eligible = date(new Date(Date.parse(old.updated_at) + 30 * 86_400_000).toISOString());
    expect(html).toContain(`Eligible for pruning from ${eligible} — removed on the next push after that.`);
    expect(html).not.toContain("will be deleted");
  });

  test("actions link to the latest Feed view and the stack view of this artifact", () => {
    expect(html).toContain('href="/feed/feed-tech"');
    expect(html).toContain("Back to latest");
    expect(html).toContain('href="/s/feed-tech/a1"');
    expect(html).toContain("Open in stack");
  });
});
