// chartToOption palette parameter: light + non-Paper swaps only `color`.
import { describe, expect, test } from "bun:test";
import { chartToOption } from "./chartToOption";
import type { ChartContract } from "./chartToOption";
import { PALETTES, type PaletteId } from "../lib/paletteStore";
import lightTheme from "./chartTheme.light.json";

const bar: ChartContract = {
  chart_type: "bar",
  data: { kind: "categorical", categories: ["x", "y"], series: [{ name: "s", values: [1, 2] }] },
};
const pie: ChartContract = {
  chart_type: "pie",
  data: { kind: "pie", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] },
};

const NON_PAPER: PaletteId[] = ["broadsheet", "slate", "cobalt"];

describe("chartToOption palette", () => {
  for (const id of NON_PAPER) {
    test(`light + ${id} uses the palette's six colours`, () => {
      expect(chartToOption(bar, "light", id).color).toEqual(PALETTES[id].chart!);
      expect(chartToOption(pie, "light", id).color).toEqual(PALETTES[id].chart!);
    });

    test(`light + ${id} changes nothing but color`, () => {
      const { color: _a, ...swapped } = chartToOption(bar, "light", id) as Record<string, unknown>;
      const { color: _b, ...today } = chartToOption(bar, "light") as Record<string, unknown>;
      expect(swapped).toEqual(today);
    });

    test(`dark ignores ${id}`, () => {
      expect(chartToOption(bar, "dark", id)).toEqual(chartToOption(bar, "dark"));
    });
  }

  test("paper and omitted palette equal today's light output", () => {
    const today = chartToOption(bar, "light");
    expect(chartToOption(bar, "light", "paper")).toEqual(today);
    expect(today.color).toEqual(lightTheme.colors);
  });

  test("the shared theme colours are not mutated by a palette call", () => {
    const before = [...lightTheme.colors];
    chartToOption(bar, "light", "cobalt");
    expect(lightTheme.colors).toEqual(before);
  });
});
