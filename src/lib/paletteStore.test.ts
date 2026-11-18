// paletteStore: contract values, storage fallback and guarded persistence.
import { describe, expect, test } from "bun:test";

type Storage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };

async function freshStore(storage: Storage | undefined) {
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  return import(`./paletteStore.ts?${Math.random()}`) as Promise<typeof import("./paletteStore")>;
}

describe("PALETTES", () => {
  test("order and labels follow the contract", async () => {
    const { PALETTE_ORDER, PALETTES } = await freshStore(undefined);
    expect(PALETTE_ORDER).toEqual(["paper", "broadsheet", "slate", "cobalt"]);
    expect(PALETTE_ORDER.map((id) => PALETTES[id].label)).toEqual([
      "Paper",
      "Broadsheet",
      "Slate & coral",
      "Cobalt & tangerine",
    ]);
  });

  test("swatch and bg colours", async () => {
    const { PALETTES } = await freshStore(undefined);
    expect(PALETTES.paper).toMatchObject({ bg: "#ffffff", swatch: "#673ab6", chart: null });
    expect(PALETTES.broadsheet).toMatchObject({ bg: "#ffffff", swatch: "#c62828" });
    expect(PALETTES.slate).toMatchObject({ bg: "#eef1f5", swatch: "#e0523f" });
    expect(PALETTES.cobalt).toMatchObject({ bg: "#f3f6ff", swatch: "#1e40af" });
  });

  test("chart colour arrays are exactly the six contract colours", async () => {
    const { PALETTES } = await freshStore(undefined);
    expect(PALETTES.broadsheet.chart).toEqual(["#c62828", "#1a237e", "#2e7d32", "#f9a825", "#6a1b9a", "#00838f"]);
    expect(PALETTES.slate.chart).toEqual(["#e0523f", "#334e68", "#0e9f8a", "#eab308", "#7c3aed", "#64748b"]);
    expect(PALETTES.cobalt.chart).toEqual(["#1e40af", "#ea580c", "#0891b2", "#ca8a04", "#9333ea", "#dc2626"]);
  });
});

describe("initial value", () => {
  const stored = (v: string | null): Storage => ({ getItem: () => v, setItem: () => {} });

  test("missing stored value is paper", async () => {
    const { getPalette } = await freshStore(stored(null));
    expect(getPalette()).toBe("paper");
  });

  test("unknown stored value is paper", async () => {
    const { getPalette } = await freshStore(stored("nope"));
    expect(getPalette()).toBe("paper");
  });

  test("known stored value is restored", async () => {
    const { getPalette } = await freshStore(stored("slate"));
    expect(getPalette()).toBe("slate");
  });

  test("a throwing getItem never throws and yields paper", async () => {
    const { getPalette } = await freshStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    });
    expect(getPalette()).toBe("paper");
  });

  test("absent localStorage yields paper", async () => {
    const { getPalette } = await freshStore(undefined);
    expect(getPalette()).toBe("paper");
  });
});

describe("setPalette", () => {
  test("persists under aurora:palette and notifies subscribers", async () => {
    const writes: [string, string][] = [];
    const { setPalette, getPalette, subscribe } = await freshStore({
      getItem: () => null,
      setItem: (k, v) => void writes.push([k, v]),
    });
    let calls = 0;
    subscribe(() => calls++);
    setPalette("cobalt");
    expect(getPalette()).toBe("cobalt");
    expect(writes).toEqual([["aurora:palette", "cobalt"]]);
    expect(calls).toBe(1);
    setPalette("cobalt");
    expect(calls).toBe(1);
  });

  test("a throwing setItem never throws and the choice still applies", async () => {
    const { setPalette, getPalette } = await freshStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => setPalette("broadsheet")).not.toThrow();
    expect(getPalette()).toBe("broadsheet");
  });
});

describe("rootPalette", () => {
  test("data-palette only in light and for non-paper", async () => {
    const { rootPalette } = await freshStore(undefined);
    expect(rootPalette("light", "paper")).toBeUndefined();
    expect(rootPalette("light", "slate")).toBe("slate");
    expect(rootPalette("dark", "slate")).toBeUndefined();
    expect(rootPalette("dark", "paper")).toBeUndefined();
  });
});
