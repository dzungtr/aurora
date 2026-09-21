// Contract-to-ECharts-option translator: a PURE function from a validated
// chart contract ({chart_type, data}) plus the active theme name to a
// complete ECharts option object, with every visual decision coming from
// the house theme JSON. No rendering, no state, no other ambient input —
// same contract+theme in, same option out.
import type { EChartsOption } from "echarts";
import type { ChartType, ChartData } from "../../lib/chartContract";
import darkTheme from "./chartTheme.json";
import lightTheme from "./chartTheme.light.json";

export interface ChartContract {
  chart_type: ChartType;
  data: ChartData;
}

export type ChartThemeName = "light" | "dark";
type ChartTheme = typeof darkTheme;

function themeFor(name: ChartThemeName): ChartTheme {
  return name === "light" ? lightTheme : darkTheme;
}

function baseOption(theme: ChartTheme): EChartsOption {
  return {
    backgroundColor: theme.backgroundColor,
    textStyle: { ...theme.textStyle },
    color: [...theme.colors],
  };
}

function tooltipFor(trigger: "item" | "axis", theme: ChartTheme) {
  return {
    trigger,
    backgroundColor: theme.tooltip.backgroundColor,
    borderColor: theme.tooltip.borderColor,
    textStyle: { color: theme.tooltip.textColor },
  };
}

function sharedAxisStyle(theme: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: theme.axis.lineColor } },
    axisLabel: { color: theme.axis.labelColor },
  };
}

function categoryAxes(categories: (string | number)[], theme: ChartTheme) {
  return [
    { type: "category" as const, data: categories, ...sharedAxisStyle(theme) },
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle(theme) },
  ];
}

// Per chartContract: line/area x values are categories when all-strings, numeric
// values otherwise; scatter x/y are always numeric values.
function lineAxes(x: (string | number)[], theme: ChartTheme) {
  return x.every((v) => typeof v === "string")
    ? categoryAxes(x, theme)
    : [
        { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle(theme) },
        { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle(theme) },
      ];
}

function valueAxes(theme: ChartTheme) {
  return [
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle(theme) },
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle(theme) },
  ];
}

export function chartToOption(contract: ChartContract, themeName: ChartThemeName = "dark"): EChartsOption {
  const { chart_type, data } = contract;
  const theme = themeFor(themeName);
  const option = baseOption(theme);

  switch (chart_type) {
    case "pie": {
      if (data.kind !== "pie") throw new Error(`pie requires pie data (got ${data.kind})`);
      return {
        ...option,
        tooltip: tooltipFor("item", theme),
        legend: { ...theme.legend },
        series: [
          {
            type: "pie",
            radius: theme.pie.radius,
            center: theme.pie.center,
            data: data.points.map((p) => ({ name: p.label, value: p.value })),
          },
        ],
      };
    }
    case "bar":
    case "column": {
      if (data.kind !== "categorical") throw new Error(`${chart_type} requires categorical data (got ${data.kind})`);
      const [xAxis, yAxis] = categoryAxes(data.categories, theme);
      return {
        ...option,
        tooltip: tooltipFor("axis", theme),
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis,
        yAxis,
        series: data.series.map((s) => ({
          name: s.name,
          type: "bar" as const,
          data: s.values,
          barMaxWidth: theme.bar.barMaxWidth,
          itemStyle: { borderRadius: theme.bar.borderRadius },
        })),
      };
    }
    case "line":
    case "area": {
      if (data.kind !== "line") throw new Error(`${chart_type} requires line data (got ${data.kind})`);
      const [xAxis, yAxis] = lineAxes(data.x, theme);
      return {
        ...option,
        tooltip: tooltipFor("axis", theme),
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis,
        yAxis,
        series: data.series.map((s) => ({
          name: s.name,
          type: "line" as const,
          data: s.values,
          lineStyle: { width: theme.line.width },
          symbolSize: theme.line.pointSize,
          ...(chart_type === "area" ? { areaStyle: { opacity: 0.25 } } : {}),
        })),
      };
    }
    case "scatter": {
      if (data.kind !== "scatter") throw new Error(`scatter requires scatter data (got ${data.kind})`);
      const [xAxis, yAxis] = valueAxes(theme);
      return {
        ...option,
        tooltip: tooltipFor("item", theme),
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis,
        yAxis,
        series: data.series.map((s) => ({
          name: s.name,
          type: "scatter" as const,
          data: s.points.map(([x, y]) => [x, y]),
          symbolSize: theme.line.pointSize * 1.5,
        })),
      };
    }
  }
}
