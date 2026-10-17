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
  /** Inline data URLs for image-to-image reference images */
  references?: string[];
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

export interface SpeechGenerationParams {
  model: string;
  input: string;
  voice?: string;
  instructions?: string;
  speed?: number;
  response_format: "mp3" | "wav";
  /** Inline data URLs for voice-cloning reference clips */
  references?: string[];
  /** Per-clip transcripts, paired with `references` for input_audio parts */
  referenceTranscripts?: string[];
}

export interface SpeechGenerationResult {
  bytes: Uint8Array;
  /** Mime from the response content-type header */
  mime: string;
  /** Provider generation id, when the response carries one */
  generationId?: string;
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
        // With references the message becomes multimodal: text part plus one
        // image_url part per reference (OpenRouter image-to-image input).
        messages: [
          {
            role: "user",
            content:
              params.references && params.references.length > 0
                ? [
                    { type: "text", text: params.prompt },
                    ...params.references.map((url) => ({ type: "image_url", image_url: { url } })),
                  ]
                : params.prompt,
          },
        ],
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
   * Synchronous text-to-speech via the dedicated OpenAI-compatible
   * /audio/speech endpoint (spec #57). Returns raw audio bytes; the mime
   * comes from the response content-type header. Provider errors pass
   * through with their HTTP status so unknown voices surface to the agent.
   */
  async generateSpeech(params: SpeechGenerationParams): Promise<SpeechGenerationResult> {
    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input,
      response_format: params.response_format,
    };
    if (params.voice !== undefined) body.voice = params.voice;
    if (params.instructions !== undefined) body.instructions = params.instructions;
    if (params.speed !== undefined) body.speed = params.speed;
    // Voice cloning: the input becomes a multimodal content list — text part
    // plus one input_audio part per reference clip, each optionally paired
    // with its transcript as a text part.
    if (params.references && params.references.length > 0) {
      const parts: unknown[] = [{ type: "text", text: params.input }];
      params.references.forEach((url, i) => {
        const transcript = params.referenceTranscripts?.[i];
        if (transcript) parts.push({ type: "text", text: transcript });
        // OpenAI input_audio format is the bare audio subtype of the clip's mime.
        const format = url.match(/^data:audio\/([^;]+);/)?.[1] ?? "wav";
        parts.push({ type: "input_audio", input_audio: { data: url, format } });
      });
      body.input = parts;
    }
    const res = await fetch(`${this.config.baseUrl}/audio/speech`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter speech generation failed (${res.status}): ${text.slice(0, 500)}`);
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
      generationId: res.headers.get("x-request-id") ?? undefined,
    };
  }

  /** Submit an async video generation job (POST /videos, 202 accepted). */
  async submitVideo(params: VideoSubmitParams): Promise<VideoSubmitResult> {
    const body: Record<string, unknown> = { model: params.model, prompt: params.prompt };
    if (params.duration !== undefined) body.duration = params.duration;
    if (params.resolution !== undefined) body.resolution = params.resolution;
    if (params.aspect_ratio !== undefined) body.aspect_ratio = params.aspect_ratio;
    if (params.generate_audio !== undefined) body.generate_audio = params.generate_audio;
    if (params.inputReferences && params.inputReferences.length > 0) {
      body.input_references = params.inputReferences.map((url) => ({
        type: "image_url",
        image_url: { url },
      }));
    }
    if (params.frameImages && params.frameImages.length > 0) {
      body.frame_images = params.frameImages.map((f) => ({
        type: "image_url",
        image_url: { url: f.url },
        frame_type: f.frame_type,
      }));
    }
    const res = await fetch(`${this.config.baseUrl}/videos`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter video submit failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data: any = await res.json();
    if (typeof data?.id !== "string" || data.id.length === 0) {
      throw new Error("OpenRouter video submit returned no job id");
    }
    return { jobId: data.id, pollingUrl: data.polling_url, status: data.status ?? "pending" };
  }

  /** Poll one video job's status (GET /videos/{jobId}). */
  async getVideoJob(jobId: string): Promise<VideoJobStatus> {
    const res = await fetch(`${this.config.baseUrl}/videos/${encodeURIComponent(jobId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter video status failed (${res.status}): ${text.slice(0, 500)}`);
    }
    const data: any = await res.json();
    const contentUrl: string | undefined = Array.isArray(data?.unsigned_urls)
      ? data.unsigned_urls[0]
      : undefined;
    return {
      status: data?.status ?? "pending",
      error: typeof data?.error === "string" ? data.error : undefined,
      cost: typeof data?.usage?.cost === "number" ? data.usage.cost : undefined,
      contentUrl,
    };
  }

  /**
   * Download completed video content. The URLs in unsigned_urls are not
   * presigned: the API key goes in the Authorization header, same as polling.
   */
  async downloadVideo(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.config.apiKey}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter video download failed (${res.status}): ${text.slice(0, 500)}`);
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get("content-type") ?? "video/mp4",
    };
  }

  /**
   * Best-effort video model catalog fetch (GET /videos/models) for per-second
   * price hints. Throws on non-OK; callers treat it as best-effort.
   */
  async fetchVideoModelCatalog(): Promise<VideoCatalogEntry[]> {
    const res = await fetch(`${this.config.baseUrl}/videos/models`, { headers: this.headers() });
    if (!res.ok) throw new Error(`OpenRouter video catalog fetch failed (${res.status})`);
    const data: any = await res.json();
    return Array.isArray(data?.data) ? data.data : [];
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

export interface VideoFrameImage {
  /** Inline data URL of the frame image */
  url: string;
  frame_type: "first_frame" | "last_frame";
}

export interface VideoSubmitParams {
  model: string;
  prompt: string;
  /** Style/content reference images (reference-to-video), inline data URLs */
  inputReferences?: string[];
  /** First/last frame images (image-to-video) */
  frameImages?: VideoFrameImage[];
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
  generate_audio?: boolean;
}

export interface VideoSubmitResult {
  jobId: string;
  pollingUrl?: string;
  status: string;
}

export interface VideoJobStatus {
  /** Provider status: pending | in_progress | completed | failed */
  status: string;
  error?: string;
  /** Actual generation cost in USD as reported by OpenRouter usage */
  cost?: number;
  /** First content URL from unsigned_urls; download with the auth header */
  contentUrl?: string;
}

export interface VideoCatalogEntry {
  id: string;
  pricing_skus?: Record<string, string>;
}

/**
 * Best-effort per-second price hint from a video catalog entry's pricing_skus.
 * SKU shapes vary per provider: keys matching /second/ with a "cents_per"
 * prefix are cents, otherwise dollars; the cheapest tier is shown.
 */
export function videoPriceHintForEntry(entry: VideoCatalogEntry): string | undefined {
  const skus = entry.pricing_skus ?? {};
  let best: number | undefined;
  for (const [key, raw] of Object.entries(skus)) {
    if (!/second/i.test(key)) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const usd = key.startsWith("cents_per") ? v / 100 : v;
    if (best === undefined || usd < best) best = usd;
  }
  return best === undefined ? undefined : `$${best.toFixed(2)}/s`;
}

/** Format a catalog entry's per-image price as a display hint. */
export function priceHintForEntry(entry: ModelCatalogEntry): string | undefined {
  const p = entry.pricing?.image;
  if (p === undefined || p === null) return undefined;
  const usd = Number(p);
  if (Number.isFinite(usd)) return `$${usd.toFixed(2)}/image`;
  return undefined;
}
