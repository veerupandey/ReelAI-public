# Image Studio Reimagination Implementation Plan

## Objective

Rebuild Image Studio around explicit Product Truth, typed composer references,
inferred operations, and document versions. Separate assisted ideation and campaign
planning from precision image creation while preserving existing generation
capabilities during migration.

## Phase 0: Baseline and Safety

### Task 0.1: Establish behavioral baseline

Files:

- `tests/ai-image-studio/AIImageStudioScreen.test.tsx`
- `tests/ai-image-studio/studioService.test.ts`
- `tests/ai-image-studio/studioReducer.test.ts`
- `tests/ai-image-studio/responsiveLayout.test.tsx`

Work:

- Run the current AI Image Studio test suite and build.
- Document existing failures before changes.
- Add missing tests for fresh generation with selected context and the current
  duplicate generation-failure dispatch behavior.

Verification:

- `npx vitest run tests/ai-image-studio`
- `npm run build`

## Phase 1: Correct the Domain Model

### Task 1.1: Add explicit studio session types

Files:

- Modify `components/AIImageStudio/types.ts`
- Add `components/AIImageStudio/studioOperation.ts`
- Modify `components/AIImageStudio/useStudioReducer.ts`
- Add/update `tests/ai-image-studio/studioReducer.test.ts`
- Add `tests/ai-image-studio/studioOperation.test.ts`

Work:

- Add `ProductTruth`, `ComposerReference`, `StudioDocument`, and
  `GenerationVersion`.
- Split `selectedIds` into `gallerySelectionIds` and `composerReferences`.
- Add active document and version state.
- Implement pure `inferStudioOperation`.
- Keep `CreativeRoute` only as a temporary compatibility type.

Verification:

- Reducer tests prove gallery selection does not affect references.
- Operation tests cover generate, edit, and composite inference.

### Task 1.2: Adapt generation request building

Files:

- Modify `components/AIImageStudio/studioService.ts`
- Update `tests/ai-image-studio/studioService.test.ts`

Work:

- Add `buildStudioGenerationRequest(session)`.
- Map explicit reference roles into existing `ImageGenerationRequest`.
- Apply Product Truth preservation rules only to product references.
- Preserve old request builders temporarily as compatibility wrappers.
- Ensure style references never implicitly preserve product identity.

Verification:

- Tests inspect exact requests for product, include, style, and composition roles.
- Existing generate, edit, and composite tests continue passing.

## Phase 2: Build the New Create Workspace

### Task 2.1: Create the workspace shell

Files:

- Add `components/AIImageStudio/ImageStudioShell.tsx`
- Add `components/AIImageStudio/CreateWorkspace.tsx`
- Add `components/AIImageStudio/AssetRail.tsx`
- Add `components/AIImageStudio/GenerationInspector.tsx`
- Modify `components/AIImageStudio/AIImageStudioScreen.tsx`

Work:

- Make `AIImageStudioScreen` responsible for workspace navigation and lifecycle only.
- Introduce left asset rail, central result board, right inspector, and bottom composer.
- Keep import, history, export, and generation wired through existing functionality.

Verification:

- Component tests verify workspace regions and responsive collapse behavior.
- Browser verification at desktop and mobile viewport sizes.

### Task 2.2: Build typed reference chips and composer

Files:

- Add `components/AIImageStudio/PromptComposer.tsx`
- Add `components/AIImageStudio/ReferenceChip.tsx`
- Add `components/AIImageStudio/ReferencePicker.tsx`
- Add corresponding tests

Work:

- Allow assets to be attached as product, include, style, or composition references.
- Show role, thumbnail, optional instructions, and remove action.
- Display inferred primary action.
- Provide advanced operation override behind a menu.
- Replace the current `GenerationPanel`.

Verification:

- Tests cover attaching, changing, and removing each role.
- Tests prove primary action changes based on session state.

### Task 2.3: Rebuild result presentation

Files:

- Add `components/AIImageStudio/ResultBoard.tsx`
- Modify `components/AIImageStudio/AssetGallery.tsx` or retire it after migration
- Add corresponding tests

Work:

- Separate library assets from generation results.
- Present each generation attempt as a result group.
- Allow a result to be opened as an active document or attached as a reference.

Verification:

- Generated output is visible and can immediately be refined or reused.

## Phase 3: Product Truth

### Task 3.1: Build product analysis service

Files:

- Add `components/AIImageStudio/productTruthService.ts`
- Reuse `services/creativeReferenceDirector.ts`
- Reuse relevant product-page analysis from `services/productPageImportService.ts`
- Add service tests

Work:

- Convert product images and page signals into Product Truth.
- Return preservation rules, verified facts, unresolved questions, and confidence.
- Support user corrections.

Verification:

- Tests prove rules are grounded in supplied product data.
- Uncertainty is represented explicitly rather than invented.

### Task 3.2: Add Product Truth UI

Files:

- Add `components/AIImageStudio/ProductTruthPanel.tsx`
- Modify `AssetCollectionStep.tsx`
- Modify `CreateWorkspace.tsx`
- Add corresponding tests

Work:

- Analyze imported product URLs or user-marked product assets.
- Show protected assets and preservation rules.
- Permit corrections and asset removal with confirmation.
- Remove all `Locked as Context` language and behavior.

Verification:

- Product Truth remains active regardless of gallery selection.
- Generated requests include confirmed preservation rules.

## Phase 4: AI Interpretation and Discover

### Task 4.1: Replace silent prompt enhancement

Files:

- Add `components/AIImageStudio/creativeAssistantService.ts`
- Modify or wrap `enhanceImagePrompt` usage
- Modify `PromptComposer.tsx`
- Add service and component tests

Work:

- Produce an inspectable AI interpretation containing outcome, preservation,
  composition, style, and unresolved questions.
- Keep original user direction unchanged.
- Allow accepting or editing the interpretation before generation.

Verification:

- User input is never silently overwritten.
- Interpretation reflects Product Truth and typed references.

### Task 4.2: Build Discover workspace

Files:

- Add `components/AIImageStudio/DiscoverWorkspace.tsx`
- Add `components/AIImageStudio/CreativeDirectionCard.tsx`
- Modify `AIImageStudioScreen.tsx`
- Reuse trend research and `analyzeCreativeReferences`
- Add corresponding tests

Work:

- Accept rough direction, product context, platform, objective, and optional research.
- Generate three distinct directions with rationale.
- Send a selected direction into Create.
- Clearly label when current trend evidence was or was not used.

Verification:

- Research failure still returns product-grounded directions.
- Selected direction populates Create without losing Product Truth.

### Task 4.3: Retire embedded Trend Copilot

Files:

- Remove `components/AIImageStudio/TrendCopilotPanel.tsx` after Discover parity
- Modify `AIImageStudioScreen.tsx`
- Remove obsolete tests

Verification:

- No trend-research controls remain in the default Create inspector.

## Phase 5: Refine and Version History

### Task 5.1: Introduce document versions

Files:

- Modify `types.ts`
- Modify `useStudioReducer.ts`
- Modify `studioService.ts`
- Add version reducer and service tests

Work:

- Create a document when an asset/result is opened for editing.
- Save every successful edit as a child `GenerationVersion`.
- Preserve parent prompt and reference snapshots.

Verification:

- Editing never overwrites the parent.
- Version branches survive switching between documents during the session.

### Task 5.2: Build Refine workspace

Files:

- Add `components/AIImageStudio/RefineWorkspace.tsx`
- Add `components/AIImageStudio/VersionRail.tsx`
- Add `components/AIImageStudio/DocumentCanvas.tsx`
- Add corresponding tests

Work:

- Show active image, version history, and contextual edit composer.
- Initially support whole-image prompt editing, reframe, and upscale.
- Add mask-region editing only after the document flow is stable.

Verification:

- Opening a result enters Refine.
- Applying an edit creates and selects a child version.

## Phase 6: Separate Campaign Planning

### Task 6.1: Extract Campaign workspace

Files:

- Move/refactor `components/AIImageStudio/ConceptSetWorkspace.tsx`
- Move/refactor `components/AIImageStudio/conceptSetService.ts`
- Add a campaign route/workspace component
- Modify app navigation

Work:

- Accept Product Truth, creative direction, and optional seed image.
- Preserve the existing five-frame planning capability.
- Remove campaign mode from `AIImageStudioScreen`.

Verification:

- Discover direction can open Campaign.
- Campaign can send one frame prompt or generated result back to Create.

## Phase 7: Cleanup and Consolidation

### Task 7.1: Remove obsolete Image Studio concepts

Files:

- Remove or retire `GenerationPanel.tsx`
- Remove legacy route state from `types.ts` and reducer
- Evaluate and retire `components/ImageStudioScreen.tsx`
- Consolidate duplicated creative-route mappings across Product Lock and Storyboard

Work:

- Remove `CreativeRoute` from user-facing state.
- Remove `selectedIds` generation semantics.
- Remove obsolete UI and tests.
- Keep one canonical operation-to-generation adapter.

Verification:

- `rg` finds no `Locked as Context` or user-facing `Creative Route` in Image Studio.
- Full build and relevant test suites pass.

## Delivery Slices

### Slice A: Correctness Foundation

Includes Phase 1. It fixes ambiguous state and generation request behavior without a
major visual change.

### Slice B: New Create Experience

Includes Phase 2 and Product Truth UI from Phase 3. This is the first user-facing
release and should replace the current Image Studio default workspace.

### Slice C: Creative Director

Includes Phase 4. It adds assisted briefs, optional research, and directions.

### Slice D: Precision Iteration

Includes Phase 5. It adds active documents and version branches.

### Slice E: Campaign Separation and Cleanup

Includes Phases 6 and 7.

## Release Gates

Every slice must pass:

- focused unit and component tests
- `npx vitest run tests/ai-image-studio`
- `npm run build`
- browser verification of the affected desktop flow
- browser verification at one mobile viewport
- generation request inspection for product identity preservation

Do not remove compatibility state or components until their replacement passes the
same behavioral tests.

