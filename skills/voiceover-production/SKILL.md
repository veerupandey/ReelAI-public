---
name: voiceover-production
description: Generate TTS voiceover for each scene using Gemini. Wraps raw PCM output in WAV headers (Gemini returns PCM16, not WAV — ffmpeg rejects raw PCM). Saves per-scene WAV files to the session directory then concatenates into a full audio track.
---

# Voiceover Production

## When to use

- After `image-generation` — `ScenePlan[]` has `voiceoverText` per scene
- When re-generating audio for specific scenes after feedback
- When user requests a different voice mid-run

## Inputs

| Input | Required | Description |
|---|---|---|
| `scenes` | yes | `ScenePlan[]` with `voiceoverText` per scene |
| `voice` | yes | Gemini voice name: `Kore`, `Charon`, `Puck`, `Fenrir`, `Aoede` |
| `session` | yes | `SessionInfo` with `sessionDir` |

## Instructions

1. For each scene (skip if `scene.regenerate === false`):

   a. Call `generateVoiceover(scene.voiceoverText, { provider: 'gemini', id: voice, name: voice, language: 'en-US' })`. Returns raw base64 PCM16 at 24kHz mono.

   b. Wrap in WAV: `pcmToWav(rawB64, 24000, 1, 16)` — adds 44-byte RIFF header. **Do this before saving — ffmpeg rejects raw PCM.**

   c. Upload: `uploadBase64(wavB64, `voice_${scene.index}.wav`, 'audio/wav', session.sessionDir)`. Store `up.path` as `scene.audioAbsPath`.

   d. Measure duration: `getAudioDuration(up.path, session.sessionDir)`. If > 0.5s, set `scene.actualDurationSec`. Otherwise keep `scene.targetDurationSec`.

   e. Log: `Scene N: {actualDurationSec}s actual (target {targetDurationSec}s)`.

2. Collect all `scene.audioAbsPath` values (filter nulls). Call `concatAudio(paths, `${session.sessionDir}/voiceover_full.wav`, session.sessionDir)`.

3. Measure total: `getAudioDuration(voiceover_full.wav, session.sessionDir)`. Log total vs. target.

## The PCM → WAV pipeline

Gemini TTS returns raw PCM16 — no file header. ffmpeg errors: "Invalid data found when processing input."

`pcmToWav()` (browser-side, no shell needed) builds the 44-byte RIFF/WAVE header:
```
RIFF + file size + WAVE
fmt  chunk: PCM, 1 channel, 24000 Hz, 16-bit
data chunk + raw PCM bytes
```

## Voice reference

| Voice | Character | Best for |
|---|---|---|
| `Kore` | Warm, natural female | Skincare, beauty, wellness |
| `Charon` | Clear, authoritative | Clinical, professional |
| `Puck` | Energetic, youthful | TikTok, high_energy |
| `Fenrir` | Deep, confident male | Premium male-oriented |
| `Aoede` | Soft, breathy female | Luxury, earthy_organic |

## Constraints

- **NEVER** save raw PCM from `generateVoiceover` to disk — always run `pcmToWav()` first
- **NEVER** pass raw PCM to ffmpeg — WAV header is mandatory
- **NEVER** skip `getAudioDuration` after upload — `actualDurationSec` drives Ken Burns clip length in video assembly
- On `generateVoiceover` error: emit per-scene error, use `targetDurationSec` as fallback, continue
- `concatAudio` must use `filter_complex` approach — more reliable than the concat demuxer for PCM-in-WAV files

## Success criteria

- Every scene has `audioAbsPath` pointing to a valid WAV file on disk
- Every WAV starts with RIFF header (not raw PCM bytes)
- `voiceover_full.wav` plays scenes in order
- Total voiceover duration is within ±20% of `durationSec`
- `actualDurationSec` is set per scene (video assembly depends on it)
