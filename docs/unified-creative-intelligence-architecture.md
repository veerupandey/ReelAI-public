# Unified Creative Intelligence Architecture

## Objective

Add an intuitive AI assistant around ReelAI's working image-generation engine.

The existing engine remains responsible for:

- fresh image generation
- generation from locked product references
- multi-product composite generation
- image editing
- output format and aspect ratio

The new Creative Intelligence layer researches the brand and market, proposes concepts,
and prepares ready-to-generate image or social-post briefs using the current locked
references and generation capabilities.

## Product Principles

1. **Preserve the proven engine.** Research and planning enrich generation requests;
   they do not replace reference handling, composition, editing, or format selection.
2. **One shared creative session.** Brand knowledge, trend research, concepts, locked
   references, prompts, and social-post settings are available to every assistant mode.
3. **Evidence is inspectable.** Brand and trend claims retain sources, timestamps,
   confidence, and verification status.
4. **User selection is the commitment point.** The assistant proposes concepts; it
   builds a production prompt only after the user selects a concept.
5. **Product Truth is authoritative.** Trends and aesthetics cannot override verified
   product facts or preservation rules.
6. **Structured inputs remain structured.** Locked images, typography, social layout,
   and format settings are not flattened into an opaque text prompt.
7. **Progressive disclosure.** The default creation UI stays simple. Advanced research
   and evidence appear in one assistant panel when requested.

## Information Architecture

```text
Image Studio
├── Asset rail
│   ├── locked product references
│   ├── included subjects
│   ├── style references
│   └── composition references
├── Result canvas
├── Composer
│   ├── user direction
│   ├── locked reference chips
│   ├── format
│   └── Generate
└── Creative Assistant
    ├── Concepts
    ├── Brand
    ├── Trends
    └── Social Post
```

The Creative Assistant is a collapsible right panel on desktop and a full-height sheet
on mobile. Only one assistant mode is open at a time.

## Primary User Flow

```text
Lock product/images or write rough direction
                    ↓
Assistant analyzes available shared context
                    ↓
Optionally research Brand and/or Trends
                    ↓
Assistant proposes 3-5 distinct concept cards
                    ↓
User selects one concept
                    ↓
Assistant creates an inspectable production brief
                    ↓
Generate image or open Social Post mode
                    ↓
Generate through the existing image engine
```

Users can always skip research and generate directly.

## Canonical Creative Session

The reducer-backed Image Studio session is the only canonical client-side state owner.
No Brand, Trend, or Social component owns a disconnected copy of shared knowledge.

```ts
interface CreativeSessionContext {
  productTruth?: ProductTruth;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  conceptCandidates: CreativeConcept[];
  selectedConceptId?: string;
  socialPostDraft?: SocialPostDraft;

  userDirection: string;
  composerReferences: ComposerReference[];
  outputFormat: AspectRatio;
}
```

Changing Brand Knowledge invalidates brand-dependent Trend Research, concepts, and
Social Post drafts. It does not delete Product Truth, locked references, or user input.

## Knowledge Model

### Product Truth

Product Truth is the highest-authority record:

```ts
interface ProductTruth {
  id: string;
  productName: string;
  protectedAssetIds: string[];
  preservationRules: string[];
  verifiedFacts: string[];
  unresolvedQuestions: string[];
  userCorrections: string[];
}
```

It controls exact product identity, packaging, labels, proportions, and approved facts.

### Brand Knowledge

```ts
type EvidenceStatus = 'verified' | 'inferred' | 'user_confirmed' | 'rejected';

interface EvidenceSource {
  id: string;
  url?: string;
  assetId?: string;
  label: string;
  capturedAt: string;
}

interface EvidenceValue<T> {
  value: T;
  status: EvidenceStatus;
  confidence: number;
  sourceIds: string[];
}

interface BrandFont {
  family: string;
  role: 'display' | 'heading' | 'body' | 'accent';
  weights: number[];
  source: 'website_css' | 'uploaded_font' | 'google_fonts' | 'visual_inference';
  loadUrl?: string;
  licenseNotes?: string;
}

interface BrandKnowledge {
  id: string;
  brandName: EvidenceValue<string>;
  sourceUrls: string[];
  sources: EvidenceSource[];
  fonts: EvidenceValue<BrandFont>[];
  colors: EvidenceValue<string>[];
  logoRules: EvidenceValue<string>[];
  visualPrinciples: EvidenceValue<string>[];
  toneAttributes: EvidenceValue<string>[];
  approvedLanguage: EvidenceValue<string>[];
  prohibitedLanguage: EvidenceValue<string>[];
  imageStyle: {
    lighting: EvidenceValue<string>[];
    composition: EvidenceValue<string>[];
    backgrounds: EvidenceValue<string>[];
    textures: EvidenceValue<string>[];
  };
  updatedAt: string;
}
```

Exact fonts are marked verified only when discovered from website CSS/font files,
uploaded brand guidelines, or user confirmation. Visual font guesses remain inferred
and should include suggested substitutes.

### Trend Research

```ts
interface TrendInsight {
  id: string;
  title: string;
  description: string;
  applicability: string;
  risk: string;
  confidence: number;
  sourceIds: string[];
}

interface TrendResearchResult {
  id: string;
  brandKnowledgeId?: string;
  query: string;
  platform?: SocialPlatform;
  objective?: SocialObjective;
  researchedAt: string;
  expiresAt: string;
  sources: EvidenceSource[];
  insights: TrendInsight[];
}
```

Trend results expire because freshness is part of correctness. The default validity
window should be configurable, initially 14 days.

### Creative Concept

```ts
interface CreativeConcept {
  id: string;
  title: string;
  oneLineIdea: string;
  visualDirection: string;
  hook?: string;
  brandFitRationale: string;
  trendFitRationale?: string;
  productTruthNotes: string[];
  suggestedReferenceRoles: Array<{
    assetId: string;
    role: ComposerReferenceRole;
    instructions?: string;
  }>;
  sourceTrendInsightIds: string[];
  status: 'candidate' | 'selected' | 'rejected';
}
```

Concepts are concise decision objects, not full prompts.

### Social Post Draft

```ts
type SocialPlatform = 'instagram_feed' | 'instagram_story' | 'pinterest';
type SocialObjective = 'awareness' | 'engagement' | 'conversion' | 'education';

interface SocialPostDraft {
  id: string;
  platform: SocialPlatform;
  objective: SocialObjective;
  selectedConceptId?: string;
  heroAssetId: string;
  supportingAssetIds: string[];
  aspectRatio: AspectRatio;
  layout: {
    templateId: string;
    safeZones: string[];
    logoPlacement?: string;
  };
  typography: {
    headingFont?: BrandFont;
    bodyFont?: BrandFont;
  };
  copy: {
    headline: string;
    supportingText?: string;
    caption: string;
    callToAction?: string;
    hashtags: string[];
  };
  generationBrief: string;
}
```

This is a ready-to-review post specification. It remains editable before generation.

## Research Architecture

### Brand Research Pipeline

```text
URLs + uploaded assets + optional brand guidelines
        ↓
Source acquisition
        ├── website HTML and visible copy
        ├── CSS variables and computed styles
        ├── @font-face declarations and font metadata
        ├── logos and product imagery
        └── grounded web research
        ↓
Evidence extraction
        ↓
Conflict resolution and confidence scoring
        ↓
User confirmation for uncertain/high-impact values
        ↓
Persist Brand Knowledge
```

Implementation rules:

- Prefer CSS and font metadata over visual font inference.
- Verify Google-hosted families through the Google Fonts metadata API.
- Do not download or redistribute proprietary fonts without appropriate rights.
- Preserve source URLs and captured timestamps for every verified value.
- Separate brand claims from Product Truth until explicitly verified.

### Trend Research Pipeline

```text
Product Truth + Brand Knowledge + locked references + user direction
        + platform + objective
                            ↓
Research query planner
                            ↓
Grounded current-web research
                            ↓
Evidence normalization and deduplication
                            ↓
Brand/product applicability assessment
                            ↓
3-5 concept candidates
```

Trend Analysis must answer:

1. What is currently relevant for this category, platform, and objective?
2. Which findings fit this brand?
3. Which findings conflict with Product Truth or brand rules?
4. How can each applicable finding become a distinct visual concept?

Use grounded search metadata and citations. Never present an unsourced current trend as
verified evidence.

## Assistant Orchestration

Use explicit services, not one unconstrained autonomous agent:

```text
BrandResearchService
  → produces BrandKnowledge

TrendResearchService
  → produces TrendResearchResult

ConceptDirectorService
  → produces CreativeConcept[]

ProductionBriefService
  → converts selected concept into inspectable generation brief

SocialPostDirectorService
  → produces SocialPostDraft

StudioGenerationRequestBuilder
  → maps approved context + structured references into existing engine request
```

Each service receives typed input and returns validated structured output. This makes
errors visible, supports tests, and prevents assistant modes from silently changing
generation behavior.

## Generation Request Precedence

When building the final production request:

1. Product Truth preservation rules and verified facts
2. Explicit user direction
3. Locked references and assigned roles
4. User-selected concept
5. Confirmed Brand Knowledge
6. Applicable Trend Research
7. Output-specific social layout and copy

Lower-priority context cannot contradict higher-priority context.

```ts
interface CreativeGenerationInput {
  userDirection: string;
  productTruth?: ProductTruth;
  brandKnowledge?: BrandKnowledge;
  selectedConcept?: CreativeConcept;
  trendResearch?: TrendResearchResult;
  socialPostDraft?: SocialPostDraft;
  references: ComposerReference[];
  assets: StudioAsset[];
  aspectRatio: AspectRatio;
}
```

The request builder produces:

- a transparent production prompt;
- existing structured image references;
- preservation instructions;
- exact aspect ratio;
- social layout/copy instructions when relevant.

## Intuitive UI Specification

### Default Create State

The result canvas remains dominant. The user always sees:

- locked-reference chips with roles;
- editable prompt;
- format selector;
- Generate action;
- compact assistant trigger.

### Assistant Panel

Header:

```text
Creative Assistant
[Concepts] [Brand] [Trends] [Social]
Context: 2 locked · Brand active · Trends fresh
```

#### Concepts

- Primary action: `Suggest concepts`
- Inputs are summarized, not repeated as a large form.
- Show 3-5 concept cards with:
  - title and one-line idea;
  - brand-fit indicator;
  - trend evidence indicator;
  - locked references to be used;
  - `Select concept`.
- Selecting a concept reveals an editable production brief and `Use in composer`.

#### Brand

- Primary action: `Research brand`
- Show compact sections: Fonts, Colors, Voice, Visual Style, Logo Rules.
- Every item displays `Verified`, `Inferred`, or `Needs confirmation`.
- User can confirm, edit, reject, and refresh research.
- Persistent compact badge appears in Create when active.

#### Trends

- Primary action: `Research relevant trends`
- User optionally selects platform and objective.
- Show evidence cards with source links, freshness, applicability, and risk.
- Actions: `Create concept from this` and `Exclude`.

#### Social

- Requires one hero locked image.
- Automatically uses Brand Knowledge, relevant Trend Research, selected concept, and all
  locked references.
- Three-step progressive form:
  1. Platform and objective
  2. Suggested layouts and copy
  3. Review ready-to-post specification
- Final action: `Generate social post`

### Empty And Partial States

- No locked image: explain that concepts can still be suggested, but social generation
  needs a hero image.
- No Brand Knowledge: offer Brand Research but allow trend analysis and social creation.
- No Trend Research: social post creation remains available and clearly says it uses
  brand context only.
- Research failure: retain existing knowledge and show retry; never clear working state.

## Persistence And Invalidation

| Event | Invalidate | Preserve |
|---|---|---|
| Brand Knowledge changes | trend research, concepts, social draft | product truth, references, user direction |
| Product Truth changes | concepts, social draft | brand knowledge, references, user direction |
| Locked references change | concepts, social draft | brand knowledge, trend research, user direction |
| User direction changes | generated concepts marked stale | all research and references |
| Trend research expires | trend-backed concepts marked stale | brand, product truth, references |
| Selected concept changes | production brief, social draft | research and references |

Stale items remain visible with a warning until refreshed or explicitly reused.

## Repository Mapping

Reuse and extend:

- `components/AIImageStudio/types.ts`: canonical shared types.
- `components/AIImageStudio/useStudioReducer.ts`: state, invalidation, persistence.
- `components/AIImageStudio/studioService.ts`: final request boundary.
- `components/AIImageStudio/productTruthService.ts`: authoritative product constraints.
- `components/AIImageStudio/ProductResearcher.tsx`: evolve into Brand assistant UI.
- `components/AIImageStudio/TrendResearchCopilot.tsx`: evolve into Trend assistant UI.
- `components/AIImageStudio/SocialPostDesigner.tsx`: evolve into structured social draft UI.
- `services/geminiService.ts`: grounded research calls.

Add:

- `components/AIImageStudio/CreativeAssistantPanel.tsx`
- `components/AIImageStudio/brandKnowledgeService.ts`
- `components/AIImageStudio/trendResearchService.ts`
- `components/AIImageStudio/conceptDirectorService.ts`
- `components/AIImageStudio/socialPostDirectorService.ts`
- `components/AIImageStudio/productionBriefService.ts`
- corresponding service and component tests

## Delivery Phases

### Phase 1: Shared Intelligence Foundation

- Complete canonical shared state and invalidation rules.
- Add evidence-bearing Brand Knowledge types.
- Add typed concepts and Social Post Draft.
- Keep all generation behavior unchanged.

### Phase 2: Brand Knowledge

- Extract website/CSS/font evidence.
- Add grounded brand research and provenance.
- Build verification UI.

### Phase 3: Trend Analysis And Concepts

- Add grounded trend research with freshness.
- Generate and select concept cards.
- Create inspectable production briefs.

### Phase 4: Social Post Generator

- Build structured ready-to-post drafts.
- Generate through the existing engine.
- Add platform format presets and safe-zone review.

### Phase 5: Unified Assistant UI

- Consolidate Brand, Trends, Concepts, and Social into one responsive panel.
- Remove disconnected inline panels and hardcoded brand values.
- Run usability validation on direct-generation and assisted-generation flows.

## Quality Gates

1. Direct image generation behaves exactly as before.
2. Brand research values display evidence and verification status.
3. Exact fonts are never claimed from visual inference alone.
4. Trend results include sources and freshness.
5. User selection is required before a concept becomes a production brief.
6. Social drafts automatically receive shared brand, trend, concept, and reference data.
7. User text is never silently overwritten.
8. Product Truth always wins in request-conflict tests.
9. All assistant workflows remain usable when optional research is absent or fails.
