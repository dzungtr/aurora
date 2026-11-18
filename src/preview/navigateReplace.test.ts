// navigate(path, { replace: true }) must swap the history entry (so Back does
// not bounce through bare /feed) and still notify route subscribers.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { navigate } from "./previewApi";
import { getRoutePathname, subscribeRoutePathname } from "./useRoutePathname";

type FakeWindow = EventTarget & { location: { pathname: string }; history: object };

const g = globalThis as Record<string, unknown>;
let saved: unknown;
let win: FakeWindow;
let calls: string[];

beforeEach(() => {
  saved = g.window;
  calls = [];
  win = new EventTarget() as FakeWindow;
  win.location = { pathname: "/feed" };
  win.history = {
    pushState: (_s: unknown, _t: string, path: string) => { calls.push(`push ${path}`); win.location.pathname = path; },
    replaceState: (_s: unknown, _t: string, path: string) => { calls.push(`replace ${path}`); win.location.pathname = path; },
  };
  g.window = win;
});

afterEach(() => {
  g.window = saved;
});

describe("navigate", () => {
  test("defaults to pushState", () => {
    navigate("/feed/a");
    expect(calls).toEqual(["push /feed/a"]);
  });

  test("replace option uses replaceState and notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeRoutePathname(() => seen.push(getRoutePathname()));
    navigate("/feed/a", { replace: true });
    unsub();
    expect(calls).toEqual(["replace /feed/a"]);
    expect(seen).toEqual(["/feed/a"]);
  });
});
