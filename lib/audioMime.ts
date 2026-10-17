/**
 * Audio mime sniffing from snapshot bytes (spec #55 decision 7): generation
 * providers ignore requested formats, so the bytes are authoritative.
 * Signatures: ID3/0xFFEx → mpeg, RIFF....WAVE → wav, OggS → ogg,
 * fLaC → flac, ftyp → mp4. Unknown bytes fall back to the declared mime —
 * a sniff-miss never rejects a push.
 */

export function sniffAudioMime(bytes: Uint8Array, declared: string): string {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));

  if (bytes.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  // MPEG audio frame sync: 11111111 111x (x = MPEG version bit)
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (bytes.length >= 12 && ascii(4, 4) === "ftyp") return "audio/mp4";
  return declared;
}
