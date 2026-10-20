# Brand Ad Agent Checklist

## Phase 0: Architecture Foundation
- [x] Define `CampaignBrief`, `BrandMemory`, `AssetGraph`, `SceneContract`, and `RenderManifest` domain contracts.
- [x] Define `SkillSpec`, `WorkerProfile`, and `TaskContract`.
- [x] Introduce a skill registry and worker-profile registry.
- [x] Make the planner execution-mode aware (`fast`, `balanced`, `agency`).
- [x] Make the UI collect structured campaign intent instead of only freeform brief text.

Acceptance:
- The agent flow can accept platform, objective, duration, execution mode, audience, and CTA.
- Subagents run with declared skills, tool allowlists, and hard constraints.

## Phase 1: Brand Memory and URL Import
- [ ] Create a dedicated URL import service for Shopify, Amazon, and generic product pages.
- [ ] Extract product title, gallery, claims, price cues, benefits, and visible proof.
- [ ] Merge imported site signals with uploaded assets into stable `assetId` records.
- [x] Persist `BrandMemory` instead of only raw `BrandDNA`.

Acceptance:
- A product URL produces usable product facts and asset candidates before creative planning.
- Uploaded assets and imported assets share one canonical asset graph.

## Phase 2: Scene Contract Pipeline
- [x] Replace ad-scene-only planning with true `SceneContract` generation.
- [ ] Add source binding modes: exact, crop, edit, generate matching, fresh.
- [ ] Preserve asset lineage when scenes are regenerated or edited.
- [x] Promote scene contracts into the existing Reel plan/script pipeline.

Acceptance:
- Every scene declares a role, duration target, source mode, and asset bindings.
- Product scenes prefer uploaded/imported assets over invented visuals.

## Phase 3: Skills and Bounded Subagents
- [x] Add skill routing for brand import, competitor analysis, TikTok/Reels/Shorts direction, duration fit, and creative QA.
- [x] Restrict workers to orchestrator-issued task contracts only.
- [x] Add bounded write scopes and rejection of malformed or out-of-scope tasks.
- [x] Separate privileged workers from normal Flash workers.

Acceptance:
- Workers cannot run without an orchestrator task contract.
- Skills are visible and traceable per task.

## Phase 4: Media Production
- [ ] Add scene workers for image editing and source-preserving image generation.
- [ ] Add scene/video workers for trim, split, extend, and continuity-aware motion.
- [ ] Add parallel voice workers with duration capture.
- [ ] Add caption sync worker based on actual scene/voice timing.

Acceptance:
- Image edits keep lineage to the original uploaded asset.
- Voice and captions align to resolved scene durations.

## Phase 5: Deterministic Preview and Export
- [ ] Freeze preview/export from a `RenderManifest`.
- [ ] Add export preflight blockers for stale scenes, overflow, and missing bindings.
- [ ] Ensure preview and download use identical timing data.
- [ ] Add retryable export without full page refresh.

Acceptance:
- Download output matches preview timing.
- Export fails only with explicit blockers and actionable reasons.

## Phase 6: End-to-End Vertical Slice
- [ ] Support this full path: URL + uploads + logo + 30s TikTok ad.
- [ ] Produce a reviewed concept, bound scenes, editable visuals, voice, captions, and export.
- [ ] Validate `fast`, `balanced`, and `agency` modes against latency expectations.

Acceptance:
- The brand ad flow is usable end to end without fallbacking to the legacy text-to-reel path for the first happy path.
