// PalettePicker: dark renders nothing; light renders four ordered swatches.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PalettePicker } from "./PalettePicker";
import { setPalette } from "../lib/paletteStore";
import { setTheme, useTheme } from "../lib/themeStore";

const unescape = (s: string) => s.replace(/&amp;/g, "&");
const pressed = (html: string) => [...html.matchAll(/aria-pressed="(true|false)"/g)].map((m) => m[1]);

function ThemeProbe() {
  return <>{useTheme()}</>;
}

describe("PalettePicker", () => {
  test("renders nothing in dark theme", () => {
    setTheme("dark");
    expect(renderToStaticMarkup(<PalettePicker />)).toBe("");
  });

  test("renders four swatches in order with title, aria-label and aria-pressed", () => {
    setTheme("light");
    setPalette("paper");
    const html = renderToStaticMarkup(<PalettePicker />);
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => unescape(m[1]));
    expect(labels).toEqual(["Paper", "Broadsheet", "Slate & coral", "Cobalt & tangerine"]);
    expect([...html.matchAll(/<button[^>]*title="([^"]+)"/g)].map((m) => unescape(m[1]))).toEqual(labels);
    expect(pressed(html)).toEqual(["true", "false", "false", "false"]);
    expect(html).toContain("linear-gradient(135deg, #ffffff 50%, #673ab6 50%)");
  });

  test("marks the active palette and shows its label", () => {
    setTheme("light");
    setPalette("slate");
    const html = renderToStaticMarkup(<PalettePicker />);
    expect(pressed(html)).toEqual(["false", "false", "true", "false"]);
    expect(html).toMatch(/aur-palette__label[^>]*>Slate &amp; coral</);
  });

  test("the stored palette survives dark and returns in light", () => {
    setTheme("light");
    setPalette("cobalt");
    setTheme("dark");
    expect(renderToStaticMarkup(<PalettePicker />)).toBe("");
    setTheme("light");
    expect(pressed(renderToStaticMarkup(<PalettePicker />))).toEqual(["false", "false", "false", "true"]);
  });

  test("choosing a palette leaves the theme alone", () => {
    setTheme("light");
    setPalette("broadsheet");
    expect(renderToStaticMarkup(<ThemeProbe />)).toBe("light");
  });
});
