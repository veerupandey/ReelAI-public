---
name: recreate-reference-video
description: Recreate a reference ad/reel structure for the user's brand — ingest frames (upload, Playwright, or screenshot-carousel), analyze beats, remap to brand/product truth, generate stills, animate (Ken Burns / Wan I2V / Veo), stitch, verify.
---

# Recreate Reference Video

## When to use

- User asks to recreate / remake / match a reference video, reel, or ad
- A social URL (Instagram / TikTok) is provided as creative reference
- Uploaded reference frames or a short video clip should drive beat structure

## Pipeline

1. **Ingest** — uploaded frames, `/screenshot-carousel` for social URLs, or Playwright MCP
2. **Structure** — beat roles, composition, pacing, on-screen text intent (never copy competitor claims/logos)
3. **Lock product** — evidence graph + packshot / product URL facts win over the reference
4. **Plan scenes** — remap beats to our brand; HITL plan gate
5. **Stills** — generate per scene; visual critic + regen policy
6. **Motion** — Ken Burns default; Wan/fal I2V when live motion; Veo/T2V only when the scene needs generative video
7. **Assemble** — ffmpeg stitch + VO + captions + platform export
8. **Verify** — goal card must flip all required `passes` before deliver

## Rules

- Product identity and approved claims override reference aesthetics
- Do not copy competitor packaging, logos, watermarks, or verbatim claims
- Prefer still → I2V over pure T2V for product truth
- Cost gates before paid Live Motion / Veo
- Maker never self-grades the stop condition — harness verifies the goal card
