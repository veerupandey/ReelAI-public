# Static Image Export Skill

## Purpose
Export a single high-quality image ad for Instagram Feed (4:5 aspect ratio).

## Pipeline
1. Generate ONE hero image via Gemini at 4:5 aspect ratio
2. Optionally burn text overlay (headline + CTA) via PIL
3. Export at 1080x1350 for Instagram Feed

## Rules
- Aspect ratio: **4:5** (1080x1350 for Instagram Feed)
- ONE scene only — this is a single image ad, not a carousel
- Product must be clearly visible and recognizable
- Text overlay must be legible and not obscure the product
- If mode is `edit`, always pass the product reference image
- NEVER generate text, watermarks, or brand logos inside the AI image prompt — burn text separately via PIL overlay
- Image quality should be maximum — no compression artifacts

## Scene Selection
For static image ads, the creative phase should generate exactly 1 scene with:
- `sceneNumber: 1`
- `visualDescription`: Hero product shot with lifestyle context
- `imagePrompt`: Detailed prompt for product-forward imagery
- `onScreenText`: Headline text for overlay (kept short, 3-6 words)

## Text Overlay Guidelines
- Headline: Max 6 words, bold, white on semi-transparent dark band
- CTA: Max 4 words (e.g. "Shop Now →"), accent color
- Position: Bottom 25% of image
- Font: System sans-serif, high contrast
- Never cover the product with text

## Quality Checklist
- [ ] Image is 1080x1350 (4:5)
- [ ] Product is clearly visible and identifiable
- [ ] Text (if any) is legible at thumbnail size
- [ ] No AI-generated text artifacts in the image
- [ ] Colors match the brand palette
