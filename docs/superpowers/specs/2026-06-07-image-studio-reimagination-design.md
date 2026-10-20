# Image Studio Reimagination

## Product Thesis

Image Studio should be a focused visual creation workspace guided by an AI creative
director. Users should describe an outcome, provide clearly typed references, and
iterate on results. They should not need to choose generation-engine routes or
understand how references are passed to the model.

The experience has three connected spaces:

1. **Discover** turns product truth and rough user intent into strong visual directions.
2. **Create** generates new images from a brief and explicitly typed references.
3. **Refine** edits one selected result while preserving a visible version history.

Creating a connected multi-frame campaign is a separate downstream workflow launched
from a chosen direction or result.

## Problems Being Solved

The current implementation uses `selectedIds` for unrelated meanings:

- temporary gallery selection
- the base image being edited
- images included in a composite
- protected product identity
- style and creative context
- assets supplied to concept planning

This ambiguity makes the UI difficult to understand and makes generated results
unpredictable. The current screen also embeds image operations, prompt enhancement,
trend research, and five-frame campaign planning in one workspace.

The redesign establishes explicit state and UI boundaries before changing visual
styling.

## Design Principles

1. **Intent before engine mechanics.** The UI describes what the user wants; internal
   services decide the generation route.
2. **Every reference has one explicit role.** A reference cannot silently mean both
   product identity and visual style.
3. **Product truth is persistent.** It is not controlled through temporary gallery
   selection.
4. **Editing is contextual.** Edit controls appear only when a document or region is
   active.
5. **Research is optional and purposeful.** It improves creative directions but does
   not occupy the default creation workspace.
6. **Results dominate the screen.** Controls remain compact and reveal detail only
   when needed.
7. **AI interpretation is inspectable.** Before generation, users can see how AI will
   use product truth and references.

## Information Architecture

### Discover

Discover is the optional starting point for users who need help deciding what to
create.

Inputs:

- product URL or imported product images
- rough user direction
- platform and objective, when relevant
- optional trend research

Outputs:

- analyzed Product Truth
- one production-ready brief
- three meaningfully different creative directions
- explicit rationale and product-grounding notes for each direction

Each direction supports:

- **Create image**: opens Create with a populated composer
- **Expand into campaign**: opens the separate campaign/concept-set workflow

Discover replaces the embedded Trend Copilot and the planning portion of the current
Concept Set workspace.

### Create

Create is the default Image Studio workspace.

Desktop layout:

- left rail: Assets, Product Truth, and Creative References
- center: generated results and branches
- right inspector: format and advanced controls
- bottom composer: prompt, typed reference chips, AI interpretation, and primary action

The composer is the main interaction surface. References are attached as chips with
one of these roles:

- `product`: preserve recognizable identity, packaging, labels, colors, and proportions
- `include`: place this subject or object in the output
- `style`: borrow palette, lighting, texture, and visual language only
- `composition`: follow framing or layout only

The system infers the internal operation:

- no active document and no `include` references: generate
- one active document: edit
- multiple `include` references: composite
- any `style` or `composition` references: guided generation or edit

The primary action displays the inferred outcome, such as `Create image`,
`Create composite`, or `Apply edit`. An advanced menu permits a manual override
without making route selection the default workflow.

### Refine

Refine opens when the user opens a result as an active document.

The center becomes a focused document view. Available actions:

- prompt-based whole-image edit
- select-region edit
- remove
- replace
- expand/outpaint
- reframe
- upscale

The left rail changes to version history. Every successful edit creates a child
version and never silently replaces the source.

Mask-based editing is included in the product design but should ship only after the
base document/version model is stable.

### Campaign Workspace

Campaign creation is not an Image Studio mode. It is a separate workflow that
receives:

- Product Truth
- selected creative direction
- shared visual rules
- optional seed result

The existing `conceptSetService.ts` can seed this workspace after its concerns are
separated from Image Studio.

## Product Truth

Product Truth is a persistent, inspectable record shared across Discover, Create,
Refine, and Campaign.

It contains:

- protected product assets
- detected product names and variants
- packaging and identity preservation rules
- verified facts and claims
- user corrections
- analysis confidence and unresolved questions

Example:

```text
Product Truth
✓ Preserve KAGEHA logo and label patterns
✓ Keep all three tin variants distinct
✓ Preserve tin proportions and material
! Confirm whether all variants should appear together
```

Product Truth replaces `Locked as Context`. Product assets can be used in generation
without also being treated as style references.

## Canonical State Model

```ts
type ReferenceRole = 'product' | 'include' | 'style' | 'composition';

interface ProductTruth {
  id: string;
  productName: string;
  protectedAssetIds: string[];
  preservationRules: string[];
  verifiedFacts: string[];
  unresolvedQuestions: string[];
  userCorrections: string[];
}

interface ComposerReference {
  assetId: string;
  role: ReferenceRole;
  strength?: number;
  instructions?: string;
}

interface StudioDocument {
  id: string;
  rootAssetId: string;
  activeVersionId: string;
  versionIds: string[];
}

interface GenerationVersion {
  id: string;
  parentVersionId?: string;
  outputAssetId: string;
  prompt: string;
  inferredOperation: 'generate' | 'edit' | 'composite';
  referenceSnapshot: ComposerReference[];
  productTruthId?: string;
  createdAt: string;
}

interface StudioSession {
  assets: StudioAsset[];
  productTruth?: ProductTruth;
  gallerySelectionIds: Set<string>;
  composerReferences: ComposerReference[];
  activeDocument?: StudioDocument;
  versions: GenerationVersion[];
  prompt: string;
  aspectRatio: AspectRatio;
}
```

`CreativeRoute` remains an internal service concern during migration. It is removed
from user-facing state after operation inference is stable.

## AI Creative Assistant

The assistant is available in Discover and as a compact composer action in Create.

It performs these steps:

1. Analyze Product Truth and typed references.
2. Interpret the user's rough direction.
3. Identify missing decisions that materially affect output.
4. Optionally research relevant trends.
5. Produce a production brief or several creative directions.
6. Explain what will be preserved and what will be changed.

Prompt enhancement should not silently overwrite user text. The composer shows:

- original direction
- AI interpretation
- expandable production prompt

The user may edit the interpretation before generation.

## Key User Flows

### Direct Creation

1. User opens Create.
2. User writes a prompt.
3. User optionally attaches typed references.
4. UI shows inferred action and AI interpretation.
5. User creates results.
6. Results appear as a new branch.

### Product-Grounded Creation

1. User imports a product URL or product images.
2. AI creates Product Truth.
3. User confirms or corrects important rules.
4. User describes the desired image.
5. Create automatically applies product preservation without treating the product as
   a style reference.

### Composite

1. User attaches two or more assets as `include`.
2. User optionally assigns product, style, or composition references.
3. Composer action changes to `Create composite`.
4. AI interpretation lists the role of each reference.
5. User generates and refines the chosen result.

### Edit

1. User opens a result or imported asset.
2. It becomes the active document.
3. User describes the change or selects a region.
4. Action changes to `Apply edit`.
5. Result is saved as a child version.

### Assisted Ideation

1. User opens Discover.
2. User provides product context and optional rough intent.
3. AI optionally researches current patterns.
4. AI presents three distinct directions.
5. User sends one direction to Create or Campaign.

## Component Boundaries

Proposed components:

- `ImageStudioShell`: navigation and responsive workspace frame
- `DiscoverWorkspace`: product analysis and creative directions
- `CreateWorkspace`: asset rails, results, composer, and inspector
- `RefineWorkspace`: active document and version controls
- `ProductTruthPanel`: persistent product facts and protection rules
- `ReferenceChip`: explicit reference role and instructions
- `PromptComposer`: user direction, AI interpretation, and primary action
- `ResultBoard`: generated outputs and branches
- `VersionRail`: document history
- `GenerationInspector`: aspect ratio and advanced options

`AIImageStudioScreen` should orchestrate workspace-level navigation only. Generation,
asset ingestion, and assistant workflows should move into focused hooks/services.

## Service Boundaries

### Retain

- existing product-page asset import
- `generateImageAsset`
- `enhanceImagePrompt`, adapted into interpretation rather than silent replacement
- `analyzeCreativeReferences`
- trend research service
- concept-set planning service for Campaign

### Add

- `inferStudioOperation(session): StudioOperation`
- `buildStudioGenerationRequest(session): ImageGenerationRequest`
- `analyzeProductTruth(assets, productSignals): ProductTruth`
- `buildCreativeDirections(productTruth, userDirection, research?): CreativeDirection[]`

### Remove From User-Facing API

- manual `CreativeRoute` selection
- generic `selectedIds` as generation context
- automatic treatment of selected assets as product identity plus brand style

## Error Handling

- Generation errors create a failed version attempt with retry controls.
- Product analysis uncertainty appears as unresolved Product Truth questions.
- Missing required references disable the primary action and state the exact fix.
- Research failure does not block ideation; the assistant labels directions as
  product-grounded without current trend evidence.
- Removing an asset referenced by Product Truth or a version requires confirmation.

## Responsive Behavior

- Desktop uses left rail, center board, right inspector, and bottom composer.
- Tablet collapses the right inspector into a drawer.
- Mobile uses a single workspace with bottom-sheet Assets and Properties panels.
- The composer remains persistent on Create and Refine.
- Discover becomes a vertically ordered flow on mobile.

## Visual Direction

- Preserve the current dark ReelAI visual language.
- Reduce borders and boxed panels; use hierarchy, spacing, and progressive disclosure.
- Keep generated images visually dominant.
- Reserve cyan for protected Product Truth, purple for creation, and amber for
  optional research signals.
- Replace emoji-heavy controls with a consistent icon system.
- Use plain-language verbs: `Create`, `Apply edit`, `Use as style`, `Protect product`.

## Migration Strategy

The migration must keep the existing generation path functional.

1. Introduce explicit session state and operation inference behind the current UI.
2. Build the new Create workspace and composer using existing generation services.
3. Introduce Product Truth and remove `Locked as Context`.
4. Add Discover and move Trend Copilot behavior into it.
5. Add document/version-based Refine.
6. Move Concept Set into the separate Campaign workspace.
7. Remove legacy route UI and obsolete state after behavior and tests migrate.

## Success Metrics

- Users can create, edit, and composite without choosing a creative route.
- Every generation reference has an explicit visible role.
- Product assets retain identity without unintentionally imposing style.
- A user can move from rough idea to first generation without entering a handcrafted
  production prompt.
- Users can explain why each attached image will affect the result.
- Editing produces a visible version branch.
- Campaign planning no longer competes with image editing inside one screen.

## Acceptance Criteria

1. Gallery selection, composer references, Product Truth, and active document are
   separate state concepts.
2. The primary action is inferred from active document and reference roles.
3. Users can inspect and change every composer reference role.
4. Product Truth preservation rules are visible before generation.
5. Prompt assistance shows an interpretation instead of silently replacing user text.
6. Trend research is optional and located in Discover.
7. Connected concept sets launch into a separate Campaign workspace.
8. Successful edits create child versions.
9. Existing generate, edit, and composite service capabilities remain functional
   throughout migration.

