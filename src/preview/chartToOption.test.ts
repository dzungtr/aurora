// chartToOption is a pure function: unit-tested per chart_type for option
// shape and house-theme application. No DOM, no ECharts instance.
import { describe, expect, test } from "bun:test";
import { chartToOption } from "./chartToOption";
import type { ChartContract } from "./chartToOption";
import theme from "./chartTheme.json";
import type { ChartData } from "../../lib/chartContract";

const valid: Record<string, ChartContract> = {
  pie: { chart_type: "pie", data: { kind: "pie", points: [{ label: "a", value: 1 }, { label: "b", value: 2 }] } },
  bar: {
    chart_type: "bar",
    data: { kind: "categorical", categories: ["x", "y"], series: [{ name: "s", values: [1, 2] }] },
  },
  column: {
    chart_type: "column",
    data: { kind: "categorical", categories: ["x", "y"], series: [{ name: "s", values: [3, 4] }] },
  },
  line: {
    chart_type: "line",
    data: { kind: "line", x: ["a", "b"], series: [{ name: "s", values: [1, 2] }] },
  },
  area: {
    chart_type: "area",
    data: { kind: "line", x: ["a", "b"], series: [{ name: "s", values: [1, 2] }] },
  },
  scatter: {
    chart_type: "scatter",
    data: { kind: "scatter", series: [{ name: "s", points: [[1, 2], [3, 4]] }] },
  },
};

describe("chartToOption", () => {
  test.each(Object.keys(valid))("%s: renders from its contract with the house theme", (type) => {
    const opt = chartToOption(valid[type]) as any;
    expect(opt.color).toEqual(theme.colors); // house palette applied
    expect(opt.textStyle.color).toBe(theme.textStyle.color); // house font/color applied
    expect(opt.series.length).toBeGreaterThanOrEqual(1);
    expect(opt.series[0].type).toBe(type === "column" ? "bar" : type === "area" ? "line" : type);
  });

  test("bar: categories land on the x axis, series values map 1:1", () => {
    const opt = chartToOption(valid.bar) as any;
    expect(opt.xAxis.data).toEqual(["x", "y"]);
    expect(opt.series[0].data).toEqual([1, 2]);
    expect(opt.series[0].barMaxWidth).toBe(theme.bar.barMaxWidth);
  });

  test("pie: points become name/value data with house radius", () => {
    const opt = chartToOption(valid.pie) as any;
    expect(opt.series[0].data).toEqual([{ name: "a", value: 1 }, { name: "b", value: 2 }]);
    expect(opt.series[0].radius).toBe(theme.pie.radius);
  });

  test("area: line series gain an areaStyle fill", () => {
    const line = chartToOption(valid.line) as any;
    const area = chartToOption(valid.area) as any;
    expect(line.series[0].areaStyle).toBeUndefined();
    expect(area.series[0].areaStyle).toBeDefined();
  });

  test("scatter: (x, y) tuples pass through per series", () => {
    const opt = chartToOption(valid.scatter) as any;
    expect(opt.series[0].data).toEqual([[1, 2], [3, 4]]);
  });

  test("scatter: numeric x is a value axis, never ordinalized", () => {
    const opt = chartToOption({
      chart_type: "scatter",
      data: { kind: "scatter", series: [{ name: "s", points: [[0, 1], [100, 2], [101, 3]] }] },
    }) as any;
    expect(opt.xAxis.type).toBe("value");
    expect(opt.yAxis.type).toBe("value");
    expect(opt.xAxis).not.toHaveProperty("data"); // no category bucketing
  });

  test("line: numeric x uses value axes (non-uniform spacing preserved), string x stays categorical", () => {
    const numeric = chartToOption({
      chart_type: "line",
      data: { kind: "line", x: [0, 10, 11], series: [{ name: "s", values: [1, 2, 3] }] },
    }) as any;
    expect(numeric.xAxis.type).toBe("value");
    expect(numeric.yAxis.type).toBe("value");
    expect(numeric.series[0].data).toEqual([1, 2, 3]);

    const categorical = chartToOption(valid.line) as any;
    expect(categorical.xAxis.type).toBe("category");
    expect(categorical.xAxis.data).toEqual(["a", "b"]);
  });

  test("theme legend uses real ECharts sizing keys (itemWidth/itemHeight, no iconSize)", () => {
    const opt = chartToOption(valid.bar) as any;
    expect(opt.legend.itemWidth).toBe(10);
    expect(opt.legend.itemHeight).toBe(10);
    expect(opt.legend).not.toHaveProperty("iconSize");
  });

  test("mismatched contract kind throws (defense in depth behind tool validation)", () => {
    const bad: ChartContract = {
      chart_type: "bar",
      data: { kind: "pie", points: [{ label: "a", value: 1 }] } as unknown as ChartData,
    };
    expect(() => chartToOption(bad)).toThrow();
  });

  test("purity: repeated calls return deep-equal options, input untouched", () => {
    const before = JSON.stringify(valid.line);
    const a = chartToOption(valid.line);
    const b = chartToOption(valid.line);
    expect(JSON.stringify(valid.line)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
