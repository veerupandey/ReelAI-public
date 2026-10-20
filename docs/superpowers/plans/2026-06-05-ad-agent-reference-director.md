# Ad Agent Creative Reference Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add research-led custom image references to the autonomous ad agent.

**Architecture:** A focused reference-director service classifies uploads and assigns them per scene. The console owns file input; the autonomous agent owns planning visibility and generation grounding.

**Tech Stack:** React, TypeScript, Gemini multimodal API, Vitest

---

### Task 1: Reference Director

**Files:**
- Create: `services/creativeReferenceDirector.ts`
- Test: `tests/creativeReferenceDirector.test.ts`

- [ ] Write failing tests for classification, maximum reference count, avoid-reference handling, and role-aware assignment.
- [ ] Run `npx vitest run tests/creativeReferenceDirector.test.ts` and verify failure.
- [ ] Implement reference types, fallback classification, analysis prompt, and scene assignment.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Upload UI

**Files:**
- Modify: `components/AgentConsole.tsx`
- Test: `tests/agentLaunchConfig.test.ts`

- [ ] Add a reusable file-to-base64 helper test.
- [ ] Add multi-image upload, preview, note editing, and removal controls.
- [ ] Pass uploaded references into `AutonomousAgent.run`.
- [ ] Run focused tests.

### Task 3: Planning And Generation

**Files:**
- Modify: `services/autonomousAgent.ts`
- Test: `tests/creativeReferenceDirector.test.ts`

- [ ] Analyze references after product research.
- [ ] Inject reference summaries into scene and carousel planning.
- [ ] Assign references to scenes and display rationale.
- [ ] Use composite image generation with imported product plus selected uploaded references.
- [ ] Ensure avoid references only become text constraints.
- [ ] Run focused tests.

### Task 4: Verification

- [ ] Run `npx vitest run tests/creativeReferenceDirector.test.ts tests/agentLaunchConfig.test.ts tests/campaign-manager/unit/contentExecutor.test.ts`.
- [ ] Run `npm run build`.
- [ ] Review the diff for unrelated changes and report existing full-suite failures separately.
