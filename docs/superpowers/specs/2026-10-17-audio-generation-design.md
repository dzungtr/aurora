# Audio generation (`create_speech` / `create_music` / `push_audio`) — Design Spec

Date: 2026-10-17
Status: Approved (design session; all external facts live-verified)

## Summary

Aurora gains audio as a first-class artifact kind with three MCP tools: `create_speech`
(text-to-speech via OpenRouter's dedicated `/audio/speech` endpoint) and `create_music`
(song generation via chat-completions audio modality on Lyria 3) — both synchronous,
like `create_image` — plus `push_audio`, the local/remote-source upload tool mirroring
`push_image`/`push_video`. Voice cloning via reference clips is a v1 must-have.

All provider facts below were verified live against OpenRouter's model catalog, docs,
and paid smoke tests on 2026-10-15/17 (total spend $0.16: 2× TTS, 2× music, 1×
music-with-image). Nothing in this spec rests on training-data recall.

## Verified provider facts

| Fact | Measurement |
|---|---|
| TTS latency (`hexgrad/kokoro-82m`) | 1.2–6.1 s, ~$0.00003/call, 39 KB valid MP3 |
| Music clip latency (`google/lyria-3-clip-preview`) | 13.7 s, $0.04, one 745 KB audio chunk |
| Music full song (`google/lyria-3-pro-preview`) | 30.4 s, $0.08, one 4.3 MB audio chunk |
| Music + image conditioning | Works — lyrics demonstrably conditioned on the supplied image |
| TTS `voice` omission | 400 "An explicit voice is required for this TTS provider" (Kokoro) |
| TTS response | Raw bytestream; true mime in `content-type` header; `x-generation-id` header; **no per-call cost** in body or headers |
| Music response | SSE; chunk 0 `delta.content` = song structure (lyrics + `[0.0:2.6]` timestamps + `[[A0]]` sections); one `delta.audio.data` base64 chunk; final chunk carries `usage.cost` |
| Requested `audio.format` | **Not honored** — requested wav, received MP3 (ID3 header). Mime must be sniffed from bytes |
| Speech model space | 35 models with `output_modalities=speech`; music: Lyria 3 clip/pro only |

## Decision log

| # | Question | Decision |
|---|---|---|
| 1 | One `create_audio` vs two tools | Two tools, split by API contract (mirrors `create_image`/`create_video`) |
| 2 | Sync vs submit-and-notify | Both synchronous — measured worst case 30.4 s is within tool-call tolerance; ADR-0004 async machinery untouched |
| 3a | Whitelist defaults | speech: kokoro-82m (default), gemini-3.8-flash-tts, eleven-v4 · music: lyria-3-clip-preview (default), lyria-3-pro-preview |
| 3b | Voice handling | `default_voice` per whitelist entry; omitted `voice` → aurora fills it; unknown voices → provider 400 passes through |
| 4 | Voice cloning | v1 must-have: `input_references` (1–3 clips) + optional per-clip `transcript`; `supports_voice_cloning` preflight flag |
| 5 | `push_audio` | Included — completes push/create symmetry and unblocks artifact-based cloning refs |
| 6 | Music extras | Image conditioning included (verified); song-structure text → artifact `transcript`; no `audio.format` request param |
| 7 | Mime handling | Sniff bytes first (ID3/0xFFEx→mpeg, RIFF/WAVE→wav, OggS→ogg, fLaC→flac, ftyp→mp4); fall back to declared/content-type; never reject on sniff-miss |
| 8 | Speech params | `response_format` enum `["mp3","wav"]`, default mp3 (no pcm — unplayable by `<audio>`); `speed` + `instructions` pass-through |
| 9 | Price hints | Music tool description carries per-song prices ($0.04/30s clip, $0.08/song); speech says "priced per input character; pennies per call" |

## Tool contracts

### `create_speech` → `POST {base}/audio/speech`

Input schema: `session_id`, `title`, `input` (string), `model` (enum from
whitelist.speech), `voice?` (filled from `default_voice` when omitted),
`instructions?`, `speed?` (number), `response_format?` ("mp3"|"wav", default "mp3"),
`input_references?` (max 3; each: `artifact{session_id,artifact_id}` | `path` |
`base64+mime` | `url`, plus optional `transcript`), `artifact_id?`, `session_title?`.

Provider request: `{model, input, voice, instructions?, speed?, response_format,
input_references?: [{type:"input_audio", input_audio:{data: <data-url>}}, {type:"text",
text: <transcript>}...]}`.

Preflight: model must be whitelisted; `input_references` present but
`supports_voice_cloning !== true` → clear tool error.

### `create_music` → `POST {base}/chat/completions` (audio modality)

Input schema: `session_id`, `title`, `prompt`, `model` (enum: lyria-3-clip-preview
default, lyria-3-pro-preview), `image_references?` (same 4-variant reference schema as
`create_image`), `artifact_id?`, `session_title?`.

Provider request: `{model, messages:[{role:"user", content:[{type:"text",
text:prompt}, {type:"image_url", image_url:{url}}...]}], modalities:["text","audio"],
stream:true, usage:{include:true}}`.

Response handling: concat `delta.audio.data` chunks → bytes; collect `delta.content`
→ `transcript`; `usage.cost` → recorded in the job registry entry like `create_image`.

### `push_audio`

Exact mirror of `push_image`/`push_video`: `session_id`, `title`, `source`
(path | base64+mime | url), `artifact_id?`, `session_title?` →
`store.pushMedia({type:"audio", ...})`. One-line addition via the existing
`registerMediaTool`.

## Internal changes

1. **whitelist.ts** — `GenerationWhitelist` gains `speech[]` + `music[]`; entries gain
   `default_voice?`, `supports_voice_cloning?`; defaults + normalize + config loader
   updated; music tool description embeds per-song prices.
2. **openrouter.ts** — `generateSpeech() → {bytes, mime, generationId}`;
   `generateMusic() → {bytes, transcript, cost}` (SSE parse).
3. **referenceResolver.ts** — modality-aware accepted types: audio clips for speech,
   images for music.
4. **artifactStore.ts** — `PushMediaInput.type` union gains `"audio"`; media artifacts
   gain optional `transcript` (persisted in metadata, returned in result).
5. **lib/audioMime.ts** (new) — byte sniffer + fallback combiner.
6. **mcpSurface.ts** — register `push_audio`, `create_speech`, `create_music` (inside
   the `generation?.apiKey` gate); voice prefill; cloning preflight.
7. **src/preview/MediaArtifact.tsx** — route audio artifacts to an `<audio
   controls>` player (video → `<video>`, audio → `<audio>`, else `<img>` today);
   render the artifact `transcript` (expandable lyrics block) when present.
8. **src/preview/StackView.tsx** — include `audio` in the media routing branch.
9. **src/preview/previewApi.ts** — `ArtifactMeta` gains optional `transcript`.
10. **README.md** — tool list updated.

Note: `src/components/viewers/AudioViewer.tsx` is the file-explorer viewer
(path-based); it needs no change for this feature. The preview surface is the
rendering path for pushed/generated audio. (Amendment 2026-10-17: preview
surface files added to the edit scope after worker exploration surfaced the
routing gap.)

Completed audio generation jobs are recorded in the job registry inline, the
same way `create_image` does, so `check_generation` looks them up uniformly.

## Tests

Per-module test files mirroring the existing suite: whitelist (defaults,
`default_voice`, per-modality config override), openrouter (speech fetch; music SSE
fixture incl. multi-audio-chunk case), referenceResolver (audio accepted for speech,
images for music, wrong-type error), artifactStore (type "audio" + transcript),
audioMime (all signatures + unknown fallback), mcpSurface (all three tools end-to-end).

Optional live smoke (≤$0.20, key in env): one kokoro speech + one lyria clip; results
recorded in the PR body.

## Deferred

HeyGen scene-image references, Seed Audio `@Audio1/2/3` multi-clip placeholders,
multi-speaker `turns` input, `pcm` response format, async submit-and-notify for audio,
TTS per-call cost capture, speech-to-text, audio-to-audio.

## Relationship to ADRs

No new ADR: ADR-0005 (whitelist-bounded model enums) already covers the model-enum
pattern; the sync flow follows `create_image` precedent under ADR-0004's regime
(audio deliberately stays off the async job path). CONTEXT.md gains glossary entries
for the new terms.
