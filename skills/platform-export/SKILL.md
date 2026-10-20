---
name: platform-export
description: Re-encode the captioned video for a specific platform (Instagram Reels, TikTok, YouTube Shorts) with the correct bitrate, file size, pixel format, and metadata. Generates the final downloadable MP4 for the user.
---

# Platform Export

## When to use

- After `creative-review` passes (or user explicitly approves)
- Final step before delivering the video to the user
- Can be run multiple times for different platforms from the same `captioned.mp4`

## Inputs

| Input | Required | Description |
|---|---|---|
| `videoAbsPath` | yes | Absolute path to `captioned.mp4` |
| `platform` | yes | `instagram_reels` \| `tiktok` \| `youtube_shorts` |
| `session` | yes | `SessionInfo` with `sessionDir` and `baseUrl` |
| `brandSlug` | no | For naming the output file |
| `productSlug` | no | For naming the output file |

## Instructions

1. Determine output filename: `output_{platform}.mp4` in `session.sessionDir`.

2. Call `exportForPlatform(videoAbsPath, outputAbsPath, platform, session.sessionDir)`.

   This runs the ffmpeg re-encode with platform-specific settings:
   ```bash
   ffmpeg -y -i "{input}" \
     -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p" \
     -c:v libx264 -preset slow -crf 20 -b:v {videoBitrate} -maxrate {videoBitrate} -bufsize {bufsize} \
     -c:a aac -b:a {audioBitrate} -ar 44100 -ac 2 \
     -movflags +faststart \
     -metadata comment="{platform} optimised by ReelAI" \
     "{output}"
   ```

3. Verify file size is within platform limits.

4. Emit the final video with label `"{platform} export ready"` and a download URL via the shell server.

5. Emit a delivery summary markdown: platform, file size, duration, bitrate, download link.

## Platform specs

| Platform | Video bitrate | Audio bitrate | Max size | Notes |
|---|---|---|---|---|
| `instagram_reels` | 3,500 kbps | 128 kbps | 650 MB | `-movflags +faststart` required for streaming |
| `tiktok` | 1,000 kbps | 128 kbps | 287 MB | Lower bitrate — optimize for mobile data |
| `youtube_shorts` | 2,000 kbps | 192 kbps | 256 MB | Higher audio bitrate for music-heavy content |

## Output naming convention

```
output_instagram_reels.mp4
output_tiktok.mp4
output_youtube_shorts.mp4
```

If `brandSlug` and `productSlug` are provided, prefer:
```
{brandSlug}_{productSlug}_{platform}_{sessionId:8}.mp4
```

## Constraints

- **NEVER** deliver the raw `final.mp4` or `captioned.mp4` directly — always run the platform export pass
- **NEVER** skip `-movflags +faststart` — required for video to start playing before fully downloaded
- **NEVER** use `-shortest` flag — it can cut audio; duration is managed by `addAudioToVideo` in assembly
- If file size exceeds platform limit: lower `-crf` from 20 to 24 and re-encode once before surfacing an error
- Always encode audio as AAC stereo at 44100 Hz — some platforms reject mono or PCM audio

## Success criteria

- `output_{platform}.mp4` exists in `session.sessionDir`
- File size is within the platform limit
- Video resolution is exactly 1080×1920
- Video has `-movflags +faststart` for web streaming
- User receives a clickable download URL in the console
