import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WHITELIST,
  loadWhitelist,
  modelIds,
  defaultModel,
  buildImageToolDescription,
  preflightParamError,
  buildSpeechToolDescription,
  speechCloningPreflightError,
} from "./whitelist";

describe("whitelist", () => {
  it("falls back to code-shipped defaults when no config file exists", () => {
    const wl = loadWhitelist(join(tmpdir(), `no-such-config-${Date.now()}.json`));
    expect(wl).toBe(DEFAULT_WHITELIST);
    expect(defaultModel(wl.image)).toBe("google/gemini-2.5-flash-image");
  });

  it("overrides a modality from a JSON config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-wl-"));
    const path = join(dir, "generation.json");
    writeFileSync(
      path,
      JSON.stringify({ image: [{ id: "custom/model", note: "mine", default: true }] })
    );
    try {
      const wl = loadWhitelist(path);
      expect(modelIds(wl.image)).toEqual(["custom/model"]);
      expect(defaultModel(wl.image)).toBe("custom/model");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to defaults (not a failure) on an invalid config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-wl-"));
    const path = join(dir, "generation.json");
    writeFileSync(path, "{not json");
    try {
      expect(loadWhitelist(path)).toBe(DEFAULT_WHITELIST);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("description uses live price hints when available, static notes offline", () => {
    const wl = loadWhitelist(join(tmpdir(), `no-such-config-${Date.now()}.json`));
    const offline = buildImageToolDescription(wl);
    expect(offline).toContain("fast, low-cost image generation");
    expect(offline).not.toContain("$");
    const online = buildImageToolDescription(wl, new Map([["google/gemini-2.5-flash-image", { priceHint: "$0.03/image" }]]));
    expect(online).toContain("$0.03/image");
  });

  it("pre-flight rejects params outside the model's capabilities", () => {
    const entry = { id: "m", aspect_ratios: ["1:1", "16:9"] };
    expect(preflightParamError(entry, "aspect_ratios", "21:9")).toContain("1:1, 16:9");
    expect(preflightParamError(entry, "aspect_ratios", "16:9")).toBeNull();
    // No capability data → pass through to the provider
    expect(preflightParamError({ id: "m" }, "aspect_ratios", "21:9")).toBeNull();
  });
});

describe("speech whitelist (issue #57)", () => {
  it("ships three speech defaults with default_voice and cloning flags", () => {
    expect(modelIds(DEFAULT_WHITELIST.speech)).toEqual([
      "hexgrad/kokoro-82m",
      "google/gemini-3.8-flash-tts",
      "elevenlabs/eleven-v4",
    ]);
    expect(defaultModel(DEFAULT_WHITELIST.speech)).toBe("hexgrad/kokoro-82m");
    const kokoro = DEFAULT_WHITELIST.speech[0];
    expect(kokoro.default_voice).toBe("af_heart");
    expect(kokoro.supports_voice_cloning).toBeUndefined();
    expect(DEFAULT_WHITELIST.speech[2].supports_voice_cloning).toBe(true);
  });

  it("normalizes default_voice and supports_voice_cloning from a config override", () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-speech-wl-"));
    const path = join(dir, "generation.json");
    writeFileSync(path, JSON.stringify({
      speech: [
        { id: "custom/tts", default: true, default_voice: "nx_alloy", supports_voice_cloning: false },
        { id: "clone/tts", supports_voice_cloning: true },
      ],
    }));
    try {
      const wl = loadWhitelist(path);
      expect(modelIds(wl.speech)).toEqual(["custom/tts", "clone/tts"]);
      expect(wl.speech[0].default_voice).toBe("nx_alloy");
      expect(wl.speech[0].supports_voice_cloning).toBe(false);
      expect(wl.speech[1].supports_voice_cloning).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overrides speech per-modality while image/video keep their defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "aurora-speech-wl-"));
    const path = join(dir, "generation.json");
    writeFileSync(path, JSON.stringify({ speech: [{ id: "only/tts", default: true }] }));
    try {
      const wl = loadWhitelist(path);
      expect(modelIds(wl.speech)).toEqual(["only/tts"]);
      expect(defaultModel(wl.image)).toBe("google/gemini-2.5-flash-image");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("speech tool description carries the per-character price note and cloning flags", () => {
    const desc = buildSpeechToolDescription(DEFAULT_WHITELIST);
    expect(desc).toContain("Priced per input character");
    expect(desc).toContain("elevenlabs/eleven-v4");
    expect(desc).toContain("[voice cloning]");
  });

  it("cloning preflight fails only when references are present on a non-cloning model", () => {
    const nonCloning: any = { id: "m" };
    expect(speechCloningPreflightError(nonCloning, false)).toBeNull();
    expect(speechCloningPreflightError(nonCloning, true)).toContain("voice cloning");
    expect(speechCloningPreflightError(nonCloning, true)).toContain("m");
    expect(speechCloningPreflightError({ id: "c", supports_voice_cloning: true } as any, true)).toBeNull();
  });
});
