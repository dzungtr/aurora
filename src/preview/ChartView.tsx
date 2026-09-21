// Chart artifact renderer: feeds the stored chart contract through the pure
// chartToOption translator and renders it with ECharts. In-place replace
// (same artifact_id re-pushed) lands as new content → re-init option.
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { chartToOption, type ChartContract } from "./chartToOption";
import { useTheme } from "../lib/themeStore";

export type { ChartContract };

export function parseChartContract(content: string): ChartContract {
  const parsed = JSON.parse(content) as ChartContract;
  if (typeof parsed !== "object" || parsed === null || typeof parsed.chart_type !== "string") {
    throw new Error("not a chart contract");
  }
  return parsed;
}

export function ChartView({ contract }: { contract: ChartContract }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(chartToOption(contract, theme));
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [contract, theme]);

  return <div className="aur-chart" ref={ref} />;
}
