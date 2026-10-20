/**
 * Data model types for the AI Image Studio.
 * Session-only state — no Supabase persistence.
 */

// ---------------------------------------------------------------------------
// Legacy types — DEPRECATED, will be removed after Phase 7
// ---------------------------------------------------------------------------

/** @deprecated Use StudioOperation inferred from context instead */
export type CreativeRoute = 'generate_fresh' | 'ai_upgrade' | 'composite' | 'edit';

/** Semantic role assigned to an asset in composite mode (legacy) */
export type ReferenceRole = 'product' | 'person' | 'environment' | 'style_guide';

/** Role and instructions for a reference asset in composite generation (legacy) */
export interface RoleAssignment {
  role: ReferenceRole;
  preserve?: string; // max 200 chars — what to keep
  modify?: string;   // max 200 chars — what to change
}

// ---------------------------------------------------------------------------
// New domain model — Phase 1 additions
// ---------------------------------------------------------------------------

/**
 * Width-to-height proportion / canvas id for generated images.
 * Social presets (`9:16`, `1:1`, …) plus pixel canvases (`1464x600`, `600x450`, custom `WxH`).
 * See `aspectRatioCatalog.ts` for labels, Gemini mapping, and Amazon A+ presets.
 */
export type AspectRatio = string;

/**
 * Explicit role for a composer reference.
 * - product: preserve recognizable identity, packaging, labels, colors, proportions
 * - include: place this subject or object in the output
 * - style: borrow palette, lighting, texture, and visual language only
 * - composition: follow framing or layout only
 */
export type ComposerReferenceRole = 'product' | 'include' | 'style' | 'composition';

/** Inferred studio operation derived from session state */
export type StudioOperation = 'generate' | 'edit' | 'composite';

/** A typed reference attached to the composer */
export interface ComposerReference {
  assetId: string;
  role: ComposerReferenceRole;
  strength?: number;       // 0–1 influence weight
  instructions?: string;   // max 200 chars
}

/** Persistent product identity and preservation rules — highest authority */
export interface ProductTruth {
  id: string;
  productName: string;
  protectedAssetIds: string[];
  preservationRules: string[];
  verifiedFacts: string[];
  unresolvedQuestions: string[];
  userCorrections: string[];
}

// ---------------------------------------------------------------------------
// Evidence-bearing Brand Knowledge types
// ---------------------------------------------------------------------------

export type EvidenceStatus = 'verified' | 'inferred' | 'user_confirmed' | 'rejected';

export interface EvidenceSource {
  id: string;
  url?: string;
  assetId?: string;
  label: string;
  capturedAt: string;
}

export interface EvidenceValue<T> {
  value: T;
  status: EvidenceStatus;
  confidence: number;
  sourceIds: string[];
}

export interface BrandFont {
  family: string;
  role: 'display' | 'heading' | 'body' | 'accent';
  weights: number[];
  source: 'website_css' | 'uploaded_font' | 'google_fonts' | 'visual_inference';
  loadUrl?: string;
  licenseNotes?: string;
}

/** Evidence-bearing brand knowledge — replaces BrandProfile */
export interface BrandKnowledge {
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

// ---------------------------------------------------------------------------
// Trend Research types
// ---------------------------------------------------------------------------

export type SocialPlatform = 'instagram_feed' | 'instagram_story' | 'pinterest';
export type SocialObjective = 'awareness' | 'engagement' | 'conversion' | 'education';

export interface TrendInsight {
  id: string;
  title: string;
  description: string;
  applicability: string;
  risk: string;
  confidence: number;
  sourceIds: string[];
}

/** Enhanced trend research with freshness and platform targeting */
export interface TrendResearchResult {
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

// ---------------------------------------------------------------------------
// Creative Concept types
// ---------------------------------------------------------------------------

/** A distinct creative concept proposed by the assistant */
export interface CreativeConcept {
  id: string;
  title: string;
  oneLineIdea: string;
  visualDirection: string;
  negativePrompt?: string;
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
  status: 'candidate' | 'selected' | 'rejected' | 'stale';
}

/** original = net-new brand post; recreate = adapt reference structure; hybrid = mix */
export type CreativeExecutionMode = 'original' | 'recreate' | 'hybrid';

/**
 * Visible strategist synthesis after research, before concept selection.
 * Distinct from ProductionBrief (post-concept, pre-generation).
 */
export interface StrategistBrief {
  id: string;
  campaignGoal: string;
  audience?: string;
  platform?: SocialPlatform;
  objective?: SocialObjective;
  executionMode: CreativeExecutionMode;
  summary: string;
  brandFit: string;
  productFit: string;
  trendAngles: string[];
  preservationPriorities: string[];
  creativeTerritories: string[];
  constraints: string[];
  openQuestions: string[];
  brandKnowledgeId?: string;
  trendResearchId?: string;
  productTruthId?: string;
  sourceInsightIds: string[];
  createdAt: string;
  userEdits?: string[];
}

/** @deprecated Use CreativeConcept instead */
export interface CreativeDirection {
  id: string;
  title: string;
  rationale: string;
  productionBrief: string;
  trendResearchId?: string;
}

// ---------------------------------------------------------------------------
// Social Art Direction types
// ---------------------------------------------------------------------------

/** Whether text should appear on the generated image */
export type TextDecision = 'none' | 'headline' | 'headline_supporting';

/** Where the call-to-action should be placed */
export type CTAPlacement = 'none' | 'caption_only' | 'on_image';

/** A single validated text entry for on-image display */
export interface VisibleTextEntry {
  content: string;
  role: 'headline' | 'supporting' | 'cta';
  placement: string;
  maxChars: number;
}

/** Structured art-direction plan produced before generation */
export interface SocialArtDirectionPlan {
  visualStrategy: string;
  rationale: string;
  composition: string;
  lockedImageTreatment: string;
  textDecision: TextDecision;
  visibleText: VisibleTextEntry[];
  typography: {
    headingFont: string;
    bodyFont: string;
  };
  ctaPlacement: CTAPlacement;
  confidence: number; // 0–1
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Social Post Draft types
// ---------------------------------------------------------------------------

/** Ready-to-review post specification — editable before generation */
export interface SocialPostDraft {
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
  artDirectionPlan?: SocialArtDirectionPlan;
}

export type OutputIntent = 'image' | 'social_post';

/** An active document opened for editing */
export interface StudioDocument {
  id: string;
  rootAssetId: string;
  activeVersionId: string;
  versionIds: string[];
}

/** A single generation attempt saved as a version node */
export interface GenerationVersion {
  id: string;
  parentVersionId?: string;
  outputAssetId: string;
  prompt: string;
  inferredOperation: StudioOperation;
  referenceSnapshot: ComposerReference[];
  productTruthId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Brand compliance review
// ---------------------------------------------------------------------------

export type BrandComplianceCategory =
  | 'brand_colors'
  | 'visual_style'
  | 'product_fidelity'
  | 'typography'
  | 'claims'
  | 'logo_treatment'
  | 'instagram_readability';

export interface BrandComplianceCheck {
  category: BrandComplianceCategory;
  label: string;
  score: number; // 0–100
  status: 'pass' | 'warning' | 'fail';
  finding: string;
  recommendation?: string;
}

export interface BrandComplianceReport {
  score: number; // 0–100 weighted overall score
  status: 'pass' | 'warning' | 'fail';
  summary: string;
  checks: BrandComplianceCheck[];
  evaluatedAt: string;
  evaluationMode: 'visual_ai' | 'limited';
}

/** Caption length / tone preset for Instagram post copy */
export type CaptionTone = 'short' | 'story' | 'promo' | 'viral';

/** Whether caption generation produced grounded output or a degraded result. */
export type CaptionGenerationStatus = 'ok' | 'fallback' | 'failed';

/** Session-level Instagram caption pack for review + export */
export interface StudioCaptionPack {
  caption: string;
  hashtags: string[];
  callToAction?: string;
  altText?: string;
  researchSummary?: string;
  /** Asset that was active when the caption was generated */
  sourceAssetId?: string;
  /** When set, caption covers the full ordered variation / carousel set */
  variationSetId?: string;
  /** Ordered post-queue asset ids when caption covers a manual carousel */
  postQueueIds?: string[];
  /** Number of slides in the carousel set (when variationSetId or post queue is set) */
  slideCount?: number;
  generatedAt: string;
  usedWebResearch: boolean;
  tone?: CaptionTone;
  /**
   * Optional for backwards compatibility with persisted sessions.
   * Newly generated packs always set this explicitly.
   */
  generationStatus?: CaptionGenerationStatus;
  /** Provider/validation failure shown when generationStatus is not ok. */
  generationError?: string;
}

/**
 * Post-concept production brief stored on the session.
 * Defined in productionBriefService to avoid duplicating the shape here.
 */
export type StudioProductionBrief = import('./productionBriefService').ProductionBrief;

/** Full studio session — replaces the legacy StudioState shape over migration phases */
export interface StudioSession {
  assets: StudioAsset[];
  productTruth?: ProductTruth;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  conceptCandidates: CreativeConcept[];
  selectedConceptId?: string;
  socialPostDraft?: SocialPostDraft;
  activeDirection?: CreativeDirection;
  outputIntent: OutputIntent;
  gallerySelectionIds: Set<string>;
  composerReferences: ComposerReference[];
  activeDocument?: StudioDocument;
  versions: GenerationVersion[];
  prompt: string;
  aspectRatio: AspectRatio;
}

// ---------------------------------------------------------------------------
// Shared asset type
// ---------------------------------------------------------------------------

/** A single image asset within the studio session */
export interface StudioAsset {
  id: string;                          // crypto.randomUUID()
  name: string;                        // User-editable, max 100 chars
  description: string;                 // User-editable, max 500 chars
  base64: string;                      // Image data
  /** Remote or data URL fallback when base64 is empty (e.g. CORS-blocked imports). */
  previewUrl?: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  source: 'upload' | 'url_import' | 'generated';
  createdAt: string;                   // ISO timestamp
  // AI generation metadata (only for source === 'generated')
  generationPrompt?: string;
  creativeRoute?: CreativeRoute;
  aspectRatio?: AspectRatio;
  sourceAssetIds?: string[];           // IDs of assets used as references
  /** Groups true batch variation results together */
  variationSetId?: string;
  /** 1-based index within a variation set */
  variationIndex?: number;
  /** Groups ordered Prompt Writer carousel slides together */
  carouselSetId?: string;
  /** 1-based index within a carousel set */
  carouselSlideIndex?: number;
  /** Optional Prompt Writer title for this carousel slide */
  carouselSlideTitle?: string;
  /** User-picked winner inside a variation set */
  isFavorite?: boolean;
  /** Post-generation visual review against researched brand/product context */
  brandCompliance?: BrandComplianceReport;
  /** True while the asynchronous compliance review is running */
  brandCompliancePending?: boolean;
}

/** A record of a past generation attempt */
export interface HistoryEntry {
  id: string;
  prompt: string;
  creativeRoute: CreativeRoute;
  aspectRatio: AspectRatio;
  referenceAssetIds: string[];
  status: 'success' | 'failure';
  errorMessage?: string;
  outputAssetId?: string;
  outputThumbnail?: string;            // base64 thumbnail for display
  createdAt: string;
}

/** Central state for the AI Image Studio */
export interface StudioState {
  assets: StudioAsset[];
  multiSelectEnabled: boolean;
  viewMode: 'default' | 'compact';
  detailAssetId: string | null;
  // Generation
  prompt: string;
  /** @deprecated Use StudioOperation inferred from context instead */
  creativeRoute: CreativeRoute;
  aspectRatio: AspectRatio;
  /** @deprecated Use composerReferences instead */
  roleAssignments: Map<string, RoleAssignment>;
  isGenerating: boolean;
  isEnhancing: boolean;
  // History
  history: HistoryEntry[];             // max 50 entries, LIFO
  /**
   * Canonical gallery multi-select — drives highlight, export, compare, and
   * generation scope override. Independent of composerReferences.
   */
  gallerySelectionIds: Set<string>;
  /**
   * Ordered Instagram post / carousel queue (max 10). Click order = slide order.
   * Independent of gallerySelectionIds (locks) so users can queue winners separately.
   */
  postQueueIds: string[];
  /**
   * Explicit typed references for generation / copilot / Prompt Writer.
   * Roles are set via Role Assignment or Add Reference — not gallery click alone.
   */
  composerReferences: ComposerReference[];
  activeDocument?: StudioDocument;
  versions: GenerationVersion[];
  productTruth?: ProductTruth;
  /**
   * True when gallery/selection locks diverge from productTruth.protectedAssetIds.
   * Research (brand/trends) is preserved; regenerate product truth / concepts before trusting them.
   */
  productTruthStale?: boolean;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  conceptCandidates: CreativeConcept[];
  selectedConceptId?: string;
  socialPostDraft?: SocialPostDraft;
  /** Post-ready caption/hashtags for export (independent of social-post draft) */
  captionPack?: StudioCaptionPack;
  /** Visible research→planning synthesis before concepts */
  strategistBrief?: StrategistBrief;
  /** True when locks changed under an existing strategist brief (brief may no longer match product truth). */
  strategistBriefStale?: boolean;
  /** Post-concept, pre-generation production brief for Writer / Generate */
  productionBrief?: StudioProductionBrief;
  activeDirection?: CreativeDirection;
  outputIntent: OutputIntent;
  /** True when the prompt was set by the Prompt Writer and is already a complete, enriched prompt */
  isPromptEnriched?: boolean;
  /**
   * Shared editable brand website(s) for Assistant, Prompt Writer, and Import.
   * Newline-separated; stays in sync across the studio until the user edits it.
   */
  brandUrlInput: string;
}
