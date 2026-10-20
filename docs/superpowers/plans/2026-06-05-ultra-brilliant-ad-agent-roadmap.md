# Ultra-Brilliant Ad Agent Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a measurable, evidence-grounded, self-correcting advertising intelligence layer.

**Architecture:** Add an evidence graph and structured decision record before creative planning, then add best-of-N concept selection and specialist critics at high-risk gates. Improve through trace-based continuous evaluation rather than uncontrolled agent complexity.

**Tech Stack:** TypeScript, React, Gemini structured outputs and multimodal APIs, Vitest, existing ReelAI agent runtime

---

## Milestone 1: Intelligence Baseline And Evals

### Task 1: Golden Evaluation Dataset

**Files:**
- Create: `evals/ad-agent/cases.json`
- Create: `evals/ad-agent/rubric.ts`
- Create: `tests/ad-agent/intelligenceBaseline.test.ts`

- [ ] Add at least 30 cases covering format requests, ingestible versus topical products, sparse product pages, conflicting references, unsupported claims, and brand drift.
- [ ] Implement deterministic graders for format accuracy, claim citations, intended use, reference limits, and structured output validity.
- [ ] Record current baseline scores before architecture changes.

### Task 2: Trace And Decision Record

**Files:**
- Create: `services/adIntelligence/types.ts`
- Create: `services/adIntelligence/decisionTraceService.ts`
- Modify: `services/autonomousAgent.ts`
- Test: `tests/ad-agent/decisionTraceService.test.ts`

- [ ] Define structured run, research, decision, concept, scene, critic, and generation trace types.
- [ ] Persist a trace for every run and link all creative decisions to trace IDs.
- [ ] Add trace completeness graders.

## Milestone 2: Evidence-Grounded Core

### Task 3: Evidence Graph

**Files:**
- Create: `services/adIntelligence/evidenceGraph.ts`
- Create: `services/adIntelligence/evidenceExtractionService.ts`
- Modify: `services/productPageImportService.ts`
- Test: `tests/ad-agent/evidenceGraph.test.ts`

- [ ] Extract visible product facts, product structured data, intended use, approved claims, warnings, and source metadata.
- [ ] Model support, contradiction, applicability, and provenance edges.
- [ ] Add freshness and confidence rules.

### Task 4: Claim And Intended-Use Gate

**Files:**
- Create: `services/adIntelligence/evidenceGate.ts`
- Modify: `services/autonomousAgent.ts`
- Test: `tests/ad-agent/evidenceGate.test.ts`

- [ ] Validate every verbal, textual, and visual claim against graph evidence.
- [ ] Block incorrect product-use scenes.
- [ ] Reject unsupported claims before image generation.

### Task 5: Format Lock And Native Planners

**Files:**
- Create: `services/adIntelligence/planners/`
- Modify: `services/autonomousAgent.ts`
- Modify: `services/formatRouter.ts`
- Test: `tests/ad-agent/formatNativePlanning.test.ts`

- [ ] Create separate planners for static, carousel, Reels, TikTok, Shorts, and Veo/video.
- [ ] Validate platform constraints and lock the confirmed output format.
- [ ] Add planner-specific scorecards.

## Milestone 3: Concept Intelligence

### Task 6: Distinct Concept Generator

**Files:**
- Create: `services/adIntelligence/conceptGenerator.ts`
- Test: `tests/ad-agent/conceptGenerator.test.ts`

- [ ] Generate product-led, audience-led, and culture/platform-led concepts.
- [ ] Require distinct proposition, hook, narrative device, and visual direction.
- [ ] Cite graph evidence in every concept.

### Task 7: Pairwise Concept Judge

**Files:**
- Create: `services/adIntelligence/conceptJudge.ts`
- Modify: `services/autonomousAgent.ts`
- Test: `tests/ad-agent/conceptJudge.test.ts`

- [ ] Compare concepts pairwise using a fixed rubric.
- [ ] Randomize comparison order to reduce position bias.
- [ ] Apply hard evidence and intended-use failures before scoring.
- [ ] Show chosen and rejected concept rationale in the UI.

### Task 8: Specialist Critics

**Files:**
- Create: `services/adIntelligence/critics/`
- Test: `tests/ad-agent/critics.test.ts`

- [ ] Implement evidence, brand, and platform critics with structured pass/fail outputs.
- [ ] Run critics only at planning approval and pre-production gates.
- [ ] Track critic disagreement and compare it against human decisions.

## Milestone 4: Visual Self-Correction

### Task 9: Visual Critic

**Files:**
- Create: `services/adIntelligence/visualCritic.ts`
- Modify: `services/autonomousAgent.ts`
- Test: `tests/ad-agent/visualCritic.test.ts`

- [ ] Review generated scenes against product references, evidence, scene intent, and assigned creative references.
- [ ] Detect product drift, label corruption, incorrect use, unsupported outcomes, and scene mismatch.
- [ ] Return targeted correction instructions.

### Task 10: Targeted Regeneration Loop

**Files:**
- Create: `services/adIntelligence/regenerationPolicy.ts`
- Modify: `services/autonomousAgent.ts`
- Test: `tests/ad-agent/regenerationPolicy.test.ts`

- [ ] Regenerate only failed scenes.
- [ ] Cap retries and stop on repeated architectural failure.
- [ ] Track quality gain, latency, and generation cost.

## Milestone 5: Learning Flywheel

### Task 11: Typed Brand Memory

**Files:**
- Create: `services/adIntelligence/brandMemoryService.ts`
- Migrate: `services/agentMemory.ts`
- Test: `tests/ad-agent/brandMemoryService.test.ts`

- [ ] Separate immutable brand truth, approved preferences, rejected directions, and performance signals.
- [ ] Require explicit approval or repeated evidence before promoting memory.

### Task 12: Continuous Evaluation Dashboard

**Files:**
- Create: `components/AdAgentEvalDashboard.tsx`
- Create: `services/adIntelligence/evalRunner.ts`
- Test: `tests/ad-agent/evalRunner.test.ts`

- [ ] Run the golden dataset against every intelligence change.
- [ ] Display regression, quality, cost, and latency trends.
- [ ] Mine production traces and user feedback into candidate eval cases.

## Release Gates

- [ ] Milestone 1 ships only after baseline results are recorded.
- [ ] Milestone 2 ships only after known incorrect-use and format-routing cases pass.
- [ ] Milestone 3 ships only if pairwise human preference improves over Milestone 2.
- [ ] Milestone 4 ships only if visual pass rate improves without unacceptable cost and latency.
- [ ] Milestone 5 ships only after memory promotion rules prevent accidental brand-truth corruption.
