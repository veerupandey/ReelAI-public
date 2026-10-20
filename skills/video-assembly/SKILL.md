---
name: video-assembly
description: Assemble the final video from scene images and voiceover audio. Applies Ken Burns zoom/pan effects to stills, joins clips with xfade transitions, mixes in the full voiceover audio, and pads the video with a freeze-frame if audio is longer than the video track.
---

# Video Assembly

## When to use

- After `voiceover-production` — all scenes have both `imageAbsPath` and `audioAbsPath`
- When re-assembling after scene regeneration or user feedback
- The core production phase — runs inside the shell server via ffmpeg

## Inputs

| Input | Required | Description |
|---|---|---|
| `scenes` | yes | `ScenePlan[]` with `imageAbsPath` and `actualDurationSec` per scene |
| `voiceoverFullPath` | yes | Absolute path to `voiceover_full.wav` |
| `session` | yes | `SessionInfo` with `sessionDir` |

## Instructions

1. **Ken Burns clips** — for each scene:
   - Alternate zoom direction: even scenes zoom in, odd scenes zoom out
   - Call `buildKenBurnsClip(scene.imageAbsPath, `${session.sessionDir}/clip_${scene.index}.mp4`, scene.actualDurationSec, direction, session.sessionDir)`
   - This runs: `ffmpeg -loop 1 -i {image} -vf "scale=2160:3840,zoompan=z='...':d={frames}:s=1080x1920:fps=30" -t {dur} -c:v libx264 ...`

2. **Xfade concat** — collect all `clip_N.mp4` absolute paths with their durations. Call `concatWithXfade(clips, `${session.sessionDir}/concat.mp4`, session.sessionDir, 0.5)`.
   - Fade duration is clamped to `min(0.5, minClipDur × 0.4)` automatically
   - Transitions rotate: fade → fadeblack → smoothup → wipeup → smoothleft

3. **Audio mix** — call `addAudioToVideo(concat.mp4, voiceoverFullPath, `${session.sessionDir}/final.mp4`, session.sessionDir)`.
   - If audio is longer than video: `tpad=stop_mode=clone:stop_duration={delta}` freeze-extends the last frame to match
   - If video is longer: `apad=pad_dur=0.2` pads audio slightly

4. Emit the final video output with label "Assembled video" and a URL to serve it from the shell server.

## ffmpeg command patterns

### Ken Burns (zoom in)
```bash
ffmpeg -y -loop 1 -i "{image}" \
  -vf "scale=2160:3840,zoompan=z='zoom+0.00015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s=1080x1920:fps=30,format=yuv420p" \
  -t {durationSec} -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p "{output}"
```

### Ken Burns (zoom out)
```bash
# z starts at 1.06, decrements
zoompan=z='if(eq(on\,1)\,1.06\,zoom-0.00015)'
```

### Xfade with label chain (3 clips example)
```bash
ffmpeg -y -i clip_0.mp4 -i clip_1.mp4 -i clip_2.mp4 \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.500:offset=4.500[v1];[v1][2:v]xfade=transition=fadeblack:duration=0.500:offset=9.000[v2]" \
  -map "[v2]" -c:v libx264 -preset fast -crf 18 concat.mp4
```

### Audio + video with freeze-frame pad
```bash
ffmpeg -y -i concat.mp4 -i voiceover_full.wav \
  -vf "tpad=stop_mode=clone:stop_duration={extraSec}" \
  -af "apad=pad_dur=0.2" \
  -t {maxDur} -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k final.mp4
```

## Constraints

- **ALWAYS** use absolute paths for all ffmpeg input and output files
- **NEVER** use relative paths — the shell server runs from a different working directory
- **NEVER** let xfade duration exceed `minClipDur × 0.4` — it causes ffmpeg to drop frames
- **NEVER** skip `tpad` when audio is longer than video — the `-shortest` flag cuts audio, not extends video
- If any clip fails Ken Burns: emit error for that clip, skip it in the xfade concat (do not abort)
- All output videos must be `yuv420p` pixel format — required for web playback

## Success criteria

- `concat.mp4` exists with all scene clips joined via xfade transitions
- `final.mp4` exists with voiceover audio mixed in, no audio cutoff at end
- Video duration matches or slightly exceeds total voiceover duration (never shorter)
- Video plays in browser without codec errors
