// Typed data contracts for the push_chart tool. Agents send plain structured
// data (never raw chart-lib specs); aurora owns all styling via the house
// theme. This module is the single source of truth: the MCP input schema and
// the chartToOption translator both consume these shapes.
import { z } from "zod";

export const CHART_TYPES = ["pie", "bar", "column", "line", "area", "scatter"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** One named series of numeric values aligned with the shared category/x axis. */
export const seriesSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.number()).min(1),
});
export type Series = z.infer<typeof seriesSchema>;

/** Pie: one flat label/value list; no shared axis. */
export const pieDataSchema = z.object({
  kind: z.literal("pie"),
  points: z.array(z.object({ label: z.string().min(1), value: z.number() })).min(1),
});
export type PieData = z.infer<typeof pieDataSchema>;

/** Bar/column: categories on the axis, one or more value series. */
export const categoricalDataSchema = z.object({
  kind: z.literal("categorical"),
  categories: z.array(z.string()).min(1),
  series: z.array(seriesSchema).min(1),
});
export type CategoricalData = z.infer<typeof categoricalDataSchema>;

/** Line/area: ordered x axis (strings are treated as categories, numbers as values). */
export const lineDataSchema = z.object({
  kind: z.literal("line"),
  x: z.array(z.union([z.string(), z.number()])).min(1),
  series: z.array(seriesSchema).min(1),
});
export type LineData = z.infer<typeof lineDataSchema>;

/** Scatter: per-series (x, y) points; no shared axis. */
export const scatterDataSchema = z.object({
  kind: z.literal("scatter"),
  series: z
    .array(z.object({ name: z.string().min(1), points: z.array(z.tuple([z.number(), z.number()])).min(1) }))
    .min(1),
});
export type ScatterData = z.infer<typeof scatterDataSchema>;

export const chartDataSchema = z.discriminatedUnion("kind", [
  pieDataSchema,
  categoricalDataSchema,
  lineDataSchema,
  scatterDataSchema,
]);
export type ChartData = z.infer<typeof chartDataSchema>;

/** Allowed data `kind` per chart_type — the shape contract the tool enforces. */
export const REQUIRED_KIND: Record<ChartType, string> = {
  pie: "pie",
  bar: "categorical",
  column: "categorical",
  line: "line",
  area: "line",
  scatter: "scatter",
};

export const chartPushSchema = z.object({
  chart_type: z.enum(CHART_TYPES),
  data: chartDataSchema,
});

/**
 * Validate that a chart_type + data pair is coherent (e.g. bar requires
 * categorical data). Returns an error message, or null when valid.
 */
export function chartContractError(chartType: ChartType, data: ChartData): string | null {
  const required = REQUIRED_KIND[chartType];
  if (data.kind !== required) {
    return `chart_type "${chartType}" requires data of kind "${required}" (got "${data.kind}")`;
  }
  return null;
}
