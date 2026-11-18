// Feed shell presentation (issue #100): tab row, notices and empty state.
// FeedView itself is wired to module-level stores and the live socket, so the
// pure presentational pieces are rendered here; the state machine behind them
// is covered by feedViewState.test.ts.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedEmpty, FeedNotice, FeedTabs } from "./FeedView";
import { feedUnread } from "./feedModel";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const tab = (session_id: string, last_activity = "2026-11-18T00:00:00Z") => ({ session_id, last_activity });

const render = (props: Partial<Parameters<typeof FeedTabs>[0]> = {}) =>
  renderToStaticMarkup(
    <FeedTabs
      tabs={[tab("feed-business"), tab("feed-tech", "2026-11-18T11:55:00Z")]}
      activeId="feed-tech"
      unread={{}}
      now={NOW}
      onSelect={() => {}}
      {...props}
    />
  );

describe("FeedTabs", () => {
  test("renders one tab per channel with the id verbatim, in the given order", () => {
    const html = render();
    expect(html.indexOf("feed-business")).toBeGreaterThan(-1);
    expect(html.indexOf("feed-business")).toBeLessThan(html.indexOf("feed-tech"));
  });

  test("links each tab to its feed path", () => {
    const html = render();
    expect(html).toContain('href="/feed/feed-business"');
    expect(html).toContain('href="/feed/feed-tech"');
  });

  test("only the active tab is marked active", () => {
    const html = render();
    expect(html.match(/is-active/g)?.length).toBe(1);
    expect(html).toContain('class="aur-feed__tab is-active" href="/feed/feed-tech"');
  });

  test("no tab is active when activeId is null", () => {
    expect(render({ activeId: null })).not.toContain("is-active");
  });

  test("unread badge on inactive tabs only, hidden at zero", () => {
    const html = render({ unread: { "feed-business": 3, "feed-tech": 5 } });
    expect(html).toContain('<span class="aur-feed__badge">3</span>');
    expect(html).not.toContain(">5<");
    expect(render()).not.toContain("aur-feed__badge");
  });

  test("live dot only for channels active within 15 minutes", () => {
    const html = render();
    expect(html.match(/aur-feed__dot/g)?.length).toBe(1);
  });

  test("shows retention for the open channel", () => {
    expect(render({ retentionDays: 14 })).toContain("retention 14d");
    expect(render()).not.toContain("retention");
  });
});

describe("FeedNotice", () => {
  test("a non-channel session links to the Artifacts view", () => {
    const html = renderToStaticMarkup(<FeedNotice kind="not-channel" sid="scratch" />);
    expect(html).toContain("<code>scratch</code> is not a channel.");
    expect(html).toContain('href="/s/scratch"');
    expect(html).toContain("Open in Artifacts");
  });

  test("an unknown session has no link", () => {
    const html = renderToStaticMarkup(<FeedNotice kind="no-session" sid="nope" />);
    expect(html).toContain("No session <code>nope</code>.");
    expect(html).not.toContain("<a ");
  });
});

describe("FeedEmpty", () => {
  test("says how a channel comes to exist and links to /s", () => {
    const html = renderToStaticMarkup(<FeedEmpty />);
    expect(html).toContain("No channels yet");
    expect(html).toContain("session_kind");
    expect(html).toContain('href="/s"');
    expect(html).toContain("Browse artifacts");
  });
});

describe("feedUnread", () => {
  test("sums unread over channel ids only", () => {
    const channels = [{ session_id: "a" }, { session_id: "b" }];
    expect(feedUnread({ a: 2, b: 1, scratch: 9 }, channels)).toBe(3);
  });
  test("is zero while channels are unloaded", () => {
    expect(feedUnread({ a: 2 }, null)).toBe(0);
  });
});
