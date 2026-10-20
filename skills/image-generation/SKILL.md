---
name: image-generation
description: Generate or edit scene images using Imagen. Product-showing scenes (hook, ingredients, cta) always use the product reference image in edit mode to lock bottle identity. Lifestyle scenes (ritual, result) generate fresh. All images are saved to the session directory.
---

# Image Generation

## When to use

- After `ad-copywriting` produces an approved `ScenePlan[]`
- For each scene that needs an image (all on first run; only `regenerate !== false` scenes on re-runs)
- When user requests a specific scene to be regenerated after feedback

## Inputs

| Input | Required | Description |
|---|---|---|
| `scenes` | yes | `ScenePlan[]` from plan phase |
| `productBase64` | yes | Base64 PNG of hero product image |
| `session` | yes | `SessionInfo` with `sessionDir` |
| `brandSlug` | no | For brand-scoped image memory |

## Instructions

1. Load memory — `readMemory('generate_images', brandSlug)`. Format with `formatMemoryForPrompt()`. This becomes the `[CONSTRAINTS FROM PAST RUNS]` block appended to each image prompt.

2. For each scene (skip if `scene.regenerate === false`):

   a. Determine mode: `useRef = scene.useProductAsReference && !!productBase64`

   b. Augment prompt:
      ```
      {scene.imagePrompt}

      [CONSTRAINTS FROM PAST RUNS]
      {memBlock}
      ```

   c. Call `generateImageAsset()` from `services/geminiService.ts`:
      - `mode: 'edit'` + `primaryReference: { data: productBase64, mimeType: 'image/png' }` when `useRef`
      - `mode: 'generate'` otherwise

   d. Upload: `uploadBase64(base64, `scene_${scene.index}.png`, 'image/png', session.sessionDir)`. Store `up.path` as `scene.imageAbsPath`.

   e. Emit image output with label `Scene N: {role} ({durationSec}s)`.

3. Emit summary: "Generated N images — X edited from product reference, Y generated fresh."

## Scene role → mode

| Role | Mode | Reason |
|---|---|---|
| `hook` | edit | Product on surface — must match real bottle |
| `ritual` | generate | Person applying — no packaging visible |
| `ingredients` | edit | Flat lay — reference preserves label |
| `result` | generate | Skin close-up only — no product |
| `cta` | edit | Product hero — must match real bottle |

## Image prompt templates (from `autonomousAgent.ts` SCENE_PROMPTS)

| Role | Intent |
|---|---|
| `hook` | EDIT THIS EXACT PRODUCT IMAGE. White surface, dramatic side lighting, luxury beauty commercial |
| `ritual` | Person applying product, white background, editorial Vogue-style |
| `ingredients` | EDIT THIS EXACT PRODUCT IMAGE. Flat lay with 3 natural ingredients, deep shadows |
| `result` | Extreme close-up of radiant dewy skin, rim lighting, no product visible |
| `cta` | EDIT THIS EXACT PRODUCT IMAGE. Low angle, soft halo light, pure white background |

All prompts end with `9:16 vertical format.`

## Constraints

- **NEVER** generate a product scene (`hook`, `ingredients`, `cta`) without the product reference in edit mode
- **NEVER** skip uploading to `sessionDir` — assembly needs `imageAbsPath`
- **NEVER** use edit mode for `result` scene — skin only, no product
- On `generateImageAsset()` error: emit per-scene error, continue — do not abort the run
- If `productBase64` is null: log warning, use generate mode for all, tell user at the gate

## Success criteria

- Every scene has a non-null `imageUrl` (data URL for console preview)
- Every scene has a non-null `imageAbsPath` (absolute disk path for assembly)
- Product scenes visually match the reference packaging (verified at `creative-review`)
- No scene silently skipped — errors surfaced per scene
