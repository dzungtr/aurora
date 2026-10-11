/**
 * Typed OpenRouter client for the generation tools. Image generation goes
 * through the chat-completions endpoint with the image modality enabled; the
 * public model catalog feeds best-effort price hints for tool descriptions.
 */
export interface OpenRouterClientConfig {
  apiKey: string;
  /** API root, e.g. https://openrouter.ai/api/v1 — tests point this at a fake */
  baseUrl: string;
}

export interface ImageGenerationParams {
  model: string;
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
  quality?: string;
}

export interface GeneratedImage {
  mime: string;
  base64: string;
}

export interface ImageGenerationResult {
  images: GeneratedImage[];
  /** Actual generation cost in USD as reported by OpenRouter usage */
  cost?: number;
}

export interface ModelCatalogEntry {
  id: string;
  pricing?: {
    image?: string;
    prompt?: string;
    completion?: string;
  };
}

export interface ImageConfig {
  resolution?: string;
  aspect_ratio?: string;
  quality?: string;
}

export class OpenRouterClient {
  constructor(private config: OpenRouterClientConfig) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.apiKey}`,
      "content-type": "application/json",
    };
  }

  /** Parse a `data:<mime>;base64,<bytes>` URL into its components. */
  private static parseDataUrl(url: string): GeneratedImage {
    const m = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) throw new Error(`Unexpected image payload from OpenRouter (not a data URL)`);
    return { mime: m[1], base64: m[2] };
  }

  async generateImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    const imageConfig: ImageConfig = {};
    if (params.resolution !== undefined) imageConfig.resolution = params.resolution;
    if (params.aspect_ratio !== undefined) imageConfig.aspect_ratio = params.aspect_ratio;
    if (params.quality !== undefined) imageConfig.quality = params.quality;
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: "user", content: params.prompt }],
        modalities: ["image", "text"],
        image_config: imageConfig,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter image generation failed (${res.status}): ${body.slice(0, 500)}`);
    }
    const data: any = await res.json();
    const message = data?.choices?.[0]?.message;
    const rawImages: string[] = message?.images?.map((i: any) => i?.image_url?.url) ?? [];
    if (rawImages.length === 0) {
      throw new Error("OpenRouter returned no image payload");
    }
    return {
      images: rawImages.map((u) => OpenRouterClient.parseDataUrl(u)),
      cost: typeof data?.usage?.cost === "number" ? data.usage.cost : undefined,
    };
  }

  /**
   * Best-effort public catalog fetch for price hints. Never throws: an
   * unreachable catalog leaves hints empty (static notes remain).
   */
  async fetchModelCatalog(): Promise<ModelCatalogEntry[]> {
    const res = await fetch(`${this.config.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`OpenRouter catalog fetch failed (${res.status})`);
    const data: any = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
  }
}

/** Format a catalog entry's per-image price as a display hint. */
export function priceHintForEntry(entry: ModelCatalogEntry): string | undefined {
  const p = entry.pricing?.image;
  if (p === undefined || p === null) return undefined;
  const usd = Number(p);
  if (Number.isFinite(usd)) return `$${usd.toFixed(2)}/image`;
  return undefined;
}
