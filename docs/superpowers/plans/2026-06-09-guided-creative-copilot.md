# Guided Creative Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disconnected Brand, Trends, Concepts, and Social primary workflow with one guided Copilot that researches context, creates grounded concepts and prompts, then creates social posts from locked images.

**Architecture:** Add a focused orchestration service that composes the existing brand, trend, concept, and social services without duplicating their logic. Replace the assistant panel's primary navigation with two stages: Creative Research and Social Post, while preserving Brand and Trend evidence in expandable details.

**Tech Stack:** React 19, TypeScript, Vitest, existing reducer and AI Image Studio services.

---

### Task 1: Copilot orchestration service

**Files:**
- Create: `components/AIImageStudio/creativeCopilotService.ts`
- Test: `tests/ai-image-studio/creativeCopilotService.test.ts`

- [ ] Write a failing test proving one orchestration call returns brand knowledge, trend research, grounded concepts, and a ready prompt.
- [ ] Run the focused test and confirm it fails because the service does not exist.
- [ ] Implement `runCreativeCopilot` using `researchBrand`, `researchTrends`, and `generateConcepts`.
- [ ] Ensure concept prompts explicitly include product, brand, market, and selected trend context.
- [ ] Run focused tests.

### Task 2: Guided Copilot UI

**Files:**
- Create: `components/AIImageStudio/GuidedCreativeCopilot.tsx`
- Modify: `components/AIImageStudio/CreativeAssistantPanel.tsx`
- Test: `tests/ai-image-studio/GuidedCreativeCopilot.test.tsx`

- [ ] Write failing UI tests for the single Research & Create Concepts action and concept selection.
- [ ] Implement guided inputs, progress stages, concept review, prompt application, and expandable research details.
- [ ] Retain existing evidence panels inside Research Details.
- [ ] Run focused tests.

### Task 3: Guided social workflow

**Files:**
- Modify: `components/AIImageStudio/GuidedCreativeCopilot.tsx`
- Test: `tests/ai-image-studio/GuidedCreativeCopilot.test.tsx`

- [ ] Write failing tests proving locked images unlock social draft creation.
- [ ] Implement Create Social Post From Locked Images using existing shared brand, trend, selected concept, and references.
- [ ] Preserve editable social draft and Generate Social Post behavior.
- [ ] Run focused tests.

### Task 4: Verification

**Files:**
- Modify only files required by failures.

- [ ] Run `npx vitest run tests/ai-image-studio`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run build`.
