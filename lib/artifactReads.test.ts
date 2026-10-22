import { describe, it, expect } from "bun:test";
import {
  IMAGE_READ_CAP_BYTES,
  READ_ARTIFACT_TYPE_TABLE,
  TEXT_READ_CAP_BYTES,
  mapArtifactToContent,
} from "./artifactReads";
import type { ArtifactMeta } from "./artifactStore";

// Pure unit tests: in-memory fixtures only — no store, no fs, no MCP transport.

function meta(overrides: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    artifact_id: "a1",
    seq: 1,
    type: "markdown",
    title: "Report",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function textOf(content: ReturnType<typeof mapArtifactToContent>): string {
  expect(content).toHaveLength(1);
  const block = content[0]!;
  if (block.type !== "text") throw new Error(`expected a text block, got ${block.type}`);
  return block.text;
}

function bytes(size: number): Uint8Array {
  return new Uint8Array(size).fill(7);
}

describe("mapArtifactToContent — markdown", () => {
  it("returns the full source, uncapped", () => {
    const source = "# Report\n" + "x".repeat(1024 * 1024);
    expect(textOf(mapArtifactToContent(meta(), { text: source }))).toBe(source);
  });

  it("ignores offset: markdown is never paged", () => {
    const source = "a".repeat(TEXT_READ_CAP_BYTES + 10);
    expect(textOf(mapArtifactToContent(meta(), { text: source }, { offset: TEXT_READ_CAP_BYTES }))).toBe(source);
  });
});

describe("mapArtifactToContent — capped text types (mermaid/chart/ui)", () => {
  it.each(["mermaid", "chart", "ui"])("%s: text under the cap is returned whole", (type) => {
    const source = "flowchart TD\n A --> B";
    expect(textOf(mapArtifactToContent(meta({ type }), { text: source }))).toBe(source);
  });

  it.each(["mermaid", "chart", "ui"])("%s: text exactly at the cap is not marked truncated", (type) => {
    const source = "a".repeat(TEXT_READ_CAP_BYTES);
    const text = textOf(mapArtifactToContent(meta({ type }), { text: source }));
    expect(text).toBe(source);
    expect(text).not.toContain("[truncated");
  });

  it("truncates one byte over the cap and states total size and continuation offset", () => {
    const source = "a".repeat(TEXT_READ_CAP_BYTES + 1);
    const text = textOf(mapArtifactToContent(meta({ type: "mermaid" }), { text: source }));
    expect(text.startsWith("a".repeat(TEXT_READ_CAP_BYTES))).toBe(true);
    expect(text).toContain(`of ${TEXT_READ_CAP_BYTES + 1} total`);
    expect(text).toContain(`offset=${TEXT_READ_CAP_BYTES}`);
  });

  it("pages a 400 KiB source and returns the remainder on the follow-up call", () => {
    const source = "flowchart TD\n" + "x".repeat(400 * 1024 - 13);
    const total = source.length; // ASCII: bytes === chars

    const first = textOf(mapArtifactToContent(meta({ type: "mermaid" }), { text: source }));
    expect(first).toContain(`of ${total} total`);
    expect(first).toContain(`offset=${TEXT_READ_CAP_BYTES}`);

    const rest = textOf(
      mapArtifactToContent(meta({ type: "mermaid" }), { text: source }, { offset: TEXT_READ_CAP_BYTES })
    );
    expect(rest).not.toContain("[truncated");
    expect(rest.length).toBe(total - TEXT_READ_CAP_BYTES);
    expect(first.slice(0, TEXT_READ_CAP_BYTES) + rest).toBe(source);
  });

  it("never splits a multi-byte UTF-8 sequence at the cap boundary", () => {
    // 262143 ASCII bytes then a 2-byte character: the cap lands inside it.
    const source = "a".repeat(TEXT_READ_CAP_BYTES - 1) + "é";
    const first = textOf(mapArtifactToContent(meta({ type: "mermaid" }), { text: source }));
    const chunk = first.split("\n\n---\n")[0]!;
    expect(chunk).not.toContain("\uFFFD");
    expect(chunk).toBe("a".repeat(TEXT_READ_CAP_BYTES - 1));
    expect(first).toContain(`offset=${TEXT_READ_CAP_BYTES - 1}`);

    const rest = textOf(
      mapArtifactToContent(meta({ type: "mermaid" }), { text: source }, { offset: TEXT_READ_CAP_BYTES - 1 })
    );
    expect(rest).toBe("é");
  });

  it("reports an out-of-range offset instead of returning an empty chunk", () => {
    const text = textOf(
      mapArtifactToContent(meta({ type: "chart" }), { text: "{}" }, { offset: 4000 })
    );
    expect(text).toContain("offset 4000 is past the end");
    expect(text).toContain("2 bytes");
  });

  it("reports an out-of-range offset for an empty source too", () => {
    const text = textOf(
      mapArtifactToContent(meta({ type: "mermaid" }), { text: "" }, { offset: 10 })
    );
    expect(text).toContain("offset 10 is past the end");
    expect(text).toContain("0 bytes");
  });
});

describe("mapArtifactToContent — image", () => {
  it("returns an MCP image block at the 4 MiB boundary", () => {
    const content = mapArtifactToContent(
      meta({ type: "image", artifact_id: "img", mime: "image/png" }),
      { bytes: bytes(IMAGE_READ_CAP_BYTES) }
    );
    expect(content).toHaveLength(1);
    const block = content[0]!;
    if (block.type !== "image") throw new Error(`expected an image block, got ${block.type}`);
    expect(block.mimeType).toBe("image/png");
    expect(Buffer.from(block.data, "base64").byteLength).toBe(IMAGE_READ_CAP_BYTES);
  });

  it("falls back to application/octet-stream when the mime is missing", () => {
    const block = mapArtifactToContent(meta({ type: "image" }), { bytes: bytes(8) })[0]!;
    expect(block.type === "image" ? block.mimeType : null).toBe("application/octet-stream");
  });

  it("returns a text error naming the blob URL above the cap, never image bytes", () => {
    const text = textOf(
      mapArtifactToContent(
        meta({ type: "image", artifact_id: "big", title: "Big PNG" }),
        { bytes: bytes(IMAGE_READ_CAP_BYTES + 1) },
        { blobUrl: "http://127.0.0.1:7634/api/preview/sessions/s/artifacts/big/blob" }
      )
    );
    expect(text).toContain("4.0 MiB inline read cap");
    expect(text).toContain("http://127.0.0.1:7634/api/preview/sessions/s/artifacts/big/blob");
  });
});

describe("mapArtifactToContent — audio/video", () => {
  it.each(["audio", "video"])("%s: unsupported-type message carries the deep link and no bytes", (type) => {
    const content = mapArtifactToContent(
      meta({ type, artifact_id: `${type}-1`, title: "Clip", mime: `${type}/mp4`, size: 2048 }),
      null,
      { deepLink: `http://127.0.0.1:7634/s/sess/${type}-1` }
    );
    const text = textOf(content);
    expect(text).toContain(`http://127.0.0.1:7634/s/sess/${type}-1`);
    expect(text).toContain("cannot be read over MCP");
    expect(text).toContain("2048 bytes");
    expect(content.some((c) => c.type !== "text")).toBe(false);
  });
});

describe("READ_ARTIFACT_TYPE_TABLE", () => {
  it("names every artifact type and both caps, so descriptions cannot drift", () => {
    for (const type of ["markdown", "mermaid", "chart", "ui", "image", "audio", "video"]) {
      expect(READ_ARTIFACT_TYPE_TABLE).toContain(type);
    }
    expect(READ_ARTIFACT_TYPE_TABLE).toContain(`${TEXT_READ_CAP_BYTES / 1024} KiB`);
    expect(READ_ARTIFACT_TYPE_TABLE).toContain(`${IMAGE_READ_CAP_BYTES / 1048576} MiB`);
  });
});
