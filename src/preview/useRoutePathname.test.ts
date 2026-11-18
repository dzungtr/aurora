// Regression for #108: PreviewApp derives StackView's key from the URL, so it
// must re-render on every in-app navigate() and popstate. The hook is a
// useSyncExternalStore over (onRouteChange, getRoutePathname); this checks
// that contract: the subscription fires and the snapshot is the new path.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { navigate } from "./previewApi";
import { getRoutePathname, subscribeRoutePathname } from "./useRoutePathname";

type FakeWindow = EventTarget & { location: { pathname: string }; history: object };

const g = globalThis as Record<string, unknown>;
let saved: unknown;
let win: FakeWindow;

beforeEach(() => {
  saved = g.window;
  win = new EventTarget() as FakeWindow;
  win.location = { pathname: "/s/sid/a2" };
  win.history = { pushState: (_s: unknown, _t: string, path: string) => { win.location.pathname = path; } };
  g.window = win;
});

afterEach(() => {
  g.window = saved;
});

describe("route pathname subscription", () => {
  test("navigate() notifies subscribers and the snapshot is the new path", () => {
    const seen: string[] = [];
    const unsub = subscribeRoutePathname(() => seen.push(getRoutePathname()));
    navigate("/s/sid/a1");
    navigate("/s/sid/a3");
    unsub();
    expect(seen).toEqual(["/s/sid/a1", "/s/sid/a3"]);
  });

  test("popstate notifies subscribers with the restored path", () => {
    const seen: string[] = [];
    const unsub = subscribeRoutePathname(() => seen.push(getRoutePathname()));
    win.location.pathname = "/s/sid/a1";
    win.dispatchEvent(new Event("popstate"));
    unsub();
    expect(seen).toEqual(["/s/sid/a1"]);
  });

  test("unsubscribe stops notifications", () => {
    let n = 0;
    const unsub = subscribeRoutePathname(() => n++);
    unsub();
    navigate("/s/sid/a1");
    expect(n).toBe(0);
  });
});
