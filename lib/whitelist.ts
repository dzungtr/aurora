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
  /** Video models: supported durations in seconds */
  durations?: number[];
  /** Video models: whether the model can generate audio alongside video */
  supports_audio?: boolean;
  /** Speech models: voice filled from this when the tool call omits `voice` */
  default_voice?: string;
  /** Speech models: whether input_references voice-clone clips are accepted */
  supports_voice_cloning?: boolean;
}

export interface GenerationWhitelist {
  image: WhitelistModelEntry[];
  video: WhitelistModelEntry[];
  speech: WhitelistModelEntry[];
  /** Music models (chat-completions audio modality, spec #55) */
  music: WhitelistModelEntry[];
  /**
   * Optional base URL (e.g. a remote ingress) used for preview deep links
   * returned by MCP tools. When absent, the request's own Host / forwarded
   * headers are used, falling back to loopback + external port.
   */
  publicUrl?: string;
}

export interface ModelCatalogInfo {
  /** Best-effort live price hint, e.g. "$0.03/image"; absent when the catalog is unreachable */
  priceHint?: string;
}

/** Cheap-tier defaults: one fast image model and one cheap video model. */
export const DEFAULT_WHITELIST: GenerationWhitelist = {
  image: [
    {
      id: "google/gemini-2.5-flash-image",
      note: "fast, low-cost image generation (nano-banana tier)",
      default: true,
    },
  ],
  speech: [
    {
      id: "hexgrad/kokoro-82m",
      note: "cheap-tier text-to-speech",
      default: true,
      default_voice: "af_heart",
    },
    {
      id: "google/gemini-3.8-flash-tts",
      note: "flash-tier text-to-speech",
      default_voice: "Kore",
    },
    {
      id: "elevenlabs/eleven-v4",
      note: "voice-cloning text-to-speech",
      default_voice: "Rachel",
      supports_voice_cloning: true,
    },
  ],
  music: [
    {
      id: "google/lyria-3-clip-preview",
      note: "$0.04/clip (30s)",
      default: true,
    },
    {
      id: "google/lyria-3-pro-preview",
      note: "$0.08/song",
    },
  ],
  video: [
    {
      id: "x-ai/grok-imagine-video-1.5-lite",
      note: "cheap-tier video generation",
      default: true,
      durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      resolutions: ["480p", "720p", "1080p"],
      aspect_ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
      supports_audio: true,
    },
  ],
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
      durations: Array.isArray(e.durations) ? e.durations : undefined,
      supports_audio: typeof e.supports_audio === "boolean" ? e.supports_audio : undefined,
      default_voice: typeof e.default_voice === "string" ? e.default_voice : undefined,
      supports_voice_cloning: typeof e.supports_voice_cloning === "boolean" ? e.supports_voice_cloning : undefined,
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
    const out: GenerationWhitelist = { image: [], video: [], speech: [], music: [] };
    for (const modality of ["image", "video", "speech", "music"] as const) {
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
    return { ...out, publicUrl: loadConfigPublicUrl(parsed) };
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

/** The config's publicUrl field, when a non-empty string. */
function loadConfigPublicUrl(parsed: Partial<GenerationWhitelist>): string | undefined {
  return typeof parsed.publicUrl === "string" && parsed.publicUrl.length > 0 ? parsed.publicUrl : undefined;
}

/**
 * Operator's public base URL for preview deep links, from the generation
 * config's publicUrl field (undefined when unset or the config is missing).
 * Re-read per request so config edits apply without a server restart.
 */
export function loadPublicUrl(configPath: string = defaultGenerationConfigPath()): string | undefined {
  return loadWhitelist(configPath).publicUrl;
}

/**
 * Build the create_video tool description with live per-second price hints
 * from the (best-effort) video catalog, falling back to static notes offline.
 */
export function buildVideoToolDescription(
  whitelist: GenerationWhitelist,
  catalog: Map<string, ModelCatalogInfo> = new Map()
): string {
  const hints = whitelist.video
    .map((m) => `${m.id}${formatPriceHint(m, catalog)}${m.default ? " [default]" : ""}`)
    .join("; ");
  return (
    "Generate one short video from a text prompt via OpenRouter. Submit-and-notify: " +
    "returns a job id immediately; a background poller pushes the finished video " +
    "artifact into the session when the provider completes (or a visible failure " +
    "artifact when it fails, is cancelled, or expires). Model per-second prices at " +
    "build of this description: " +
    hints +
    ". Optional duration/resolution/aspect_ratio/generate_audio are validated " +
    "against the model's capabilities before submission."
  );
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
 * Build the create_speech tool description. Speech is priced per input
 * character (spec #55 decision 9); model ids come from the speech whitelist.
 */
export function buildSpeechToolDescription(whitelist: GenerationWhitelist): string {
  const hints = whitelist.speech
    .map((m) => {
      const cloning = m.supports_voice_cloning ? " [voice cloning]" : "";
      return `${m.id}${formatPriceHint(m, new Map())}${cloning}${m.default ? " [default]" : ""}`;
    })
    .join("; ");
  return (
    "Generate one speech audio artifact from text via OpenRouter's /audio/speech endpoint " +
    "and snapshot it into the session. Priced per input character; pennies per call. " +
    "Speech models at build of this description: " +
    hints +
    ". Voice cloning references require a model that supports them."
  );
}

/**
 * Pre-flight validation of create_speech voice-cloning references against
 * the model's whitelist entry (spec #55 story 17): cloning references on a
 * model without the capability fail fast with an actionable error.
 */
export function speechCloningPreflightError(entry: WhitelistModelEntry, hasReferences: boolean): string | null {
  if (hasReferences && entry.supports_voice_cloning !== true) {
    return (
      `model ${entry.id} does not support voice cloning. ` +
      "Omit input_references or choose a cloning-capable speech model (supports_voice_cloning on the whitelist)."
    );
  }
  return null;
}

/**
 * Build the create_music tool description with the per-song price hints
 * (spec #55 decision 9): the whitelist entries carry static per-song prices,
 * so the description is built from the whitelist alone.
 */
export function buildMusicToolDescription(whitelist: GenerationWhitelist): string {
  const hints = whitelist.music
    .map((m) => `${m.id}${formatPriceHint(m, new Map())}${m.default ? " [default]" : ""}`)
    .join("; ");
  return (
    "Generate one song from a text prompt, optionally conditioned on reference " +
    "images, via OpenRouter's chat-completions audio modality; snapshots an " +
    "aurora audio artifact with the song's lyrics/structure stored as " +
    "transcript metadata. Synchronous. Per-song prices at build of this " +
    "description: " +
    hints +
    "."
  );
}

/** Video generation params subject to pre-flight validation. */
export interface VideoGenerationParams {
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  generate_audio?: boolean;
}

/**
 * Pre-flight validation of create_video params against the model's whitelist
 * entry caps (operator-curated config/defaults; the OpenRouter catalog carries
 * pricing only — PRD #24 amendment 2026-10-11). Returns an actionable error,
 * or null when acceptable.
 */
export function videoPreflightError(entry: WhitelistModelEntry, params: VideoGenerationParams): string | null {
  if (params.duration !== undefined) {
    if (!entry.durations || !entry.durations.includes(params.duration)) {
      return (
        `model ${entry.id} does not support duration ${params.duration}s. ` +
        `Allowed: ${(entry.durations ?? []).join(", ")}`
      );
    }
  }
  if (params.resolution !== undefined) {
    const err = preflightParamError(entry, "resolutions", params.resolution);
    if (err) return err;
  }
  if (params.aspect_ratio !== undefined) {
    const err = preflightParamError(entry, "aspect_ratios", params.aspect_ratio);
    if (err) return err;
  }
  if (params.generate_audio === true && entry.supports_audio === false) {
    return `model ${entry.id} does not support audio generation`;
  }
  return null;
}

/**
 * Pre-flight validation of generation params against the model's capabilities.
 * Caps come from the whitelist entry (operator-curated config/defaults), not
 * the OpenRouter catalog: the public catalog carries pricing only (PRD #24
 * amendment 2026-10-11). Returns an actionable error, or null when acceptable.
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
