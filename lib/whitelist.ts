import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Model whitelist for the generation tools. Code-shipped defaults, optionally
 * overridden by a JSON config file at ~/.config/aurora/generation.json (path
 * overridable via the AURORA_GENERATION_CONFIG env var). The active whitelist
 * is re-read per request so config edits apply without a server restart.
 */
export interface WhitelistModelEntry {
  id: string;
  note?: string;
  default?: boolean;
  /** Per-model parameter caps, used for pre-flight validation against the model's catalog capabilities */
  resolutions?: string[];
  aspect_ratios?: string[];
  qualities?: string[];
}

export interface GenerationWhitelist {
  image: WhitelistModelEntry[];
  video: WhitelistModelEntry[];
}

export interface ModelCatalogInfo {
  /** Best-effort live price hint, e.g. "$0.03/image"; absent when the catalog is unreachable */
  priceHint?: string;
}

/** Cheap-tier defaults: one fast image model; video stays empty until #26. */
export const DEFAULT_WHITELIST: GenerationWhitelist = {
  image: [
    {
      id: "google/gemini-2.5-flash-image",
      note: "fast, low-cost image generation (nano-banana tier)",
      default: true,
    },
  ],
  video: [],
};

/** Default config file location; the whitelist module reads it per request. */
export function defaultGenerationConfigPath(): string {
  return process.env.AURORA_GENERATION_CONFIG ?? join(homedir(), ".config/aurora/generation.json");
}

function normalizeEntry(raw: unknown): WhitelistModelEntry | null {
  if (typeof raw === "string") return { id: raw };
  if (raw && typeof raw === "object" && typeof (raw as any).id === "string") {
    const e = raw as WhitelistModelEntry;
    return {
      id: e.id,
      note: typeof e.note === "string" ? e.note : undefined,
      default: e.default === true,
      resolutions: e.resolutions,
      aspect_ratios: e.aspect_ratios,
      qualities: e.qualities,
    };
  }
  return null;
}

/**
 * Load the active whitelist: defaults, replaced per-modality by the config
 * file when it exists and parses. A missing file is silent (defaults only);
 * an unreadable/invalid file warns and falls back to defaults — config is
 * never a startup failure.
 */
export function loadWhitelist(configPath: string = defaultGenerationConfigPath()): GenerationWhitelist {
  let raw: string;
  try {
    raw = readFileSync(resolve(configPath), "utf-8");
  } catch {
    return DEFAULT_WHITELIST;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<GenerationWhitelist>;
    const out: GenerationWhitelist = { image: [], video: [] };
    for (const modality of ["image", "video"] as const) {
      const list = parsed[modality];
      if (Array.isArray(list)) {
        for (const entry of list) {
          const norm = normalizeEntry(entry);
          if (norm) out[modality].push(norm);
        }
      } else {
        out[modality] = DEFAULT_WHITELIST[modality];
      }
    }
    return out;
  } catch (err) {
    console.error(`whitelist: ignoring invalid generation config at ${configPath}:`, err);
    return DEFAULT_WHITELIST;
  }
}

/** The default model id for a modality, or the first entry. */
export function defaultModel(list: WhitelistModelEntry[]): string | undefined {
  return (list.find((m) => m.default) ?? list[0])?.id;
}

/** Model ids for the tool schema enum, rebuilt per request. */
export function modelIds(list: WhitelistModelEntry[]): string[] {
  return list.map((m) => m.id);
}

function formatPriceHint(entry: WhitelistModelEntry, catalog: Map<string, ModelCatalogInfo>): string {
  const hint = catalog.get(entry.id)?.priceHint;
  if (hint) return ` (~${hint})`;
  if (entry.note) return ` (${entry.note})`;
  return "";
}

/**
 * Build the create_image tool description with live price hints from the
 * (best-effort) catalog, falling back to static notes offline.
 */
export function buildImageToolDescription(
  whitelist: GenerationWhitelist,
  catalog: Map<string, ModelCatalogInfo> = new Map()
): string {
  const hints = whitelist.image
    .map((m) => `${m.id}${formatPriceHint(m, catalog)}${m.default ? " [default]" : ""}`)
    .join("; ");
  return (
    "Generate one image from a text prompt via OpenRouter and snapshot it as an " +
    "aurora image artifact. Model prices at build of this description: " +
    hints +
    ". Optional resolution/aspect_ratio/quality are validated against the model's capabilities before submission."
  );
}

/**
 * Pre-flight validation of generation params against the model's catalog
 * capabilities. Returns an actionable error message, or null when acceptable.
 */
export function preflightParamError(
  entry: WhitelistModelEntry,
  param: "resolutions" | "aspect_ratios" | "qualities",
  value: string
): string | null {
  const allowed = entry[param];
  if (!allowed || allowed.includes(value)) return null;
  return (
    `model ${entry.id} does not support ${param.slice(0, -1)} "${value}". ` +
    `Allowed: ${allowed.join(", ")}`
  );
}
