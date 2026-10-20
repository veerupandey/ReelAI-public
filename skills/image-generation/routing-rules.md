# Image Generation — Routing Rules

## Edit vs. Generate

Use `mode: 'edit'` when the scene shows the product packaging.  
Use `mode: 'generate'` when the scene shows skin, people, or environments only.

### Force edit mode
- `scene.useProductAsReference === true`
- Roles: `hook`, `ingredients`, `cta`

### Force generate mode
- `scene.useProductAsReference === false`
- Roles: `result`, `ritual`
- `productBase64` is null (fallback, log warning)

## Why this matters

Imagen edit mode anchors generation to the reference — preserving exact label text, bottle shape, color palette, and proportions. Without it, Imagen hallucinates a different bottle.

## Handling missing reference

If `productBase64` is null:
1. Log: "No product reference — switching all scenes to generate mode. Identity may drift."
2. Set `scene.useProductAsReference = false` for all scenes
3. Show this warning in the gate before proceeding

## Re-generation on feedback

- Call `interpretFeedback()` → get `patches[]`
- Set `scene.regenerate = true` only for patched scene indices
- All others keep `scene.regenerate = false`
- Re-run generation loop — only patched scenes re-generate

## Prompt augmentation order

```
{base template from SCENE_PROMPTS}

[CONSTRAINTS FROM PAST RUNS]
1. MISTAKE: "product label distorted" → CORRECT: "use EDIT THIS EXACT PRODUCT IMAGE prefix"
2. MISTAKE: "background too busy" → CORRECT: "pure white background, nothing else"
```

Memory constraints come after the base template — base establishes the brief first.
