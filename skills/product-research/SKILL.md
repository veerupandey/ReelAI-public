---
name: product-research
description: Import a product page URL and extract verified facts, hero image, and brand signals. Use at the start of any ad creation run before writing scripts or generating images. Outputs a facts list, product reference image, and session directory.
---

# Product Research

## When to use

- User provides a product URL and wants to create an ad
- First phase of every autonomous agent run
- When refreshing stale product data mid-run

## Inputs

| Input | Required | Description |
|---|---|---|
| `productUrl` | yes | Full URL to the product page |
| `brand` | yes | Brand slug e.g. `sulwhasoo` — names the session directory |
| `product` | yes | Product slug e.g. `first-care-serum` — names the session directory |

## Instructions

1. Call `createSession(brand, product)` — creates `/tmp/reelai-agent/{brand}/{product}/{sessionId}/`. Store the returned `SessionInfo` for the whole run.

2. Call `importProductPageAssetsRich(productUrl, '', { executionMode: 'balanced', analyzeAssets: true })`. Returns `{ productTitle, assets[] }`.

3. Pick the hero asset using this priority order:
   - `quality === 'hero'` AND `shotType === 'packshot'`
   - `verdict === 'use_as_is'` AND `shotType === 'packshot'`
   - `quality === 'hero'`
   - `verdict === 'use_as_is'`
   - First asset in array

4. Call `getProductKnowledge(productUrl)`. If it returns `{ facts: string[] }`, these are ground truth — they take precedence over asset descriptions.

5. Build `facts[]`:
   - If `pageFacts.length > 0` → `[...pageFacts, ...assetFacts.slice(0, 2)]`
   - Otherwise → `assetFacts` from asset `semanticDescription` fields

6. Upload the hero asset: `uploadBase64(base64, 'product_reference.png', mimeType, session.sessionDir)`. Store returned `path` as `productAbsPath`.

7. Emit a markdown summary: product title, URL, asset count, session directory, asset list.

8. Emit the product reference image — user must confirm it is the correct product shot.

9. If `pageFacts` found, emit them as an "Ingredients & Claims" block so user can spot errors before scripting.

## Constraints

- **NEVER** use asset descriptions as ingredient facts if `pageFacts` exist — page text is ground truth
- **NEVER** proceed without a product reference image — if downloads fail, gate the user to upload one manually
- **NEVER** invent a product title — use `productTitle` from import or last URL path segment
- Session directory must exist before any file write

## Success criteria

- `facts[]` has ≥3 entries from the actual product page
- `productAbsPath` is a saved PNG readable by Imagen edit mode
- `session.sessionDir` is a valid absolute path under `/tmp/reelai-agent/`
- User sees the product image in console before the run continues
