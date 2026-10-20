// === BRAND SYSTEM ===

export interface Brand {
  id: string;
  userId: string;
  name: string;
  websiteUrl: string;
  instagramHandle?: string;
  createdAt: string;
  updatedAt: string;
  dna: BrandDNA | null;
  brandMemory?: BrandMemory | null;
  assets: BrandAsset[];
  status: 'new' | 'researching' | 'ready';
}

export interface BrandDNA {
  // Visual Identity
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    palette: string[];
    reasoning: string;
  };
  typography: {
    headingStyle: string;
    bodyStyle: string;
    characterTraits: string;
  };
  visualSignature: string;
  aesthetic: string[];

  // Messaging
  brandVoice: {
    tone: string;
    personality: string;
    vocabulary: string[];
  };
  tagline: string;
  valuePropositions: string[];
  targetAudience: {
    demographics: string;
    psychographics: string;
    painPoints: string[];
  };

  // Products
  products: ProductInfo[];
  keyIngredients: string[];

  // Social Presence
  instagramAesthetic: string;
  contentPillars: string[];
  topPerformingPatterns: string[];
  postingFrequency: string;

  // Market Position
  competitorInsights: string;
  differentiators: string[];
  marketPosition: string;
}

export interface BrandAsset {
  id: string;
  type: 'logo' | 'product' | 'lifestyle' | 'social_post' | 'generated';
  base64: string;
  mimeType: string;
  description: string;
  sourceUrl?: string;
  previewUrl?: string;
  originPageUrl?: string;
  sourceProductTitle?: string;
  semanticDescription?: string;
  productIdentity?: string;
  shotType?: 'logo' | 'packshot' | 'lifestyle' | 'detail' | 'texture' | 'ingredient' | 'model_with_product' | 'infographic' | 'comparison' | 'bundle' | 'unknown';
  framingMode?: 'cover' | 'contain';
  framingFocusY?: number;
  presentationReason?: string;
  quality?: 'hero' | 'strong' | 'usable' | 'weak';
  editability?: 'safe_to_edit' | 'safe_to_outpaint' | 'reference_only';
  identityRisk?: 'low' | 'medium' | 'high';
  productVisibility?: number;
  labelReadability?: number;
  bestSceneRoles?: string[];
  verdict?: 'use_as_is' | 'can_upgrade' | 'good_reference' | 'do_not_use';
  verdictReason?: string;
  generationPrompt?: string;
  derivedFromAssetId?: string;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
  productKey?: string;
  createdAt?: string;
}

export type AssetProvenanceRole =
  | 'product'
  | 'person'
  | 'environment'
  | 'style_guide'
  | 'previous_scene'
  | 'reference';

export interface AssetProvenanceStep {
  assetId: string;
  role: AssetProvenanceRole;
  preserve?: string[];
  modify?: string;
}

export interface ProductAssetRegistryEntry {
  id: string;
  brandName: string;
  productKey: string;
  productUrl: string;
  productTitle: string;
  assetId: string;
  assetType: BrandAsset['type'];
  description: string;
  sourceUrl?: string;
  previewUrl?: string;
  promptUsed?: string;
  derivedFromAssetId?: string;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
  createdAt: string;
  lastUsedAt: string;
}

export type CampaignPlatform = 'tiktok' | 'instagram_reels' | 'youtube_shorts' | 'instagram_feed' | 'instagram_carousel';
export type CampaignObjective = 'awareness' | 'consideration' | 'conversion' | 'ugc_style' | 'founder_story';
export type ExecutionMode = 'fast' | 'balanced' | 'agency';

// === AD FORMAT SYSTEM ===
export type AdFormat =
  | 'static_image'     // Single image ad (Instagram feed, meta ads)
  | 'carousel'         // Multi-image carousel (Instagram carousel, up to 10 slides)
  | 'stitched_video'   // Images → Ken Burns → xfade → audio → MP4 (current flow)
  | 'veo3_video';      // Veo3 per-scene video clips → stitch → final MP4

/** Per-scene motion for stitched_video: still (Ken Burns) vs Wan I2V live motion */
export type SceneMotionMode = 'still' | 'live_motion';

/** Ad-agent / main-agent text model preference (images stay on Gemini Flash Image). */
export type PlannerModelPreference =
  | 'glm_53_flash'
  | 'kimi_k3'
  | 'openai'
  | 'codex'
  | 'gemini_pro';

/** Format-specific specs for aspect ratio, resolution, and constraints */
export interface FormatSpec {
  width: number;
  height: number;
  aspectRatio: string;
  maxFileSizeMB?: number;
  maxSlides?: number;         // carousel only
  clipDurationSec?: number;   // veo3 only: per-clip duration (4, 6, or 8)
}

export const FORMAT_SPECS: Record<AdFormat, Record<string, FormatSpec>> = {
  static_image: {
    instagram_feed: { width: 1080, height: 1350, aspectRatio: '4:5' },
  },
  carousel: {
    instagram_carousel: { width: 1080, height: 1080, aspectRatio: '1:1', maxSlides: 10 },
  },
  stitched_video: {
    instagram_reels: { width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMB: 650 },
    tiktok: { width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMB: 287 },
    youtube_shorts: { width: 1080, height: 1920, aspectRatio: '9:16', maxFileSizeMB: 256 },
  },
  veo3_video: {
    instagram_reels: { width: 1080, height: 1920, aspectRatio: '9:16', clipDurationSec: 6 },
    tiktok: { width: 1080, height: 1920, aspectRatio: '9:16', clipDurationSec: 6 },
    youtube_shorts: { width: 1080, height: 1920, aspectRatio: '9:16', clipDurationSec: 6 },
  },
};

/** Resolve the FormatSpec for a given format + platform combination */
export function resolveFormatSpec(format: AdFormat, platform: CampaignPlatform): FormatSpec {
  const specs = FORMAT_SPECS[format];
  // Direct match
  if (specs[platform]) return specs[platform];
  // Fallback: first available spec for that format
  const fallback = Object.values(specs)[0];
  if (fallback) return fallback;
  // Ultimate fallback: 9:16 video
  return { width: 1080, height: 1920, aspectRatio: '9:16' };
}
export type SceneRoute =
  | 'use_existing'
  | 'upgrade_existing'
  | 'composite_product'
  | 'generate_fresh'
  | 'continue_sequence';
export type SceneVisualTask =
  | 'use_imported'
  | 'edit_imported'
  | 'overlay_on_product'
  | 'generate_new';
export type AssetLabMode =
  | 'scene_prompt_only'
  | 'continue_image'
  | 'continue_image_into_scene'
  | 'image_variant'
  | 'new_from_scene';
export type SceneSourceMode =
  | 'use_exact_asset'
  | 'crop_reframe_asset'
  | 'edit_from_asset'
  | 'generate_matching_shot'
  | 'generate_fresh';

export interface SceneVisualRecipe {
  productId: string;
  productTitle: string;
  route: SceneRoute;
  sourceMode: SceneSourceMode;
  visualTask: SceneVisualTask;
  visualTaskReason?: string;
  routeReason?: string;
  recommendedBaseAssetId?: string | null;
}

export interface StoryboardScene {
  sceneNumber: number;
  text: string;
  visualDescription: string;
  imagePrompt: string;
  durationSec?: number;  // AI-suggested duration for this scene
  motionMode?: SceneMotionMode; // default still — Live Motion animates approved still via Wan I2V
  recipe: SceneVisualRecipe;
}

export interface StoryboardSceneVariant {
  assetId: string;
  description: string;
  previewUrl?: string;
  generationMode?: AssetLabMode;
  route?: SceneRoute;
  createdAt: number;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}

export interface StoryboardSceneState extends StoryboardScene {
  id: string;
  productId?: string;
  productTitle?: string;
  visualTask?: SceneVisualTask;
  visualTaskReason?: string;
  approved?: boolean;
  route?: SceneRoute;
  routeReason?: string;
  sourceMode?: SceneSourceMode;
  baseAssetId?: string;
  baseAssetDescription?: string;
  generationMode?: AssetLabMode;
  linkedAssetId?: string;
  linkedAssetDescription?: string;
  selectedVariantAssetId?: string;
  variants?: StoryboardSceneVariant[];
  agencySuggestedBaseAssetId?: string;
  agencySuggestedBaseAssetDescription?: string;
  agencySuggestedPrompt?: string;
  agencySuggestedReasoning?: string;
  agencySuggestedRoute?: SceneRoute;
  agencySuggestedMode?: AssetLabMode;
  agencySuggested?: boolean;
  directorsNote?: string;
  visualGap?: boolean;
}

export type PlannedStoryboardScene = StoryboardSceneState & { suggestedPosition: number };

export interface CreativeStoryboardResult {
  narrativeArc?: string;
  creativeRationale?: string;
  scenes: StoryboardScene[];
}

export interface PreferredSceneDirective {
  sceneNumber: number;
  text: string;
  visualDescription: string;
  imagePrompt: string;
  durationSec?: number;  // AI-suggested duration for this scene
  motionMode?: SceneMotionMode;
  productId?: string;
  productTitle?: string;
  assetId?: string;
  assetDescription?: string;
  sourceMode?: SceneSourceMode;
}

export interface CampaignBrief {
  rawPrompt: string;
  adFormat: AdFormat;
  platform: CampaignPlatform;
  objective: CampaignObjective;
  durationSec?: 10 | 15 | 20 | 30 | 45 | 60;  // optional for static/carousel
  executionMode: ExecutionMode;
  plannerModel?: PlannerModelPreference;
  audience?: string;
  tone?: string;
  callToAction?: string;
  productUrl?: string;
  productContext?: ProductContext;
  preferredScenes?: PreferredSceneDirective[];
  referenceUrls?: string[];
  constraints?: string[];
  carouselSlideCount?: number;  // AI-recommended, user-confirmed (carousel only)
}

export interface ProductContext {
  productId: string;
  productTitle: string;
  productUrl: string;
  brandName: string;
  productAssets: BrandAsset[];
  productFacts: string[];
  allowedClaims: string[];
  signalSummary?: string;
  platform: CampaignPlatform;
  durationSec: 10 | 15 | 20 | 30 | 45 | 60;
}

export interface ProductUniverse {
  primaryProductId: string;
  products: ProductContext[];
}

export interface ImportedProduct {
  id: string;
  productUrl: string;
  title: string;
  brandName?: string;
  signalSummary: string;
  facts: string[];
  assets: BrandAsset[];
}

export interface ProductResolutionCandidate {
  productId: string;
  productTitle: string;
  productUrl: string;
  confidence: number;
  source: 'explicit_url' | 'existing_assets' | 'catalog_search';
  assetCount?: number;
}

export interface ProductResolutionResult {
  status: 'resolved' | 'ambiguous' | 'unresolved';
  selectedCandidate?: ProductResolutionCandidate;
  candidates: ProductResolutionCandidate[];
  reason?: string;
}

export interface BrandMemory {
  brandId?: string;
  name: string;
  websiteUrl?: string;
  dna?: BrandDNA | null;
  assets: AssetGraphNode[];
  approvedClaims: string[];
  evidenceSummary: string[];
}

export interface AssetGraphNode {
  assetId: string;
  brandAssetId?: string;
  type: BrandAsset['type'];
  origin: 'uploaded' | 'imported' | 'generated';
  mimeType: string;
  description: string;
  productIdentity?: string;
  sourceUrl?: string;
  previewUrl?: string;
  sourcePageUrl?: string;
  sourceProductTitle?: string;
  linkedSceneIds?: string[];
}

export interface AssetBinding {
  assetId: string;
  mode: SceneSourceMode;
  reason: string;
  required: boolean;
}

export interface SceneContract {
  sceneId: string;
  sceneNumber: number;
  role: string;
  durationTargetSec?: number;       // optional: not used for static/carousel
  platform: CampaignPlatform;
  objective: CampaignObjective;
  adFormat: AdFormat;
  voiceoverText?: string;           // optional: not used for static/carousel
  onScreenText: string;
  visualIntent: string;
  imagePrompt?: string;
  directorsNote?: string;
  sourceMode: SceneSourceMode;
  assetBindings: AssetBinding[];
  aspectRatio?: string;             // e.g. '4:5', '1:1', '9:16'
  cameraMovement?: string;
  status: 'planned' | 'generating' | 'ready' | 'stale' | 'error';
}

export interface RenderManifestScene {
  sceneId: string;
  durationSec: number;
  voiceoverText: string;
  onScreenText: string;
  assetIds: string[];
}

export interface RenderManifest {
  manifestId: string;
  adFormat: AdFormat;
  platform: CampaignPlatform;
  totalDurationSec?: number;        // optional: 0 or omitted for static/carousel
  scenes: RenderManifestScene[];
  exportStatus: 'draft' | 'ready' | 'blocked';
  blockers: string[];
}

export interface CampaignBlueprint {
  brief: CampaignBrief;
  productContext?: ProductContext | null;
  concept: AdConcept;
  brandMemory: BrandMemory | null;
  sceneContracts: SceneContract[];
  renderManifest: RenderManifest | null;
  reviewHistory: ReviewFeedback[];
}

export interface ProductInfo {
  name: string;
  url?: string;
  description: string;
  keyIngredients: string[];
  benefits: string[];
  price?: string;
  imageDescription: string;
}

// === CAMPAIGN SYSTEM ===

export interface Campaign {
  id: string;
  brandId: string;
  brief: string;
  targetPlatform: string;
  targetMarket: string;
  status: 'briefing' | 'researching' | 'creating' | 'reviewing' | 'approved' | 'generating';
  concept: AdConcept | null;
  iterations: CampaignIteration[];
  createdAt: string;
}

export interface AdConcept {
  title: string;
  adFormat: AdFormat;
  hook: string;
  narrative: string;
  narrativeArc?: string;
  scenes: AdScene[];
  musicDirection: string;         // video formats only; ignored for static/carousel
  captionStyle: string;
  colorMood: string;
  estimatedDuration: number;      // 0 for static, per-slide avg for carousel
  creativeRationale: string;
}

export interface AdScene {
  sceneNumber: number;
  visualDescription: string;
  imagePrompt: string;
  voiceoverText?: string;           // optional: not used for static/carousel
  onScreenText: string;
  directorsNote?: string;
  durationSec?: number;             // optional: not used for static/carousel
  motionMode?: SceneMotionMode;
  transitionIn?: string;            // optional: not used for static/carousel
  brandAssetRef?: string;
  brandImageIndex?: number;
  brandAssetEditAction?: 'use_as_is' | 'edit';
  cameraMovement?: string;          // optional: not used for static/carousel
  slideHeadline?: string;           // carousel only: headline text for slide overlay
  slideBody?: string;               // carousel only: body text for slide overlay
}

export interface CampaignIteration {
  iteration: number;
  concept: AdConcept;
  reviewScore: number;
  reviewFeedback: string;
  improvements: string[];
  timestamp: number;
}

export interface ReviewFeedback {
  stage?: 'concept' | 'scene_binding' | 'final_output';
  overallScore: number;
  brandConsistency: number;
  hookStrength: number;
  narrativeFlow: number;
  visualImpact: number;
  marketFit: number;
  verdict: 'approved' | 'needs_revision';
  critiques: string[];
  mandatoryFixes: string[];
  suggestions: string[];
  metadata?: {
    failingSceneNumbers?: number[];
    groundedSceneCount?: number;
    requiredGroundedSceneCount?: number;
  };
}
