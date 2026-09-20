// Contract-to-ECharts-option translator: a PURE function from a validated
// chart contract ({chart_type, data}) to a complete ECharts option object,
// with every visual decision coming from the house theme JSON. No rendering,
// no state, no ambient input — same contract in, same option out.
import type { EChartsOption } from "echarts";
import type { ChartType, ChartData } from "../../lib/chartContract";
import theme from "./chartTheme.json";

export interface ChartContract {
  chart_type: ChartType;
  data: ChartData;
}

function baseOption(): EChartsOption {
  return {
    backgroundColor: theme.backgroundColor,
    textStyle: { ...theme.textStyle },
    color: [...theme.colors],
  };
}

const sharedAxisStyle = {
  axisLine: { lineStyle: { color: theme.axis.lineColor } },
  axisLabel: { color: theme.axis.labelColor },
};

function categoryAxes(categories: (string | number)[]) {
  return [
    { type: "category" as const, data: categories, ...sharedAxisStyle },
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle },
  ];
}

// Per chartContract: line/area x values are categories when all-strings, numeric
// values otherwise; scatter x/y are always numeric values.
function lineAxes(x: (string | number)[]) {
  return x.every((v) => typeof v === "string")
    ? categoryAxes(x)
    : [
        { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle },
        { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle },
      ];
}

function valueAxes() {
  return [
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle },
    { type: "value" as const, splitLine: { lineStyle: { color: theme.axis.splitLineColor } }, ...sharedAxisStyle },
  ];
}

export function chartToOption(contract: ChartContract): EChartsOption {
  const { chart_type, data } = contract;
  const option = baseOption();

  switch (chart_type) {
    case "pie": {
      if (data.kind !== "pie") throw new Error(`pie requires pie data (got ${data.kind})`);
      return {
        ...option,
        tooltip: { trigger: "item" },
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
      return {
        ...option,
        tooltip: { trigger: "axis" },
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis: categoryAxes(data.categories)[0],
        yAxis: categoryAxes(data.categories)[1],
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
      return {
        ...option,
        tooltip: { trigger: "axis" },
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis: lineAxes(data.x)[0],
        yAxis: lineAxes(data.x)[1],
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
      return {
        ...option,
        tooltip: { trigger: "item" },
        legend: { ...theme.legend },
        grid: { ...theme.grid },
        xAxis: valueAxes()[0],
        yAxis: valueAxes()[1],
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
