import { describe, it, expect } from "bun:test";
import { sniffAudioMime } from "./audioMime";

// Minimal signature fixtures: real container headers, payload bytes irrelevant.
const ID3_MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
const MPEG_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x00]);
const FLAC = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x00, 0x00]);
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

describe("sniffAudioMime", () => {
  it("detects ID3 as audio/mpeg", () => {
    expect(sniffAudioMime(ID3_MP3, "application/octet-stream")).toBe("audio/mpeg");
  });
  it("detects an MPEG frame sync (0xFFEx) as audio/mpeg", () => {
    expect(sniffAudioMime(MPEG_FRAME, "application/octet-stream")).toBe("audio/mpeg");
  });
  it("detects RIFF....WAVE as audio/wav", () => {
    expect(sniffAudioMime(WAV, "application/octet-stream")).toBe("audio/wav");
  });
  it("detects OggS as audio/ogg", () => {
    expect(sniffAudioMime(OGG, "application/octet-stream")).toBe("audio/ogg");
  });
  it("detects fLaC as audio/flac", () => {
    expect(sniffAudioMime(FLAC, "application/octet-stream")).toBe("audio/flac");
  });
  it("detects ftyp at offset 4 as audio/mp4", () => {
    expect(sniffAudioMime(MP4, "application/octet-stream")).toBe("audio/mp4");
  });
  it("falls back to the declared mime on unknown bytes without error", () => {
    expect(sniffAudioMime(new Uint8Array([1, 2, 3, 4]), "audio/x-custom")).toBe("audio/x-custom");
  });
  it("falls back to the declared mime on empty bytes", () => {
    expect(sniffAudioMime(new Uint8Array([]), "audio/mpeg")).toBe("audio/mpeg");
  });
});
