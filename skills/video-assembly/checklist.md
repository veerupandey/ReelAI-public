# Video Assembly — Common Failure Modes

## ffmpeg issues and fixes

| Symptom | Cause | Fix |
|---|---|---|
| "No such file or directory" | Relative path passed | Use absolute paths from `session.sessionDir` |
| "Invalid data found when processing input" | Raw PCM passed as WAV | Run `pcmToWav()` before saving audio |
| Video shorter than audio, tail cut off | `-shortest` flag used | Use `tpad=stop_mode=clone` to freeze-extend video |
| xfade drops frames or black flicker | Fade duration > clip length | Clamp to `min(0.5, minClipDur × 0.4)` |
| "zoompan: out of range" | Duration too long for zoompan | Check `frames = round(durationSec × 30)` is correct |
| Output video won't play in browser | Wrong pixel format | Add `-pix_fmt yuv420p` to all libx264 encodes |
| Audio and video out of sync | Actual audio duration differs from target | Always use `actualDurationSec` from WAV measurement, not `targetDurationSec` |
| Concat produces silence between clips | Using concat demuxer on PCM-in-WAV | Use `filter_complex concat` instead |

## xfade label chain — critical rule

Every xfade filter in a chain must output a named label — including the last one.  
Without the last label, ffmpeg cannot map the output stream.

```
# WRONG — last filter has no label
[0:v][1:v]xfade=...offset=4.5[v1];[v1][2:v]xfade=...offset=9.0

# CORRECT — every filter has an output label
[0:v][1:v]xfade=...offset=4.5[v1];[v1][2:v]xfade=...offset=9.0[v2]
-map "[v2]"
```

## Pre-flight checks before running assembly

- [ ] All `scene.imageAbsPath` values are non-null and files exist on disk
- [ ] All WAV files start with RIFF header (`file voiceover_full.wav` reports "RIFF (little-endian) data, WAVE audio")
- [ ] `voiceover_full.wav` duration matches sum of `scene.actualDurationSec` values (±0.5s)
- [ ] Shell server is running (`isShellServerRunning()` returns true)
- [ ] Session directory exists and is writable
