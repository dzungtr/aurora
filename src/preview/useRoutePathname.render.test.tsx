// Render-level regression for #108: a component reading useRoutePathname must
// re-render on in-app navigate() and on popstate.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { installDom } from "../test/dom";
import { navigate } from "./previewApi";
import { useRoutePathname } from "./useRoutePathname";

let dom: ReturnType<typeof installDom>;
let root: Root;
let host: HTMLElement;

function Probe() {
  return <span data-testid="path">{useRoutePathname()}</span>;
}

beforeAll(() => {
  dom = installDom("http://localhost/s/sid/a2");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterAll(() => {
  act(() => root.unmount());
  dom.restore();
});

test("re-renders on navigate() and popstate", () => {
  act(() => root.render(<Probe />));
  expect(host.textContent).toBe("/s/sid/a2");

  act(() => navigate("/s/sid/a1"));
  expect(host.textContent).toBe("/s/sid/a1");

  // A raw pushState emits nothing; only the popstate event may re-render.
  act(() => window.history.pushState({}, "", "/s/sid/a3"));
  expect(host.textContent).toBe("/s/sid/a1");
  act(() => {
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });
  expect(host.textContent).toBe("/s/sid/a3");
});
