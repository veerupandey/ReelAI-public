# Ultra-Brilliant Autonomous Ad Agent

## Objective

Build an ad agent that produces brand-specific, evidence-grounded, format-native creative and continuously improves from reviews and campaign outcomes.

## Research Conclusions

1. Intelligence must be measured. Evaluation guidance recommends task-specific evals, production-derived datasets, trace grading, pairwise comparisons, and human calibration.
2. Multi-agent systems should not be the default. Add specialist agents only where evals show a single workflow fails or where a high-risk decision needs independent review.
3. Structured outputs improve reliable orchestration, but application code must still validate semantic correctness.
4. Product and advertising claims require evidence before publication. Product-page structured data, visible page content, and approved brand data should become first-class evidence.
5. Platform-native and meaningfully different creative variants are more valuable than small cosmetic variations. TikTok recommends 3-5 creatives with big differences and continuous testing.
6. Generated creative needs explicit provenance, reference assignments, decision rationale, and review traces.

## Core Architecture

### 1. Evidence Graph

Create a structured graph before planning creative.

Node types:

- brand fact
- product fact
- approved claim
- prohibited claim
- intended use
- audience insight
- competitor pattern
- platform convention
- trend signal
- uploaded reference
- historical performance signal

Every node stores source, captured date, confidence, freshness, and supporting excerpt or asset.

Edges represent relationships such as:

- supports claim
- contradicts claim
- applies to audience
- relevant to platform
- derived from reference
- succeeded for brand
- rejected by user

Creative decisions must cite evidence-node IDs. Unsupported decisions are rejected or explicitly labeled as hypotheses.

### 2. Creative Decision Record

Every run produces a structured record:

- objective and target audience
- selected format and reason
- campaign insight
- single-minded proposition
- concept territories considered
- chosen concept and rejected concepts
- scene/slide purpose
- evidence used per claim
- reference assignment per scene
- platform rules applied
- expected performance hypothesis

This becomes the trace used for review, debugging, and learning.

### 3. Best-of-N Concept Competition

Generate three meaningfully different concept territories:

- product/evidence-led
- audience/problem-led
- culture/platform-native

Concepts must differ in proposition, hook, narrative device, and visual direction. A judge performs pairwise comparisons using a fixed rubric:

- evidence correctness
- brand distinctiveness
- audience relevance
- platform nativeness
- clarity
- originality
- conversion potential
- production feasibility

The winning concept proceeds. Scores never override hard failures such as incorrect product use or unsupported claims.

### 4. Specialist Critics At Decision Gates

Use independent critics only at these gates:

- Evidence critic: validates claims and intended use.
- Brand critic: validates brand distinctiveness and reference alignment.
- Platform critic: validates format, safe zones, pacing, sound, and native conventions.
- Visual critic: reviews generated assets for product drift and scene alignment.

Critics return structured pass/fail results with mandatory fixes. They do not independently run the campaign.

### 5. Format-Native Planners

Use separate planners and scorecards:

- static image: one-message hierarchy, visual stopping power, CTA
- carousel: sequential or modular slide logic, swipe incentive, standalone value
- Reels: 9:16, sound-on, safe-zone-aware, fast hook
- TikTok: creator-native, first-three-second proposition, hook/body/close
- Shorts: vertical, social-first, sound-on, concise action-oriented structure
- Veo/video: motion feasibility, continuity, audio, timing

Format selection must never silently change after user confirmation.

### 6. Visual Generation And Verification

Each scene receives:

- verified scene intent
- cited facts and allowed claims
- product identity reference
- at most two relevant creative references
- positive visual instructions
- user-rejected constraints

After generation, multimodal review checks:

- correct intended use
- exact product identity
- text and label integrity
- reference alignment
- brand consistency
- scene purpose
- prohibited visual implications

Failed scenes regenerate with the critic's specific correction.

### 7. Intelligence And Evaluation Flywheel

Create a versioned evaluation dataset from:

- known failures such as ingestible matcha applied to skin
- user-approved and rejected concepts
- production traces
- adversarial prompts
- format-routing cases
- product-identity drift cases

Track:

- format selection accuracy
- evidence citation precision and recall
- unsupported claim rate
- incorrect intended-use rate
- product identity pass rate
- reference assignment quality
- concept preference win rate
- human approval rate
- regeneration rate
- cost and latency

Run evals on every intelligence-layer change. Use pairwise judges for creative quality and deterministic checks for routing, citations, schemas, and limits.

### 8. Learning And Memory

Store four distinct memory types:

- immutable brand truth
- approved creative preferences
- rejected directions
- observed performance signals

Never promote a single user preference or campaign result into brand truth automatically. Require repeated evidence or explicit approval.

## Delivery Phases

### Phase 1: Evidence-Grounded Core

- Evidence graph and source extraction
- Structured decision records
- Claim and intended-use hard gates
- Format lock and format-native planners
- Baseline eval dataset

### Phase 2: Concept Intelligence

- Three concept territories
- Pairwise concept judge
- Creative strategy review UI
- Specialist evidence, brand, and platform critics

### Phase 3: Visual Self-Correction

- Scene-level multimodal visual critic
- Automated targeted regeneration
- Product identity and incorrect-use visual evals

### Phase 4: Learning Flywheel

- Trace storage and grading
- Approval/rejection learning
- Performance-data ingestion
- Brand-specific recommendations
- Continuous eval dashboard

## Non-Goals

- A large always-on multi-agent council
- Blindly following trends
- Automatically treating generated claims as approved
- Producing many near-identical variants
- Optimizing solely for an LLM-generated score

## Success Criteria

- Zero known incorrect-use regressions in the benchmark suite.
- At least 95% format-selection accuracy.
- At least 90% supported-claim precision before production.
- At least 90% product-identity visual pass rate.
- Meaningfully different concepts in at least 95% of three-concept runs.
- Improved human pairwise preference over the current agent without unacceptable cost or latency growth.
