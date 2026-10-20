# Product Research — References

## Services

```
services/productPageImportService.ts
  importProductPageAssetsRich(url, brandCtx, options) → { productTitle, assets[] }
  getProductKnowledge(url) → { facts: string[] } | null

services/shellToolService.ts
  createSession(brand, product) → SessionInfo
    SessionInfo: { sessionDir, sessionId, brandSlug, productSlug, baseUrl }

  uploadBase64(base64, filename, mimeType, sessionDir) → UploadResult
    UploadResult: { filename, path, url, mimeType, size }
```

## Asset fields used

```
quality:             'hero' | 'supporting' | 'low'
shotType:            'packshot' | 'lifestyle' | 'ingredient' | 'unknown'
verdict:             'use_as_is' | 'needs_edit' | 'skip'
semanticDescription: string   ← used for facts when pageFacts missing
base64:              string   ← may include 'data:image/png;base64,' prefix — strip it
mimeType:            string
previewUrl:          string
```

## Strip data-URL prefix before uploading

```ts
const raw = heroAsset.base64.startsWith('data:')
  ? heroAsset.base64.split(',')[1]
  : heroAsset.base64;
```

## Session directory layout

```
/tmp/reelai-agent/{brand}/{product}/{sessionId}/
  product_reference.png    ← hero image, locked identity for Imagen edit
  scene_0.png              ← generated scene images
  voice_0.wav              ← per-scene WAV (with RIFF header)
  voiceover_full.wav       ← concatenated audio
  clip_0.mp4               ← Ken Burns clips
  concat.mp4               ← xfade video
  final.mp4                ← video + audio merged
  captioned.mp4            ← captions overlaid
  output_{platform}.mp4    ← final platform export
  _memory/
    global-skills.jsonl    ← universal learned rules
    brand-{slug}.jsonl     ← brand-specific aesthetic preferences
```
