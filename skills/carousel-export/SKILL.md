# Carousel Export Skill

## Purpose
Export multi-slide carousel images for Instagram Carousel (1:1 aspect ratio) with per-slide text overlays.

## Pipeline
1. AI recommends slide count (3-10 slides), user approves or adjusts
2. Generate image per slide via Gemini at 1:1 aspect ratio
3. Burn text overlay per slide (headline + body) via PIL
4. Batch export all slides at 1080x1080

## Rules
- Aspect ratio: **1:1** (1080x1080 for Instagram Carousel)
- Slide count: AI recommends 3-10, user confirms
- Visual consistency: All slides must share the same color palette, lighting, and typography style
- Each slide must deliver standalone value (user may stop swiping at any slide)
- First slide is the HOOK — must be scroll-stopping
- Last slide is the CTA — clear action with brand handle

## Slide Roles (recommended)
| Slide | Role | Example |
|-------|------|---------|
| 1 | Hook | Eye-catching product hero or bold statement |
| 2-N-1 | Value | Benefits, ingredients, how-to, social proof |
| N | CTA | Call to action with brand handle |

For shorter carousels (3-4 slides):
- Slide 1: Hook + product
- Slide 2-3: Key benefits
- Slide 4: CTA

For longer carousels (5-10 slides):
- Slide 1: Hook
- Slides 2-4: Problem/solution narrative
- Slides 5-8: Benefits with evidence
- Slide 9-10: Social proof + CTA

## Text Overlay Guidelines
- Headline: Max 5 words per slide, bold, white
- Body: Max 12 words, lighter weight, slightly smaller
- Position: Bottom 30% of image on semi-transparent dark band
- Font: Consistent across all slides
- First slide headline should be the strongest hook

## Quality Checklist
- [ ] All slides are 1080x1080 (1:1)
- [ ] Visual style is consistent across all slides
- [ ] Each slide adds new information
- [ ] Text is legible at thumbnail size
- [ ] Product is clearly shown in at least 2 slides
- [ ] Last slide has a clear CTA
- [ ] No AI-generated text artifacts in images
