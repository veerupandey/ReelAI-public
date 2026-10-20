# Social Art Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an intelligent social art-direction stage that chooses the visual treatment and decides whether exact validated on-image text improves the post.

**Architecture:** Introduce a focused `socialArtDirectorService` that consumes existing brand, product, trend, concept, and locked-image context and returns a structured plan. The social draft service will validate and store that plan, while the generation pipeline will allow exact text only when the plan explicitly selects it.

**Tech Stack:** TypeScript, React, Gemini `@google/genai`, Vitest

---

### Task 1: Define And Validate Social Art Direction

**Files:**
- Create: `components/AIImageStudio/socialArtDirectorService.ts`
- Create: `tests/ai-image-studio/socialArtDirectorService.test.ts`
- Modify: `components/AIImageStudio/types.ts`

- [ ] **Step 1: Write failing tests for text-free and text-bearing plans**

Test that validation removes text when `textDecision` is `none`, rejects internal language, removes educational conversion CTAs, and preserves exact safe headline text.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/ai-image-studio/socialArtDirectorService.test.ts`

Expected: FAIL because the service and plan types do not exist.

- [ ] **Step 3: Add structured plan types**

Add `SocialArtDirectionPlan` with visual strategy, rationale, composition, locked-image treatment, `textDecision`, exact visible text, placement, typography, CTA placement, confidence, and warnings.

- [ ] **Step 4: Implement deterministic plan validation**

Implement `validateSocialArtDirectionPlan(plan, input)` so unsafe or contradictory text falls back to `textDecision: 'none'`, with no visible text or on-image CTA.

- [ ] **Step 5: Run the focused test**

Run: `npx vitest run tests/ai-image-studio/socialArtDirectorService.test.ts`

Expected: PASS.

### Task 2: Generate Plans From Complete Creative Context

**Files:**
- Modify: `components/AIImageStudio/socialArtDirectorService.ts`
- Modify: `tests/ai-image-studio/socialArtDirectorService.test.ts`

- [ ] **Step 1: Write failing context tests**

Test that the planner prompt contains original user goal, brand fonts and aesthetics, verified facts, locked-image analysis, selected concept, and only relevant trend evidence. Test that it instructs the model to choose text-free output when appropriate.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run tests/ai-image-studio/socialArtDirectorService.test.ts`

Expected: FAIL because planning prompt generation is missing.

- [ ] **Step 3: Implement planner prompt and Gemini generation**

Add `buildSocialArtDirectorPrompt` and `directSocialPost`, returning a validated structured plan. Use a low temperature and require JSON. Provide a deterministic text-free fallback when provider generation fails.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/ai-image-studio/socialArtDirectorService.test.ts`

Expected: PASS.

### Task 3: Integrate The Plan Into Social Draft Creation

**Files:**
- Modify: `components/AIImageStudio/socialPostDirectorService.ts`
- Modify: `components/AIImageStudio/types.ts`
- Modify: `tests/ai-image-studio/socialPostDirectorService.test.ts`

- [ ] **Step 1: Write failing integration tests**

Test that `createSocialPostDraft` calls art direction before copy/layout finalization, stores the plan on the draft, and uses the plan's exact visible text instead of concept rationale or generic copy.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run tests/ai-image-studio/socialPostDirectorService.test.ts`

Expected: FAIL because drafts do not contain art direction.

- [ ] **Step 3: Add the plan to `SocialPostDraft` and draft creation**

Use the plan's composition, text decision, exact text, typography, and CTA placement. Keep caption and hashtags publish-only.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run tests/ai-image-studio/socialPostDirectorService.test.ts`

Expected: PASS.

### Task 4: Enforce Exact Text Decisions During Image Generation

**Files:**
- Modify: `components/AIImageStudio/studioService.ts`
- Modify: `components/AIImageStudio/creativeContextService.ts`
- Modify: `tests/ai-image-studio/studioService.test.ts`
- Modify: `tests/ai-image-studio/creativeContextService.test.ts`

- [ ] **Step 1: Write failing generation tests**

Test that text-free plans produce no `allowedOnImageText` and explicitly prohibit generated text. Test that text-bearing plans allow only the exact validated strings from the art-direction plan.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run tests/ai-image-studio/studioService.test.ts tests/ai-image-studio/creativeContextService.test.ts`

Expected: FAIL because generation still reads copy fields directly.

- [ ] **Step 3: Update production prompt and allowed-text logic**

Read on-image text only from the validated art-direction plan. Add an explicit no-text instruction when `textDecision` is `none`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/ai-image-studio/studioService.test.ts tests/ai-image-studio/creativeContextService.test.ts`

Expected: PASS.

### Task 5: Show The Art Direction Decision In The UI

**Files:**
- Modify: `components/AIImageStudio/GuidedCreativeCopilot.tsx`
- Modify: `tests/ai-image-studio/assistantWorkflow.test.ts`

- [ ] **Step 1: Write failing workflow assertions**

Test that progress includes the art-direction and validation stages and that the resulting draft exposes visual strategy, text/no-text decision, exact visible copy, typography, and warnings.

- [ ] **Step 2: Run workflow tests**

Run: `npx vitest run tests/ai-image-studio/assistantWorkflow.test.ts`

Expected: FAIL because the UI and draft do not expose the decision.

- [ ] **Step 3: Add progress and draft review UI**

Show the plan before generation and clearly label text-free decisions. Keep the Generate button available only after a validated plan exists.

- [ ] **Step 4: Run workflow tests**

Run: `npx vitest run tests/ai-image-studio/assistantWorkflow.test.ts`

Expected: PASS.

### Task 6: Full Verification

**Files:**
- Verify all changed files

- [ ] **Step 1: Run AI Image Studio tests**

Run: `npx vitest run tests/ai-image-studio`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS, with only the existing bundle-size warning.
