# Platform Export — Specs Reference

## Instagram Reels

```
Resolution:    1080 × 1920 (9:16)
Frame rate:    30fps
Video codec:   H.264 (libx264), yuv420p
Video bitrate: 3,500 kbps target, 3,500 kbps max
Audio codec:   AAC stereo, 128 kbps, 44100 Hz
Max file size: 650 MB
Max duration:  90 seconds
Streaming:     -movflags +faststart required
```

## TikTok

```
Resolution:    1080 × 1920 (9:16)
Frame rate:    30fps
Video codec:   H.264 (libx264), yuv420p
Video bitrate: 1,000 kbps target
Audio codec:   AAC stereo, 128 kbps, 44100 Hz
Max file size: 287 MB (< 5 min), 1 GB (< 60 min)
Max duration:  10 minutes
Streaming:     -movflags +faststart recommended
```

## YouTube Shorts

```
Resolution:    1080 × 1920 (9:16)
Frame rate:    30fps
Video codec:   H.264 (libx264), yuv420p
Video bitrate: 2,000 kbps target
Audio codec:   AAC stereo, 192 kbps, 44100 Hz
Max file size: 256 MB (< 15 min)
Max duration:  60 seconds for Shorts classification
Streaming:     -movflags +faststart required
```

## ffmpeg preset used

`-preset slow -crf 20` — slower encode, better compression efficiency.  
Use `fast` during development, `slow` for final export.

## File size reduction if over limit

1. Increase CRF: `-crf 20` → `-crf 24` (reduces quality slightly)
2. Reduce video bitrate: lower `-b:v` and `-maxrate` by 20%
3. If still over: trim silence at start/end of voiceover before re-assembling

## Metadata embedded

```bash
-metadata comment="instagram_reels optimised by ReelAI"
-metadata title="{productTitle}"
-metadata artist="ReelAI"
```
