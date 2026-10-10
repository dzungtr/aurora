import { describe, it, expect } from "bun:test";
import { chartDataSchema } from "./chartContract";

describe("chartDataSchema scatter contract", () => {
  it("accepts well-formed scatter payloads", () => {
    const res = chartDataSchema.safeParse({
      kind: "scatter",
      series: [{ name: "s", points: [[1, 2], [3, 4]] }],
    });
    expect(res.success).toBe(true);
  });

  it("rejects a 3-element point", () => {
    const res = chartDataSchema.safeParse({
      kind: "scatter",
      series: [{ name: "s", points: [[1, 2, 3]] }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a 1-element point", () => {
    const res = chartDataSchema.safeParse({
      kind: "scatter",
      series: [{ name: "s", points: [[1]] }],
    });
    expect(res.success).toBe(false);
  });
});
