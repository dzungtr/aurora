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
