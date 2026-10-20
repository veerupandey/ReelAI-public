# Product Lock Redesign: The Creative Control Room

## Vision

Turn ReelAI from a "scene generator with attached assets" into a **story-first creative operating system** for product ads — where the AI thinks like an art director, not a settings panel.

---

## Core Product Thesis

The user should never think in generation modes. The system should think in this order:

1. What are we selling?
2. What visual truth do we have?
3. What story should we tell?
4. What does each scene need visually?
5. Which engine executes that visual?

Today the UI leaks step 5 too early. The fix is not to hide step 5 — it is to make steps 1–4 so good that step 5 becomes invisible.

---

## What Is Broken Today (Diagnosis From Code)

### 1. Import is image collection, not product understanding

`productPageImportService.ts` fetches pages via Jina Reader, regex-extracts up to 12 `![alt](url)` image tags, scores them by alt-text relevance, and downloads as base64. The output is a flat `BrandAsset[]` with `description` (alt text), `sourceUrl`, and raw bytes — no shot-type classification, no usability rating, no label-readability score, no "what can I do with this image" metadata.

`catalogBrandAssets` in `geminiService.ts` (line ~889) does analyze assets with Gemini and produces `BrandAssetCatalogEntry` with `shotType`, `productIdentity`, and `framingMode` — but this only runs in the **main reel pipeline** (`App.tsx`), never in the brand ad wizard flow. The Product Lock uses raw descriptions instead.

**Relevant code:**
- `services/productPageImportService.ts` — `importProductPageAssets` (~378), `fetchImageAsset` (~339), `extractProductImages` (~297)
- `services/geminiService.ts` — `catalogBrandAssets` (~889), `analyzeBrandAesthetics` (~838)

### 2. Storyboard planning is smarter than the scene controls

`planResearchDrivenLockedStoryboard` (geminiService.ts:61) already classifies scenes with `visualTask`: `use_imported`, `edit_imported`, `overlay_on_product`, `generate_new`. It maps `recommendedBaseAssetId` to imported assets and provides `visualTaskReason`.

But after planning, `BrandVideoCreator.tsx` (~512–554) maps these into `AssetLabMode` strings (`continue_image`, `scene_prompt_only`, etc.) and drops the rationale. The user then sees `ProductLockAssetLabPanel.tsx` with five raw engine-mode buttons.

**Relevant code:**
- `services/geminiService.ts` — `planResearchDrivenLockedStoryboard` (~61–228)
- `components/BrandVideoCreator.tsx` — agency seed mapping (~512–554)
- `components/productLock/productLockTypes.ts` — `AssetLabMode`, `SceneVisualTaskType`

### 3. The UX is tied to engine mechanics

`AssetLabMode` in `productLockTypes.ts` exposes: `scene_prompt_only`, `continue_image`, `continue_image_into_scene`, `image_variant`, `new_from_scene`. These are implementation details. The user should see "Use This Shot", "Upgrade This Shot", "Imagine Something New" — not engine configuration.

**Relevant code:**
- `components/productLock/ProductLockAssetLabPanel.tsx` (~100–177)
- `components/productLock/ProductLockSceneCard.tsx` (~138–165)

### 4. Asset binding is single-image-centric

`ImageGenerationRequest` supports one `primaryReference` plus optional `prevSceneReference` / `nextSceneReference`. This works for variants but not for composite scenes like "product bottle + smiling woman + ingredient props" which need multiple reference images combined with different preservation rules per reference.

**Relevant code:**
- `types.ts` — `ImageGenerationRequest` (~177–188)
- `services/geminiService.ts` — `generateImageAsset` (~1706–1776)

### 5. Multi-product is not a first-class concept

`useBrandAdSetup.ts` (~163–215) scopes to one product URL via `scopeBrandToProduct`. The entire `ensureBrandAssets` flow filters brand assets to a single `originPageUrl`. This blocks bundle stories, routines, and comparison narratives.

**Relevant code:**
- `components/hooks/useBrandAdSetup.ts` — `ensureBrandAssets` (~163–215), `handleResolveProduct` (~217–280)

### 6. Two disconnected planning worlds

`ScenePlan` / `ReelPlan` (for generic reels) and `ResearchDrivenStoryboardScene` / `LockedSceneIdea` (for brand ads) have different field names, different enums, and converge only at `generateImageAsset`. Type drift shows up in tests using `'crop_reframe'` while `AdScene` only allows `'use_as_is' | 'edit'`.

**Relevant code:**
- `types.ts` — `ScenePlan` (~501–519), `ReelPlan` (~513–519)
- `types/brand.ts` — `AdScene` (~275–288), `SceneSourceMode`
- `components/productLock/productLockTypes.ts` — `LockedSceneIdea` (~21–51)

---

## The New Experience

### Design Principles

1. **Story first, engine never** — the user picks creative intent, the system picks execution
2. **Opinionated AI, easy override** — the system recommends a route with reasoning; user changes it in one click
3. **Multi-reference compositing** — scenes can pull from multiple source assets with per-reference preservation rules
4. **Multi-product native** — products are a first-class collection, not a URL filter
5. **Continuity by default** — scenes know their neighbors and maintain visual coherence automatically

### Canonical Type Boundary

This redesign must not create a third domain-model home.

- `types/brand.ts` becomes the canonical home for all brand-ad and storyboard domain types
- `types.ts` remains the home for shared media, render, and generic editor/runtime types
- `components/productLock/productLockTypes.ts` becomes a temporary UI/view-model layer only, then gets minimized or removed

That means new concepts like `ImportedProduct`, `ImportedAsset`, `SceneRoute`, `SceneVisualRecipe`, and storyboard state live in `types/brand.ts`, not `types.ts`.

### Flow Overview

```
Product URLs → Product Universe → Asset Intelligence → Story Engine → Storyboard
                                                                         ↓
                                                              Scene Router (auto)
                                                                         ↓
                                                              Visual Workbench
                                                                         ↓
                                                              Approve → Script Studio → Video
```

---

## Phase 1: Product Universe

**What changes:** Replace single-URL product resolution with a multi-product import panel.

**Input:**
- One or more product URLs (paste multiple, comma-separated)
- Optional campaign prompt / creative direction
- Optional brand website URL (for brand-level context)

**Process:**
1. For each URL: fetch page via Jina → extract title, facts, claims, ingredients, proof hooks via `extractProductPageSignalSummary`
2. Import images per product (existing pipeline)
3. Group assets by product

**Output — Product Universe Panel:**

Each product gets a card showing:
- Product name + category (derived from page)
- Key claims (guardrails — what we can and cannot say)
- Imported image count with strip preview
- "Story roles" — AI-suggested ways this product could appear (hero, supporting, CTA anchor)

**Data model:**

```ts
interface ImportedProduct {
  id: string;
  productUrl: string;
  title: string;
  brandName: string;
  category?: string;
  facts: string[];
  claims: string[];
  ingredients?: string[];
  storyRoles: ('hero' | 'supporting' | 'cta_anchor' | 'demo_subject')[];
  assets: ImportedAsset[];
}
```

**What we keep:** Jina-based page fetch, `extractProductPageSignalSummary`, `extractProductImages`, `fetchImageAsset` scoring logic.

**What we replace:** `scopeBrandToProduct` single-URL filter → products as a parallel collection.

**Files changed:**
- `services/productPageImportService.ts` — new `importProductUniverse(urls[])` wrapping existing helpers
- `components/hooks/useBrandAdSetup.ts` — accept `string[]` URLs, store `ImportedProduct[]`
- `types/brand.ts` — add `ImportedProduct`, `ImportedAsset`

---

## Phase 2: Asset Intelligence

**What changes:** Imported images gain progressive Gemini-based intelligence so the planner sees more than raw alt text, but the first storyboard does not wait on a full-gallery analysis pass.

**Process:**

For each product's images, run a capped multimodal Gemini analysis pass on the highest-priority assets first, then continue hydrating the rest progressively in the background.

**Data model:**

```ts
interface ImportedAsset {
  id: string;
  productId: string;
  sourceUrl?: string;
  base64?: string;
  mimeType?: string;

  // AI-computed intelligence
  shotType: 'packshot' | 'texture' | 'ingredient' | 'lifestyle' | 'model_with_product' | 'infographic' | 'comparison' | 'bundle' | 'other';
  quality: 'hero' | 'strong' | 'usable' | 'weak';
  editability: 'safe_to_edit' | 'safe_to_outpaint' | 'reference_only';
  identityRisk: 'low' | 'medium' | 'high';
  productVisibility: number;  // 0–1
  labelReadability: number;   // 0–1
  bestSceneRoles: string[];   // e.g. ["hook hero", "CTA close-up", "proof shot"]
  semanticDescription: string;
  productIdentity?: string;

  // User-facing verdict
  verdict: 'use_as_is' | 'can_upgrade' | 'good_reference' | 'do_not_use';
  verdictReason: string;
}
```

### Latency Strategy By Execution Mode

Asset intelligence cannot be a hard blocking step for every imported asset in every mode.

- `fast`
  - import images immediately
  - run cheap heuristics synchronously from existing metadata and URL/alt-text scoring
  - analyze only the top 2-4 likely hero assets per product before the first storyboard
  - hydrate the rest in the background after the user already has scenes on screen
- `balanced`
  - analyze the top 4-6 assets per product before first storyboard
  - continue analyzing overflow assets in the background
- `agency`
  - analyze all priority assets up front, but still cap the first blocking batch
  - overflow assets can hydrate progressively and improve route recommendations after the first plan

The planner must accept partial intelligence. It should produce an initial storyboard from:

- product page signals
- current analyzed assets
- fallback heuristics for unanalyzed assets

Then it can refine scene routing as richer asset intelligence arrives. The first storyboard should not wait on a full-gallery multimodal pass.

**User-facing result — asset strip with verdict badges:**
- 🟢 **Use** — clean hero shot, no generation needed
- 🔵 **Upgrade** — good bones, AI can improve lighting/composition
- 🟡 **Reference** — useful as ingredient/texture/style reference, not as final frame
- ⚫ **Skip** — text-heavy infographic, watermarked, too small

**What we keep:** `catalogBrandAssets` prompt structure and JSON schema pattern.

**What we replace:** Separate `BrandAssetCatalogEntry` catalog → intelligence baked into each `ImportedAsset`.

**Files changed:**
- `services/geminiService.ts` — new `analyzeProductAssets(product: ImportedProduct): Promise<ImportedAsset[]>`
- `services/productPageImportService.ts` — call `analyzeProductAssets` after image import
- `types/brand.ts` — `ImportedAsset` type with intelligence fields

---

## Phase 3: Story Engine

**What changes:** Story planning receives the currently available asset intelligence and generates a `SceneVisualRecipe` per scene — not just a prompt + `visualTask` string.

**Process:**

The planner receives:
1. All products with their facts, claims, ingredients
2. All assets with their verdicts, shot types, and best scene roles
3. Campaign direction / creative prompt
4. Platform + duration constraints

It produces a **narrative spine** first:

```
Hook → Pain/Myth → Product Truth → Demo/Proof → Emotional Payoff → CTA
```

Then for each beat, a `SceneVisualRecipe`:

```ts
type SceneRoute =
  | 'use_existing'       // crop/reframe only, no AI generation
  | 'upgrade_existing'   // reference-preserving edit (lighting, composition)
  | 'composite_product'  // product identity preserved, new environment/subjects invented
  | 'generate_fresh'     // entirely new scene, product truth constraints only
  | 'extend_sequence';   // continuity from previous scene

interface SceneVisualRecipe {
  sceneId: string;
  narrativeBeat: 'hook' | 'pain' | 'truth' | 'proof' | 'payoff' | 'cta';
  scriptLine: string;
  visualConcept: string;
  productVisibility: 'hero' | 'supporting' | 'absent' | 'implied';

  // The creative routing decision
  route: SceneRoute;
  routeReason: string;
  confidence: number;  // 0–1

  // Asset binding
  preferredProductIds: string[];
  primaryAssetId?: string;
  additionalAssetIds?: string[];
  preservationRules?: {
    assetId: string;
    preserve: ('product_identity' | 'label' | 'composition' | 'lighting' | 'person')[];
    modify: string;
  }[];

  // Fallback
  fallbackRoute?: SceneRoute;
  fallbackReason?: string;

  // Generation spec (system fills this)
  generationBrief: string;
}
```

**Example — composite scene:**

```json
{
  "sceneId": "scene_04",
  "narrativeBeat": "proof",
  "scriptLine": "See the glow after just one wash.",
  "visualConcept": "Smiling woman holding the product bottle with visibly glowing, dewy skin.",
  "productVisibility": "hero",
  "route": "composite_product",
  "routeReason": "Asset 1 has a clean bottle shot with readable label. Composite it into a model scene.",
  "confidence": 0.85,
  "preferredProductIds": ["gentle-cleanser"],
  "primaryAssetId": "asset_1",
  "preservationRules": [
    {
      "assetId": "asset_1",
      "preserve": ["product_identity", "label"],
      "modify": "Place in the hand of a smiling woman with glowing skin, premium bathroom background"
    }
  ],
  "generationBrief": "A woman smiling naturally, holding the exact product bottle from the reference image. Preserve all label text, logo, and bottle proportions. Dewy, glowing skin. Premium bathroom background with soft morning light. Vertical 9:16."
}
```

**Example — fresh generation scene:**

```json
{
  "sceneId": "scene_03",
  "narrativeBeat": "pain",
  "scriptLine": "Stop washing your face like it owes you money.",
  "visualConcept": "Split-screen: harsh foaming chemicals vs gentle botanical lather.",
  "productVisibility": "supporting",
  "route": "generate_fresh",
  "routeReason": "This scene needs a visual metaphor that doesn't exist in the gallery.",
  "confidence": 0.9,
  "preferredProductIds": ["gentle-cleanser"],
  "primaryAssetId": null,
  "fallbackRoute": "composite_product",
  "fallbackReason": "Could composite Asset 2 into a bathroom scene if fresh generation fails.",
  "generationBrief": "Split visual: left side shows harsh chemical foam dissolving skin barrier (red, aggressive), right side shows gentle botanical lather with visible chamomile and oat. Vertical 9:16, cinematic lighting."
}
```

**What we keep:** `planResearchDrivenLockedStoryboard` prompt structure and `visualTask` concept.

**What we replace:** `LockedSceneIdea` → `StoryboardScene` wrapping `SceneVisualRecipe`.

**Files changed:**
- `services/geminiService.ts` — evolve `planResearchDrivenLockedStoryboard` into `planCreativeStoryboard`
- `types/brand.ts` — add `SceneVisualRecipe`, `SceneRoute`, `StoryboardScene`
- `components/productLock/productLockTypes.ts` — replace `LockedSceneIdea` + `AssetLabMode`

---

## Phase 4: Scene Router + Multi-Reference Compositing

**What changes:** Auto-route every scene through the right engine. Add composite mode for multi-reference scenes.

### Route → Engine Mapping

| User-Facing Route | Internal Engine | What Happens |
|---|---|---|
| **Use This Shot** | Crop/reframe only | Asset cropped to 9:16 with smart focus. No AI. |
| **Upgrade Shot** | Reference-preserving edit | `mode: 'edit'`, lighting/composition improvements. Product identity locked. |
| **Place Product In New World** | Multi-reference composite | `mode: 'composite'`, per-reference preservation rules. Product + new environment/subjects. |
| **Imagine New Scene** | Fresh generation | `mode: 'generate'`, product truth constraints only. No reference image. |
| **Continue From Previous** | Sequence continuity | `mode: 'edit'` with `prevSceneReference`. Continuity instructions. |

### Extended `ImageGenerationRequest`

```ts
interface ImageGenerationRequest {
  mode: 'generate' | 'edit' | 'composite';

  imagePrompt: string;
  visualDescription?: string;
  brandContext?: string;

  // Existing single-reference fields (kept for backward compat)
  primaryReference?: ImageReferenceInput;
  prevSceneReference?: ImageReferenceInput;
  nextSceneReference?: ImageReferenceInput;

  // New: multiple references with per-reference rules
  references?: {
    input: ImageReferenceInput;
    role: 'product' | 'person' | 'environment' | 'style_guide';
    preserve: string[];
    modify?: string;
  }[];

  currentSceneText?: string;
  prevSceneText?: string;
  nextSceneText?: string;
}
```

When `mode === 'composite'`, the prompt builder combines all references with per-reference preservation instructions. Gemini's image model already accepts multiple inline images — we structure the prompt to tell it what to preserve from each.

### Provenance And Lineage Changes

Composite support is not just a prompt-builder change. It requires first-class provenance.

Today generated assets only keep one `derivedFromAssetId`. That is insufficient for:

- composite scenes using multiple source assets
- reuse scoring for future generations
- continuity-aware edits on top of composite outputs
- explaining to the user how a scene was made

The redesigned system must preserve lineage at three levels:

1. **Asset level**
   - generated assets store all source asset ids and the role each source played
2. **Registry level**
   - reusable-asset history stores composite provenance, not only one parent asset
3. **Scene variant level**
   - every rendered scene variant stores which references were used and what was preserved

Suggested domain additions:

```ts
interface AssetProvenanceStep {
  assetId: string;
  role: 'product' | 'person' | 'environment' | 'style_guide' | 'previous_scene';
  preserve: string[];
  modify?: string;
}

interface BrandAsset {
  // existing fields...
  derivedFromAssetId?: string; // kept for backward compatibility
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}

interface ProductAssetRegistryEntry {
  // existing fields...
  derivedFromAssetId?: string; // kept for backward compatibility
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}

interface SceneImageVariant {
  // existing fields...
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}
```

**Files changed:**
- `types.ts` — extend `ImageGenerationRequest` with `references[]` and `'composite'` mode
- `types/brand.ts` — extend `BrandAsset` and registry-facing brand asset lineage types
- `services/productAssetRegistryService.ts` — persist and score composite provenance
- `components/productLock/hooks/useLockedAssetJobs.ts` — attach provenance to generated variants
- `services/geminiService.ts` — update `generateImageAsset` for composite prompt building
- New `services/sceneRouter.ts` — `routeScene(recipe, assets) → ImageGenerationRequest`

---

## Phase 5: The Creative Control Room UI

Replace the Product Lock screen with a three-column layout.

### Left Rail: Product Universe

```
┌─────────────────────┐
│  PRODUCTS            │
│                      │
│  ┌────────────────┐  │
│  │ Gentle Cleanser │  │
│  │ 8 assets • Hero │  │
│  │ [img][img][img] │  │
│  └────────────────┘  │
│                      │
│  ┌────────────────┐  │
│  │ Vitamin Serum   │  │
│  │ 5 assets • Supp │  │
│  │ [img][img]      │  │
│  └────────────────┘  │
│                      │
│  + Add Product URL   │
│                      │
│  ─── STORY MODE ──── │
│  ○ Single Hero       │
│  ○ Bundle Story      │
│  ○ Routine Story     │
│  ○ Comparison        │
└─────────────────────┘
```

### Center: Storyboard Timeline

```
┌─────────────────────────────────────────────┐
│  SCENE 3 • Pain Beat                        │
│                                              │
│  "Stop washing your face like it owes        │
│   you money."                                │
│                                              │
│  ┌──────────┐  Route: Imagine New Scene      │
│  │          │  Confidence: ●●●●○             │
│  │ [thumb]  │                                │
│  │          │  "No imported asset fits this   │
│  └──────────┘   visual metaphor."            │
│                                              │
│  [ Accept ]  [ Change Route ▾ ]  [ Retry ]   │
└─────────────────────────────────────────────┘
```

### Right Rail: Visual Workbench

```
┌──────────────────────────┐
│  VISUAL WORKBENCH         │
│                           │
│  ── AI Director's Note ── │
│  "This scene needs a      │
│   visual metaphor that    │
│   doesn't exist in your   │
│   gallery. Generating     │
│   fresh with botanical    │
│   vs chemical contrast."  │
│                           │
│  ── Candidate Assets ──   │
│  [Asset 2] verdict: ref   │
│  [Asset 5] verdict: skip  │
│                           │
│  ── Generation Brief ──   │
│  "Split visual: harsh     │
│   chemical foam vs gentle │
│   botanical lather..."    │
│  [Edit Brief]             │
│                           │
│  ── Preview History ──    │
│  [v1] [v2] [v3]          │
│                           │
│  ── Advanced ──           │
│  Engine: generate_fresh   │
│  Model: gemini-3-pro      │
│  [Override Engine ▾]      │
└──────────────────────────┘
```

**Product personality — the AI talks like an art director:**

- "Asset 3 is the cleanest hero shot. Perfect for CTA."
- "This scene wants a world that doesn't exist in your gallery. Let me imagine it."
- "I can preserve the bottle from Asset 1 and build a smiling-model shot around it."
- "This image is truthful but visually weak. Let me upgrade it instead of forcing it into the hook."

---

## New Scene Status Model

```ts
type SceneStatus =
  | 'planned'            // recipe created, no visual yet
  | 'routing'            // AI is deciding the best route
  | 'ready_to_make'      // route confirmed, generation spec ready
  | 'rendering'          // actively generating
  | 'needs_feedback'     // visual ready, user should review
  | 'approved';          // user accepted

interface StoryboardScene {
  id: string;
  sceneNumber: number;
  status: SceneStatus;
  recipe: SceneVisualRecipe;
  currentVisual?: UploadedMedia;
  variants: SceneImageVariant[];
  userOverrides?: {
    routeOverride?: SceneRoute;
    promptOverride?: string;
    assetOverrides?: string[];
  };
}
```

---

## Multi-Product Story Patterns

Built-in, not bolted-on:

| Pattern | Example | How Products Appear |
|---|---|---|
| **Single Hero** | "Why this cleanser changes everything" | One product throughout |
| **Hero + Support** | "The cleanser that pairs with..." | Primary in scenes 1–3, secondary enters scene 4 |
| **Bundle** | "The complete routine" | Products introduced sequentially, together in CTA |
| **Routine** | "Morning to night" | Products appear in temporal sequence |
| **Comparison** | "Before vs After" | Same product, different states/contexts |

---

## Implementation Plan

### Milestone 0: Domain Convergence + Provenance Foundation

**Goal:** Stabilize the data model before adding new planning layers.

1. `types/brand.ts` — define canonical homes for `ImportedProduct`, `ImportedAsset`, `SceneRoute`, `SceneVisualRecipe`, `StoryboardScene`
2. `types.ts` — keep only generic shared media/runtime types; add only the cross-cutting `ImageGenerationRequest` composite extension
3. `types/brand.ts` + registry types — add `sourceAssetIds[]` and `provenance[]` while keeping `derivedFromAssetId` for backward compatibility
4. `services/productAssetRegistryService.ts` — update storage shape and reuse scoring to understand multi-source assets
5. `components/productLock/productLockTypes.ts` — mark as transitional view-model layer and start deleting duplicated domain definitions

**Why first:** This prevents the redesign from introducing a third source of truth and avoids building composite features on a lineage model that cannot represent them.

**Estimated scope:** ~250 lines new, ~150 refactored

### Milestone 1: Product Universe + Asset Intelligence (Foundation)

**Goal:** Replace single-URL import with multi-product intelligence layer.

1. `productPageImportService.ts` — new `importProductUniverse(urls: string[])` returning `ImportedProduct[]`
2. `geminiService.ts` — new `analyzeProductAssets(product, images)` returning enriched `ImportedAsset[]`
3. Make intelligence latency-aware by execution mode:
   - `fast`: analyze only top hero candidates before storyboard
   - `balanced`: analyze a larger front batch
   - `agency`: analyze all priority assets up front, hydrate overflow progressively
4. `types/brand.ts` — add `ImportedProduct`, `ImportedAsset` with all intelligence fields
5. `useBrandAdSetup.ts` — accept multiple URLs, store products array
6. New `components/productLock/ProductUniversePanel.tsx` — left rail UI

**Estimated scope:** ~800 lines new, ~200 refactored

### Milestone 2: Story Engine + Visual Recipes

**Goal:** Story planner produces `SceneVisualRecipe[]` with auto-routing.

1. `geminiService.ts` — new `planCreativeStoryboard()` evolving from `planResearchDrivenLockedStoryboard`
2. `types/brand.ts` — add `SceneVisualRecipe`, `SceneRoute`, `StoryboardScene`
3. `productLockTypes.ts` — replace `LockedSceneIdea` + `AssetLabMode` with `StoryboardScene`
4. `BrandVideoCreator.tsx` — route through new planner

**Estimated scope:** ~600 lines new, ~400 replaced

### Milestone 3: Scene Router + Execution

**Goal:** Auto-route scenes to the right engine. Add composite mode.

1. New `services/sceneRouter.ts` — maps `SceneVisualRecipe` → `ImageGenerationRequest`
2. `types.ts` — extend `ImageGenerationRequest` with `references[]` and `'composite'` mode
3. `types/brand.ts` + registry types — persist provenance for multi-reference outputs
4. `geminiService.ts` — update `generateImageAsset` for composite prompt building
5. `useLockedAssetJobs.ts` — consume scene router instead of manual mode selection

**Estimated scope:** ~500 lines new, ~300 refactored

### Milestone 4: Creative Control Room UI

**Goal:** Three-column layout replacing current Product Lock screen.

1. Replace `ProductLockAssetLabPanel.tsx` + `ProductLockSceneCard.tsx` with:
   - `ProductUniversePanel.tsx` (left rail)
   - `StoryboardTimeline.tsx` (center)
   - `VisualWorkbench.tsx` (right rail)
2. Scene cards show route chips + confidence, not engine modes
3. Visual Workbench shows director's reasoning + candidates + history

**Estimated scope:** ~1200 lines new UI, ~800 removed

### Milestone 5: Polish + Advanced

- Drag-to-reorder scenes
- One-click "Try another route" with instant re-routing
- Batch approve all high-confidence scenes
- "Autopilot" mode: approve all → generate all → script studio
- Export storyboard as shareable deck

---

## What We Keep vs What We Replace

| Keep (proven, reusable) | Replace (leaky, limiting) |
|---|---|
| `generateImageAsset` core engine | `AssetLabMode` enum + 5-button UI |
| `planResearchDrivenLockedStoryboard` prompt DNA | `LockedSceneIdea` data model |
| Jina-based page fetch + image scoring | Single-URL `scopeBrandToProduct` filter |
| `runWithRetry` / retry logic | Manual mode selection UI |
| Scene variant history | `ProductLockAssetLabPanel` |
| `BrandAssetCatalogEntry` field concepts | Separate catalog vs asset split |

---

## Recommended UX Copy

| Use | Instead of |
|---|---|
| Use This Shot | `use_as_is` |
| Upgrade Shot | `edit_imported` / `image_variant` |
| Place Product In New World | `continue_image_into_scene` / `overlay_on_product` |
| Imagine New Scene | `scene_prompt_only` / `generate_new` |
| Continue From Previous | `continue_image` |

---

## Summary

This is not a rewrite — it is a **new layer on top of proven engines**. The core insight: `planResearchDrivenLockedStoryboard` already thinks in the right abstraction (`visualTask`), and `generateImageAsset` already handles edit/generate. What's missing is:

1. An **intelligence layer** between import and planning (Phase 2)
2. A **recipe layer** between planning and execution (Phase 3)
3. A **UI** that speaks creative intent instead of engine configuration (Phase 5)
4. A **canonical domain model** in `types/brand.ts` so the redesign reduces drift instead of adding it
5. A **lineage model** that can represent composite scenes as reusable product assets
6. A **latency strategy** so `fast`, `balanced`, and `agency` remain meaningfully different

The user should feel like they have an elite creative partner who says "I analyzed your assets, here's the story, here's why each scene looks the way it does, and here's what I'll build" — not a settings panel that says "pick a generation mode."
