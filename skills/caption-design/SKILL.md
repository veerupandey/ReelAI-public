---
name: caption-design
description: Extract the dominant brand color from the product image, generate 3 caption style previews (Dark Bar, Brand Color, Tinted Bar) as PNG images, present them to the user for approval, then burn the chosen style onto the assembled video using Python PIL and ffmpeg overlay.
---

# Caption Design

## When to use

- After `video-assembly` produces `final.mp4`
- Before `platform-export`
- When user requests a different caption style mid-run

## Inputs

| Input | Required | Description |
|---|---|---|
| `videoAbsPath` | yes | Absolute path to `final.mp4` |
| `productImageAbsPath` | yes | Absolute path to `product_reference.png` |
| `scenes` | yes | `ScenePlan[]` with `voiceoverText` and `actualDurationSec` per scene |
| `session` | yes | `SessionInfo` with `sessionDir` and `baseUrl` |

## Instructions

1. **Extract brand color + generate style previews** — call `generateCaptionStylePreviews(productImageAbsPath, sampleText, session.sessionDir, session.baseUrl)`.

   This Python PIL script:
   - Resizes product image to 100×100, buckets pixels into RGB regions
   - Finds most saturated non-white/non-black color as `brand_hex`
   - Computes a light tint version (`tint_hex`)
   - Renders 3 full-frame 1080×1920 preview PNGs with sample captions:
     - **A — Dark Bar**: white text, black semi-transparent bar at bottom
     - **B — Brand Color**: brand_hex text, no background bar
     - **C — Tinted Bar**: dark text on light tint bar

2. **Emit previews** — output each preview PNG as an image with label "Caption Style A/B/C".

3. **Gate** — ask: "Which caption style? A, B, C, or describe your preference."

4. **Build timed captions from voiceover text** — for each scene, split `voiceoverText` into 2–4 keyword bursts (2–4 words each). Calculate `startSec` and `endSec` per burst based on cumulative `actualDurationSec`.

   Use Gemini to extract keyword bursts:
   ```
   Extract 2-4 punchy keyword bursts (2-4 words each) from this voiceover line for a caption overlay.
   Return JSON array of strings only.
   Voiceover: "{scene.voiceoverText}"
   ```

5. **Burn captions** — call `burnCaptionsStyled(videoAbsPath, `${session.sessionDir}/captioned.mp4`, captions, chosenStyle, session.sessionDir)`.

   This uses Python PIL to generate transparent PNG per caption burst, then ffmpeg `overlay` filter to composite them at the correct timestamps. **Does not use ffmpeg `drawtext`** — not available without libfreetype.

6. Emit the captioned video with label "Captioned video."

## Caption rules

- **≤5 words per burst** — keyword phrases, not full sentences
- **≤3 bursts per scene** — do not crowd the frame
- Position: `y = H × 0.78` (lower third)
- Font fallback chain: Helvetica → Arial → DejaVu Sans Bold → PIL default

## Style specs

| Style | Text color | Background | Opacity |
|---|---|---|---|
| Dark Bar (A) | `#ffffff` | `#000000` bar | 0.65 |
| Brand Color (B) | `brand_hex` | Transparent | — |
| Tinted Bar (C) | `#1a1a1a` | `tint_hex` bar | 0.75 |

## Constraints

- **NEVER** use ffmpeg `drawtext` filter — it requires libfreetype which is not always compiled in
- **NEVER** burn full voiceover sentences — extract keywords only
- **NEVER** show more than 3 caption bursts per scene
- **NEVER** skip the user approval gate — color choice must be explicit
- If PIL fails to render a caption PNG, skip that burst silently and continue (do not abort)

## Success criteria

- User explicitly chose a caption style (A, B, or C, or approved a described preference)
- `captioned.mp4` exists with captions visible in lower third
- Captions are ≤5 words each and appear at the correct scene timestamps
- Caption color visually relates to the product brand palette
