// Viewer-chosen light palette. Module-level singleton (like themeStore) so the
// choice survives the full-tree remounts that navigation triggers. Presentation
// only: nothing agent- or server-side can select a palette.

import { useSyncExternalStore } from "react";
import type { Theme } from "./themeStore";

export type PaletteId = "paper" | "broadsheet" | "slate" | "cobalt";

export const PALETTE_ORDER: PaletteId[] = ["paper", "broadsheet", "slate", "cobalt"];

export interface PaletteMeta {
  label: string;
  /** Left half of the two-tone swatch. */
  bg: string;
  /** Right half of the swatch; the palette's accent. */
  swatch: string;
  /** Six chart colours for the light chart theme; null keeps chartTheme.light.json. */
  chart: string[] | null;
}

export const PALETTES: Record<PaletteId, PaletteMeta> = {
  paper: { label: "Paper", bg: "#ffffff", swatch: "#673ab6", chart: null },
  broadsheet: {
    label: "Broadsheet",
    bg: "#ffffff",
    swatch: "#c62828",
    chart: ["#c62828", "#1a237e", "#2e7d32", "#f9a825", "#6a1b9a", "#00838f"],
  },
  slate: {
    label: "Slate & coral",
    bg: "#eef1f5",
    swatch: "#e0523f",
    chart: ["#e0523f", "#334e68", "#0e9f8a", "#eab308", "#7c3aed", "#64748b"],
  },
  cobalt: {
    label: "Cobalt & tangerine",
    bg: "#f3f6ff",
    swatch: "#1e40af",
    chart: ["#1e40af", "#ea580c", "#0891b2", "#ca8a04", "#9333ea", "#dc2626"],
  },
};

const KEY = "aurora:palette";
const subscribers = new Set<() => void>();

function readStored(): PaletteId {
  try {
    const raw = localStorage.getItem(KEY);
    return PALETTE_ORDER.find((id) => id === raw) ?? "paper";
  } catch {
    return "paper";
  }
}

let palette: PaletteId = readStored();

export function setPalette(next: PaletteId): void {
  if (next === palette) return;
  palette = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // best-effort persistence only
  }
  for (const fn of subscribers) fn();
}

export function getPalette(): PaletteId {
  return palette;
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** React hook: the current palette, live-updating across every mounted surface. */
export function usePalette(): PaletteId {
  return useSyncExternalStore(subscribe, getPalette, getPalette);
}

/** Value for the `.aur` root's `data-palette`: light and non-Paper only. */
export function rootPalette(theme: Theme, id: PaletteId): PaletteId | undefined {
  return theme === "light" && id !== "paper" ? id : undefined;
}
