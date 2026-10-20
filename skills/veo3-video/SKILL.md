# Veo3 Video Production Skill

## Purpose
Generate per-scene AI video clips using Google Veo3 API and stitch them into a final ad video.

## COST WARNING
Veo3 is a **premium-priced API**. ALWAYS:
1. Show cost estimate BEFORE any Veo3 call
2. Get EXPLICIT user confirmation before generating
3. Show each clip for approval before generating the next
4. NEVER auto-approve Veo3 operations

## Model Selection
- Default (Gemini API): `veo-3.1-fast-generate-preview`
- Higher quality (Gemini API): `veo-3.1-generate-preview`
- Override with env `VITE_VEO_MODEL` if Google renames preview models
- Do **not** use Vertex-only IDs like `veo-3.0-fast-generate-001` with the API-key client (404 on v1beta)

## Safe product pipeline (still → animate)
1. Generate product-grounded scene stills (exact asset or product_composite)
2. Human approves stills
3. Veo image-to-video animates each approved still as the first frame
4. Human approves each clip before the next paid call
5. Stitch clips

Never send product scenes as text-only Veo prompts — that invents packaging.

## Pipeline
1. Plan scenes (shared creative phase)
2. **Cost confirmation gate**: Show estimated cost, require explicit "yes"
3. Per-scene loop:
   a. Generate Veo3 clip (4-8s per clip)
   b. Show clip preview to user
   c. User approves → next scene
   d. User rejects → regenerate with feedback OR skip
4. Stitch approved clips via ffmpeg concat
5. Optional: add separate voiceover track (Veo3 generates native audio)
6. Platform export

## Veo3 API Constraints
- Clip duration: 4, 6, or 8 seconds
- Aspect ratios: 16:9 (landscape) or 9:16 (portrait)
- Resolution: 720p to 1080p (fast), up to 4K (standard)
- Generation time: 1-3 minutes per clip
- Audio: Veo3 v3+ generates audio and dialogue natively

## Prompt Engineering for Veo3
- Be specific about camera movement: "slow dolly in", "static wide shot", "handheld tracking"
- Include lighting direction: "soft diffused light", "golden hour backlight"
- Describe audio if relevant: "ambient cafe sounds", "soft piano"
- Keep prompts under 500 words
- Reference the product by name and description for consistency

## First-Frame Option
For better product consistency:
1. Generate a still image first via Gemini (product hero shot)
2. Pass it as the first frame to Veo3
3. Veo3 will animate from that frame, preserving product identity

## Stitching Rules
- Use ffmpeg `concat` filter (NOT xfade — Veo3 clips already have natural motion)
- If clips have inconsistent audio levels, normalize with ffmpeg `loudnorm`
- If adding a separate voiceover, duck the Veo3 native audio to -12dB

## Quality Checklist
- [ ] Cost estimate shown and user confirmed before first API call
- [ ] Each clip previewed and approved before next generation
- [ ] Product is recognizable in product-focused scenes
- [ ] Audio levels are consistent across clips
- [ ] Final video plays smoothly without jarring transitions
- [ ] Total duration matches the target
- [ ] Platform export is optimized (bitrate, resolution)
