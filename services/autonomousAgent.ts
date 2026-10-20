/**
 * Autonomous Ad Agent — Autonomous pipeline with human-in-the-loop gates.
 * Files are organized into /tmp/reelai-agent/{brand}/{product}/{sessionId}/
 * All ffmpeg commands use absolute paths. Gemini TTS PCM is wrapped in WAV headers.
 */

import { GoogleGenAI } from '@google/genai';
import { generateImageAsset, generateVoiceover } from './geminiService';
import { importProductPageAssetsRich, getProductKnowledge } from './productPageImportService';
import { readMemory, formatMemoryForPrompt, type MemoryEntry } from './agentMemory';
import {
  createSession,
  pcmToWav,
  uploadBase64,
  execShell,
  runPython,
  buildKenBurnsClip,
  concatWithXfade,
  concatAudio,
  addAudioToVideo,
  burnCaptions,
  burnCaptionsStyled,
  generateCaptionStylePreviews,
  exportForPlatform,
  getAudioDuration,
  getMediaDuration,
  isShellServerRunning,
  type SessionInfo,
  type CaptionStyle,
  type AdPlatform,
} from './shellToolService';
import { timeFitClip } from './producers/timeFitClip';
import { listMcpTools, callMcpTool, mcpContentToText } from './mcpClient';
import { attemptShellRepair } from './agentShellRepair';
import {
  discoverAgentCapabilities,
  looksLikeOpenEndedAgentAsk,
  runAgentDirector,
} from './agentDirector';
import { TaskRunMemory } from './taskRunMemory';
import { produceCarousel, generateCarouselImages, applyTextOverlays, type CarouselSlide, type TextOverlayStyle } from './producers/carouselProducer';
import { estimateVeo3Cost, generateVeo3Clip, stitchVeo3Clips, resolveVeoClipImageInput, type Veo3ClipResult } from './producers/veo3VideoProducer';
import {
  estimateWanI2vCost,
  estimateLiveMotionCostPerClipUsd,
  generateWanI2vClip,
  buildLiveMotionPrompt,
  wanImageSizeForPlatform,
  resolveLiveMotionFromFeedback,
  applyLiveMotionIntent,
  resolveLiveMotionModelId,
  DEFAULT_LIVE_MOTION_MODEL_ID,
} from './producers/wanI2vProducer';
import { getStudioI2vModel } from '../components/AIImageStudio/studioAnimateService';
import { mapWithConcurrency } from './concurrency';
import { planText, resolveDefaultPlannerModel, type PlannerModelId } from './siliconflow/planner';
import { resolveApiKeyForModel } from './llm/apiKeys';
import {
  appendProductPhotoRealism,
  PRODUCT_PHOTO_REALISM_PLANNER_RULE,
} from './productPhotoRealism';
import {
  analyzeReferenceStructure,
  formatReferenceStructureBlock,
  referenceStructurePlannerRules,
} from './referenceStructureAnalysis';
import {
  continuityImpliesPerson,
  extractImageBase64FromDataUrl,
  formatContinuityLockMarkdown,
  parsePlannerPayload,
  prependContinuityLock,
  SCENE_CONTINUITY_PLANNER_RULES,
  synthesizeContinuityFromScenes,
  type SceneContinuityBible,
} from './sceneContinuity';
import {
  AD_AGENT_VOICE_OPTIONS,
  clampAdAgentDurationSec,
  coerceAdAgentVoice,
  estimateAdAgentSceneCount,
  resolveAdAgentVoiceFromFeedback,
} from '../runtime/adAgentOptions';
import { coerceVideoVibe } from './adAgentVideoTreatment';
import {
  analyzeCreativeReferences,
  assignCreativeReferences,
  type CreativeReference,
  type CreativeReferenceUpload,
  type SceneReferenceAssignment,
  type SceneVisualMode,
  resolveSceneVisualMode,
} from './creativeReferenceDirector';
import type { SceneMotionMode } from '../types/brand';
import {
  completeDecisionTrace,
  createDecisionTrace,
  recordTraceDecision,
  serializeDecisionTrace,
} from './adIntelligence/decisionTraceService';
import type { AdDecisionTrace } from './adIntelligence/types';
import { extractProductEvidence } from './adIntelligence/evidenceExtractionService';
import { formatEvidenceGraphForPrompt, type EvidenceGraph } from './adIntelligence/evidenceGraph';
import { cleanScriptText } from '../utils/sceneDrafts';
import { coerceAgentVisualMode } from '../utils/productVisualRequirement';
import { gateCreativeScenes } from './adIntelligence/evidenceGate';
import {
  assertFormatLocked,
  formatNativePlannerPrompt,
  getNativePlannerSpec,
  scoreNativePlan,
  type NativePlannerSpec,
} from './adIntelligence/planners';
import { generateFallbackConceptTerritories, validateConceptDistinctness } from './adIntelligence/conceptGenerator';
import { judgeConceptsPairwise, type CreativeConceptTerritory } from './adIntelligence/conceptJudge';
import { runCriticCouncil } from './adIntelligence/critics';
import { reviewVisualScene, type VisualCriticReview } from './adIntelligence/visualCritic';
import { createRegenerationPolicy, selectScenesForRegeneration } from './adIntelligence/regenerationPolicy';
import {
  bootstrapLoop,
  applyVerifyToState,
  syncGoalCardToSession,
  planRecreatePath,
  recreatePathMarkdown,
  defaultMotionHint,
  retrieveMemoryForPhase,
  shouldWriteMemory,
  shouldEscalate,
  continueAfterEscalate,
  executeRecreateIngest,
  completeStepById,
  structureAnalysisRole,
  HARD_MULTIMODAL_MODEL,
  WORKER_MODEL,
  shouldProposeForgeAfterRepair,
  proposeForgeScript,
  forgeAndRegisterRepairTool,
  passedCount,
  type LoopRunState,
  type LoopBootstrapResult,
  type RecreatePathPlan,
  debateScenePlan,
  debateTaskGraph,
  debateTranscriptMarkdown,
  formatTaskGraphMarkdown,
  shouldReviewTaskGraphAfterIngest,
  type DebateImage,
  type DebateOutcome,
} from './agentLoop';
import { clearForgedTools, approveAndForgeTool, callTool } from './toolRegistry';
import {
  resolveOutputAudience,
  type OutputAudience,
} from './agentOutputAudience';
import {
  extractHttpUrls,
  missingProductIdentity,
  resolvePromptUrlRoles,
  urlHostLabel,
} from './promptUrlRoles';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrendInsights {
  trendingHooks: string[];       // e.g. ["Problem-first", "Ingredient reveal"]
  topHashtags: string[];         // e.g. ["#skintok", "#glowup"]
  nativeConventions: string[];   // e.g. ["Fast cuts <2s", "Creator voiceover"]
  trendSummary: string;          // 2-3 sentence summary of what's working
  postCaption: string;           // ready-to-paste post caption with hashtags
}

export type AgentPhase =
  | 'idle' | 'research' | 'plan_scenes' | 'generate_images'
  | 'generate_voiceover' | 'assemble_video' | 'deliver'
  | 'export_image' | 'export_carousel' | 'generate_veo3_clips' | 'cost_confirmation'
  | 'generate_live_motion'
  | 'plan_loop'
  | 'forge_tool';

export type AgentOutputType = 'markdown' | 'image' | 'video' | 'audio' | 'terminal' | 'error';

export type { OutputAudience };

export interface AgentOutput {
  type: AgentOutputType;
  content?: string;
  url?: string;
  label?: string;
  mimeType?: string;
  /** Who should see this in the console. Default inferred; 'user' for product artifacts. */
  audience?: OutputAudience;
}

export type AgentEventType =
  | 'phase_start' | 'status' | 'output'
  | 'approval_needed'
  | 'approval_resolved'
  | 'error' | 'complete' | 'stopped';

export type ApprovalSceneMotion = {
  index: number;
  role: string;
  motionMode: SceneMotionMode;
};

export interface ApprovalRequest {
  approvalId: string;
  phase: AgentPhase;
  question: string;
  details?: string;
  autoApproveAfterSec?: number;
  /** plan_scenes (stitched video): editable Still / Live Motion per scene */
  sceneMotionOptions?: ApprovalSceneMotion[];
  /** Live Motion model label for plan-gate cost copy */
  liveMotionModelLabel?: string;
  /** Estimated USD per Live Motion clip for plan-gate cost copy */
  liveMotionCostPerClipUsd?: number;
  /** Hybrid tool forge: pending network/external tool awaiting approval */
  forgeDraft?: {
    forgeId: string;
    name: string;
    description: string;
    reason: string;
    /** Session Python script — shown collapsed in the approval gate */
    code?: string;
  };
}

export type ApprovalResolution = {
  approved: boolean;
  feedback: string;
  sceneMotionModes?: Array<{ index: number; motionMode: SceneMotionMode }>;
  /** When set, approve/reject a pending forge draft */
  forgeId?: string;
};

export interface AgentEvent {
  id: string;
  timestamp: number;
  type: AgentEventType;
  phase?: AgentPhase;
  message?: string;
  output?: AgentOutput;
  approval?: ApprovalRequest;
  result?: AgentDeliverable;
  /** Compact goal checklist progress for Quiet+ status strip */
  goalProgress?: { passed: number; total: number; skillPath?: string };
}

export interface AgentDeliverable {
  adFormat: import('../types/brand').AdFormat;
  videoUrl?: string;              // video formats only
  imageUrl?: string;              // static_image format only
  carouselImageUrls?: string[];   // carousel format only
  sceneImages: Array<{ url: string; label: string }>;
  script: string;
  durationSec: number;
  sessionDir: string;
  postCaption: string;           // platform-native caption + hashtags, ready to paste
  trendInsights?: TrendInsights; // what was trending when this ad was made
}

export interface AgentConfig {
  adFormat: import('../types/brand').AdFormat;
  platform: 'instagram_reels' | 'tiktok' | 'youtube_shorts' | 'instagram_feed' | 'instagram_carousel';
  /** Target ad length in seconds (typically 5–90; presets 5/15/30/45/60). */
  durationSec: number;
  style: 'luxe_minimalist' | 'earthy_organic' | 'high_energy' | 'ugc_style';
  voice: string;
  reviewMode: 'review' | 'auto';
  autoApproveSec: number;
  carouselEditMode?: 'auto' | 'studio';
  /** Main planner + main-agent text model (default GLM 5.3 Flash; always falls back to Gemini). */
  plannerModel?: PlannerModelId;
  /** Optional API key override for the selected planner/agent provider (also stored in UI localStorage). */
  plannerApiKey?: string;
  /**
   * Video Ad (stitched): default new scenes to Live Motion I2V instead of Ken Burns stills.
   * User can still flip per scene at the Scene Plan gate.
   */
  preferLiveMotion?: boolean;
  /**
   * Live Motion model id (SiliconFlow Wan or fal Seedance/Kling/Veo/Grok/…).
   * Defaults to Wan 2.2 when unset.
   */
  liveMotionModelId?: string;
  /** Edit energy + VO voice: bright Gen Z creator ↔ premium cinematic calm. */
  vibe?: 'gen_z_bright' | 'balanced' | 'premium_calm';
  /**
   * When false, skip TTS and ship a silent video (scene timing uses target durations).
   * On-screen captions from script text can still burn. Defaults to true.
   */
  includeVoiceover?: boolean;
}

/** Optional Brand Ad Agency / Hub upload → AutonomousAgent seed context. */
export interface AgencyRunContext {
  source?: 'brand_video_agency' | 'product_upload';
  /** When true, Agency curation is authoritative — do not silently rewrite plan/assets. */
  lockPlan?: boolean;
  /** Skip product page re-import when facts + hero are already seeded. */
  skipResearch?: boolean;
  /**
   * When true (Hub researcher Apply), also skip agent brand-style + trend re-research.
   * Brief in the prompt is story authority.
   */
  skipBrandAndTrends?: boolean;
  /** Locked researcher / Agency brief — preferred over prompt-derived brief when set. */
  creativeBrief?: string;
  /** Human direction from Ad Creator step 01 (optional). */
  userDirection?: string;
  /** Product page URL resolved by the launcher — authoritative over prompt text. */
  productUrl?: string;
  /** Creative reference URL (social post) — never used for product identity. */
  referenceUrl?: string;
  productTitle?: string;
  productFacts?: string[];
  productBase64?: string;
  productMimeType?: string;
  seedScenes?: ScenePlan[];
  /** Deduped asset bank keyed by asset id (avoids repeating base64 in every scene). */
  sceneAssetBank?: Record<string, { base64: string; mimeType: string; name?: string }>;
  approvedConcept?: {
    title: string;
    hook: string;
    narrative: string;
    proposition?: string;
    visualDirection?: string;
  };
}

export interface ScenePlan {
  index: number;
  role: string; // flexible — AI picks descriptive labels (e.g. 'hook', 'reveal', 'lifestyle', 'cta')
  targetDurationSec: number;
  actualDurationSec: number;
  imagePrompt: string;
  voiceoverText: string;
  useProductAsReference: boolean;
  visualMode?: SceneVisualMode;
  imageUrl?: string;
  imageAbsPath?: string;
  audioAbsPath?: string;
  regenerate?: boolean;
  /** still (Ken Burns) or live_motion (Wan I2V fitted to targetDurationSec) */
  motionMode?: SceneMotionMode;
  /** Planner's motion direction for this beat (what moves / how we cut) — feeds Live Motion prompts. */
  motionIntent?: string;
  /** Fitted Live Motion clip path used by assemble instead of Ken Burns */
  motionClipAbsPath?: string;
  // Carousel-specific fields
  slideHeadline?: string;  // Max 5 words per slide
  slideBody?: string;      // Max 12 words per slide
  referenceAssignment?: SceneReferenceAssignment;
  /** Agency: use curated asset bytes instead of regenerating. */
  preserveExactAsset?: boolean;
  lockedAssetId?: string;
  lockedAssetBase64?: string;
  lockedAssetMimeType?: string;
  agencySourceMode?: import('../types/brand').SceneSourceMode;
}

export interface FeedbackInterpretation {
  intent: string;           // what the agent understood the user wants
  structural: boolean;      // true = scene count/order must change → trigger full re-plan
  replanHint: string;       // if structural, what to pass to planScenes
  /** Keep existing TTS / don't regen voiceover (default true for visual-only redos). */
  keepVoiceover?: boolean;
  /** Switch Gemini TTS voice (e.g. Sadachbia for hyper female hype). */
  newVoice?: string;
  /** Optional vibe switch when feedback asks for Gen Z / calm energy. */
  newVibe?: 'gen_z_bright' | 'balanced' | 'premium_calm';
  /** Switch scene motion (Wan Live Motion vs Ken Burns stills). */
  motionMode?: 'live_motion' | 'still';
  /** When set with motionMode, only these 0-based indexes; omit = all scenes. */
  motionSceneIndexes?: number[];
  /** Optional continuity bible patches (cast / wardrobe / lighting). */
  continuityPatch?: Partial<{
    cast: string;
    wardrobe: string;
    locationFamily: string;
    lightingPalette: string;
  }>;
  patches: Array<{
    sceneIndex: number;     // 0-based
    newVoiceoverText?: string;
    newImagePrompt?: string;
    regenImage: boolean;
  }>;
}

// ── Visual Mode helpers ────────────────────────────────────────────────────────
// SCENE_PROMPTS removed — the AI now writes image prompts freely per scene.
// visualMode controls whether the product reference image is injected.

const WORDS_PER_SEC = 2.5;
/** Vision plan reviews per run: the first storyboard plus one re-plan. */
const MAX_SCENE_DEBATES_PER_RUN = 2;
const uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Map recreate task-graph step ids onto the console phase rail. */
function phaseForRecreateStep(stepId: string): AgentPhase {
  switch (stepId) {
    case 'ingest_ref':
    case 'structure':
      return 'plan_loop';
    case 'lock_product':
      return 'research';
    case 'plan_scenes':
      return 'plan_scenes';
    case 'stills':
      return 'generate_images';
    case 'motion':
      return 'generate_live_motion';
    case 'assemble':
      return 'assemble_video';
    case 'verify':
    case 'deliver':
      return 'deliver';
    default:
      return 'plan_loop';
  }
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';

const sessionArtifactUrl = (session: SessionInfo, artifactPath: string): string => {
  if (/^https?:\/\//i.test(artifactPath) || artifactPath.startsWith('data:')) return artifactPath;
  if (artifactPath.startsWith(session.baseUrl)) return artifactPath;
  const filename = artifactPath.split('/').filter(Boolean).pop() || artifactPath;
  return `${session.baseUrl}/${filename}`;
};

export const hasDuplicateCreativeScenes = (
  scenes: Array<Pick<ScenePlan, 'imagePrompt' | 'voiceoverText' | 'slideHeadline' | 'slideBody'>>,
): boolean => {
  const normalize = (value = '') => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const visualKeys = scenes.map((scene) => normalize(scene.imagePrompt));
  const copyKeys = scenes.map((scene) => normalize(scene.voiceoverText || scene.slideHeadline || scene.slideBody || ''));
  return new Set(visualKeys).size < visualKeys.filter(Boolean).length
    || new Set(copyKeys).size < copyKeys.filter(Boolean).length;
};

const fallbackVideoScene = (
  title: string,
  sceneIndex: number,
  _sceneCount: number,
  creativeBrief: string,
): { role: string; voiceoverText: string; imagePrompt: string; visualMode: SceneVisualMode } => {
  const arc = [
    {
      role: 'hook',
      voiceoverText: `Notice the detail that makes this different.`,
      imagePrompt: `Extreme macro opening hook focused on the most distinctive material, texture, ingredient, or construction detail of ${title}, catching soft directional light. Use a premium color palette, shallow depth of field, tactile detail, and vertical 9:16 composition. Preserve the real product design and avoid a generic centered packshot.`,
      visualMode: 'product_locked' as SceneVisualMode,
    },
    {
      role: 'ritual',
      voiceoverText: `See how naturally it fits into the ritual.`,
      imagePrompt: `Close observational ritual of ${title}: one clear hand using the product as intended (whisk in bowl, pour into cup, or tin held above a vessel) with soft materials resting in the vessel — never floating foam or cream between hands. Natural window light, tactile surfaces, vertical 9:16, product identity preserved.`,
      visualMode: 'product_composite' as SceneVisualMode,
    },
    {
      role: 'benefit',
      voiceoverText: `The difference becomes clear in the moment of use.`,
      imagePrompt: `Real-camera benefit-reveal scene showing the immediate, visually supportable result of using ${title}, without before-and-after manipulation or unsupported claims. Use natural highlights, credible human presence, brand-appropriate color harmony, and a distinct lens angle. Vertical 9:16 with product identity preserved if visible.`,
      visualMode: 'product_composite' as SceneVisualMode,
    },
    {
      role: 'lifestyle',
      voiceoverText: `A small choice that belongs in real life.`,
      imagePrompt: `Lifestyle scene placing the intended outcome of ${title} in a credible everyday environment with filtered daylight, human context, and quiet negative space. The mood should feel grounded, modern, and aspirational without unsupported claims. Vertical 9:16, no product pack required; focus on the emotional payoff.`,
      visualMode: 'generated_fresh' as SceneVisualMode,
    },
    {
      role: 'cta',
      voiceoverText: `Make ${title} part of your everyday routine.`,
      imagePrompt: `Real product packshot of ${title} with one relevant usage prop and a clean textured surface. Use natural directional light, exact packaging preservation, balanced shadows, brand colors, and clear space for a CTA caption. Vertical 9:16 commercial product shoot with the product label sharp and intact.`,
      visualMode: 'product_locked' as SceneVisualMode,
    },
  ];
  const picked = arc[Math.min(sceneIndex, arc.length - 1)];
  return {
    ...picked,
    imagePrompt: creativeBrief
      ? `${picked.imagePrompt} Creative brief to reflect: ${creativeBrief.slice(0, 180)}.`
      : picked.imagePrompt,
  };
};

const fallbackCarouselSlide = (
  title: string,
  slideIndex: number,
  slideCount: number,
  creativeBrief: string,
): { headline: string; body: string; imagePrompt: string; visualMode: SceneVisualMode } => {
  const slides = [
    {
      headline: 'Look Closer',
      body: 'Swipe to see what makes it different.',
      imagePrompt: `Square 1:1 premium hero composition for ${title}: exact product visible with one relevant usage prop and clean negative space for headline typography. Use brand-appropriate light, refined accents, tactile surfaces, and sharp product identity preservation.`,
      visualMode: 'product_locked' as SceneVisualMode,
    },
    {
      headline: 'The Detail',
      body: 'See the material, ingredient, or craft up close.',
      imagePrompt: `Square 1:1 macro scene showing the most distinctive material, ingredient, texture, or construction detail of ${title}. Use tactile close-up photography, shallow depth of field, natural highlights, and an editorial composition distinct from the product hero.`,
      visualMode: 'product_composite' as SceneVisualMode,
    },
    {
      headline: 'How It Fits',
      body: 'Use it exactly as intended, without the fuss.',
      imagePrompt: `Square 1:1 observational ritual shot of ${title} being handled or used exactly as intended. Use warm daylight, credible human interaction, tactile detail, and a clean composition that feels educational and elevated without unsupported claims.`,
      visualMode: 'product_composite' as SceneVisualMode,
    },
    {
      headline: 'The Payoff',
      body: 'See the immediate, supportable result.',
      imagePrompt: `Square 1:1 real lifestyle payoff scene showing the credible intended outcome of ${title} without unsupported claims. Keep the mood fresh, grounded, and sensory with brand color harmony, natural contrast, human context, and no product packshot — everyday lifestyle mood only.`,
      visualMode: 'generated_fresh' as SceneVisualMode,
    },
    {
      headline: 'Make It Yours',
      body: `Discover ${title}.`,
      imagePrompt: `Square 1:1 final CTA packshot for ${title}, exact product identity locked beside one relevant usage prop. Use real product-shoot lighting, soft natural shadow, balanced text-safe space, and clear product readability so the last slide feels shoppable and real.`,
      visualMode: 'product_locked' as SceneVisualMode,
    },
  ];
  const picked = slides[Math.min(slideIndex, slides.length - 1)];
  return {
    ...picked,
    headline: slideIndex === slideCount - 1 ? picked.headline : picked.headline,
    imagePrompt: creativeBrief
      ? `${picked.imagePrompt} Creative brief to reflect: ${creativeBrief.slice(0, 180)}.`
      : picked.imagePrompt,
  };
};

// ── Agent ─────────────────────────────────────────────────────────────────────

export class AutonomousAgent {
  private stopped = false;
  private ai: GoogleGenAI;
  private pendingApprovals = new Map<string, (r: ApprovalResolution) => void>();
  // Loaded once per run — merged global + brand memory
  private memoryByPhase = new Map<string, MemoryEntry[]>();
  private brandSlug = '';
  private decisionTrace: AdDecisionTrace | null = null;
  private evidenceGraph: EvidenceGraph | null = null;
  private selectedConcept: CreativeConceptTerritory | null = null;
  private regenerationPolicy = createRegenerationPolicy(2);
  /** Cast/world lock from the latest planScenes / planCarouselSlides call. */
  private sceneContinuity: SceneContinuityBible | null = null;
  /** Per-run memory of user feedback + agent actions (not brand memory). */
  private taskMemory = new TaskRunMemory();
  /** Outer loop runtime state (goal card + task graph). */
  private loopState: LoopRunState | null = null;
  private loopBootstrap: LoopBootstrapResult | null = null;
  private recreatePath: RecreatePathPlan | null = null;
  /** Product + reference frames handed to Gemini Pro for the planning review. */
  private planDebateImages: DebateImage[] = [];
  /** Vision reviews spent on plans this run — re-plans must not bill forever. */
  private sceneDebatesRun = 0;
  /** Prevent forge-on-fail loops for the same repair goal. */
  private forgedRepairGoals = new Set<string>();
  /** Latest run config (for forge HITL during assemble). */
  private lastConfig: AgentConfig | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
  }

  stop() {
    this.stopped = true;
    this.pendingApprovals.forEach((r) => r({ approved: false, feedback: '' }));
    this.pendingApprovals.clear();
  }

  resolveApproval(
    approvalId: string,
    approved: boolean,
    feedback = '',
    sceneMotionModes?: ApprovalResolution['sceneMotionModes'],
    forgeId?: string,
  ) {
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      this.pendingApprovals.delete(approvalId);
      resolve({ approved, feedback, sceneMotionModes, forgeId });
    }
  }

  /** HITL: approve a network/external forged tool and register it. */
  async resolveForgeApproval(forgeId: string, approved: boolean): Promise<void> {
    if (!approved || !forgeId) return;
    await approveAndForgeTool(forgeId);
  }

  /** Emit goal checklist progress for the Quiet+ status strip. */
  private emitGoalProgress(onEvent: (e: AgentEvent) => void, phase?: AgentPhase) {
    if (!this.loopState?.goalCard) return;
    const { passed, required } = passedCount(this.loopState.goalCard);
    // No message: the dots carry the count, and a message here would overwrite
    // the meaningful status line in the console strip.
    this.emit(onEvent, 'status', {
      phase: phase || 'plan_loop',
      goalProgress: {
        passed,
        total: required,
        skillPath: this.loopState.goalCard.skillPath,
      },
    });
  }

  /** Emit a forge_tool approval_needed event that includes forgeDraft for the UI. */
  async gateForgeTool(
    onEvent: (e: AgentEvent) => void,
    config: AgentConfig,
    draft: { forgeId: string; name: string; description: string; reason: string; code?: string },
  ): Promise<ApprovalResolution> {
    const approvalId = uid();
    this.emit(onEvent, 'approval_needed', {
      phase: 'forge_tool',
      approval: {
        approvalId,
        phase: 'forge_tool',
        question: `Approve helper "${draft.name}" for this session?`,
        details: draft.reason,
        forgeDraft: draft,
      },
    });
    return new Promise<ApprovalResolution>((resolve) => {
      this.pendingApprovals.set(approvalId, resolve);
    }).then(async (resolution) => {
      if (resolution.approved && draft.forgeId) {
        await approveAndForgeTool(draft.forgeId);
        this.outUser(onEvent, 'forge_tool', {
          type: 'markdown',
          label: 'Custom helper',
          content: `Custom helper ready: **${draft.name}**`,
        });
      }
      return resolution;
    });
  }

  /**
   * Apply harness signals to the goal card. Returns false when the run must abort
   * (user Stop on escalate). Success stops are informational only.
   */
  private async updateLoopSignals(
    onEvent: (e: AgentEvent) => void,
    config: AgentConfig,
    signals: Parameters<typeof applyVerifyToState>[1],
    spentDeltaUsd = 0,
  ): Promise<boolean> {
    if (!this.loopState) return true;
    const { state, result, stop } = applyVerifyToState(this.loopState, signals, spentDeltaUsd);
    this.loopState = state;
    await syncGoalCardToSession(state);
    if (result.newlyPassed.length) {
      this.log(
        onEvent,
        'plan_loop',
        `Goal progress: ${result.newlyPassed.join(', ')}`,
      );
    }
    this.emitGoalProgress(onEvent, 'plan_loop');
    if (stop.stop && stop.reason === 'success') {
      this.log(onEvent, 'plan_loop', stop.message);
      return true;
    }
    if (stop.stop && shouldEscalate(stop.reason)) {
      this.out(onEvent, 'plan_loop', {
        type: 'markdown',
        label: 'Loop Escalate',
        content: `**${stop.reason}** — ${stop.message}\n\nContinue once (soft +4 steps / +$5) or Stop.`,
      });
      const gate = await this.gate(
        onEvent,
        { ...config, reviewMode: 'review' },
        'plan_loop',
        `Loop escalate: ${stop.reason}. Continue or Stop?`,
        stop.message,
      );
      if (!gate.approved) {
        this.emit(onEvent, 'stopped', { message: `Stopped after loop escalate (${stop.reason}).` });
        return false;
      }
      this.loopState = continueAfterEscalate(this.loopState);
      await syncGoalCardToSession(this.loopState);
      this.log(onEvent, 'plan_loop', 'Escalation Continue — soft budget bump applied');
      this.emitGoalProgress(onEvent, 'plan_loop');
    } else if (stop.stop && stop.reason && stop.reason !== 'success') {
      this.out(onEvent, 'plan_loop', {
        type: 'markdown',
        label: 'Loop Stop',
        content: `**${stop.reason}** — ${stop.message}`,
      });
    }
    return true;
  }

  private markRecreateStep(
    stepId: string,
    evidence?: string,
    onEvent?: (e: AgentEvent) => void,
  ): void {
    if (!this.loopState || this.loopBootstrap?.intent.skillPath !== 'recreate_reference_video') return;
    const { state } = completeStepById(this.loopState, stepId, evidence);
    this.loopState = state;
    if (onEvent) this.emitGoalProgress(onEvent, phaseForRecreateStep(stepId));
  }

  private emit(onEvent: (e: AgentEvent) => void, type: AgentEventType, payload: Partial<Omit<AgentEvent, 'id' | 'timestamp' | 'type'>>) {
    onEvent({ id: uid(), timestamp: Date.now(), type, ...payload });
  }
  private log(onEvent: (e: AgentEvent) => void, phase: AgentPhase, message: string) {
    this.emit(onEvent, 'status', { phase, message });
  }
  private out(onEvent: (e: AgentEvent) => void, phase: AgentPhase, output: AgentOutput) {
    const audience = resolveOutputAudience({
      audience: output.audience,
      label: output.label,
      type: output.type,
    });
    this.emit(onEvent, 'output', { phase, output: { ...output, audience } });
  }
  private outUser(onEvent: (e: AgentEvent) => void, phase: AgentPhase, output: AgentOutput) {
    this.out(onEvent, phase, { ...output, audience: 'user' });
  }
  private outReview(onEvent: (e: AgentEvent) => void, phase: AgentPhase, output: AgentOutput) {
    this.out(onEvent, phase, { ...output, audience: 'review' });
  }
  private outDebug(onEvent: (e: AgentEvent) => void, phase: AgentPhase, output: AgentOutput) {
    this.out(onEvent, phase, { ...output, audience: 'debug' });
  }
  /**
   * Review the task graph once images exist.
   *
   * At bootstrap there is usually nothing to look at yet — reference frames are
   * captured later — so the graph review happens here instead, after ingest and
   * product lock. Its notes are folded into the brief so scene planning
   * inherits them; skipped when the bootstrap review already ran with images.
   */
  private async refineTaskGraphWithImages(
    onEvent: (e: AgentEvent) => void,
    creativeBrief: string,
  ): Promise<string> {
    const bootstrap = this.loopBootstrap;
    if (!bootstrap) return creativeBrief;
    if (!shouldReviewTaskGraphAfterIngest({
      images: this.planDebateImages,
      bootstrapDebate: bootstrap.debate,
    })) return creativeBrief;

    const debate = await debateTaskGraph({
      graph: bootstrap.taskGraph,
      goal: bootstrap.goalCard.goal,
      context: creativeBrief,
      images: this.planDebateImages,
    });
    if (debate.skippedReason) return creativeBrief;

    bootstrap.debate = debate;
    if (debate.applied) {
      bootstrap.taskGraph = debate.merged;
      bootstrap.taskGraphMarkdown = formatTaskGraphMarkdown(debate.merged);
      if (this.loopState) this.loopState.taskGraph = debate.merged;
      this.outDebug(onEvent, 'research', {
        type: 'markdown',
        label: 'Agent Loop · Revised plan',
        content: bootstrap.taskGraphMarkdown,
      });
      this.traceDecision(
        'research',
        'planner_debate',
        'Gemini Pro revised the production plan after reviewing product + reference frames',
        [],
        0.8,
      );
    }
    this.reportPlannerDebate(onEvent, 'research', 'production plan', debate);

    const notes = [...debate.notes, ...debate.risks];
    if (!notes.length) return creativeBrief;
    return [
      creativeBrief,
      ['## PLANNER REVIEW (image-aware)', ...notes.map((n) => `- ${n}`)].join('\n'),
    ].filter(Boolean).join('\n\n').trim();
  }

  /**
   * Run the scene-plan half of the planner debate and merge Pro's revisions
   * in place. Silent no-op when there are no images to reason about.
   */
  private async applySceneDebate(
    scenes: ScenePlan[],
    title: string,
    facts: string[],
    creativeBrief: string,
    onEvent: (e: AgentEvent) => void,
  ): Promise<void> {
    if (!this.planDebateImages.length || !scenes.length) return;
    // A storyboard re-plan deserves a fresh look, but not an unbounded bill.
    if (this.sceneDebatesRun >= MAX_SCENE_DEBATES_PER_RUN) return;
    this.sceneDebatesRun += 1;
    const debate = await debateScenePlan({
      scenes: scenes.map((s) => ({
        index: s.index,
        role: s.role,
        targetDurationSec: s.targetDurationSec,
        imagePrompt: s.imagePrompt,
        voiceoverText: s.voiceoverText,
        motionIntent: s.motionIntent,
      })),
      productTitle: title,
      facts,
      brief: creativeBrief,
      images: this.planDebateImages,
    });
    for (const revision of debate.merged) {
      const scene = scenes.find((s) => s.index === revision.index);
      if (!scene) continue;
      if (revision.imagePrompt) scene.imagePrompt = revision.imagePrompt;
      if (revision.voiceoverText) scene.voiceoverText = cleanScriptText(revision.voiceoverText);
      if (revision.motionIntent) scene.motionIntent = revision.motionIntent.slice(0, 220);
    }
    if (debate.applied) {
      this.traceDecision(
        'plan_scenes',
        'planner_debate',
        `Gemini Pro revised ${debate.merged.length} scene(s) after reviewing product + reference frames`,
        [],
        0.8,
      );
    }
    this.reportPlannerDebate(onEvent, 'plan_scenes', 'scene plan', debate);
  }

  /** Surface a planning debate: one step line for the user, transcript in Details. */
  private reportPlannerDebate(
    onEvent: (e: AgentEvent) => void,
    phase: AgentPhase,
    subject: string,
    debate?: DebateOutcome<unknown>,
  ) {
    if (!debate || debate.skippedReason) return;
    this.outDebug(onEvent, phase, {
      type: 'markdown',
      label: 'Planner debate',
      content: debateTranscriptMarkdown(`Planner debate · ${subject}`, debate),
    });
    this.step(
      onEvent,
      phase,
      debate.applied
        ? `Planner debate on the ${subject} — Gemini Pro reviewed your product and reference frames and revised the plan.`
        : `Planner debate on the ${subject} — Gemini Pro checked the plan against your images and agreed.`,
    );
    if (debate.risks.length) {
      this.step(onEvent, phase, `Watch out: ${debate.risks[0]}`);
    }
  }

  /** Product hero plus a few reference frames, for image-aware planning. */
  private buildDebateImages(
    productBase64: string | null,
    productMime: string,
    refs: CreativeReferenceUpload[],
  ): DebateImage[] {
    const images: DebateImage[] = [];
    if (productBase64) {
      images.push({
        mimeType: productMime || 'image/png',
        data: productBase64,
        label: 'Product packshot',
      });
    }
    for (const ref of refs.slice(0, 5)) {
      if (!ref.base64) continue;
      images.push({
        mimeType: ref.mimeType || 'image/png',
        data: ref.base64,
        label: `Reference frame — ${ref.name}`,
      });
    }
    return images;
  }

  /**
   * A milestone worth reading — one short line, always visible in the canvas.
   * Use for what changed, not for how it was done.
   */
  private lastStepText = '';
  private step(onEvent: (e: AgentEvent) => void, phase: AgentPhase, text: string) {
    // Collapse accidental consecutive duplicates (Strict Mode / re-entry).
    if (text === this.lastStepText) return;
    this.lastStepText = text;
    this.outUser(onEvent, phase, { type: 'markdown', label: 'Step', content: text });
  }
  private check() { if (this.stopped) throw new Error('Agent stopped by user.'); }

  private traceDecision(
    phase: string,
    decisionType: string,
    decision: string,
    evidenceIds: string[] = [],
    confidence = 1,
  ) {
    if (!this.decisionTrace) return;
    recordTraceDecision(this.decisionTrace, { phase, decisionType, decision, evidenceIds, confidence });
  }

  private async persistDecisionTrace(session: SessionInfo | null): Promise<void> {
    if (!this.decisionTrace || !session) return;
    try {
      await uploadBase64(
        btoa(unescape(encodeURIComponent(serializeDecisionTrace(this.decisionTrace)))),
        'decision_trace.json',
        'application/json',
        session.sessionDir,
      );
    } catch (error: any) {
      this.decisionTrace.errors.push(`Trace persistence failed: ${error?.message || 'unknown error'}`);
    }
  }

  private async persistTaskMemory(session: SessionInfo | null): Promise<void> {
    if (!session) return;
    try {
      await uploadBase64(
        btoa(unescape(encodeURIComponent(JSON.stringify(this.taskMemory.toJSON(), null, 2)))),
        'task_memory.json',
        'application/json',
        session.sessionDir,
      );
    } catch {
      // non-fatal
    }
  }

  /** Returns formatted memory constraint block for a given phase (empty string if no memory). */
  private memoryFor(phase: string): string {
    const entries = this.memoryByPhase.get(phase) ?? [];
    return formatMemoryForPrompt(entries);
  }

  /** Load global + brand memory into a phase-indexed map for this run. */
  private async loadMemory(): Promise<void> {
    const phases: Array<'plan_scenes' | 'generate_images' | 'generate_voiceover' | 'all'> =
      ['plan_scenes', 'generate_images', 'generate_voiceover', 'all'];
    this.memoryByPhase.clear();
    for (const phase of phases) {
      const entries = await readMemory(phase, this.brandSlug);
      const existing = this.memoryByPhase.get(phase) ?? [];
      this.memoryByPhase.set(phase, [...existing, ...entries]);
    }
    // 'all' entries apply everywhere — merge into every phase
    const allEntries = this.memoryByPhase.get('all') ?? [];
    if (allEntries.length > 0) {
      for (const phase of phases.filter((p) => p !== 'all')) {
        const existing = this.memoryByPhase.get(phase) ?? [];
        this.memoryByPhase.set(phase, [...existing, ...allEntries]);
      }
    }
  }

  private async geminiText(prompt: string): Promise<string> {
    // Main-agent text uses the same multi-provider preference as the planner (default GLM 5.3 Flash).
    // Vision / image gen remain on Gemini Flash / Flash Image elsewhere.
    // GLM deep thinking is on so the agent can reason before acting.
    const requested = await resolveDefaultPlannerModel(this.lastConfig?.plannerModel);
    const result = await planText({
      prompt,
      requested,
      apiKey: this.lastConfig?.plannerApiKey || resolveApiKeyForModel(requested),
      enableReasoning: true,
      reasoningEffort: 'high',
    });
    return result.content;
  }

  /** Scene planning: configured provider (default GLM 5.3 Flash) with Gemini fallback. */
  private async planWithConfiguredModel(
    prompt: string,
    config: AgentConfig,
    onEvent: (e: AgentEvent) => void,
  ): Promise<string> {
    const requested = await resolveDefaultPlannerModel(config.plannerModel);
    const result = await planText({
      prompt,
      requested,
      apiKey: config.plannerApiKey || resolveApiKeyForModel(requested),
      enableReasoning: true,
      reasoningEffort: 'high',
    });
    this.traceDecision(
      'plan_scenes',
      'planner_model',
      `requested=${result.requested} actual=${result.actual} model=${result.modelId}`
        + (result.reasoning ? ' reasoning=1' : '')
        + (result.fallbackReason ? ` fallback=${result.fallbackReason}` : ''),
      ['planner-config'],
      result.actual === result.requested ? 1 : 0.7,
    );
    this.log(
      onEvent,
      'plan_scenes',
      result.fallbackReason
        ? `Planner fallback: requested ${result.requested} → ${result.actual} (${result.modelId})`
        : `Planner: ${result.actual} (${result.modelId}${result.reasoning ? ' · reasoning' : ''})`,
    );
    if (result.reasoning) {
      const clipped = result.reasoning.length > 4000
        ? `${result.reasoning.slice(0, 4000)}\n…`
        : result.reasoning;
      this.outDebug(onEvent, 'plan_scenes', {
        type: 'markdown',
        label: 'Planner Reasoning',
        content: clipped,
      });
    }
    if (result.fallbackReason) {
      this.out(onEvent, 'plan_scenes', {
        type: 'markdown',
        label: 'Planner Fallback',
        content: `Requested **${result.requested}**, used **${result.actual}** (\`${result.modelId}\`).\nReason: ${result.fallbackReason}`,
      });
    }
    return result.content;
  }

  private async gate(
    onEvent: (e: AgentEvent) => void,
    config: AgentConfig,
    phase: AgentPhase,
    question: string,
    details?: string,
    sceneMotionOptions?: ApprovalSceneMotion[],
    liveMotionMeta?: { modelLabel?: string; costPerClipUsd?: number },
  ): Promise<ApprovalResolution> {
    const approvalId = uid();
    const autoSec = config.reviewMode === 'auto' ? config.autoApproveSec : undefined;
    this.emit(onEvent, 'approval_needed', {
      phase,
      approval: {
        approvalId,
        phase,
        question,
        details,
        autoApproveAfterSec: autoSec,
        sceneMotionOptions,
        liveMotionModelLabel: liveMotionMeta?.modelLabel,
        liveMotionCostPerClipUsd: liveMotionMeta?.costPerClipUsd,
      },
    });

    return new Promise<ApprovalResolution>((resolve) => {
      this.pendingApprovals.set(approvalId, resolve);
      if (config.reviewMode === 'auto') {
        setTimeout(() => {
          if (this.pendingApprovals.has(approvalId)) {
            this.pendingApprovals.delete(approvalId);
            this.emit(onEvent, 'approval_resolved', { phase, message: 'Auto-approved.' });
            // Keep planned motion modes on auto-approve (no UI edits).
            resolve({
              approved: true,
              feedback: '',
              sceneMotionModes: sceneMotionOptions?.map((s) => ({
                index: s.index,
                motionMode: s.motionMode,
              })),
            });
          }
        }, (autoSec || 15) * 1000);
      }
    }).then((resolution: ApprovalResolution) => {
      if (resolution.feedback?.trim()) {
        this.taskMemory.rememberFeedback(phase, resolution.feedback);
      }
      return resolution;
    });
  }

  private emitTaskMemory(
    onEvent: (e: AgentEvent) => void,
    phase: AgentPhase,
  ): void {
    const md = this.taskMemory.formatMarkdown();
    if (!md.includes('No task notes')) {
      this.outDebug(onEvent, phase, { type: 'markdown', label: 'Task Memory', content: md });
    }
  }

  // ── Phase 1: Research ────────────────────────────────────────────────────────

  private async runResearch(
    productUrl: string,
    session: SessionInfo | null,
    onEvent: (e: AgentEvent) => void,
    creativeBrief = '',  // user's detailed prompt — guides what facts to surface
  ): Promise<{ title: string; facts: string[]; productBase64: string | null; productAbsPath: string | null }> {
    this.emit(onEvent, 'phase_start', { phase: 'research', message: 'Importing product page...' });

    // ── Step 1: If the user gave a detailed brief, interpret it first ──────────
    if (creativeBrief.trim()) {
      try {
        const briefInterpretationPrompt = `A user wants to create an ad with this creative brief:
"${creativeBrief}"
Product URL: ${productUrl}

Analyze the brief and extract:
1. Story intent: what narrative/mood/emotion is the user going for?
2. Key scenes or moments they described (list them)
3. Visual style clues (lighting, color, environment, people, actions)
4. What product facts would be most relevant to support this story?
5. What should NOT be the focus (things to avoid in this story)

Return ONLY a JSON object:
{
  "storyIntent": "<1-2 sentences>",
  "keyMoments": ["<moment 1>", "<moment 2>", ...],
  "visualStyle": "<lighting, color palette, mood, environment>",
  "relevantFacts": ["<what to look for on the product page>", ...],
  "avoid": ["<what to de-emphasize>"]
}`;
        const raw = await this.geminiText(briefInterpretationPrompt);
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const interp = JSON.parse(match[0]);
          const briefMd = [
            '## 🎬 Brief Understood',
            `**Story intent:** ${interp.storyIntent || creativeBrief.slice(0, 120)}`,
            interp.keyMoments?.length ? `\n**Key moments to create:**\n${(interp.keyMoments as string[]).map((m: string) => `- ${m}`).join('\n')}` : '',
            interp.visualStyle ? `\n**Visual direction:** ${interp.visualStyle}` : '',
            interp.avoid?.length ? `\n**De-emphasize:** ${(interp.avoid as string[]).join(', ')}` : '',
          ].filter(Boolean).join('\n');
          this.out(onEvent, 'research', { type: 'markdown', content: briefMd, label: 'Brief Interpretation' });
          // Store the interpretation for downstream phases
          (this as any)._briefInterpretation = interp;
        }
      } catch {
        // Non-blocking — just proceed with research
      }
    }

    const result = await importProductPageAssetsRich(productUrl, '', { executionMode: 'balanced', analyzeAssets: true });
    this.check();

    const title = result.productTitle || productUrl.split('/').pop() || 'Featured Product';
    const assets = result.assets;

    const heroAsset =
      assets.find((a) => a.quality === 'hero' && a.shotType === 'packshot') ||
      assets.find((a) => a.verdict === 'use_as_is' && a.shotType === 'packshot') ||
      assets.find((a) => a.quality === 'hero') ||
      assets.find((a) => a.verdict === 'use_as_is') ||
      assets[0];

    const summary = [
      `## ${title}`,
      `URL: ${productUrl}`,
      `Assets imported: ${assets.length}`,
      session ? `Session: ${session.sessionDir}` : 'Shell server offline — video assembly unavailable',
      assets.map((a) => `  • ${a.shotType || 'image'} — ${(a.semanticDescription || a.description || '').slice(0, 60)}`).join('\n'),
    ].join('\n');

    this.out(onEvent, 'research', { type: 'markdown', content: summary, label: 'Product Research' });

    const rawBase64 = heroAsset?.base64
      ? (heroAsset.base64.startsWith('data:') ? heroAsset.base64.split(',')[1] : heroAsset.base64)
      : null;

    const previewSrc = heroAsset?.previewUrl ||
      (rawBase64 ? `data:${heroAsset?.mimeType || 'image/png'};base64,${rawBase64}` : null);
    if (previewSrc) {
      this.out(onEvent, 'research', { type: 'image', url: previewSrc, label: 'Product reference (locked — used to preserve product identity in generated scenes)' });
    }

    let productAbsPath: string | null = null;
    if (rawBase64 && session) {
      try {
        const up = await uploadBase64(rawBase64, 'product_reference.png', heroAsset?.mimeType || 'image/png', session.sessionDir);
        productAbsPath = up.path;
        this.log(onEvent, 'research', `Product reference saved → ${session.sessionDir}/product_reference.png`);
      } catch (e: any) {
        this.log(onEvent, 'research', `Warning: could not save product reference: ${e.message}`);
      }
    }

    // Browse product page when Playwright MCP is available (Quiet+: short status + user screenshot).
    const wantsBrowse = Boolean(productUrl && !productUrl.startsWith('upload://'));
    if (wantsBrowse) {
      try {
        const mcpTools = await listMcpTools();
        const hasPlaywright = mcpTools.some((t) => t.serverName === 'playwright' && t.name === 'browser_navigate');
        if (!hasPlaywright) {
          this.log(onEvent, 'research', 'Browse unavailable — continuing with product import');
          this.outUser(onEvent, 'research', {
            type: 'markdown',
            label: 'Browse tip',
            content: 'Could not open a live browser for this product page. Continuing with imported product data.\n\nTo enable browsing, start the agent helper (`npm run dev:agent`) with Playwright MCP connected.',
          });
        } else {
          this.step(onEvent, 'research', `Browsing ${urlHostLabel(productUrl)} to see the real product page…`);
          await callMcpTool('playwright', 'browser_navigate', { url: productUrl });
          await callMcpTool('playwright', 'browser_wait_for', { time: 2000 });

          const snapshotResult = await callMcpTool('playwright', 'browser_snapshot', {});
          const snapshotText = snapshotResult.content.find((c) => c.type === 'text')?.text ?? '';
          if (snapshotText) {
            const excerpt = snapshotText.slice(0, 3000);
            this.outDebug(onEvent, 'research', {
              type: 'markdown',
              content: `**Page accessibility snapshot (first 3000 chars)**\n\`\`\`\n${excerpt}\n\`\`\``,
              label: 'Playwright page snapshot',
            });
          }

          await callMcpTool('playwright', 'browser_evaluate', {
            function: '() => { window.scrollTo(0, document.body.scrollHeight / 3); return true; }',
          });
          await callMcpTool('playwright', 'browser_wait_for', { time: 800 });
          await callMcpTool('playwright', 'browser_evaluate', {
            function: '() => { window.scrollTo(0, 0); return true; }',
          });
          await callMcpTool('playwright', 'browser_wait_for', { time: 600 });

          this.log(onEvent, 'research', 'Capturing product page…');
          const shot = await callMcpTool('playwright', 'browser_take_screenshot', { raw: false });
          const imgContent = shot.content.find(
            (c) => c.type === 'image' || (c.type === 'text' && (c.text ?? '').startsWith('data:')),
          );
          if (imgContent) {
            const dataUrl = imgContent.type === 'image'
              ? `data:image/png;base64,${imgContent.data ?? ''}`
              : imgContent.text ?? '';
            if (dataUrl) {
              this.outUser(onEvent, 'research', {
                type: 'image',
                url: dataUrl,
                label: 'Product page',
              });
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(onEvent, 'research', `Browse failed — ${msg.slice(0, 120)}`);
        this.outUser(onEvent, 'research', {
          type: 'markdown',
          label: 'Browse tip',
          content: `Could not browse the product page (${msg.slice(0, 160)}). Continuing with imported product data.\n\nTip: run \`npm run dev:agent\` and ensure Playwright MCP is connected.`,
        });
      }
    }

    // Start with visual asset descriptions
    const assetFacts = assets.slice(0, 6).map((a) => a.semanticDescription || a.description || '').filter(Boolean);

    // Merge with structured product knowledge (ingredients, benefits, claims from page text)
    const knowledge = getProductKnowledge(productUrl);
    const pageFacts = knowledge?.facts ?? [];

    // pageFacts come directly from the product page — they take precedence
    const rawFacts = pageFacts.length > 0
      ? [...pageFacts, ...assetFacts.slice(0, 2)]
      : assetFacts;

    if (pageFacts.length > 0) {
      const knowledgeMd = [
        '## Product Knowledge (from page)',
        ...pageFacts.map((f) => `- ${f}`),
      ].join('\n');
      this.out(onEvent, 'research', { type: 'markdown', content: knowledgeMd, label: 'Ingredients & Claims' });
    }

    // ── Step 2: If brief was provided, surface brief-relevant facts via AI ──────────
    let facts = rawFacts;
    if (creativeBrief.trim() && rawFacts.length > 0) {
      try {
        const relevancePrompt = `A user wants to create an ad with this creative brief:
"${creativeBrief}"

These are facts from the product page for "${title}":
${rawFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Task: Re-order and annotate these facts to surface those most relevant to the brief's story direction first.
Also add 2-3 contextual facts about what the brief implies (mood, occasion, lifestyle context) that the ad should convey — even if not literally on the product page.
Do NOT invent product ingredients, medical claims, or specifications. Only add story context.

Return ONLY a JSON array of strings (facts, most relevant first):
["<most story-relevant fact>", "<2nd most relevant>", ...]`;
        const raw = await this.geminiText(relevancePrompt);
        const match = raw.match(/\[[\s\S]*?\]/);
        if (match) {
          const reordered = JSON.parse(match[0]) as string[];
          if (reordered.length >= rawFacts.length - 1) {
            facts = reordered;
            this.out(onEvent, 'research', {
              type: 'markdown',
              content: `## Facts Aligned to Brief\n${reordered.slice(0, 8).map((f) => `- ${f}`).join('\n')}`,
              label: 'Story-Relevant Facts',
            });
          }
        }
      } catch {
        // Non-blocking — fall back to raw facts
      }
    }

    return { title, facts, productBase64: rawBase64, productAbsPath };
  }

  // ── Phase 1b: Brand Aesthetics Research ──────────────────────────────────────
  // Returns the style enum AND stores a rich BrandAesthetics fingerprint for
  // use in scene planning prompts (fonts, colors, tone, visual language).

  private brandAesthetics: {
    fontStyle: string;
    colorPalette: string;
    photoStyle: string;
    tone: string;
    designLanguage: string;
    moodWords: string[];
  } | null = null;

  private async researchBrandStyle(
    brandSlug: string,
    productUrl: string,
    onEvent: (e: AgentEvent) => void,
  ): Promise<'luxe_minimalist' | 'earthy_organic' | 'high_energy' | 'ugc_style'> {
    this.log(onEvent, 'research', `Analyzing brand aesthetics for ${brandSlug}...`);

    const aestheticsPrompt = `You are a brand strategist and art director. Analyze the visual identity and brand aesthetics for:
URL: ${productUrl}
Brand: ${brandSlug}

Research the brand's visual identity and return a JSON object with:
1. fontStyle: Describe the typography (e.g. "clean sans-serif like Inter, modern geometric", "elegant serif like Playfair Display, editorial", "handwritten/organic script, artisan feel")
2. colorPalette: Describe the actual colors (e.g. "muted sage green #8FAF8A, warm cream #F5EFE6, terracotta accent #C4714A", "deep navy #1A2B4A with gold #D4A843 accents, premium feel")
3. photoStyle: Describe photography aesthetic (e.g. "soft natural light, minimal staging, white backgrounds", "dark moody studio, dramatic shadows, high contrast", "lifestyle UGC-style, candid, authentic")
4. tone: Brand voice and personality (e.g. "calm, mindful, wellness-focused", "bold, energetic, youth-oriented", "luxurious, sophisticated, aspirational")
5. designLanguage: Overall design system (e.g. "lots of whitespace, thin lines, minimal elements", "earthy textures, hand-drawn elements, natural materials", "bold typography, high contrast, maximalist")
6. moodWords: Array of 5-7 single words that capture the brand mood
7. styleEnum: One of: luxe_minimalist, earthy_organic, high_energy, ugc_style

Return ONLY this JSON (no markdown):
{
  "fontStyle": "...",
  "colorPalette": "...",
  "photoStyle": "...",
  "tone": "...",
  "designLanguage": "...",
  "moodWords": ["word1", "word2", ...],
  "styleEnum": "..."
}`;

    try {
      const raw = await this.geminiText(aestheticsPrompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        this.brandAesthetics = {
          fontStyle: data.fontStyle || '',
          colorPalette: data.colorPalette || '',
          photoStyle: data.photoStyle || '',
          tone: data.tone || '',
          designLanguage: data.designLanguage || '',
          moodWords: Array.isArray(data.moodWords) ? data.moodWords : [],
        };

        const aestheticsMd = [
          `## 🎨 Brand Aesthetics — ${brandSlug}`,
          `**Typography:** ${data.fontStyle}`,
          `**Color palette:** ${data.colorPalette}`,
          `**Photography:** ${data.photoStyle}`,
          `**Tone:** ${data.tone}`,
          `**Design language:** ${data.designLanguage}`,
          `**Mood:** ${(data.moodWords as string[]).join(' · ')}`,
          `**Detected visual style:** \`${data.styleEnum}\``,
        ].join('\n');
        this.out(onEvent, 'research', { type: 'markdown', content: aestheticsMd, label: 'Brand Aesthetics' });

        const styleEnum = String(data.styleEnum || '').toLowerCase();
        if (styleEnum.includes('luxe') || styleEnum.includes('minimalist')) return 'luxe_minimalist';
        if (styleEnum.includes('earthy') || styleEnum.includes('organic')) return 'earthy_organic';
        if (styleEnum.includes('high') || styleEnum.includes('energy')) return 'high_energy';
        if (styleEnum.includes('ugc') || styleEnum.includes('raw')) return 'ugc_style';
      }
    } catch {
      this.log(onEvent, 'research', `Brand aesthetics research failed — using fallback detection`);
    }

    // Fallback: simple style detection
    try {
      const simplePrompt = `Brand URL: ${productUrl}\nReturn ONLY one of: luxe_minimalist, earthy_organic, high_energy, ugc_style`;
      const res = await this.geminiText(simplePrompt);
      const t = res.trim().toLowerCase();
      if (t.includes('luxe') || t.includes('minimalist')) return 'luxe_minimalist';
      if (t.includes('earthy') || t.includes('organic')) return 'earthy_organic';
      if (t.includes('high') || t.includes('energy')) return 'high_energy';
      if (t.includes('ugc') || t.includes('raw')) return 'ugc_style';
    } catch {}

    return 'luxe_minimalist';
  }


  // ── Phase 1c: Trend Research (Gemini + Google Search grounding) ──────────────

  private async researchTrends(
    productCategory: string,
    platform: AgentConfig['platform'],
    onEvent: (e: AgentEvent) => void,
  ): Promise<TrendInsights> {
    const platformName: Record<AgentConfig['platform'], string> = {
      instagram_reels: 'Instagram Reels',
      tiktok: 'TikTok',
      youtube_shorts: 'YouTube Shorts',
      instagram_feed: 'Instagram Feed',
      instagram_carousel: 'Instagram Carousel',
    };
    const platformLabel = platformName[platform];
    this.log(onEvent, 'research', `Researching live ${platformLabel} trends for "${productCategory}"...`);

    const prompt = `You are a social media trend analyst with access to live data. First infer the product category from the supplied product information, then research current ${platformLabel} ad trends for that category in 2026.
Product category: "${productCategory}"

Find:
1. Hook styles getting the most views for this product category on ${platformLabel} right now
2. Trending hashtags for this category on ${platformLabel} (platform-native, not generic)
3. Native content conventions that make an ad feel like organic ${platformLabel} content (not like an ad)
4. CTA style that converts best on ${platformLabel} in 2026
5. A ready-to-post caption for this category (platform-native tone, with hashtags, ≤150 chars)

Return ONLY this JSON (no markdown fences):
{
  "trendingHooks": ["<hook pattern>", "<hook>", "<hook>"],
  "topHashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "nativeConventions": ["<convention>", "<convention>", "<convention>"],
  "trendSummary": "<2-3 sentences about what is working on ${platformLabel} for this product category right now>",
  "postCaption": "<ready-to-post caption with hashtags and CTA in ${platformLabel} voice>"
}`;

    try {
      const res = await this.ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ parts: [{ text: prompt }] }],
        config: { tools: [{ googleSearch: {} }] } as any,
      });
      const text = (res.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? '').join('').trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const insights = JSON.parse(match[0]) as TrendInsights;
        const trendMd = [
          `## ${platformLabel} — Live Trend Research`,
          `**What's working:** ${insights.trendSummary}`,
          '',
          `**Trending hooks:** ${insights.trendingHooks.join(' · ')}`,
          `**Top hashtags:** ${insights.topHashtags.join(' ')}`,
          `**Native conventions:** ${insights.nativeConventions.join(' · ')}`,
          '',
          `**Post caption (ready to copy):**\n> ${insights.postCaption}`,
        ].join('\n');
        this.out(onEvent, 'research', { type: 'markdown', content: trendMd, label: `${platformLabel} Trend Research` });
        return insights;
      }
    } catch (e: any) {
      this.log(onEvent, 'research', `Trend research: ${e.message?.slice(0, 80)} — using platform defaults`);
    }

    // Platform-native fallbacks
    const fallbacks: Record<AgentConfig['platform'], TrendInsights> = {
      tiktok: {
        trendingHooks: ['Problem-first pattern interrupt', 'Before/after ingredient reveal', 'POV skincare routine'],
        topHashtags: ['#skincare', '#skintok', '#glowup', '#skincareroutine', '#tiktokbeauty'],
        nativeConventions: ['Hook in first 1.5s', 'Fast cuts ≤2s per scene', 'Creator-style voiceover not polished VO'],
        trendSummary: 'Authenticity outperforms polish on TikTok. Fast-paced proof-first content with relatable hooks.',
        postCaption: 'Your skin called — it wants this 🌿 #skincare #skintok #glowup',
      },
      instagram_reels: {
        trendingHooks: ['Aesthetic product reveal', 'Transformation montage', 'Ingredient flat lay reveal'],
        topHashtags: ['#skincare', '#beautyreels', '#glowskin', '#skincareproducts', '#reelsbeauty'],
        nativeConventions: ['Cohesive color palette across all scenes', 'Smooth transitions', 'Premium product shots'],
        trendSummary: 'Premium aesthetic storytelling with smooth transitions performs best on Reels. Visual cohesion is key.',
        postCaption: 'Skin that speaks for itself ✨ Shop link in bio → #skincare #beautyreels',
      },
      youtube_shorts: {
        trendingHooks: ['Spoken hook within 2s', 'Benefit-led opening', 'Curiosity gap question'],
        topHashtags: ['#skincare', '#skincareproducts', '#beautyshorts', '#glowup', '#youtubeshorts'],
        nativeConventions: ['Clear spoken voiceover', 'Benefits explained clearly', 'Subscribe CTA at end'],
        trendSummary: 'Shorts viewers expect informative content. Clear spoken hooks and benefit explanations perform well.',
        postCaption: 'The skincare secret you needed 🌟 Full routine in description! #skincare',
      },
      instagram_feed: {
        trendingHooks: ['Eye-catching hero image', 'Bold statement overlay', 'Product-first visual'],
        topHashtags: ['#skincare', '#beauty', '#skincareroutine', '#glowskin', '#naturalbeauty'],
        nativeConventions: ['High-res 4:5 image', 'Clean text overlay', 'Strong CTA in caption'],
        trendSummary: 'Feed posts favor high-quality imagery with clear messaging. Bold visuals with minimal text overlays.',
        postCaption: 'Your new skincare essential ✨ Link in bio → #skincare #beauty',
      },
      instagram_carousel: {
        trendingHooks: ['Swipe-worthy first slide', 'Educational series', 'Before/after transformation'],
        topHashtags: ['#skincare', '#beauty', '#skincarecarousel', '#beautytips', '#skincaretips'],
        nativeConventions: ['Consistent visual style across slides', 'Each slide adds value', 'CTA on last slide'],
        trendSummary: 'Carousel posts get highest engagement when each slide delivers value. Educational formats dominate.',
        postCaption: 'Swipe for your new favorite routine 👉 #skincare #skincaretips',
      },
    };
    return fallbacks[platform];
  }

  // ── Phase 2: Plan Scenes ─────────────────────────────────────────────────────

  private async planScenes(
    title: string,
    facts: string[],
    config: AgentConfig,
    onEvent: (e: AgentEvent) => void,
    creativeBrief = '',   // PRIMARY — user's story direction from their prompt text
    trends?: TrendInsights,
    evidenceGraph?: EvidenceGraph | null,
    plannerSpec?: NativePlannerSpec,
    selectedConcept?: CreativeConceptTerritory | null,
  ): Promise<ScenePlan[]> {
    this.emit(onEvent, 'phase_start', { phase: 'plan_scenes', message: 'Planning scenes...' });

    const refBeatCount = (creativeBrief.match(/### Beat \d+/g) || []).length;
    const durationSec = clampAdAgentDurationSec(config.durationSec);
    const bounds = plannerSpec
      ? { minScenes: plannerSpec.minScenes, maxScenes: plannerSpec.maxScenes }
      : null;
    const requestedSceneCount = refBeatCount >= 2
      ? Math.max(bounds?.minScenes ?? 1, Math.min(bounds?.maxScenes ?? 8, refBeatCount))
      : estimateAdAgentSceneCount(durationSec);
    const sceneCount = bounds
      ? Math.max(bounds.minScenes, Math.min(bounds.maxScenes, requestedSceneCount))
      : requestedSceneCount;
    const secPerScene = durationSec / sceneCount;
    const wordsPerScene = Math.floor(secPerScene * WORDS_PER_SEC);
    const factsText = facts.map((f, i) => `${i + 1}. ${f}`).join('\n') || title;

    const trendBlock = trends
      ? `PLATFORM TRENDS (weave in naturally):\n- ${trends.trendSummary}\n- Hooks: ${trends.trendingHooks.join(' · ')}\n- Native feel: ${trends.nativeConventions.join(' · ')}\n`
      : '';
    const conceptBlock = selectedConcept
      ? `WINNING CREATIVE CONCEPT — build this story:\n- Territory: ${selectedConcept.territory || selectedConcept.title}\n- Proposition: ${selectedConcept.proposition}\n- Hook: ${selectedConcept.hook}\n- Visual direction: ${selectedConcept.visualDirection}\n`
      : '';
    const evidenceBlock = evidenceGraph
      ? `EVIDENCE (accuracy guardrail — don't invent beyond these):\n${formatEvidenceGraphForPrompt(evidenceGraph)}\n`
      : '';
    const nativeBlock = plannerSpec ? `\n${formatNativePlannerPrompt(plannerSpec)}\n` : '';

    const brandAestheticsBlock = this.brandAesthetics ? [
      `BRAND AESTHETICS (apply to every image prompt — this is the brand's actual visual DNA):`,
      `- Typography feel: ${this.brandAesthetics.fontStyle}`,
      `- Color palette: ${this.brandAesthetics.colorPalette}`,
      `- Photography style: ${this.brandAesthetics.photoStyle}`,
      `- Brand tone: ${this.brandAesthetics.tone}`,
      `- Design language: ${this.brandAesthetics.designLanguage}`,
      `- Mood keywords: ${this.brandAesthetics.moodWords.join(', ')}`,
      `Apply these colors, textures, lighting, and visual language in EVERY image prompt you write.`,
    ].join('\n') : '';

    const vibe = config.vibe || 'balanced';
    const vibeBlock = {
      gen_z_bright: [
        'ENERGY / TONE (mandatory): Bright Gen Z creator energy.',
        '- Voiceover reads like a creator talking to a friend — casual, punchy, a little irreverent. NEVER ad-copy or corporate.',
        '- Visuals: bold saturated color pops, mid-action framing, real hands/people, playful text-overlay moments.',
        '- Edit feel: fast momentum, pattern interrupts, at least one unexpected/chaotic-fun beat.',
      ].join('\n'),
      balanced: [
        'ENERGY / TONE: Modern, confident, conversational. Contemporary color grade, clean momentum from hook to CTA.',
      ].join('\n'),
      premium_calm: [
        'ENERGY / TONE: Premium cinematic calm. Measured voiceover, editorial light and shadow, tactile close-ups, quiet-luxury restraint.',
      ].join('\n'),
    }[vibe];

    const scriptPrompt = `You are a short-form video director planning a ${config.durationSec}-second ${config.platform.replace(/_/g, ' ')} ad. You think in HOOKS, MOTION, and CUTS — not in still photographs.

${creativeBrief ? `CREATIVE BRIEF — THIS IS THE STORY YOU MUST TELL (follow precisely; if it contains a VIDEO TREATMENT with beats, map your scenes to those beats):\n"${creativeBrief}"\n\n` : ''}\
PRODUCT: ${title}
VISUAL STYLE: ${config.style.replace(/_/g, ' ')}
${vibeBlock}
${brandAestheticsBlock}
${trendBlock}
${conceptBlock}
${evidenceBlock}
PRODUCT FACTS (accuracy only — do not let these limit your creative narrative):
${factsText}

RULES:
- If a creative brief is given above, follow that story exactly. It is your primary instruction.
- SCENE 1 IS THE HOOK: it must earn the first 1.5 seconds — visual pattern interrupt + a spoken line that creates curiosity or tension. Never open on a static product shot.
- Escalate energy across scenes toward the payoff; end with a direct, casual CTA (not a slogan).
- ANTI-BORING: never a "product rotating on a pedestal" sequence, never a flat benefit-list read. Use platform-native formats (POV, before/after, reveal, whip-cut montage) when they fit the brief.
- Trend hooks above are ingredients, not decoration — build at least one scene around one of them when no brief overrides.
- NEVER invent medical or clinical claims not in the product facts list.
- Write each imagePrompt as a cinematographer directing a single real-camera frame: lighting, composition, color palette, mood, subject, camera angle, texture, aspect ratio 9:16. Specific and evocative (40–80 words).
${PRODUCT_PHOTO_REALISM_PLANNER_RULE}
${SCENE_CONTINUITY_PLANNER_RULES}
${/## REFERENCE STRUCTURE/i.test(creativeBrief) ? referenceStructurePlannerRules() : ''}
- Write each motionIntent as the director: what moves IN the frame and how we cut into/out of this beat (e.g. "hand snaps product into frame, whip-pan out", "steam rises as camera pushes in slowly"). 10–25 words.
- For each scene choose visualMode:
  • "product_locked" = exact product packshot/packaging MUST be visible and preserved exactly
  • "product_composite" = new creative scene where the product ALSO appears naturally in frame
  • "generated_fresh" = pure lifestyle/emotion/concept image — NO product visible (model, environment, abstract)
- Mix modes: 1–2 product_locked (hero/cta), rest composite or fresh to tell the story.
- Scene roles are flexible labels — use what fits your story (e.g. "hook", "problem", "ritual", "transformation", "reveal", "payoff", "cta").
${nativeBlock}
${this.memoryFor('plan_scenes')}

Return ONLY JSON (no markdown) with this shape — exactly ${sceneCount} scenes:
{
  "continuity": {
    "cast": "<one talent description OR 'product-only / hands-only'>",
    "wardrobe": "<locked wardrobe vibe>",
    "locationFamily": "<same world / set family>",
    "lightingPalette": "<lighting + color grade family>",
    "doNotChange": ["face", "hair", "product packaging", "location family"]
  },
  "scenes": [
    {
      "role": "<descriptive scene label>",
      "voiceoverText": "<spoken line ~${wordsPerScene} words, in the energy/tone above, no slogans>",
      "imagePrompt": "<detailed visual brief, 40–80 words; scene 2+ MUST start with 'continues from previous shot:'>",
      "motionIntent": "<what moves in frame / how we cut, 10–25 words>",
      "visualMode": "<product_locked | product_composite | generated_fresh>"
    }
  ]
}`;

    let scenesData: Array<{ role: string; voiceoverText: string; imagePrompt: string; motionIntent?: string; visualMode: SceneVisualMode }> = [];
    try {
      const raw = await this.planWithConfiguredModel(scriptPrompt, config, onEvent);
      const parsed = parsePlannerPayload(raw);
      this.sceneContinuity = parsed.continuity;
      scenesData = parsed.scenes as typeof scenesData;
    } catch {
      this.sceneContinuity = null;
    }
    this.check();

    // Fallback padding if AI returns fewer scenes than expected
    while (scenesData.length < sceneCount) {
      const i = scenesData.length;
      scenesData.push(fallbackVideoScene(title, i, sceneCount, creativeBrief));
    }
    if (!this.sceneContinuity) {
      this.sceneContinuity = synthesizeContinuityFromScenes(scenesData);
    }

    const validModes = new Set<SceneVisualMode>(['product_locked', 'product_composite', 'generated_fresh']);
    const continuity = this.sceneContinuity;
    const scenes: ScenePlan[] = scenesData.slice(0, sceneCount).map((s, i) => {
      const role = s.role || (i === 0 ? 'hook' : i === sceneCount - 1 ? 'cta' : 'story');
      const rawPrompt = s.imagePrompt || fallbackVideoScene(title, i, sceneCount, creativeBrief).imagePrompt;
      const imagePrompt = prependContinuityLock(rawPrompt, continuity, i);
      const rawVm: SceneVisualMode = validModes.has(s.visualMode) ? s.visualMode : (i === 0 ? 'product_locked' : 'generated_fresh');
      const vm = coerceAgentVisualMode(rawVm, imagePrompt, role);
      return {
        index: i,
        role,
        targetDurationSec: parseFloat(secPerScene.toFixed(2)),
        actualDurationSec: parseFloat(secPerScene.toFixed(2)),
        imagePrompt,
        voiceoverText: cleanScriptText(s.voiceoverText || fallbackVideoScene(title, i, sceneCount, creativeBrief).voiceoverText),
        visualMode: vm,
        useProductAsReference: vm !== 'generated_fresh',
        motionMode: config.preferLiveMotion ? 'live_motion' : 'still',
        motionIntent: typeof s.motionIntent === 'string' && s.motionIntent.trim()
          ? s.motionIntent.trim().slice(0, 220)
          : undefined,
      };
    });

    if (hasDuplicateCreativeScenes(scenes)) {
      this.out(onEvent, 'plan_scenes', {
        type: 'markdown',
        label: 'Scene Diversity Guard',
        content: 'The planner returned repeated scene copy or visual prompts, so the agent replaced duplicates with distinct hook, ritual, pour, lifestyle, and CTA beats before production.',
      });
      scenes.forEach((scene, index) => {
        const fallback = fallbackVideoScene(title, index, sceneCount, creativeBrief);
        scene.role = fallback.role;
        scene.voiceoverText = cleanScriptText(fallback.voiceoverText);
        scene.imagePrompt = prependContinuityLock(fallback.imagePrompt, continuity, index);
        scene.visualMode = fallback.visualMode;
        scene.useProductAsReference = fallback.visualMode !== 'generated_fresh';
        scene.motionMode = config.preferLiveMotion ? 'live_motion' : 'still';
      });
    }

    // Second planning turn: Pro looks at the product and reference frames and
    // revises beats before the storyboard reaches the approval gate.
    await this.applySceneDebate(scenes, title, facts, creativeBrief, onEvent);

    const totalWords = scenes.reduce((sum, sc) => sum + sc.voiceoverText.split(' ').length, 0);
    const liveCount = scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
    const liveModelLabel = getStudioI2vModel(
      resolveLiveMotionModelId(config.liveMotionModelId || DEFAULT_LIVE_MOTION_MODEL_ID),
    ).label;
    this.out(onEvent, 'plan_scenes', {
      type: 'markdown',
      label: 'Continuity Lock',
      content: formatContinuityLockMarkdown(continuity),
    });
    const planMd = [
      `## ${config.durationSec}s ${config.platform.replace(/_/g, ' ')} — ${sceneCount} scenes`,
      creativeBrief ? `**Brief:** ${creativeBrief.slice(0, 140)}${creativeBrief.length > 140 ? '…' : ''}` : '',
      `Estimated voiceover: ~${(totalWords / WORDS_PER_SEC).toFixed(0)}s`,
      liveCount > 0
        ? `**Motion:** ${liveCount}/${sceneCount} scene(s) Live Motion (${liveModelLabel}) · rest Ken Burns stills`
        : '**Motion:** Ken Burns stills (enable Live Motion in Ad Creator or flip scenes at the approval gate)',
      '',
      ...scenes.map((s) =>
        `**Scene ${s.index + 1}: ${s.role.toUpperCase()}** · ${s.targetDurationSec}s · \`${s.visualMode}\` · ${(s.motionMode || 'still') === 'live_motion' ? 'Live Motion' : 'Still'}\n> "${s.voiceoverText}"\n> _Image: ${s.imagePrompt.slice(0, 100)}…_${s.motionIntent ? `\n> _Motion: ${s.motionIntent}_` : ''}`
      ),
    ].filter(Boolean).join('\n\n');

    this.step(onEvent, 'plan_scenes', `Storyboard ready — ${scenes.length} scenes.`);
    this.out(onEvent, 'plan_scenes', { type: 'markdown', content: planMd, label: 'Scene Plan' });
    return scenes;
  }

  // ── Phase 2b: Plan Carousel Slides ───────────────────────────────────────────────

  private async planCarouselSlides(
    title: string,
    facts: string[],
    config: AgentConfig,
    onEvent: (e: AgentEvent) => void,
    creativeBrief = '',   // PRIMARY — user's story direction
    feedbackHint = '',    // feedback from approval gate re-plans
    trends?: TrendInsights,
    evidenceGraph?: EvidenceGraph | null,
    plannerSpec?: NativePlannerSpec,
    selectedConcept?: CreativeConceptTerritory | null,
  ): Promise<ScenePlan[]> {
    this.emit(onEvent, 'phase_start', { phase: 'plan_scenes', message: 'Planning carousel slides...' });

    const refBeatCount = (creativeBrief.match(/### Beat \d+/g) || []).length;
    const slideCount = refBeatCount >= 2
      ? Math.max(2, Math.min(10, refBeatCount))
      : Math.max(3, Math.min(10, 5));
    const factsText = facts.map((f, i) => `${i + 1}. ${f}`).join('\n') || title;

    const trendBlock = trends
      ? `PLATFORM TRENDS (weave in naturally):\n- ${trends.trendSummary}\n- Hooks: ${trends.trendingHooks.join(' · ')}\n- Native feel: ${trends.nativeConventions.join(' · ')}\n`
      : '';
    const conceptBlock = selectedConcept
      ? `WINNING CREATIVE CONCEPT — build this story:\n- Proposition: ${selectedConcept.proposition}\n- Hook: ${selectedConcept.hook}\n- Visual direction: ${selectedConcept.visualDirection}\n`
      : '';
    const evidenceBlock = evidenceGraph
      ? `EVIDENCE (accuracy guardrail — don't invent beyond these):\n${formatEvidenceGraphForPrompt(evidenceGraph)}\n`
      : '';
    const nativeBlock = plannerSpec ? `\n${formatNativePlannerPrompt(plannerSpec)}\n` : '';

    const brandAestheticsBlock = this.brandAesthetics ? [
      `BRAND AESTHETICS (apply to every image prompt — this is the brand's actual visual DNA):`,
      `- Typography feel: ${this.brandAesthetics.fontStyle}`,
      `- Color palette: ${this.brandAesthetics.colorPalette}`,
      `- Photography style: ${this.brandAesthetics.photoStyle}`,
      `- Brand tone: ${this.brandAesthetics.tone}`,
      `- Design language: ${this.brandAesthetics.designLanguage}`,
      `- Mood keywords: ${this.brandAesthetics.moodWords.join(', ')}`,
      `Apply these colors, textures, lighting, and visual language in EVERY image prompt you write.`,
    ].join('\n') : '';

    const carouselPrompt = `You are a creative art director planning an Instagram carousel ad.

${creativeBrief ? `CREATIVE BRIEF — THIS IS THE STORY YOU MUST TELL (follow precisely):\n"${creativeBrief}"\n\n` : ''}\
${feedbackHint ? `USER REFINEMENT:\n"${feedbackHint}"\n\n` : ''}\
PRODUCT: ${title}
VISUAL STYLE: ${config.style.replace(/_/g, ' ')}
${brandAestheticsBlock}
${trendBlock}
${conceptBlock}
${evidenceBlock}
PRODUCT FACTS (accuracy only — do not let these limit your creative story):
${factsText}

RULES:
- If a creative brief is given above, tell that story. It is your primary instruction.
- If no brief, create a compelling narrative for this product — not a formulaic hook/benefit/CTA grid.
- NEVER invent medical or clinical claims not in the product facts.
- Write each imagePrompt as a professional art director briefing a real product shoot: lighting, composition, color palette, mood, camera angle, texture, 1:1 square format. Be specific (40–80 words).
${PRODUCT_PHOTO_REALISM_PLANNER_RULE}
${SCENE_CONTINUITY_PLANNER_RULES}
${/## REFERENCE STRUCTURE/i.test(creativeBrief) ? referenceStructurePlannerRules() : ''}
- For each slide choose visualMode:
  • "product_locked" = exact product packshot/packaging MUST be visible and locked
  • "product_composite" = new creative scene where product ALSO appears naturally
  • "generated_fresh" = pure lifestyle/emotion/concept — NO product visible
- Typical structure: slide 1 product hero (product_locked), slides 2–4 story/lifestyle (mix), slide 5 CTA.
- Each slide must deliver standalone value. Slide 1 headline must stop the scroll (max 5 words).
${nativeBlock}
${this.memoryFor('plan_scenes')}

Return ONLY JSON (no markdown) with this shape — exactly ${slideCount} slides:
{
  "continuity": {
    "cast": "<one talent description OR 'product-only / hands-only'>",
    "wardrobe": "<locked wardrobe vibe>",
    "locationFamily": "<same world / set family>",
    "lightingPalette": "<lighting + color grade family>",
    "doNotChange": ["face", "hair", "product packaging", "location family"]
  },
  "scenes": [
    {
      "headline": "<max 5 words>",
      "body": "<max 12 words>",
      "imagePrompt": "<detailed visual brief, 40–80 words; slide 2+ MUST start with 'continues from previous shot:'>",
      "visualMode": "<product_locked | product_composite | generated_fresh>"
    }
  ]
}`;


    let slidesData: Array<{ headline: string; body: string; imagePrompt: string; visualMode?: SceneVisualMode }> = [];
    try {
      const raw = await this.planWithConfiguredModel(carouselPrompt, config, onEvent);
      const parsed = parsePlannerPayload(raw);
      this.sceneContinuity = parsed.continuity;
      slidesData = parsed.scenes.map((s) => ({
        headline: String(s.headline || ''),
        body: String(s.body || ''),
        imagePrompt: String(s.imagePrompt || ''),
        visualMode: s.visualMode as SceneVisualMode | undefined,
      }));
    } catch {
      this.sceneContinuity = null;
    }
    this.check();

    // Fallback padding
    while (slidesData.length < slideCount) {
      const i = slidesData.length;
      slidesData.push(fallbackCarouselSlide(title, i, slideCount, creativeBrief));
    }
    if (!this.sceneContinuity) {
      this.sceneContinuity = synthesizeContinuityFromScenes(slidesData);
    }

    const validModes = new Set<SceneVisualMode>(['product_locked', 'product_composite', 'generated_fresh']);
    const continuity = this.sceneContinuity;
    const scenes: ScenePlan[] = slidesData.slice(0, slideCount).map((slide, i) => {
      const rawVm: SceneVisualMode = validModes.has(slide.visualMode as SceneVisualMode)
        ? slide.visualMode as SceneVisualMode
        : (i === 0 ? 'product_locked' : i === slideCount - 1 ? 'product_composite' : 'generated_fresh');
      const imagePrompt = prependContinuityLock(slide.imagePrompt, continuity, i);
      const vm = coerceAgentVisualMode(rawVm, imagePrompt, i === 0 ? 'hook' : i === slideCount - 1 ? 'cta' : 'story');
      return {
        index: i,
        role: i === 0 ? 'hook' : i === slideCount - 1 ? 'cta' : 'story',
        targetDurationSec: 0,
        actualDurationSec: 0,
        imagePrompt,
        voiceoverText: '',
        visualMode: vm,
        useProductAsReference: vm !== 'generated_fresh',
        slideHeadline: cleanScriptText(slide.headline),
        slideBody: cleanScriptText(slide.body),
      };
    });

    if (hasDuplicateCreativeScenes(scenes)) {
      this.out(onEvent, 'plan_scenes', {
        type: 'markdown',
        label: 'Carousel Diversity Guard',
        content: 'The planner returned repeated slide copy or visual prompts, so the agent replaced the set with distinct hook, scoop, whisk, pour, and CTA slides before production.',
      });
      scenes.forEach((scene, index) => {
        const fallback = fallbackCarouselSlide(title, index, slideCount, creativeBrief);
        scene.slideHeadline = cleanScriptText(fallback.headline);
        scene.slideBody = cleanScriptText(fallback.body);
        scene.imagePrompt = prependContinuityLock(fallback.imagePrompt, continuity, index);
        scene.visualMode = fallback.visualMode;
        scene.useProductAsReference = fallback.visualMode !== 'generated_fresh';
      });
    }

    this.out(onEvent, 'plan_scenes', {
      type: 'markdown',
      label: 'Continuity Lock',
      content: formatContinuityLockMarkdown(continuity),
    });
    const planMd = [
      `## Instagram Carousel — ${slideCount} slides`,
      creativeBrief ? `**Brief:** ${creativeBrief.slice(0, 140)}${creativeBrief.length > 140 ? '…' : ''}` : '',
      '',
      ...scenes.map((s) =>
        `**Slide ${s.index + 1}** · \`${s.visualMode}\`\n> Headline: "${s.slideHeadline}"\n> Body: "${s.slideBody}"\n> _Image: ${s.imagePrompt.slice(0, 100)}…_`
      ),
    ].filter(Boolean).join('\n\n');

    await this.applySceneDebate(scenes, title, facts, creativeBrief, onEvent);

    this.step(onEvent, 'plan_scenes', `Carousel planned — ${scenes.length} slides.`);
    this.out(onEvent, 'plan_scenes', { type: 'markdown', content: planMd, label: 'Carousel Plan' });
    return scenes;
  }

  // ── Phase 3: Generate Images ──────────────────────────────────────────────────

  private async generateImages(
    scenes: ScenePlan[],
    productBase64: string | null,
    session: SessionInfo | null,
    onEvent: (e: AgentEvent) => void,
    config?: AgentConfig,
  ): Promise<ScenePlan[]> {
    this.emit(onEvent, 'phase_start', { phase: 'generate_images', message: `Generating ${scenes.length} scene images...` });
    const updated = [...scenes];

    const generateOne = async (scene: ScenePlan, opts?: { simplified?: boolean; prevScene?: ScenePlan }): Promise<void> => {
      // Agency exact-asset lock: use curated bytes, do not hallucinate a new packshot.
      if (scene.preserveExactAsset && scene.lockedAssetBase64) {
        const raw = scene.lockedAssetBase64.startsWith('data:')
          ? scene.lockedAssetBase64.split(',')[1]
          : scene.lockedAssetBase64;
        const mimeType = scene.lockedAssetMimeType || 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${raw}`;
        scene.imageUrl = dataUrl;
        this.out(onEvent, 'generate_images', {
          type: 'image',
          url: dataUrl,
          label: `Scene ${scene.index + 1}: ${scene.role} · Agency locked asset`,
        });
        this.log(onEvent, 'generate_images', `Scene ${scene.index + 1}: using Agency locked asset (skipped generation)`);
        if (session) {
          const ext = mimeType.includes('png') ? 'png' : 'jpg';
          const filename = `scene_${scene.index}.${ext}`;
          const up = await uploadBase64(raw, filename, mimeType, session.sessionDir);
          scene.imageAbsPath = up.path;
        }
        return;
      }

      const visualMode = coerceAgentVisualMode(
        resolveSceneVisualMode(scene),
        scene.imagePrompt || '',
        scene.role || '',
      );
      scene.visualMode = visualMode;
      scene.useProductAsReference = visualMode !== 'generated_fresh';
      const sceneRefBase64 = scene.lockedAssetBase64
        ? (scene.lockedAssetBase64.startsWith('data:') ? scene.lockedAssetBase64.split(',')[1] : scene.lockedAssetBase64)
        : productBase64;
      const sceneRefMime = scene.lockedAssetMimeType || 'image/png';
      const useRef = visualMode !== 'generated_fresh' && !!sceneRefBase64;
      if (visualMode !== 'generated_fresh' && !sceneRefBase64) {
        throw new Error(
          `Scene ${scene.index + 1} (${scene.role}) requires the real product image as a reference, but none is available. Import a product photo or lock an Agency asset, then retry.`,
        );
      }
      const assignedReferences = scene.referenceAssignment?.references || [];
      const avoidBlock = scene.referenceAssignment?.avoidConstraints.length
        ? `\n\nAVOID THESE USER-REJECTED DIRECTIONS:\n- ${scene.referenceAssignment.avoidConstraints.join('\n- ')}`
        : '';
      const memBlock = this.memoryFor('generate_images');
      const augmentedPrompt = memBlock
        ? `${scene.imagePrompt}${avoidBlock}\n\n[CONSTRAINTS FROM PAST RUNS]\n${memBlock}`
        : `${scene.imagePrompt}${avoidBlock}`;
      // Simplified retry: drop multi-refs (common cause of empty Gemini image responses)
      // and keep only the primary product reference when required.
      const references = opts?.simplified
        ? []
        : assignedReferences
          .filter((reference) => visualMode !== 'generated_fresh' || reference.role !== 'product_identity')
          .map((reference) => ({
            input: { data: reference.base64, mimeType: reference.mimeType },
            role: reference.role === 'product_identity' ? 'product' as const
              : reference.role === 'lifestyle_reference' ? 'person' as const
              : reference.role === 'composition_reference' ? 'environment' as const
              : 'style_guide' as const,
            preserve: reference.preserve,
            modify: `Use only for ${reference.description}. Do not copy other brand identity or text.`,
          }));
      const productRule = visualMode === 'product_locked'
        ? '\n\nPRODUCT LOCK: Preserve the exact product, packaging, label, logo, proportions, colors, and text. Do not redesign or hallucinate the product.'
        : visualMode === 'product_composite'
          ? '\n\nPRODUCT COMPOSITE: Generate a fresh scene, but preserve the supplied product identity exactly wherever it is visible.'
          : '\n\nGENERATE FRESH: Create a distinct supporting visual. Do not insert the product or reuse the product packshot.';
      const mode = opts?.simplified
        ? (useRef ? 'edit' : 'generate')
        : (references.length || visualMode === 'product_composite' ? 'composite' : useRef ? 'edit' : 'generate');

      // Continuity via bible text lock (parallel-safe). Optional prev still only when
      // already on disk (e.g. selective redo of a later beat) — never block the pool.
      const prevScene = opts?.prevScene;
      const prevBase64 = extractImageBase64FromDataUrl(prevScene?.imageUrl)
        || (prevScene?.lockedAssetBase64
          ? (prevScene.lockedAssetBase64.startsWith('data:')
            ? prevScene.lockedAssetBase64.split(',')[1]
            : prevScene.lockedAssetBase64)
          : undefined);
      const continuity = this.sceneContinuity;
      const lockedPrompt = continuity
        ? prependContinuityLock(`${augmentedPrompt}${productRule}`, continuity, scene.index)
        : `${augmentedPrompt}${productRule}`;
      const useCharacterContinuity = Boolean(prevBase64) && continuityImpliesPerson(continuity);

      const base64 = await generateImageAsset({
        mode,
        imagePrompt: appendProductPhotoRealism(lockedPrompt),
        visualDescription: `${scene.role}: ${scene.voiceoverText}`,
        ...(useRef ? { primaryReference: { data: sceneRefBase64!, mimeType: sceneRefMime } } : {}),
        references,
        skipPromptReview: !!opts?.simplified,
        ...(prevBase64 && !opts?.simplified ? {
          prevSceneReference: { data: prevBase64, mimeType: 'image/png' },
          prevSceneText: prevScene?.voiceoverText || prevScene?.imagePrompt?.slice(0, 160),
          continuityDomain: useCharacterContinuity ? 'character' as const : undefined,
        } : {}),
      });

      const dataUrl = `data:image/png;base64,${base64}`;
      scene.imageUrl = dataUrl;

      this.out(onEvent, 'generate_images', {
        type: 'image',
        url: dataUrl,
        label: `Scene ${scene.index + 1}: ${scene.role} (${scene.targetDurationSec}s)${opts?.simplified ? ' · simplified retry' : ''}${prevBase64 && !opts?.simplified ? ' · continuity' : ''}`,
      });

      if (session) {
        const filename = `scene_${scene.index}.png`;
        const up = await uploadBase64(base64, filename, 'image/png', session.sessionDir);
        scene.imageAbsPath = up.path;
      }
    };

    // Parallel stills (bible lock keeps cast/world aligned without serial chaining).
    const IMAGE_CONCURRENCY = 3;
    let pending = updated.filter((s) => s.regenerate !== false).map((s) => s.index);
    pending = [...pending].sort((a, b) => a - b);
    if (pending.length > 1) {
      this.log(onEvent, 'generate_images',
        `Generating ${pending.length} scene image(s) in parallel (×${Math.min(IMAGE_CONCURRENCY, pending.length)})...`);
    }
    while (pending.length > 0) {
      const failures: Array<{ index: number; role: string; error: string }> = [];
      await mapWithConcurrency(pending, IMAGE_CONCURRENCY, async (sceneIndex) => {
        const scene = updated.find((s) => s.index === sceneIndex);
        if (!scene) return;
        const prevScene = updated.find((s) => s.index === sceneIndex - 1);
        const canChain = Boolean(prevScene?.imageUrl || prevScene?.lockedAssetBase64);
        this.check();
        this.log(onEvent, 'generate_images',
          `Scene ${scene.index + 1}/${updated.length}: ${scene.role}${canChain ? ' (prev still available)' : ''}`);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await generateOne(scene, {
              simplified: attempt > 0,
              prevScene: canChain ? prevScene : undefined,
            });
            return;
          } catch (err: any) {
            if (this.stopped) throw err;
            const message = String(err?.message || err);
            if (attempt === 0) {
              this.log(onEvent, 'generate_images',
                `Scene ${scene.index + 1}: image attempt failed (${message.slice(0, 180)}) — retrying simplified...`);
            } else {
              failures.push({ index: scene.index, role: scene.role || 'scene', error: message });
              this.out(onEvent, 'generate_images', {
                type: 'error',
                content: `Scene ${scene.index + 1} failed: ${message}`,
              });
            }
          }
        }
      });
      this.check();
      if (!failures.length) break;

      const failureLines = failures
        .map((f) => `Scene ${f.index + 1} (${f.role}): ${f.error.slice(0, 220)}`)
        .join('\n');
      this.out(onEvent, 'generate_images', {
        type: 'error',
        content: `Image generation failed after retry:\n${failureLines}`,
      });

      if (!config) {
        throw new Error(`Image generation failed for ${failures.map((f) => `scene ${f.index + 1}: ${f.error}`).join(' | ')}`);
      }

      const failureGate = await this.gate(
        onEvent,
        config,
        'generate_images',
        `Image generation failed for ${failures.length} scene(s) — retry?`,
        'Approve = retry the failed scenes. Type "retry" in feedback for the same. '
          + 'Stop = end the run (prompt and setup are kept; click Run Agent to restart).',
      );
      this.check();
      if (!failureGate.approved) {
        this.emit(onEvent, 'stopped', { message: 'Stopped at image generation failure gate.' });
        throw new Error('Agent stopped by user.');
      }
      this.log(onEvent, 'generate_images',
        `Retrying image generation for scene(s) ${failures.map((f) => f.index + 1).join(', ')}...`);
      pending = failures.map((f) => f.index).sort((a, b) => a - b);
    }

    return updated;
  }

  // ── Phase 4: Generate Voiceover ───────────────────────────────────────────────

  private async generateVoiceovers(
    scenes: ScenePlan[],
    voice: string,
    session: SessionInfo | null,
    onEvent: (e: AgentEvent) => void,
  ): Promise<ScenePlan[]> {
    this.emit(onEvent, 'phase_start', { phase: 'generate_voiceover', message: 'Generating voiceover...' });
    const updated = [...scenes];
    const failures: string[] = [];

    // TTS calls are independent per scene — run up to 4 in parallel.
    await mapWithConcurrency(updated, 4, async (scene) => {
      this.check();
      this.log(onEvent, 'generate_voiceover', `Scene ${scene.index + 1}: "${scene.voiceoverText.slice(0, 50)}..."`);

      try {
        const rawB64 = await generateVoiceover(scene.voiceoverText, {
          provider: 'gemini', id: voice || 'Kore', name: voice || 'Kore', language: 'en-US',
        } as any);

        // Wrap raw PCM in WAV header — Gemini TTS returns PCM16 24kHz mono
        const wavB64 = pcmToWav(rawB64, 24000, 1, 16);
        const filename = `voice_${scene.index}.wav`;

        if (session) {
          const up = await uploadBase64(wavB64, filename, 'audio/wav', session.sessionDir);
          scene.audioAbsPath = up.path;

          const actualDur = await getAudioDuration(up.path, session.sessionDir);
          scene.actualDurationSec = actualDur > 0.5 ? actualDur : scene.targetDurationSec;
          this.log(onEvent, 'generate_voiceover',
            `Scene ${scene.index + 1}: ${scene.actualDurationSec.toFixed(1)}s actual (target ${scene.targetDurationSec.toFixed(1)}s)`);
        } else {
          const dataUrl = `data:audio/wav;base64,${wavB64}`;
          this.out(onEvent, 'generate_voiceover', { type: 'audio', url: dataUrl, label: `Scene ${scene.index + 1}` });
        }
      } catch (err: any) {
        if (this.stopped) throw err;
        failures.push(`scene ${scene.index + 1}: ${err.message}`);
        this.out(onEvent, 'generate_voiceover', { type: 'error', content: `Scene ${scene.index + 1} audio failed: ${err.message}` });
      }
    });

    if (failures.length) {
      throw new Error(`Voiceover generation failed for ${failures.join(' | ')}`);
    }

    // Concatenate audio segments
    if (session) {
      const audioPaths = updated.map((s) => s.audioAbsPath).filter((p): p is string => !!p);
      if (audioPaths.length > 0) {
        const fullAudioPath = `${session.sessionDir}/voiceover_full.wav`;
        const concatResult = await concatAudio(audioPaths, fullAudioPath, session.sessionDir);
        if (concatResult.ok) {
          const totalDur = await getAudioDuration(fullAudioPath, session.sessionDir);
          this.log(onEvent, 'generate_voiceover', `Full voiceover: ${totalDur.toFixed(1)}s`);
        } else {
          this.log(onEvent, 'generate_voiceover', `Audio concat warning: ${concatResult.stderr.slice(-100)}`);
        }
      }

      const timingMd = [
        '## Scene Timings (actual TTS)',
        ...updated.map((s) => `Scene ${s.index + 1} (${s.role}): ${s.actualDurationSec.toFixed(1)}s`),
        `Total: ${updated.reduce((t, s) => t + s.actualDurationSec, 0).toFixed(1)}s`,
      ].join('\n');
      this.out(onEvent, 'generate_voiceover', { type: 'markdown', content: timingMd, label: 'Timing' });
    }

    return updated;
  }

  private async reviewAndRegenerateVisuals(
    scenes: ScenePlan[],
    productBase64: string | null,
    session: SessionInfo | null,
    onEvent: (e: AgentEvent) => void,
    config?: AgentConfig,
  ): Promise<ScenePlan[]> {
    if (!this.evidenceGraph) return scenes;
    let updated = scenes;
    for (let round = 0; round < 2; round++) {
      const reviews: VisualCriticReview[] = await Promise.all(updated.map((scene) => reviewVisualScene({
        sceneIndex: scene.index,
        imagePrompt: scene.imagePrompt,
        visualDescription: `${scene.role}: ${scene.voiceoverText || scene.slideBody || ''}`,
        hasProductReference: scene.useProductAsReference,
        generatedImageBase64: scene.imageUrl?.startsWith('data:') ? scene.imageUrl.split(',')[1] : undefined,
        productReferenceBase64: productBase64 || undefined,
        evidenceGraph: this.evidenceGraph!,
        assignedReferenceCount: scene.referenceAssignment?.references.length || 0,
      })));
      const failed = reviews.filter((review) => !review.passed);
      // Never regenerate Agency exact-locked assets — curation is authoritative.
      const regenerableFailed = failed.filter((review) => {
        const scene = updated.find((item) => item.index === review.sceneIndex);
        return !scene?.preserveExactAsset;
      });
      this.traceDecision(
        'generate_images',
        'visual_critic',
        `Visual critic round ${round + 1}: ${reviews.length - failed.length}/${reviews.length} scenes passed`
          + (failed.length !== regenerableFailed.length
            ? ` · ${failed.length - regenerableFailed.length} Agency-locked skipped`
            : ''),
        reviews.map((review) => `visual-review-scene-${review.sceneIndex + 1}`),
        reviews.length ? reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length : 1,
      );
      this.outReview(onEvent, 'generate_images', {
        type: 'markdown',
        label: `Visual Critic · Round ${round + 1}`,
        content: reviews.map((review) => {
          const scene = updated.find((item) => item.index === review.sceneIndex);
          const lockedNote = scene?.preserveExactAsset ? ' · AGENCY LOCKED (no regen)' : '';
          return `**Scene ${review.sceneIndex + 1} · ${review.passed ? 'PASS' : (scene?.preserveExactAsset ? 'LOCKED' : 'REGENERATE')} · ${(review.score * 100).toFixed(0)}%${lockedNote}**\n`
            + `${review.findings.length ? review.findings.map((finding) => `- ${finding}`).join('\n') : '- Product identity, intended use, and scene alignment passed.'}`;
        }).join('\n\n'),
      });
      if (!regenerableFailed.length) return updated;

      const regenerationCandidates = selectScenesForRegeneration(this.regenerationPolicy, regenerableFailed);
      if (!regenerationCandidates.length) break;
      updated = updated.map((scene) => {
        const candidate = regenerationCandidates.find((item) => item.sceneIndex === scene.index);
        return candidate
          ? { ...scene, imagePrompt: `${scene.imagePrompt}\n\nMANDATORY VISUAL CRITIC CORRECTION:\n${candidate.correctionPrompt}`, regenerate: true }
          : { ...scene, regenerate: false };
      });
      updated = await this.generateImages(updated, productBase64, session, onEvent, config);
    }
    if (this.regenerationPolicy.exhaustedSceneIndexes.length) {
      throw new Error(`Visual critic could not resolve scenes after capped retries: ${this.regenerationPolicy.exhaustedSceneIndexes.map((index) => index + 1).join(', ')}`);
    }
    return updated;
  }

  // ── Phase 5: Assemble Video ───────────────────────────────────────────────────

  /** Animate Live Motion scenes with multi-provider I2V and time-fit to on-screen duration. */
  private async generateLiveMotionClips(
    scenes: ScenePlan[],
    config: AgentConfig,
    session: SessionInfo,
    onEvent: (e: AgentEvent) => void,
    productBase64?: string | null,
  ): Promise<ScenePlan[]> {
    // Skip scenes that already have a fitted clip (selective redo only re-animates cleared ones).
    const liveScenes = scenes.filter(
      (s) => (s.motionMode || 'still') === 'live_motion' && !s.motionClipAbsPath,
    );
    if (liveScenes.length === 0) return scenes;

    const modelId = resolveLiveMotionModelId(config.liveMotionModelId || DEFAULT_LIVE_MOTION_MODEL_ID);
    const model = getStudioI2vModel(modelId);
    const avgDuration = liveScenes.reduce(
      (sum, s) => sum + (s.actualDurationSec || s.targetDurationSec || 6),
      0,
    ) / Math.max(1, liveScenes.length);

    this.emit(onEvent, 'phase_start', {
      phase: 'cost_confirmation',
      message: 'Live Motion cost confirmation...',
    });
    const estimate = estimateWanI2vCost(liveScenes.length, {
      modelId,
      durationSec: avgDuration,
    });
    const costGate = await this.gate(
      onEvent,
      config,
      'cost_confirmation',
      `Live Motion uses ${model.label} (paid). Approve to animate selected scenes?`,
      estimate.warning,
      undefined,
      {
        modelLabel: model.label,
        costPerClipUsd: estimateLiveMotionCostPerClipUsd(modelId, avgDuration),
      },
    );
    this.check();
    if (!costGate.approved) {
      this.emit(onEvent, 'stopped', { message: 'Stopped at Live Motion cost confirmation.' });
      throw new Error('Agent stopped by user.');
    }
    if (!(await this.updateLoopSignals(onEvent, config, {}, estimate.estimatedUsd || 0))) {
      throw new Error('Agent stopped by user.');
    }

    this.emit(onEvent, 'phase_start', {
      phase: 'generate_live_motion',
      message: `Animating ${liveScenes.length} scene(s) with ${model.label}...`,
    });
    this.traceDecision(
      'generate_live_motion',
      'live_motion_i2v_batch',
      `Animating ${liveScenes.length} Live Motion scene(s) via ${model.label} (~$${estimate.estimatedUsd})`,
      ['scene-motion-mode', model.provider],
      1,
    );

    const next = [...scenes];

    const animateScene = async (sceneIndex: number): Promise<void> => {
      const idx = next.findIndex((s) => s.index === sceneIndex);
      if (idx < 0) return;
      const current = next[idx];
      const stillBase64 = current.lockedAssetBase64
        || (current.imageUrl?.startsWith('data:') ? current.imageUrl.split(',')[1] : undefined)
        || productBase64
        || undefined;
      const motionPrompt = buildLiveMotionPrompt({
        role: current.role,
        imagePrompt: current.imagePrompt,
        visualDescription: current.motionIntent,
        vibe: config.vibe,
      });
      this.log(
        onEvent,
        'generate_live_motion',
        `${model.label} scene ${current.index + 1}/${scenes.length}: ${current.role} → ${(current.actualDurationSec || current.targetDurationSec).toFixed(1)}s`,
      );
      const clip = await generateWanI2vClip({
        sceneIndex: current.index,
        stillAbsPath: current.imageAbsPath,
        stillBase64,
        stillMimeType: current.lockedAssetMimeType || 'image/jpeg',
        motionPrompt,
        // Prefer real TTS duration when VO already ran; else planner target.
        targetDurationSec: current.actualDurationSec || current.targetDurationSec,
        session,
        // Vertical Reels/TikTok/Shorts → 720x1280 (matches still aspect; fewer silent Wan fails).
        imageSize: wanImageSizeForPlatform(config.platform),
        modelId,
        platform: config.platform,
        generateAudio: true,
      });
      next[idx] = {
        ...current,
        motionClipAbsPath: clip.fittedClipPath,
        // Keep VO timing as source of truth; fitted should match it.
        actualDurationSec: current.actualDurationSec || clip.fittedDurationSec,
      };
      this.out(onEvent, 'generate_live_motion', {
        type: 'video',
        url: sessionArtifactUrl(session, clip.fittedClipPath),
        label: `Live Motion Scene ${current.index + 1}: ${current.role} · ${model.label} · ${clip.strategy} → ${clip.fittedDurationSec.toFixed(1)}s`,
        mimeType: 'video/mp4',
      });
    };

    // Serial I2V (×1) — SiliconFlow Wan is unreliable in parallel; fal kept serial for cost control.
    const WAN_CONCURRENCY = 1;
    let pending = liveScenes.map((s) => s.index);
    if (pending.length > 1) {
      this.log(onEvent, 'generate_live_motion',
        `Animating ${pending.length} Live Motion clip(s) one-at-a-time (${model.label})...`);
    }
    while (pending.length > 0) {
      const failures: Array<{ index: number; role: string; error: string }> = [];
      await mapWithConcurrency(pending, WAN_CONCURRENCY, async (sceneIndex) => {
        this.check();
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            // Small stagger between scenes reduces opaque provider failures.
            if (attempt === 0 && sceneIndex > 0) {
              await new Promise((r) => setTimeout(r, 2_500));
            }
            await animateScene(sceneIndex);
            return;
          } catch (err: any) {
            if (this.stopped) throw err;
            const message = String(err?.message || err);
            if (attempt === 0) {
              this.log(onEvent, 'generate_live_motion',
                `Scene ${sceneIndex + 1}: ${model.label} attempt failed (${message.slice(0, 160)}) — retrying once...`);
              await new Promise((r) => setTimeout(r, 8_000));
            } else {
              const scene = next.find((s) => s.index === sceneIndex);
              failures.push({ index: sceneIndex, role: scene?.role || 'scene', error: message });
            }
          }
        }
      });
      this.check();
      if (!failures.length) break;

      const failureLines = failures
        .map((f) => `Scene ${f.index + 1} (${f.role}): ${f.error.slice(0, 200)}`)
        .join('\n');
      this.out(onEvent, 'generate_live_motion', {
        type: 'error',
        content: `Live Motion failed after retry:\n${failureLines}`,
      });
      const failureGate = await this.gate(
        onEvent,
        config,
        'generate_live_motion',
        `Live Motion failed for ${failures.length} scene(s) — continue with stills?`,
        'Approve = finish those scenes as Ken Burns stills (run continues). '
          + `Type "retry" in feedback to re-run Live Motion for the failed scenes (~$${estimateLiveMotionCostPerClipUsd(modelId, avgDuration).toFixed(2)}/scene). `
          + 'Stop = end the run.',
      );
      this.check();
      if (!failureGate.approved) {
        this.emit(onEvent, 'stopped', { message: 'Stopped at Live Motion failure gate.' });
        throw new Error('Agent stopped by user.');
      }
      if (/\bretry\b/i.test(failureGate.feedback)) {
        this.log(onEvent, 'generate_live_motion',
          `Retrying Live Motion for scene(s) ${failures.map((f) => f.index + 1).join(', ')}...`);
        pending = failures.map((f) => f.index);
        continue;
      }
      // Resume with stills: downgrade failed scenes so assembly uses Ken Burns.
      for (const failure of failures) {
        const idx = next.findIndex((s) => s.index === failure.index);
        if (idx >= 0) next[idx] = { ...next[idx], motionMode: 'still', motionClipAbsPath: undefined };
      }
      this.log(onEvent, 'generate_live_motion',
        `Continuing with Ken Burns stills for scene(s) ${failures.map((f) => f.index + 1).join(', ')}.`);
      break;
    }
    return next;
  }

  /**
   * On-demand shell/Python repair via agent shell (session-scoped).
   * Gemini writes a short fix script; we run it through python_exec / shell_exec.
   */
  private async repairWithShell(
    onEvent: (e: AgentEvent) => void,
    phase: AgentPhase,
    args: {
      goal: string;
      error: string;
      sessionDir: string;
      contextFiles?: string[];
      verify?: () => Promise<boolean>;
      /** Optional config for forge HITL */
      config?: AgentConfig;
    },
  ): Promise<boolean> {
    this.log(onEvent, phase, `Shell repair: ${args.goal.slice(0, 120)}…`);
    const result = await attemptShellRepair({
      goal: args.goal,
      error: args.error,
      sessionDir: args.sessionDir,
      contextFiles: args.contextFiles,
      maxAttempts: 2,
      verify: args.verify,
    });
    for (const attempt of result.attempts) {
      this.out(onEvent, phase, {
        type: 'terminal',
        content: [
          `🔧 ${attempt.proposal.tool}: ${attempt.proposal.rationale}`,
          attempt.proposal.payload.slice(0, 600),
          `→ ${attempt.ok ? 'ok' : 'failed'}`,
          attempt.output.slice(0, 400),
        ].join('\n'),
      });
    }
    this.log(onEvent, phase, result.summary);
    if (result.success) return true;

    const goalKey = args.goal.slice(0, 120);
    if (!shouldProposeForgeAfterRepair({
      repairSucceeded: false,
      repairAttempts: result.attempts.length,
      alreadyForgedThisGoal: this.forgedRepairGoals.has(goalKey),
    })) {
      return false;
    }

    this.log(onEvent, phase, 'Shell repair exhausted — proposing forged session tool…');
    try {
      const draft = await proposeForgeScript({
        goal: args.goal,
        error: args.error,
        sessionDir: args.sessionDir,
      });
      this.outDebug(onEvent, phase, {
        type: 'markdown',
        label: 'Forge script',
        content: `\`\`\`python\n${draft.code.slice(0, 2000)}\n\`\`\``,
      });
      if (draft.requiresApproval) {
        const cfg = args.config || this.lastConfig;
        if (!cfg) {
          this.log(onEvent, phase, 'Forge needs approval but no config for HITL — skipping forge');
          return false;
        }
        // HITL with forgeDraft for Quiet+ gate UI (register happens via forgeAndRegisterRepairTool).
        const approvalId = uid();
        const approved = await new Promise<boolean>((resolve) => {
          this.emit(onEvent, 'approval_needed', {
            phase: 'forge_tool',
            approval: {
              approvalId,
              phase: 'forge_tool',
              question: `Approve helper "${draft.name}" for this session?`,
              details: draft.reason,
              forgeDraft: {
                forgeId: draft.forgeId,
                name: draft.name,
                description: draft.description,
                reason: draft.reason,
                code: draft.code,
              },
            },
          });
          this.pendingApprovals.set(approvalId, (resolution) => {
            resolve(resolution.approved);
          });
        });
        if (!approved) return false;
      }
      const forgeResult = await forgeAndRegisterRepairTool({
        draft,
        sessionDir: args.sessionDir,
        approved: true,
      });
      if (forgeResult.status !== 'forged') {
        this.log(
          onEvent,
          phase,
          `Forge failed: ${forgeResult.status === 'error' ? forgeResult.error : forgeResult.status}`,
        );
        return false;
      }
      this.forgedRepairGoals.add(goalKey);
      this.outUser(onEvent, phase, {
        type: 'markdown',
        label: 'Custom helper',
        content: `Custom helper ready: **${forgeResult.tool.name}**`,
      });
      this.log(onEvent, phase, `Forged tool ${forgeResult.tool.name} — running once…`);
      const run = await callTool(forgeResult.tool.name, { sessionDir: args.sessionDir });
      this.outDebug(onEvent, phase, {
        type: 'terminal',
        label: 'Forge run',
        content: `Forged ${forgeResult.tool.name}\n${run.content.map((c) => c.text || '').join('\n').slice(0, 800)}`,
      });
      if (args.verify) {
        const ok = await args.verify();
        if (ok) {
          this.log(onEvent, phase, 'Forge repair verified OK');
          return true;
        }
      }
      return !run.isError;
    } catch (err: any) {
      this.log(onEvent, phase, `Forge-on-fail error: ${err?.message || err}`);
      return false;
    }
  }

  private async assembleVideo(
    scenes: ScenePlan[],
    session: SessionInfo,
    onEvent: (e: AgentEvent) => void,
    captionStyle?: CaptionStyle,
    platform: AdPlatform = 'instagram_reels',
    endCardClipPath?: string | null,
  ): Promise<string | null> {
    this.emit(onEvent, 'phase_start', { phase: 'assemble_video', message: 'Assembling video with ffmpeg...' });

    const D = session.sessionDir;
    const fileExists = async (absPath: string) => {
      const check = await execShell(`test -f '${absPath.replace(/'/g, `'\\''`)}' && echo ok || echo missing`, D);
      return check.stdout.trim() === 'ok';
    };

    // Per-scene clips: Live Motion path when present, else Ken Burns from still
    this.log(onEvent, 'assemble_video', 'Creating scene clips...');
    const clips: Array<{ absPath: string; durationSec: number }> = [];

    for (let i = 0; i < scenes.length; i++) {
      this.check();
      const scene = scenes[i];
      const dur = Math.max(0.3, scene.actualDurationSec || scene.targetDurationSec || 3);
      const clipPath = `${D}/clip_${i}.mp4`;

      if (scene.motionClipAbsPath) {
        // Re-fit to VO duration and normalize — source Wan length often ≠ spoken length.
        const sourceDur = await getMediaDuration(scene.motionClipAbsPath, D)
          || scene.actualDurationSec
          || dur;
        try {
          await timeFitClip({
            inputPath: scene.motionClipAbsPath,
            outputPath: clipPath,
            sourceDurationSec: sourceDur,
            targetDurationSec: dur,
            sessionDir: D,
          });
        } catch (err: any) {
          const copy = await execShell(
            `cp '${scene.motionClipAbsPath.replace(/'/g, `'\\''`)}' '${clipPath.replace(/'/g, `'\\''`)}'`,
            D,
          );
          if (!copy.ok) {
            const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
              goal: `Create a ${dur.toFixed(2)}s MP4 at ${clipPath} from Live Motion ${scene.motionClipAbsPath}`,
              error: String(err?.message || err),
              sessionDir: D,
              contextFiles: [scene.motionClipAbsPath, clipPath],
              verify: () => fileExists(clipPath),
            });
            if (!repaired) throw new Error(`Scene ${i + 1} Live Motion fit failed: ${String(err?.message || err).slice(0, 200)}`);
          }
        }
        const probed = await getMediaDuration(clipPath, D);
        const useDur = probed > 0.2 ? probed : dur;
        this.out(onEvent, 'assemble_video', {
          type: 'terminal',
          content: `Live Motion scene ${i + 1} (${useDur.toFixed(1)}s, target ${dur.toFixed(1)}s)`,
        });
        clips.push({ absPath: clipPath, durationSec: useDur });
        continue;
      }

      const imgPath = scene.imageAbsPath;
      if (!imgPath) throw new Error(`Cannot assemble video: scene ${i + 1} has no generated image.`);

      const result = await buildKenBurnsClip(imgPath, clipPath, dur, i % 2 === 0 ? 'in' : 'out', D);

      this.out(onEvent, 'assemble_video', {
        type: 'terminal',
        content: `Ken Burns scene ${i + 1} (${dur.toFixed(1)}s)\n${result.stderr.slice(-200)}`,
      });

      if (result.ok) {
        const probed = await getMediaDuration(clipPath, D);
        clips.push({ absPath: clipPath, durationSec: probed > 0.2 ? probed : dur });
      } else {
        const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
          goal: `Create a ${dur.toFixed(2)}s MP4 clip at ${clipPath} from still ${imgPath} (Ken Burns or simple zoom/pan with ffmpeg).`,
          error: result.stderr || 'Ken Burns failed',
          sessionDir: D,
          contextFiles: [imgPath, clipPath],
          verify: () => fileExists(clipPath),
        });
        if (!repaired) throw new Error(`Scene ${i + 1} clip creation failed: ${result.stderr.slice(-200)}`);
        const probed = await getMediaDuration(clipPath, D);
        clips.push({ absPath: clipPath, durationSec: probed > 0.2 ? probed : dur });
      }
    }

    if (clips.length === 0) {
      this.out(onEvent, 'assemble_video', { type: 'error', content: 'No clips were created. Check scene images.' });
      return null;
    }
    this.check();

    // Concat with xfade
    this.log(onEvent, 'assemble_video', 'Applying crossfade transitions...');
    const mergedPath = `${D}/merged.mp4`;
    const mergeResult = await concatWithXfade(clips, mergedPath, D, 0.5);
    this.out(onEvent, 'assemble_video', { type: 'terminal', content: `xfade\n${mergeResult.stderr.slice(-200)}` });
    if (!mergeResult.ok) {
      const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
        goal: `Concatenate scene clips into ${mergedPath} with ffmpeg (xfade or concat demuxer). Clip paths: ${clips.map((c) => c.absPath).join(', ')}`,
        error: mergeResult.stderr || 'xfade merge failed',
        sessionDir: D,
        contextFiles: [...clips.map((c) => c.absPath), mergedPath],
        verify: () => fileExists(mergedPath),
      });
      if (!repaired) {
        this.out(onEvent, 'assemble_video', { type: 'error', content: `Merge failed: ${mergeResult.stderr.slice(-200)}` });
        return null;
      }
    }
    this.check();

    // Add audio
    const fullAudioPath = `${D}/voiceover_full.wav`;
    const checkAudio = await execShell(`test -f "${fullAudioPath}" && echo ok || echo missing`, D);
    const withAudioPath = `${D}/with_audio.mp4`;

    if (checkAudio.stdout.trim() === 'ok') {
      this.log(onEvent, 'assemble_video', 'Mixing voiceover...');
      const audioResult = await addAudioToVideo(mergedPath, fullAudioPath, withAudioPath, D);
      this.out(onEvent, 'assemble_video', { type: 'terminal', content: `audio mix\n${audioResult.stderr.slice(-150)}` });
      if (!audioResult.ok) {
        this.log(onEvent, 'assemble_video', 'Audio mix failed — using silent video');
        await execShell(`cp "${mergedPath}" "${withAudioPath}"`, D);
      }
    } else {
      this.log(onEvent, 'assemble_video', 'No voiceover found — assembling silent video');
      await execShell(`cp "${mergedPath}" "${withAudioPath}"`, D);
    }
    this.check();

    // Burn captions with chosen style — full scene voiceover text (matches audio/script)
    this.log(onEvent, 'assemble_video', `Building full-scene captions from voiceover...`);
    const captions: Array<{ text: string; startSec: number; endSec: number }> = [];
    let elapsed = 0;
    const crossfadeDuration = clips.length > 1
      ? Math.min(0.5, Math.min(...clips.map((clip) => clip.durationSec)) * 0.4, 0.75)
      : 0;
    for (const s of scenes) {
      const hasClip = clips.some((c) => c.absPath === `${D}/clip_${s.index}.mp4`);
      if (!hasClip) { elapsed += s.actualDurationSec; continue; }
      const text = s.voiceoverText.replace(/\s+/g, ' ').trim();
      const startSec = parseFloat((elapsed + 0.12).toFixed(2));
      const endSec = parseFloat((elapsed + s.actualDurationSec - 0.12).toFixed(2));
      if (text && endSec > startSec) captions.push({ text, startSec, endSec });
      elapsed += s.actualDurationSec - crossfadeDuration;
    }
    this.log(onEvent, 'assemble_video', `Burning ${captions.length} full captions (style: ${captionStyle?.label ?? 'default'})...`);

    const captionedPath = `${D}/captioned.mp4`;
    const captionResult = captionStyle
      ? await burnCaptionsStyled(withAudioPath, captionedPath, captions, captionStyle, D)
      : await burnCaptions(withAudioPath, captionedPath, captions, D);
    this.out(onEvent, 'assemble_video', { type: 'terminal', content: `captions\n${captionResult.stderr.slice(-150)}` });

    let captionedOk = (await execShell(`test -f "${captionedPath}" && echo ok || echo missing`, D)).stdout.trim() === 'ok';
    if (!captionedOk && !captionResult.ok) {
      const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
        goal: `Burn simple burnt-in captions onto ${withAudioPath} writing ${captionedPath}, or copy ${withAudioPath} to ${captionedPath} if burn is impossible.`,
        error: captionResult.stderr || 'caption burn failed',
        sessionDir: D,
        contextFiles: [withAudioPath, captionedPath],
        verify: () => fileExists(captionedPath),
      });
      captionedOk = repaired;
    }
    let preFinalPath = captionedOk ? captionedPath : withAudioPath;
    this.check();

    // Append end card clip if provided
    if (endCardClipPath) {
      this.log(onEvent, 'assemble_video', 'Appending end card...');
      const withEndCardPath = `${D}/with_endcard.mp4`;
      const concatListPath = `${D}/concat_list.txt`;
      await execShell(`printf "file '${preFinalPath}'\\nfile '${endCardClipPath}'\\n" > "${concatListPath}"`, D);
      const endResult = await execShell(
        `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k "${withEndCardPath}"`,
        D,
      );
      if (endResult.ok) {
        preFinalPath = withEndCardPath;
        this.log(onEvent, 'assemble_video', 'End card appended.');
      } else {
        const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
          goal: `Append end card ${endCardClipPath} after ${preFinalPath} into ${withEndCardPath}`,
          error: endResult.stderr || 'end card concat failed',
          sessionDir: D,
          contextFiles: [preFinalPath, endCardClipPath, withEndCardPath],
          verify: () => fileExists(withEndCardPath),
        });
        if (repaired) {
          preFinalPath = withEndCardPath;
          this.log(onEvent, 'assemble_video', 'End card appended via shell repair.');
        } else {
          this.log(onEvent, 'assemble_video', `End card concat failed — delivering without end card`);
        }
      }
      this.check();
    }

    // Platform-optimised export
    this.log(onEvent, 'assemble_video', `Exporting for ${platform.replace(/_/g, ' ')}...`);
    const finalPath = `${D}/final.mp4`;
    const exportResult = await exportForPlatform(preFinalPath, finalPath, platform, D);
    this.out(onEvent, 'assemble_video', { type: 'terminal', content: `platform export\n${exportResult.stderr.slice(-150)}` });

    let finalOk = (await execShell(`test -f "${finalPath}" && echo ok || echo missing`, D)).stdout.trim() === 'ok';
    if (!finalOk) {
      const repaired = await this.repairWithShell(onEvent, 'assemble_video', {
        goal: `Export or copy ${preFinalPath} to ${finalPath} as a playable MP4`,
        error: exportResult.stderr || 'platform export failed',
        sessionDir: D,
        contextFiles: [preFinalPath, finalPath],
        verify: () => fileExists(finalPath),
      });
      finalOk = repaired;
      if (!finalOk) await execShell(`cp "${preFinalPath}" "${finalPath}"`, D);
    }

    const finalUrl = `${session.baseUrl}/final.mp4`;

    this.out(onEvent, 'assemble_video', {
      type: 'video',
      url: finalUrl,
      label: `Final Ad · ${platform.replace(/_/g, ' ')} · ${session.brandSlug}`,
      mimeType: 'video/mp4',
    });

    // Export all platforms in parallel for one-click multi-format delivery
    this.log(onEvent, 'assemble_video', 'Exporting all platform formats in parallel...');
    const allPlatforms: AdPlatform[] = ['instagram_reels', 'tiktok', 'youtube_shorts'];
    const extraPlatforms = allPlatforms.filter((p) => p !== platform);

    await Promise.allSettled(
      extraPlatforms.map(async (p) => {
        const outPath = `${D}/export_${p}.mp4`;
        const result = await exportForPlatform(preFinalPath, outPath, p, D);
        if (result.ok) {
          const url = `${session.baseUrl}/export_${p}.mp4`;
          this.out(onEvent, 'assemble_video', {
            type: 'markdown',
            content: `✓ **${p.replace(/_/g, ' ')}** export ready — [Download](${url})`,
            label: `${p.replace(/_/g, ' ')} Export`,
          });
        }
      })
    );

    return finalUrl;
  }

  // ── End Card Generator ────────────────────────────────────────────────────────

  private async generateEndCard(
    platform: AgentConfig['platform'],
    brandName: string,
    hashtags: string[],
    session: SessionInfo,
    onEvent: (e: AgentEvent) => void,
  ): Promise<string | null> {
    this.log(onEvent, 'assemble_video', `Generating ${platform.replace(/_/g, ' ')} end card...`);
    const D = session.sessionDir;
    const pngPath = `${D}/end_card.png`;
    const clipPath = `${D}/end_card_clip.mp4`;
    const topHashtags = hashtags.slice(0, 4).join(' ');
    const handle = `@${brandName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    type PlatformCfg = { bg: string; mainText: string; subText: string; ctaText: string; accentHex: string; darkBg: boolean };
    const cfgMap: Record<AgentConfig['platform'], PlatformCfg> = {
      tiktok:              { bg: '#0a0a0a', mainText: 'Follow for more ✨', subText: handle,    ctaText: 'Link in bio ↑',     accentHex: '#fe2c55', darkBg: true  },
      instagram_reels:     { bg: '#fafafa', mainText: 'Shop Now →',         subText: handle,    ctaText: 'Link in bio',       accentHex: '#833ab4', darkBg: false },
      youtube_shorts:      { bg: '#0f0f0f', mainText: 'Subscribe ↓',        subText: brandName, ctaText: 'See description ↗', accentHex: '#ff0000', darkBg: true  },
      instagram_feed:      { bg: '#fafafa', mainText: 'Shop Now →',         subText: handle,    ctaText: 'Link in bio',       accentHex: '#833ab4', darkBg: false },
      instagram_carousel:  { bg: '#fafafa', mainText: 'Swipe to Learn →',   subText: handle,    ctaText: 'Link in bio',       accentHex: '#833ab4', darkBg: false },
    };
    const cfg = cfgMap[platform];

    const code = `
from PIL import Image, ImageDraw, ImageFont
W, H = 1080, 1920
def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2],16) for i in (0,2,4))

bg = hex2rgb("${cfg.bg}")
text_col = hex2rgb("${cfg.darkBg ? '#ffffff' : '#1a1a1a'}")
accent = hex2rgb("${cfg.accentHex}")
muted = tuple(min(255,c+70) for c in bg) if ${cfg.darkBg ? 'True' : 'False'} else tuple(max(0,c-70) for c in bg)

img = Image.new('RGB', (W, H), bg)
draw = ImageDraw.Draw(img)

def font(size):
    for p in ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Arial.ttf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, size)
        except: pass
    return ImageFont.load_default()

def center_text(text, y, f, color):
    bb = draw.textbbox((0,0), text, font=f)
    x = (W - (bb[2]-bb[0])) // 2
    draw.text((x, y), text, font=f, fill=color)

# Accent bars top & bottom
draw.rectangle([0, 0, W, 10], fill=accent)
draw.rectangle([0, H-10, W, H], fill=accent)

# Accent horizontal rule in center
draw.rectangle([(W//2)-180, H//2-8, (W//2)+180, H//2+2], fill=accent)

# Main CTA
center_text("${cfg.mainText}", H//2 - 160, font(88), text_col)

# Handle / brand name
center_text("${cfg.subText}", H//2 + 30, font(50), muted)

# Hashtags
center_text("${topHashtags}", H//2 + 120, font(38), accent)

# Bottom CTA
center_text("${cfg.ctaText}", H - 180, font(54), text_col)

img.save("${pngPath}")
print("ok")
`;
    const pyRes = await runPython(code, D);
    if (!pyRes.ok || !pyRes.stdout.includes('ok')) {
      this.log(onEvent, 'assemble_video', `End card render failed: ${pyRes.stderr.slice(0, 100)}`);
      return null;
    }

    // 2.5s silent clip
    const cmd = `ffmpeg -y -loop 1 -i "${pngPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2.5 -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "${clipPath}"`;
    const clipRes = await execShell(cmd, D);
    if (clipRes.ok) {
      this.out(onEvent, 'assemble_video', {
        type: 'image',
        url: `${session.baseUrl}/end_card.png`,
        label: `End card — ${platform.replace(/_/g, ' ')}`,
      });
      return clipPath;
    }
    this.log(onEvent, 'assemble_video', `End card clip failed: ${clipRes.stderr.slice(0, 80)}`);
    return null;
  }

  // ── Phase 6: AI Review ────────────────────────────────────────────────────────

  private async reviewVideo(
    scenes: ScenePlan[],
    videoUrl: string,
    config: AgentConfig,
    facts: string[],
    onEvent: (e: AgentEvent) => void,
  ): Promise<{ issues: string[]; approved: boolean }> {
    this.emit(onEvent, 'phase_start', { phase: 'deliver', message: 'AI reviewing assembled video...' });

    const scenesSummary = scenes.map((s) =>
      `Scene ${s.index + 1} (${s.role}): "${s.voiceoverText}" — ${s.actualDurationSec.toFixed(1)}s`
    ).join('\n');
    const factsList = facts.slice(0, 8).join(', ');
    const totalDur = scenes.reduce((t, s) => t + s.actualDurationSec, 0).toFixed(1);

    const prompt = `You are a senior ad reviewer. Review this assembled ${config.durationSec}s ${config.platform.replace(/_/g, ' ')} ad.

SCENES ASSEMBLED:
${scenesSummary}

TOTAL DURATION: ${totalDur}s (target: ${config.durationSec}s)
VERIFIED FACTS: ${factsList}
STYLE: ${config.style.replace(/_/g, ' ')}

Review for:
1. Factual accuracy — does any voiceover mention ingredients/claims not in the verified facts?
2. Pacing — are any scenes too short (<2s) or too long (>12s) for the platform?
3. Narrative arc — hook → ritual → ingredients → result → cta — does it flow?
4. Platform fit — is this right for ${config.platform.replace(/_/g, ' ')}?
5. CTA — does the last scene include a clear call to action?

Return a JSON object:
{
  "score": <1-10>,
  "issues": ["<specific issue>", ...],   // empty array if none
  "fixes": ["<what to fix and how>", ...],
  "approved": <true if score >= 7 and no critical issues>
}
Return ONLY the JSON, no markdown.`;

    try {
      const raw = await this.geminiText(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return { issues: [], approved: true };

      const result = JSON.parse(match[0]) as { score: number; issues: string[]; fixes: string[]; approved: boolean };

      const reviewMd = [
        `## AI Review — Score: ${result.score}/10`,
        result.approved ? '✓ Approved for delivery' : '⚠ Issues found — review before delivering',
        '',
        result.issues.length > 0 ? '**Issues:**\n' + result.issues.map((i) => `- ${i}`).join('\n') : '**No issues found.**',
        result.fixes.length > 0 ? '\n**Suggested fixes:**\n' + result.fixes.map((f) => `- ${f}`).join('\n') : '',
      ].join('\n');

      this.out(onEvent, 'deliver', { type: 'markdown', content: reviewMd, label: 'AI Quality Review' });
      return { issues: result.issues, approved: result.approved };
    } catch {
      return { issues: [], approved: true };
    }
  }

  // ── Main run ──────────────────────────────────────────────────────────────────

  async run(
    prompt: string,
    config: AgentConfig,
    onEvent: (e: AgentEvent) => void,
    referenceUploads: CreativeReferenceUpload[] = [],
    agencyContext?: AgencyRunContext,
  ): Promise<void> {
    this.stopped = false;
    this.loopState = null;
    this.loopBootstrap = null;
    this.recreatePath = null;
    this.forgedRepairGoals.clear();
    this.lastConfig = config;
    this.planDebateImages = [];
    this.sceneDebatesRun = 0;
    this.lastStepText = '';
    clearForgedTools();
    let effectiveReferenceUploads: CreativeReferenceUpload[] = [...referenceUploads];

    const uploadedHeroRaw = agencyContext?.productBase64
      ? (agencyContext.productBase64.startsWith('data:')
        ? agencyContext.productBase64.split(',')[1]
        : agencyContext.productBase64)
      : null;
    // Product vs reference is decided once, by role — never by URL order.
    const urlRoles = resolvePromptUrlRoles({
      prompt,
      explicitProductUrl: agencyContext?.productUrl,
      explicitReferenceUrl: agencyContext?.referenceUrl,
      hasPackshot: Boolean(uploadedHeroRaw),
    });
    if (missingProductIdentity(urlRoles, { hasPackshot: Boolean(uploadedHeroRaw) })) {
      this.emit(onEvent, 'error', {
        message: urlRoles.referenceUrl
          ? `That ${urlHostLabel(urlRoles.referenceUrl)} link is a creative reference, not your product. Add your product page URL (https://…) or upload a packshot so the product identity is yours.`
          : 'Add a product URL (https://…) or upload a product packshot before running.',
      });
      return;
    }
    const productUrl = urlRoles.productUrl || 'upload://product';
    const referenceUrl = urlRoles.referenceUrl;
    const promptBrief = extractHttpUrls(prompt)
      .reduce((text, url) => text.split(url).join(' '), prompt)
      .replace(/\s+/g, ' ')
      .trim();
    // Prefer Hub locked researcher brief; fall back to prompt text / userDirection.
    // Mutable so reference-structure analysis can append a recreate brief block.
    let creativeBrief = (
      agencyContext?.creativeBrief?.trim()
      || agencyContext?.userDirection?.trim()
      || promptBrief
    ).trim();
    const uploadedMime = agencyContext?.productMimeType || 'image/png';
    // Resolve planner preference once (GLM 5.3 Flash default; Gemini fallback on failure).
    if (!config.plannerModel) {
      config = { ...config, plannerModel: await resolveDefaultPlannerModel() };
    }

    this.decisionTrace = createDecisionTrace({
      prompt,
      productUrl,
      requestedFormat: config.adFormat,
      platform: config.platform,
    });
    assertFormatLocked(config.adFormat, config.adFormat, config.platform);
    // Clamp once so bumper asks (5s) are not silently rejected / over-planned.
    config = { ...config, durationSec: clampAdAgentDurationSec(config.durationSec) };
    const plannerSpec = getNativePlannerSpec(config.adFormat, config.platform, config.durationSec);
    this.traceDecision('intake', 'format_selection', `User requested ${config.adFormat} for ${config.platform}`, ['user-prompt'], 1);
    this.traceDecision('intake', 'format_lock', `Locked ${config.adFormat} to ${config.platform} with ${plannerSpec.aspectRatio}`, ['user-prompt'], 1);
    if (agencyContext?.source === 'brand_video_agency') {
      this.traceDecision('intake', 'agency_handoff', 'Seeded from Brand Ad Agency approved concept', ['agency-handoff'], 1);
    }
    if (uploadedHeroRaw) {
      this.traceDecision('intake', 'product_packshot_upload', 'Product hero supplied via uploaded packshot', ['product-upload'], 1);
    }

    try {
      // Create organized session directory
      const shellOk = await isShellServerRunning();
      let session: SessionInfo | null = null;

      // Derive brand from URL hostname once — used for session dir and memory scoping
      const urlObj = (() => {
        if (productUrl.startsWith('upload://')) return null;
        try { return new URL(productUrl); } catch { return null; }
      })();
      this.brandSlug = slugify(
        (urlObj?.hostname ?? agencyContext?.productTitle ?? 'brand')
          .replace(/^www\./, '')
          .split('.')[0],
      );
      const productSlug = slugify(
        agencyContext?.productTitle
        || (productUrl.startsWith('upload://') ? 'uploaded-product' : productUrl.split('/').filter(Boolean).pop())
        || 'product',
      );

      if (shellOk) {
        session = await createSession(this.brandSlug, productSlug, 'ad-agent');
        this.log(onEvent, 'research', `Session: ${session.sessionDir}`);
      }

      // Discover toolkit for readiness — never dump the catalog into the user canvas.
      try {
        const caps = await discoverAgentCapabilities();
        if (!caps.shellOnline) {
          this.log(onEvent, 'research', 'Shell offline — video assembly unavailable');
        }
        if (!caps.shellOnline || !caps.siliconflowConfigured) {
          this.outDebug(onEvent, 'research', {
            type: 'markdown',
            label: 'Agent Capabilities',
            content: caps.markdown,
            audience: 'debug',
          });
        }
      } catch {
        // non-fatal
      }

      this.step(
        onEvent,
        'research',
        productUrl.startsWith('upload://')
          ? 'Product identity locked from your uploaded packshot.'
          : `Product locked from ${urlHostLabel(productUrl)}.`,
      );
      if (referenceUrl) {
        this.step(
          onEvent,
          'research',
          `Creative reference: ${urlHostLabel(referenceUrl)} — used for structure and pacing only.`,
        );
      }

      // Load memory before any phase so prompts can be augmented
      await this.loadMemory();
      // Phase-scoped retrieve + consolidate (loop memory manage)
      for (const [phase, entries] of this.memoryByPhase) {
        this.memoryByPhase.set(phase, retrieveMemoryForPhase(entries, phase, 12));
      }
      const memCount = [...this.memoryByPhase.values()].flat().length;
      if (memCount > 0) {
        this.log(onEvent, 'research', `Loaded ${memCount} memory entries for ${this.brandSlug}`);
      }

      // Fresh task memory for this run — accumulates feedback across gates
      this.taskMemory.clear();
      if (creativeBrief.trim()) {
        this.taskMemory.remember('research', 'brief', creativeBrief.slice(0, 400), ['brief']);
      }

      // Outer loop: classify intent → goal card → Kimi task graph
      this.emit(onEvent, 'phase_start', { phase: 'plan_loop', message: 'Planning agent loop...' });
      this.step(onEvent, 'plan_loop', 'Planning production beats…');
      try {
        this.loopBootstrap = await bootstrapLoop({
          prompt,
          adFormat: config.adFormat,
          referenceUploadCount: referenceUploads.length,
          plannerModel: config.plannerModel,
          sessionDir: session?.sessionDir,
          brandSlug: this.brandSlug,
          context: creativeBrief,
          productUrl: urlRoles.productUrl,
          referenceUrl,
          debateImages: this.buildDebateImages(uploadedHeroRaw, uploadedMime, effectiveReferenceUploads),
        });
        this.loopState = this.loopBootstrap.state;
        this.emitGoalProgress(onEvent, 'plan_loop');
        this.reportPlannerDebate(onEvent, 'plan_loop', 'task graph', this.loopBootstrap.debate);
        this.outDebug(onEvent, 'plan_loop', {
          type: 'markdown',
          label: 'Agent Loop · Goal Card',
          content: [
            this.loopBootstrap.goalCardMarkdown,
            '',
            `Intent: **${this.loopBootstrap.intent.skillPath}** (${Math.round(this.loopBootstrap.intent.confidence * 100)}%)`,
            ...this.loopBootstrap.intent.reasons.map((r) => `- ${r}`),
            '',
            this.loopBootstrap.taskGraphMarkdown,
            '',
            `_Planner: ${this.loopBootstrap.planModelId}${this.loopBootstrap.usedTemplateOnly ? ' (template fallback)' : ''}_`,
          ].join('\n'),
        });

        if (this.loopBootstrap.intent.skillPath === 'recreate_reference_video') {
          const recreate = planRecreatePath({
            referenceUrl: referenceUrl || this.loopBootstrap.intent.referenceUrl,
            referenceUploads: effectiveReferenceUploads,
            taskGraph: this.loopBootstrap.taskGraph,
          });
          this.recreatePath = recreate;
          const beatCount = this.loopBootstrap.taskGraph?.steps?.length ?? 0;
          this.outUser(onEvent, 'plan_loop', {
            type: 'markdown',
            label: 'Recreate plan',
            content: [
              `We'll match this reference's pacing for your brand.`,
              beatCount > 0 ? `**${beatCount}** production beats planned.` : '',
              recreate.referenceUrl ? `Reference: ${recreate.referenceUrl}` : '',
            ].filter(Boolean).join('\n\n'),
          });
          this.outDebug(onEvent, 'plan_loop', {
            type: 'markdown',
            label: 'Recreate Reference Path',
            content: recreatePathMarkdown(recreate),
          });
          // Path plan encodes producer preference; wire the concrete motion hint.
          const motionDefault = defaultMotionHint(recreate);
          if (
            recreate.preferLiveMotionDefault
            && config.adFormat === 'stitched_video'
            && motionDefault === 'wan_i2v'
          ) {
            config = { ...config, preferLiveMotion: true };
          }

          const loopGate = await this.gate(
            onEvent,
            config,
            'plan_loop',
            'Approve matching this reference\'s structure for your brand?',
            [
              `We'll match this reference's pacing for your brand${beatCount > 0 ? ` (${beatCount} beats)` : ''}.`,
              '',
              'Full loop plan is in Details if you want the technical breakdown.',
            ].join('\n'),
          );
          if (!loopGate.approved) {
            this.emit(onEvent, 'stopped', { message: 'Loop plan rejected.' });
            return;
          }
          if (loopGate.feedback?.trim() && shouldWriteMemory({ source: 'hitl_edit', text: loopGate.feedback })) {
            this.taskMemory.rememberFeedback('plan_loop', loopGate.feedback);
          }

          // Step: ingest_ref — capture URL frames when uploads are empty
          this.emit(onEvent, 'phase_start', { phase: 'plan_loop', message: 'Capturing reference…' });
          this.step(
            onEvent,
            'plan_loop',
            recreate.referenceUrl
              ? `Capturing reference frames from ${urlHostLabel(recreate.referenceUrl)}…`
              : 'Reading your uploaded reference frames…',
          );
          const playwrightCapture = async (url: string) => {
            const mcpTools = await listMcpTools();
            const hasPlaywright = mcpTools.some((t) => t.serverName === 'playwright' && t.name === 'browser_navigate');
            if (!hasPlaywright) {
              throw new Error('Playwright MCP not connected');
            }
            this.log(onEvent, 'plan_loop', 'Browsing reference…');
            await callMcpTool('playwright', 'browser_navigate', { url });
            await callMcpTool('playwright', 'browser_wait_for', { time: 2000 });
            const shot = await callMcpTool('playwright', 'browser_take_screenshot', { raw: false });
            const imgContent = shot.content.find(
              (c) => c.type === 'image' || (c.type === 'text' && (c.text ?? '').startsWith('data:')),
            );
            if (!imgContent) {
              return { uploads: [], log: ['Playwright screenshot empty'] };
            }
            const dataUrl = imgContent.type === 'image'
              ? `data:image/png;base64,${imgContent.data ?? ''}`
              : (imgContent.text ?? '');
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : (imgContent.data || '');
            if (!base64) return { uploads: [], log: ['No image data from Playwright'] };
            this.outUser(onEvent, 'plan_loop', {
              type: 'image',
              url: dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${base64}`,
              label: 'Reference capture',
            });
            return {
              uploads: [{
                id: `pw_${Date.now().toString(36)}`,
                name: 'reference-playwright.png',
                base64,
                mimeType: 'image/png',
                note: 'Playwright MCP capture',
              }],
              log: ['Playwright navigate + screenshot ok'],
            };
          };
          const ingestResult = await executeRecreateIngest({
            referenceUploads: effectiveReferenceUploads,
            referenceUrl: recreate.referenceUrl || referenceUrl,
            ingest: recreate.ingest,
            playwrightCapture,
          });
          this.outDebug(onEvent, 'plan_loop', {
            type: 'markdown',
            label: 'Reference Ingest',
            content: ingestResult.log.map((l) => `- ${l}`).join('\n'),
          });
          if (ingestResult.error && !ingestResult.uploads.length) {
            this.outUser(onEvent, 'plan_loop', {
              type: 'markdown',
              label: 'Reference capture',
              content: `Could not capture the reference (${ingestResult.error.slice(0, 200)}).\n\nUpload frames manually, or start \`npm run dev:agent\` and try again.`,
            });
          }
          if (ingestResult.uploads.length) {
            effectiveReferenceUploads = ingestResult.uploads;
            this.markRecreateStep('ingest_ref', `Ingested ${ingestResult.uploads.length} frame(s)`, onEvent);
          } else if (ingestResult.needsHitl) {
            const captureGate = await this.gate(
              onEvent,
              { ...config, reviewMode: 'review' },
              'plan_loop',
              'Reference capture failed. Upload frames manually, or Stop.',
              ingestResult.error || ingestResult.warning || 'No frames captured from URL.',
            );
            if (!captureGate.approved) {
              this.emit(onEvent, 'stopped', { message: 'Stopped — reference ingest failed.' });
              return;
            }
          }
        }
      } catch (loopErr: any) {
        this.log(onEvent, 'plan_loop', `Loop bootstrap skipped: ${loopErr?.message || loopErr}`);
      }
      this.lastConfig = config;
      if (config.preferLiveMotion) {
        this.taskMemory.rememberDecision('research', 'Launch toggle: prefer Live Motion ON', ['live_motion']);
      }
      if (config.includeVoiceover === false) {
        this.taskMemory.rememberDecision('research', 'Launch toggle: voiceover OFF (silent video)', ['no_voice']);
      }
      if (config.voice) {
        this.taskMemory.preferences.voice = config.voice;
      }
      if (config.vibe) {
        this.taskMemory.preferences.vibe = config.vibe;
      }

      // Phase 1: Research — skip re-import when Agency already locked product facts + hero
      const canSkipResearch = Boolean(
        agencyContext?.skipResearch
        && agencyContext.productFacts?.length
        && agencyContext.productBase64,
      );
      const uploadOnly = Boolean(uploadedHeroRaw && productUrl.startsWith('upload://'));
      let title: string;
      let facts: string[];
      let productBase64: string | null;
      let productAbsPath: string | null = null;

      if (canSkipResearch && agencyContext) {
        const lockLabel = agencyContext.source === 'brand_video_agency'
          ? 'Brand Ad Agency product lock'
          : 'Researched product lock';
        this.emit(onEvent, 'phase_start', { phase: 'research', message: `Using ${lockLabel}...` });
        title = agencyContext.productTitle || productUrl.split('/').filter(Boolean).pop() || 'Featured Product';
        facts = [...(agencyContext.productFacts || [])];
        const rawBase64 = agencyContext.productBase64!.startsWith('data:')
          ? agencyContext.productBase64!.split(',')[1]
          : agencyContext.productBase64!;
        productBase64 = rawBase64;
        const mimeType = agencyContext.productMimeType || 'image/png';
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: agencyContext.source === 'brand_video_agency' ? 'Agency Product Lock' : 'Researcher Product Lock',
          content: [
            `## ${title}`,
            `URL: ${productUrl}`,
            `Seeded ${facts.length} product facts (skipped page re-import).`,
            agencyContext.seedScenes?.length
              ? `Carrying ${agencyContext.seedScenes.length} approved scene(s) into planning.`
              : '',
          ].filter(Boolean).join('\n'),
        });
        this.out(onEvent, 'research', {
          type: 'image',
          url: `data:${mimeType};base64,${rawBase64}`,
          label: agencyContext.source === 'brand_video_agency'
            ? 'Product reference (agency-locked)'
            : 'Product reference (researcher-locked)',
        });
        if (session) {
          try {
            const up = await uploadBase64(rawBase64, 'product_reference.png', mimeType, session.sessionDir);
            productAbsPath = up.path;
            this.log(onEvent, 'research', `Product reference saved → ${session.sessionDir}/product_reference.png`);
          } catch (e: any) {
            this.log(onEvent, 'research', `Warning: could not save product reference: ${e.message}`);
          }
        }
      } else if (uploadOnly && uploadedHeroRaw) {
        this.emit(onEvent, 'phase_start', { phase: 'research', message: 'Using uploaded product packshot...' });
        title = agencyContext?.productTitle || 'Uploaded Product';
        facts = [
          ...(agencyContext?.productFacts || []),
          ...(creativeBrief ? [`Creative brief: ${creativeBrief}`] : []),
        ];
        if (!facts.length) {
          facts = [`Product image provided by upload (${title}). Use visual identity from the packshot.`];
        }
        productBase64 = uploadedHeroRaw;
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: 'Uploaded Product Packshot',
          content: [
            `## ${title}`,
            'Source: uploaded packshot (no product URL — page scrape skipped).',
            creativeBrief ? `Brief: ${creativeBrief}` : '',
            `Facts seeded: ${facts.length}`,
          ].filter(Boolean).join('\n'),
        });
        this.out(onEvent, 'research', {
          type: 'image',
          url: `data:${uploadedMime};base64,${uploadedHeroRaw}`,
          label: 'Product reference (uploaded packshot)',
        });
        if (session) {
          try {
            const up = await uploadBase64(uploadedHeroRaw, 'product_reference.png', uploadedMime, session.sessionDir);
            productAbsPath = up.path;
            this.log(onEvent, 'research', `Product reference saved → ${session.sessionDir}/product_reference.png`);
          } catch (e: any) {
            this.log(onEvent, 'research', `Warning: could not save product reference: ${e.message}`);
          }
        }
      } else {
        const research = await this.runResearch(productUrl, session, onEvent, creativeBrief);
        title = agencyContext?.productTitle || research.title;
        facts = research.facts;
        // Uploaded packshot always wins over scraped page hero when both are present.
        productBase64 = uploadedHeroRaw || research.productBase64;
        productAbsPath = research.productAbsPath;
        if (uploadedHeroRaw) {
          this.out(onEvent, 'research', {
            type: 'image',
            url: `data:${uploadedMime};base64,${uploadedHeroRaw}`,
            label: 'Product reference (uploaded packshot — overrides page scrape)',
          });
          if (session) {
            try {
              const up = await uploadBase64(uploadedHeroRaw, 'product_reference.png', uploadedMime, session.sessionDir);
              productAbsPath = up.path;
              this.log(onEvent, 'research', `Uploaded packshot saved as product reference → ${session.sessionDir}/product_reference.png`);
            } catch (e: any) {
              this.log(onEvent, 'research', `Warning: could not save uploaded packshot: ${e.message}`);
            }
          }
        }
      }
      // Merge Hub researcher facts (when page scrape also ran).
      if (agencyContext?.productFacts?.length && !canSkipResearch) {
        const seeded = agencyContext.productFacts;
        facts = [...seeded, ...facts.filter((f) => !seeded.includes(f))].slice(0, 16);
        if (agencyContext.productTitle) title = agencyContext.productTitle;
      }
      this.check();
      this.decisionTrace.productFacts = [...facts];
      this.evidenceGraph = extractProductEvidence({ productUrl, productTitle: title, facts });
      this.traceDecision('research', 'product_facts', `Imported ${facts.length} verified product facts for ${title}`, facts.map((_, index) => `product-fact-${index + 1}`), facts.length ? .95 : .2);
      this.traceDecision('research', 'evidence_graph', `Built evidence graph with ${this.evidenceGraph.nodes.length} nodes and ${this.evidenceGraph.edges.length} relationships`, this.evidenceGraph.nodes.map((node) => node.id), .95);
      if (!(await this.updateLoopSignals(onEvent, config, { hasBrandProductLock: true }))) return;
      this.markRecreateStep('lock_product', 'Product evidence locked', onEvent);
      this.planDebateImages = this.buildDebateImages(
        productBase64,
        uploadedHeroRaw ? uploadedMime : 'image/png',
        effectiveReferenceUploads,
      );
      creativeBrief = await this.refineTaskGraphWithImages(onEvent, creativeBrief);
      this.check();
      const creativeReferences: CreativeReference[] = await analyzeCreativeReferences(effectiveReferenceUploads);
      if (creativeReferences.length) {
        this.traceDecision('research', 'reference_analysis', `Analyzed ${creativeReferences.length} uploaded creative references`, creativeReferences.map((reference) => `reference-${reference.id}`), .8);
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: 'Creative Reference Analysis',
          content: [
            '## Uploaded Creative References',
            ...creativeReferences.map((reference) => `- **${reference.name}** · ${reference.role.replace(/_/g, ' ')} · ${reference.description}`),
          ].join('\n'),
        });
      }

      // Structure recreate: analyze reference frames → seed brief before planning.
      if (effectiveReferenceUploads.length) {
        const role = structureAnalysisRole(effectiveReferenceUploads.length);
        const structureModel = role === 'hard_multimodal' ? HARD_MULTIMODAL_MODEL : WORKER_MODEL;
        this.log(onEvent, 'research', `Reference structure model: ${structureModel} (${role})`);
        const structure = await analyzeReferenceStructure(effectiveReferenceUploads, { model: structureModel });
        this.check();
        if (structure?.beats?.length) {
          const structureBlock = formatReferenceStructureBlock(structure);
          if (!/## REFERENCE STRUCTURE/i.test(creativeBrief)) {
            creativeBrief = [creativeBrief, structureBlock].filter(Boolean).join('\n\n').trim();
          }
          this.traceDecision(
            'research',
            'reference_structure',
            `Extracted ${structure.beats.length} reference beat(s) for structure recreate via ${structureModel}`,
            structure.beats.map((_, i) => `ref-beat-${i + 1}`),
            0.85,
          );
          this.out(onEvent, 'research', {
            type: 'markdown',
            label: 'Reference Structure',
            content: `${structureBlock}\n\n_Model: \`${structureModel}\`_`,
          });
          this.step(
            onEvent,
            'research',
            `Reference structure read — ${structure.beats.length} beats to match.`,
          );
          if (!(await this.updateLoopSignals(onEvent, config, { hasReferenceAnalysis: true }))) return;
          this.markRecreateStep('structure', `Analyzed ${structure.beats.length} beats`, onEvent);
        }
      }

      // Phase 1b/1c: Brand style + trends — skip when Hub researcher already locked a brief.
      const hubResearcherLock = Boolean(
        canSkipResearch
        && agencyContext?.source === 'product_upload'
        && (agencyContext.skipBrandAndTrends || Boolean(creativeBrief.trim())),
      );

      let detectedStyle = config.style;
      let trends: TrendInsights;
      if (hubResearcherLock) {
        this.log(onEvent, 'research', 'Using Hub researcher lock — skipped brand style & trend re-research');
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: 'Hub Researcher Lock',
          content: [
            '## Using Hub researcher output',
            'Skipped page re-import, brand-style probe, and live trend research.',
            'Story authority: locked creative brief from Ad Creator Researcher.',
            `Visual style (user-selected): ${config.style.replace(/_/g, ' ')}`,
          ].join('\n'),
        });
        this.traceDecision('research', 'brand_style', `Kept user style ${config.style} (Hub researcher lock)`, ['hub-research'], 1);
        trends = {
          trendingHooks: [],
          topHashtags: [],
          nativeConventions: [],
          trendSummary: 'Trend context already synthesized in the Hub researcher locked brief.',
          postCaption: '',
        };
        this.traceDecision('research', 'platform_trends', trends.trendSummary, ['hub-research'], .9);
      } else {
        // Brand style + trend research are independent — run them concurrently.
        const productCategory = facts.slice(0, 3).join(', ') || title;
        [detectedStyle, trends] = await Promise.all([
          this.researchBrandStyle(this.brandSlug, productUrl, onEvent),
          this.researchTrends(productCategory, config.platform, onEvent),
        ]);
        this.check();
        this.traceDecision('research', 'brand_style', `Selected ${detectedStyle} from brand research`, ['product-url'], .7);
        this.traceDecision('research', 'platform_trends', trends.trendSummary, trends.topHashtags.map((tag) => `trend-${tag}`), .6);
      }

      let configWithDetectedStyle: AgentConfig = {
        ...config,
        style: detectedStyle,
        carouselEditMode: (config as any).carouselEditMode || 'auto',
      };

      // Creative brief / launch prompt can request Live Motion in plain language.
      const briefMotion = resolveLiveMotionFromFeedback(creativeBrief, 8);
      if (
        briefMotion.matched
        && briefMotion.mode === 'live_motion'
        && configWithDetectedStyle.adFormat === 'stitched_video'
        && !configWithDetectedStyle.preferLiveMotion
      ) {
        configWithDetectedStyle = { ...configWithDetectedStyle, preferLiveMotion: true };
        this.taskMemory.preferences.preferLiveMotion = true;
        this.taskMemory.rememberDecision(
          'plan_scenes',
          'Brief asked for Live Motion — enabled I2V defaults',
          ['live_motion'],
        );
        this.log(
          onEvent,
          'plan_scenes',
          'Creative brief requested Live Motion — enabling I2V for planned scenes.',
        );
        this.out(onEvent, 'plan_scenes', {
          type: 'markdown',
          label: 'Live Motion',
          content: 'Detected **Live Motion** in your brief — scenes will default to I2V (you can still flip per scene at the plan gate).',
        });
      } else if (briefMotion.matched && briefMotion.mode === 'still') {
        this.taskMemory.preferences.preferLiveMotion = false;
        this.taskMemory.rememberDecision('plan_scenes', 'Brief asked for stills / Ken Burns', ['still']);
      }

      if (agencyContext?.approvedConcept) {
        const approved = agencyContext.approvedConcept;
        this.selectedConcept = {
          id: 'agency-approved',
          territory: 'product_led',
          title: approved.title,
          proposition: approved.proposition || approved.hook,
          hook: approved.hook,
          narrativeDevice: approved.narrative,
          visualDirection: approved.visualDirection || 'premium product-led',
          evidenceIds: facts.map((_, index) => `product-fact-${index + 1}`),
          scores: {
            evidenceCorrectness: 1,
            brandDistinctiveness: 1,
            audienceRelevance: 1,
            platformNativeness: 1,
            clarity: 1,
            originality: 1,
            conversionPotential: 1,
            productionFeasibility: 1,
          },
          hardFailures: [],
        };
        this.traceDecision('concepts', 'agency_approved_concept', `Using Agency-approved concept: ${approved.title}`, this.selectedConcept.evidenceIds, 1);
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: 'Agency-Approved Concept',
          content: [
            `## ${approved.title}`,
            `**Hook:** ${approved.hook}`,
            `**Narrative:** ${approved.narrative}`,
            `**Proposition:** ${this.selectedConcept.proposition}`,
            '',
            '_Skipped concept competition — Agency already approved this territory._',
          ].join('\n'),
        });
      } else {
        const concepts = generateFallbackConceptTerritories({
          productTitle: title,
          platform: configWithDetectedStyle.platform,
          format: configWithDetectedStyle.adFormat,
          evidenceGraph: this.evidenceGraph,
        });
        const distinctness = validateConceptDistinctness(concepts);
        if (!distinctness.passed) throw new Error(`Concept territories are not distinct: ${distinctness.duplicateFields.join(', ')}`);
        const conceptResult = judgeConceptsPairwise(concepts);
        this.selectedConcept = conceptResult.winner;
        this.traceDecision('concepts', 'concept_competition', `Selected ${this.selectedConcept.title} after ${conceptResult.comparisons.length} pairwise comparisons`, this.selectedConcept.evidenceIds, .85);
        this.out(onEvent, 'research', {
          type: 'markdown',
          label: 'Creative Concept Competition',
          content: [
            '## Three Distinct Creative Territories',
            ...conceptResult.ranking.map((concept, index) =>
              `**${index + 1}. ${concept.title}${concept.id === this.selectedConcept?.id ? ' · SELECTED' : ''}**\n`
              + `Territory: ${concept.territory.replace(/_/g, ' ')}\n`
              + `Proposition: ${concept.proposition}\n`
              + `Hook: ${concept.hook}\n`
              + `Visual direction: ${concept.visualDirection}`
            ),
            '',
            `**Why it won:** ${conceptResult.comparisons.filter((comparison) => comparison.winnerId === this.selectedConcept?.id).map((comparison) => comparison.reason).join(' ')}`,
          ].join('\n\n'),
        });
      }

      // Phase 2: Plan + GATE (loops until approved)
      // Use carousel-specific planning for carousel format
      const isCarousel = configWithDetectedStyle.adFormat === 'carousel';
      const isStillFormat = isCarousel || configWithDetectedStyle.adFormat === 'static_image';
      const isVeo = configWithDetectedStyle.adFormat === 'veo3_video';
      let scenes = agencyContext?.seedScenes?.length
        ? agencyContext.seedScenes.map((scene, index) => {
            const bankEntry = scene.lockedAssetId && agencyContext.sceneAssetBank
              ? agencyContext.sceneAssetBank[scene.lockedAssetId]
              : undefined;
            return {
              ...scene,
              index: scene.index ?? index,
              actualDurationSec: scene.actualDurationSec || scene.targetDurationSec,
              lockedAssetBase64: scene.lockedAssetBase64 || bankEntry?.base64,
              lockedAssetMimeType: scene.lockedAssetMimeType || bankEntry?.mimeType,
            };
          })
        : isCarousel
          ? await this.planCarouselSlides(title, facts, configWithDetectedStyle, onEvent, creativeBrief, '', trends, this.evidenceGraph, plannerSpec, this.selectedConcept)
          : await this.planScenes(title, facts, configWithDetectedStyle, onEvent, creativeBrief, trends, this.evidenceGraph, plannerSpec, this.selectedConcept);
      const agencyLocked = Boolean(agencyContext?.lockPlan && agencyContext?.seedScenes?.length);
      if (agencyContext?.seedScenes?.length) {
        this.emit(onEvent, 'phase_start', { phase: 'plan_scenes', message: 'Loaded Agency-approved scene plan...' });
        const lockedCount = scenes.filter((scene) => scene.preserveExactAsset).length;
        this.out(onEvent, 'plan_scenes', {
          type: 'markdown',
          label: 'Agency Seeded Scenes',
          content: [
            agencyLocked
              ? `_Agency lock ON — plan is authoritative. Evidence/critics are advisory; exact assets will not be regenerated._`
              : '',
            lockedCount ? `**${lockedCount} scene(s) use Agency locked assets.**` : '',
            '',
            ...scenes.map((scene) =>
              `**${isCarousel ? 'Slide' : 'Scene'} ${scene.index + 1} · ${scene.role}** (${scene.targetDurationSec}s)`
              + `${scene.preserveExactAsset ? ' · 🔒 locked asset' : scene.visualMode ? ` · \`${scene.visualMode}\`` : ''}\n`
              + `${scene.voiceoverText || '(no VO)'}\n`
              + `Visual: ${scene.imagePrompt}`
            ),
          ].filter(Boolean).join('\n\n'),
        });
      }
      const applyReferenceAssignments = (plannedScenes: ScenePlan[]): ScenePlan[] => {
        const assignments = assignCreativeReferences(plannedScenes, creativeReferences);
        const assignedScenes = plannedScenes.map((scene) => ({
          ...scene,
          referenceAssignment: assignments.find((assignment) => assignment.sceneIndex === scene.index),
        }));
        if (creativeReferences.length) {
          this.out(onEvent, 'plan_scenes', {
            type: 'markdown',
            label: 'Agent Reference Assignments',
            content: assignments.map((assignment) =>
              `**${isCarousel ? 'Slide' : 'Scene'} ${assignment.sceneIndex + 1}**\n${assignment.rationale}`
            ).join('\n\n'),
          });
        }
        return assignedScenes;
      };
      scenes = applyReferenceAssignments(scenes);
      const applyEvidenceGate = (plannedScenes: ScenePlan[], { rewrite }: { rewrite: boolean }): ScenePlan[] => {
        if (!this.evidenceGraph) return plannedScenes;
        const gate = gateCreativeScenes(plannedScenes, this.evidenceGraph);
        if (gate.issues.length) {
          this.traceDecision(
            'plan_scenes',
            rewrite ? 'evidence_gate_correction' : 'evidence_gate_advisory',
            `${rewrite ? 'Corrected' : 'Flagged'} ${gate.issues.length} unsupported or incorrect-use creative decisions`,
            gate.issues.map((issue) => `product-fact-gate-scene-${issue.sceneIndex + 1}`),
            1,
          );
          this.outReview(onEvent, 'plan_scenes', {
            type: 'markdown',
            label: rewrite ? 'Evidence Safety Corrections' : 'Evidence Safety Advisory (Agency lock — not rewritten)',
            content: gate.issues.map((issue) =>
              `**${isCarousel ? 'Slide' : 'Scene'} ${issue.sceneIndex + 1} · ${issue.type.replace(/_/g, ' ')}**\n`
              + `${rewrite ? 'Removed' : 'Flagged'}: ${issue.original}\n`
              + `${rewrite ? 'Grounded correction' : 'Suggested fix'}: ${issue.correction}`
            ).join('\n\n'),
          });
        }
        return rewrite ? gate.scenes : plannedScenes;
      };
      scenes = applyEvidenceGate(scenes, { rewrite: !agencyLocked });
      const runAndReportCritics = (stage: 'planning' | 'pre_production', reviewedScenes: ScenePlan[]) => {
        if (!this.evidenceGraph) return { passed: true, mandatoryFixes: [] as string[], reviews: [], averageScore: 1 };
        const council = runCriticCouncil({
          scenes: reviewedScenes,
          evidenceGraph: this.evidenceGraph,
          plannerSpec,
          brandStyle: configWithDetectedStyle.style.replace(/_/g, ' '),
          selectedConceptTitle: this.selectedConcept?.title || '',
          stage,
        });
        this.traceDecision(
          stage,
          'critic_council',
          `${stage} critics scored ${(council.averageScore * 100).toFixed(0)}% with ${council.mandatoryFixes.length} mandatory fixes`
            + (agencyLocked ? ' (Agency lock — advisory)' : ''),
          council.reviews.map((review) => `critic-${review.critic}`),
          council.averageScore,
        );
        this.outReview(onEvent, 'plan_scenes', {
          type: 'markdown',
          label: `${stage === 'planning' ? 'Planning' : 'Pre-production'} Critic Council${agencyLocked ? ' · Advisory' : ''}`,
          content: council.reviews.map((review) =>
            `**${review.critic.toUpperCase()} · ${review.passed ? 'PASS' : (agencyLocked ? 'WARN' : 'BLOCK')} · ${(review.score * 100).toFixed(0)}%**\n`
            + `${review.findings.length ? review.findings.map((finding) => `- ${finding}`).join('\n') : '- No blocking findings.'}`
            + `${review.mandatoryFixes.length ? `\nMandatory fixes:\n${review.mandatoryFixes.map((fix) => `- ${fix}`).join('\n')}` : ''}`
          ).join('\n\n'),
        });
        return council;
      };
      const planningCritics = runAndReportCritics('planning', scenes);
      if (!agencyLocked && !planningCritics.passed && planningCritics.mandatoryFixes.length) {
        scenes = applyEvidenceGate(scenes, { rewrite: true });
      }
      const nativeScore = scoreNativePlan(plannerSpec, {
        format: configWithDetectedStyle.adFormat,
        platform: configWithDetectedStyle.platform,
        aspectRatio: plannerSpec.aspectRatio,
        elements: plannerSpec.requiredElements,
        sceneCount: scenes.length,
      });
      this.traceDecision('plan_scenes', 'native_plan_score', `Native plan compliance score ${(nativeScore.score * 100).toFixed(0)}%`, plannerSpec.requiredElements.map((element) => `native-rule-${element}`), nativeScore.score);
      if (!nativeScore.passed) {
        const message = `Format-native plan failed: ${nativeScore.missing.join(', ') || 'scene count or format mismatch'}`;
        if (agencyLocked) {
          this.out(onEvent, 'plan_scenes', {
            type: 'markdown',
            label: 'Native Plan Advisory',
            content: `${message}\n\n_Agency lock ON — continuing with approved scene count._`,
          });
        } else {
          throw new Error(message);
        }
      }
      this.traceDecision(
        'plan_scenes',
        'scene_plan',
        `Planned ${scenes.length} ${isCarousel ? 'carousel slides' : 'scenes'} for ${configWithDetectedStyle.adFormat}`,
        facts.map((_, index) => `product-fact-${index + 1}`),
        .85,
      );
      this.check();

      let planApproved = false;
      while (!planApproved) {
        const canEditMotion = !isCarousel && configWithDetectedStyle.adFormat === 'stitched_video';
        const sceneMotionOptions: ApprovalSceneMotion[] | undefined = canEditMotion
          ? scenes.map((s) => ({
              index: s.index,
              role: s.role,
              motionMode: (s.motionMode || 'still') as SceneMotionMode,
            }))
          : undefined;
        const livePlanned = scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
        const liveModelId = resolveLiveMotionModelId(
          configWithDetectedStyle.liveMotionModelId || DEFAULT_LIVE_MOTION_MODEL_ID,
        );
        const liveModel = getStudioI2vModel(liveModelId);
        const liveCostPerClip = estimateLiveMotionCostPerClipUsd(liveModelId, 6);
        const planGate = await this.gate(
          onEvent,
          configWithDetectedStyle,
          'plan_scenes',
          agencyLocked ? 'Approve this Agency-approved plan for production?' : 'Does this scene plan look good?',
          isCarousel
            ? `${scenes.length} carousel slides · Provide feedback to refine, or approve to generate images.`
            : `${scenes.length} scenes · ${configWithDetectedStyle.durationSec}s`
              + (canEditMotion
                ? ` · ${livePlanned} Live Motion (${liveModel.label}) — toggle below OR type "use live motion" (~$${liveCostPerClip.toFixed(2)} each)`
                : '')
              + ' · Provide feedback to refine, or approve to generate images.',
          sceneMotionOptions,
          canEditMotion
            ? { modelLabel: liveModel.label, costPerClipUsd: liveCostPerClip }
            : undefined,
        );
        this.check();

        if (!planGate.approved) { this.emit(onEvent, 'stopped', { message: 'Stopped at scene plan.' }); return; }
        if (!(await this.updateLoopSignals(onEvent, configWithDetectedStyle, {
          hasScenePlan: true,
          criticsPass: planningCritics.passed,
          failures: planningCritics.passed ? undefined : planningCritics.mandatoryFixes,
        }))) return;
        this.markRecreateStep('plan_scenes', 'Scene plan approved', onEvent);

        if (planGate.sceneMotionModes?.length) {
          const modeByIndex = new Map(
            planGate.sceneMotionModes.map((m) => [m.index, m.motionMode] as const),
          );
          scenes = scenes.map((s) => ({
            ...s,
            motionMode: modeByIndex.get(s.index) ?? s.motionMode ?? 'still',
          }));
          const appliedLive = scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
          this.log(
            onEvent,
            'plan_scenes',
            appliedLive > 0
              ? `Motion lock: ${appliedLive}/${scenes.length} scene(s) → Live Motion (${liveModel.label})`
              : 'Motion lock: all scenes → Ken Burns stills',
          );
        }

        // Text feedback can also flip Live Motion (UI toggles alone were easy to miss).
        if (canEditMotion && planGate.feedback.trim()) {
          const motionIntent = resolveLiveMotionFromFeedback(planGate.feedback, scenes.length);
          if (motionIntent.matched) {
            scenes = applyLiveMotionIntent(scenes, motionIntent);
            configWithDetectedStyle = {
              ...configWithDetectedStyle,
              preferLiveMotion: motionIntent.mode === 'live_motion',
            };
            this.taskMemory.preferences.preferLiveMotion = motionIntent.mode === 'live_motion';
            this.taskMemory.rememberAction(
              'plan_scenes',
              motionIntent.mode === 'live_motion'
                ? `Applied Live Motion from feedback (${scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length} scenes)`
                : 'Applied Ken Burns stills from feedback',
              ['live_motion'],
            );
            const liveN = scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
            this.log(
              onEvent,
              'plan_scenes',
              motionIntent.mode === 'live_motion'
                ? `Feedback → Live Motion on ${liveN}/${scenes.length} scene(s)`
                : 'Feedback → Ken Burns stills',
            );
            this.out(onEvent, 'plan_scenes', {
              type: 'markdown',
              label: 'Live Motion',
              content: motionIntent.mode === 'live_motion'
                ? `Understood — enabling **Live Motion** (${liveModel.label}) on ${liveN} scene(s) (~$${(liveN * liveCostPerClip).toFixed(2)}).`
                : 'Understood — using **Ken Burns stills** (no I2V).',
            });
            this.emitTaskMemory(onEvent, 'plan_scenes');
          }
        }

        if (planGate.feedback.trim()) {
          this.log(onEvent, 'plan_scenes', `Interpreting feedback: "${planGate.feedback}"`);
          const interp = await this.interpretFeedback(planGate.feedback, scenes, facts, 'plan');
          this.check();

          // Gemini may also set motionMode — apply after heuristic so structured indexes win when present
          if (canEditMotion && interp.motionMode) {
            scenes = applyLiveMotionIntent(scenes, {
              matched: true,
              mode: interp.motionMode,
              sceneIndexes: interp.motionSceneIndexes,
            });
            configWithDetectedStyle = {
              ...configWithDetectedStyle,
              preferLiveMotion: interp.motionMode === 'live_motion',
            };
            this.taskMemory.preferences.preferLiveMotion = interp.motionMode === 'live_motion';
            this.taskMemory.rememberAction(
              'plan_scenes',
              interp.motionMode === 'live_motion'
                ? 'Plan feedback → Live Motion'
                : 'Plan feedback → Ken Burns stills',
              ['live_motion'],
            );
          }
          if (interp.patches.length) {
            this.taskMemory.rememberAction(
              'plan_scenes',
              `Applied ${interp.patches.length} plan patch(es)`,
              ['patches'],
            );
          }
          this.emitTaskMemory(onEvent, 'plan_scenes');

          this.out(onEvent, 'plan_scenes', {
            type: 'markdown',
            content: `**Agent understood:** ${interp.intent}`,
            label: 'Feedback Interpretation',
          });

          // Motion-only feedback (no script/visual patches) — approve and continue
          const motionOnly = resolveLiveMotionFromFeedback(planGate.feedback, scenes.length).matched
            && !interp.structural
            && !interp.patches.length
            && !interp.newVoice;

          if (interp.structural && !agencyLocked) {
            // Scene count/order must change — full re-plan (keep original brief, add user refinement)
            const refinedBrief = [creativeBrief, interp.replanHint || planGate.feedback].filter(Boolean).join('\n\nUser refinement: ');
            scenes = isCarousel
              ? await this.planCarouselSlides(title, facts, configWithDetectedStyle, onEvent, refinedBrief, '', trends, this.evidenceGraph, plannerSpec, this.selectedConcept)
              : await this.planScenes(title, facts, configWithDetectedStyle, onEvent, refinedBrief, trends, this.evidenceGraph, plannerSpec, this.selectedConcept);
            scenes = applyReferenceAssignments(scenes);
            scenes = applyEvidenceGate(scenes, { rewrite: true });
          } else {
            if (interp.structural && agencyLocked) {
              this.out(onEvent, 'plan_scenes', {
                type: 'markdown',
                label: 'Agency Lock',
                content: 'Structural re-plan blocked — Agency curation stays locked. Applying targeted patches only. Unlock by starting a fresh Agent Hub run without Agency handoff.',
              });
            }
            // Targeted patches — apply in-place without full re-plan
            scenes = scenes.map((s) => {
              const patch = interp.patches.find((p) => p.sceneIndex === s.index);
              if (!patch) return s;
              return {
                ...s,
                voiceoverText: patch.newVoiceoverText ?? s.voiceoverText,
                imagePrompt: patch.newImagePrompt ?? s.imagePrompt,
                // Exact Agency assets stay locked unless user explicitly asks to regen that scene's image without preserve
                regenerate: s.preserveExactAsset ? false : patch.regenImage,
              };
            });
            scenes = applyEvidenceGate(scenes, { rewrite: !agencyLocked });

            // Rebuild plan markdown to show the user the updated plan
            const totalWords = scenes.reduce((sum, sc) => sum + sc.voiceoverText.split(' ').length, 0);
            const planMd = [
              `## Revised Plan (${scenes.length} scenes)`,
              `Estimated voiceover: ~${(totalWords / WORDS_PER_SEC).toFixed(0)}s`,
              '',
              ...scenes.map((s) =>
                `**Scene ${s.index + 1}: ${s.role.toUpperCase()}** · ${s.targetDurationSec}s${s.preserveExactAsset ? ' · 🔒' : ''}\n> "${s.voiceoverText}"${s.regenerate ? '\n_[image will be regenerated]_' : ''}`
              ),
            ].join('\n\n');
            this.out(onEvent, 'plan_scenes', { type: 'markdown', content: planMd, label: 'Updated Scene Plan' });
          }
          this.check();
          // Motion-only ask ("use live motion") should continue, not force another plan loop
          if (motionOnly) {
            planApproved = true;
          }
          // else loop back for another approval round
        } else {
          planApproved = true;
        }
      }

      // Phase 3: Images + GATE
      scenes = applyEvidenceGate(scenes, { rewrite: !agencyLocked });
      const productionCritics = runAndReportCritics('pre_production', scenes);
      if (!agencyLocked && !productionCritics.passed) {
        throw new Error(`Pre-production critic gate blocked generation: ${productionCritics.mandatoryFixes.join(' | ')}`);
      }
      if (agencyLocked && !productionCritics.passed) {
        this.out(onEvent, 'plan_scenes', {
          type: 'markdown',
          label: 'Pre-production Advisory',
          content: `Critics flagged issues but Agency lock is ON — proceeding to production.\n\n${productionCritics.mandatoryFixes.map((fix) => `- ${fix}`).join('\n') || '_No mandatory fixes listed._'}`,
        });
      }
      let chosenCaptionStyle: CaptionStyle | undefined;
      this.step(onEvent, 'generate_images', `Generating ${scenes.length} scene visuals…`);
      // Phase 3: Generate product-grounded stills for ALL formats (Veo uses these as first frames).
      scenes = await this.generateImages(scenes, productBase64, session, onEvent, configWithDetectedStyle);
      this.check();
      scenes = await this.reviewAndRegenerateVisuals(scenes, productBase64, session, onEvent, configWithDetectedStyle);
      this.check();

      const imgGate = await this.gate(
        onEvent,
        configWithDetectedStyle,
        'generate_images',
        isVeo ? 'Approve these stills as Veo first frames?' : 'How do the images look?',
        isVeo
          ? 'Veo will animate each approved still (image-to-video). Feedback examples: "redo scene 2 — warmer light" · "scene 1 packshot tighter".'
          : 'Approve to continue. Feedback examples: "redo scene 2 — make it warmer" · "scene 1 and 3 need more contrast"',
      );
      this.check();

      if (!imgGate.approved) { this.emit(onEvent, 'stopped', { message: 'Stopped at image review.' }); return; }
      if (!(await this.updateLoopSignals(onEvent, configWithDetectedStyle, { stillsApproved: true }))) return;
      this.markRecreateStep('stills', 'Stills approved', onEvent);
      if (imgGate.feedback.trim()) {
        this.log(onEvent, 'generate_images', `Interpreting feedback: "${imgGate.feedback}"`);
        const interp = await this.interpretFeedback(imgGate.feedback, scenes, facts, 'image');
        this.check();

        this.out(onEvent, 'generate_images', {
          type: 'markdown',
          content: `**Agent understood:** ${interp.intent}\n\nRegenerating ${interp.patches.filter((p) => p.regenImage).length} scene(s).`,
          label: 'Feedback Interpretation',
        });

        if (interp.patches.length > 0) {
          scenes = this.applyFeedbackPatches(scenes, interp);
          this.taskMemory.rememberAction(
            'generate_images',
            `Regenerated ${interp.patches.filter((p) => p.regenImage).length} image(s) from feedback`,
            ['patches'],
          );
          this.emitTaskMemory(onEvent, 'generate_images');
          scenes = await this.generateImages(scenes, productBase64, session, onEvent, configWithDetectedStyle);
          this.check();
        }
      }

      // Caption styles + TTS only for stitched video (Veo has native audio; stills skip both).
      if (!isVeo && !isStillFormat && session && productAbsPath) {
        this.log(onEvent, 'generate_images', 'Generating brand-matched caption style previews...');
        const sampleText = scenes[0]?.voiceoverText.slice(0, 60) || 'Your skin deserves this.';
        const styles = await generateCaptionStylePreviews(
          productAbsPath,
          sampleText,
          session.sessionDir,
          session.baseUrl,
        );
        this.check();

        if (styles.length > 0) {
          // Show style previews as images
          for (const s of styles) {
            this.out(onEvent, 'generate_images', {
              type: 'image',
              url: s.previewUrl,
              label: `Caption Style: ${s.label}`,
            });
          }

          const styleGate = await this.gate(onEvent, config, 'generate_images',
            'Choose a caption style',
            `Showing ${styles.length} brand-matched styles. Type "A", "B", or "C" to pick, or describe your preference (e.g. "make text bigger", "use white on dark").`);
          this.check();

          if (!styleGate.approved) { this.emit(onEvent, 'stopped', { message: 'Stopped at caption style.' }); return; }

          const pick = styleGate.feedback.trim().toUpperCase();
          if (pick === 'A') chosenCaptionStyle = styles[0];
          else if (pick === 'B') chosenCaptionStyle = styles[1];
          else if (pick === 'C') chosenCaptionStyle = styles[2];
          else if (!pick) chosenCaptionStyle = styles[0]; // default to A on approve with no feedback
          else {
            // Interpret free-text preference
            const styleInterp = await this.geminiText(`
User said: "${styleGate.feedback}". 
Available caption styles: ${styles.map((s, i) => `${String.fromCharCode(65+i)}: ${s.label} (text: ${s.textColor}, bg: ${s.bgColor})`).join(', ')}.
Which style best matches the user's preference? Return ONLY the letter A, B, or C.`);
            const letter = styleInterp.trim().toUpperCase()[0];
            chosenCaptionStyle = styles[letter === 'B' ? 1 : letter === 'C' ? 2 : 0];
            this.log(onEvent, 'generate_images', `Caption style chosen: ${chosenCaptionStyle?.label}`);
          }
        }
      }

      // Phase 4: Voiceover first — Live Motion must fit to real TTS durations
      // (or target durations when voice is off)
      const wantVoice = configWithDetectedStyle.includeVoiceover !== false;
      if (!isVeo && !isStillFormat && wantVoice) {
        this.step(onEvent, 'generate_voiceover', 'Recording the voiceover…');
        scenes = await this.generateVoiceovers(scenes, configWithDetectedStyle.voice, session, onEvent);
        this.check();
      } else if (!isVeo && !isStillFormat && !wantVoice) {
        this.emit(onEvent, 'phase_start', {
          phase: 'generate_voiceover',
          message: 'Voiceover skipped (silent video)...',
        });
        scenes = scenes.map((s) => ({
          ...s,
          actualDurationSec: s.targetDurationSec > 0.5 ? s.targetDurationSec : s.actualDurationSec,
          audioAbsPath: undefined,
        }));
        this.log(onEvent, 'generate_voiceover', 'includeVoiceover=false — using target scene durations, no TTS');
        this.out(onEvent, 'generate_voiceover', {
          type: 'markdown',
          label: 'Silent Video',
          content: 'Voiceover disabled. Assembling without spoken audio (captions from script may still burn).',
        });
        this.taskMemory.rememberDecision('generate_voiceover', 'Voiceover skipped — silent video', ['no_voice']);
      }

      // Phase 4a: Live Motion (Wan I2V) fitted to on-screen VO timing
      if (!isVeo && !isStillFormat && session) {
        const liveCount = scenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
        if (liveCount > 0) {
          this.step(onEvent, 'generate_live_motion', `Animating ${liveCount} scene(s)…`);
          scenes = await this.generateLiveMotionClips(
            scenes,
            configWithDetectedStyle,
            session,
            onEvent,
            productBase64,
          );
          this.check();
        }
      }

      // Phase 5: Assemble (video) or Export (carousel/static_image)
      let videoUrl: string | null = null;
      let carouselImageUrls: string[] | null = null;
      let imageUrl: string | null = null;

      if (session) {
        if (configWithDetectedStyle.adFormat === 'carousel') {
          // Carousel: generate images first
          this.emit(onEvent, 'phase_start', { phase: 'export_carousel', message: 'Generating carousel images...' });

          const slides: CarouselSlide[] = scenes.map((scene) => ({
            index: scene.index,
            imagePrompt: scene.imagePrompt,
            headline: scene.slideHeadline || '',
            body: scene.slideBody || '',
            useProductAsReference: scene.useProductAsReference,
            visualMode: resolveSceneVisualMode(scene),
            generatedImageBase64: scene.imageUrl?.startsWith('data:') ? scene.imageUrl.split(',')[1] : undefined,
          }));

          if (configWithDetectedStyle.carouselEditMode === 'studio') {
            // Studio mode: generate images only, let editor apply text overlays
            const { imageUrls, baseUrl } = await generateCarouselImages({
              slides,
              session,
              onEvent,
              productBase64: productBase64 || undefined,
              platform: configWithDetectedStyle.platform,
            });

            // Display raw carousel images (no text overlays yet)
            for (let i = 0; i < imageUrls.length; i++) {
              const url = sessionArtifactUrl({ ...session, baseUrl }, imageUrls[i]);
              this.out(onEvent, 'export_carousel', {
                type: 'image',
                url,
                label: `Slide ${i + 1}: ${slides[i]?.headline || 'Slide'}`,
              });
            }

            this.log(onEvent, 'export_carousel', `Carousel images generated: ${imageUrls.length} slides. Open Text Studio to add overlays.`);
            carouselImageUrls = imageUrls;
          } else {
            // Auto mode: burn text overlays immediately
            this.emit(onEvent, 'phase_start', { phase: 'export_carousel', message: 'Burning text overlays...' });

            const carouselOutput = await produceCarousel({
              slides,
              session,
              onEvent,
              productBase64: productBase64 || undefined,
              platform: configWithDetectedStyle.platform,
            });

            carouselImageUrls = carouselOutput.carouselImageUrls || [];

            // Display each carousel slide
            for (let i = 0; i < carouselImageUrls.length; i++) {
              const url = sessionArtifactUrl(session, carouselImageUrls[i]);
              this.out(onEvent, 'export_carousel', {
                type: 'image',
                url,
                label: `Slide ${i + 1}: ${slides[i]?.headline || 'Slide'}`,
              });
            }

            this.log(onEvent, 'export_carousel', `Carousel exported: ${carouselImageUrls.length} slides at 1080x1080`);
          }
          this.check();
        } else if (configWithDetectedStyle.adFormat === 'static_image') {
          // Static Image: export single image
          this.emit(onEvent, 'phase_start', { phase: 'export_image', message: 'Exporting static image...' });

          const scene = scenes[0];
          const imagePath = scene.imageAbsPath || `${session.sessionDir}/static_image.png`;

          imageUrl = imagePath;

          const url = sessionArtifactUrl(session, imageUrl);
          this.out(onEvent, 'export_image', {
            type: 'image',
            url,
            label: 'Static Image',
          });

          this.log(onEvent, 'export_image', `Static image exported: ${imageUrl}`);
          this.check();
        } else if (configWithDetectedStyle.adFormat === 'veo3_video') {
          // Veo3 Video: cost confirmation, generate clips, assemble
          this.emit(onEvent, 'phase_start', { phase: 'cost_confirmation', message: 'Veo3 cost confirmation...' });

          const estimate = estimateVeo3Cost(scenes.length);
          const costGate = await this.gate(onEvent, configWithDetectedStyle, 'cost_confirmation',
            'Veo3 is premium-priced. Approve to generate AI video clips?',
            estimate.warning);
          this.check();

          if (!costGate.approved) { this.emit(onEvent, 'stopped', { message: 'Stopped at Veo3 cost confirmation.' }); return; }
          // Soft USD proxy for loop budget (Veo has no public per-clip quote in-app).
          if (!(await this.updateLoopSignals(onEvent, configWithDetectedStyle, {}, estimate.sceneCount * 2))) return;

          this.emit(onEvent, 'phase_start', { phase: 'generate_veo3_clips', message: 'Animating approved stills with Veo3...' });
          const missingStills = scenes.filter((s) => !s.imageUrl?.startsWith('data:') && !s.lockedAssetBase64);
          if (missingStills.length && !productBase64) {
            throw new Error('Veo3 still→animate needs approved scene stills (or a product packshot). Re-run image generation.');
          }
          const clips: Veo3ClipResult[] = [];
          for (const scene of scenes) {
            this.check();
            const imageInput = resolveVeoClipImageInput({
              scene,
              productBase64,
              productMimeType: agencyContext?.productMimeType || 'image/png',
            });
            if (imageInput.missingRequiredProduct || !imageInput.image) {
              throw new Error(
                `Veo3 scene ${scene.index + 1} (${scene.role}) has no first-frame still to animate. Approve product-grounded stills first.`,
              );
            }
            this.log(
              onEvent,
              'generate_veo3_clips',
              `Veo3 animate still ${scene.index + 1}/${scenes.length}: ${scene.role} · ${imageInput.source}`,
            );
            const outputPath = `${session.sessionDir}/veo3_scene_${scene.index}.mp4`;
            const result = await generateVeo3Clip(
              `${scene.imagePrompt}\n\nMotion direction: subtle cinematic camera move and natural product micro-motion for this ${scene.role} beat. Animate the supplied still — do not change the product. No captions or generated on-screen text.`,
              '9:16',
              estimate.clipDurationSec,
              outputPath,
              imageInput.image,
            );
            clips.push({ sceneIndex: scene.index, clipPath: result.clipPath, durationSec: result.durationSec, hasAudio: true });
            this.out(onEvent, 'generate_veo3_clips', {
              type: 'video',
              url: sessionArtifactUrl(session, result.clipPath),
              label: `Veo3 Scene ${scene.index + 1}: ${scene.role} · animated ${imageInput.source}`,
              mimeType: 'video/mp4',
            });

            if (scene.index < scenes.length - 1) {
              const clipGate = await this.gate(
                onEvent,
                configWithDetectedStyle,
                'generate_veo3_clips',
                `Approve Veo3 scene ${scene.index + 1} before generating the next paid clip?`,
                'Approve to continue. Reject to stop before another Veo3 API call.',
              );
              if (!clipGate.approved) {
                this.emit(onEvent, 'stopped', { message: `Stopped after Veo3 scene ${scene.index + 1}.` });
                return;
              }
            }
          }

          this.emit(onEvent, 'phase_start', { phase: 'assemble_video', message: 'Stitching Veo3 clips...' });
          const stitchedPath = `${session.sessionDir}/veo3_merged.mp4`;
          await stitchVeo3Clips(clips, stitchedPath, session);
          const finalPath = `${session.sessionDir}/final.mp4`;
          const exportResult = await exportForPlatform(stitchedPath, finalPath, configWithDetectedStyle.platform as AdPlatform, session.sessionDir);
          if (!exportResult.ok) throw new Error(`Veo3 platform export failed: ${exportResult.stderr.slice(-300)}`);
          videoUrl = sessionArtifactUrl(session, finalPath);
          this.out(onEvent, 'assemble_video', {
            type: 'video',
            url: videoUrl,
            label: `Final Veo3 Ad · ${configWithDetectedStyle.platform.replace(/_/g, ' ')}`,
            mimeType: 'video/mp4',
          });
          this.check();
        } else {
          // Video: assemble with ffmpeg
          this.step(onEvent, 'assemble_video', 'Assembling the final cut…');
          videoUrl = await this.assembleVideo(
            scenes, session, onEvent,
            chosenCaptionStyle,
            configWithDetectedStyle.platform as AdPlatform,
          );
          this.check();
        }
      } else {
        this.out(onEvent, configWithDetectedStyle.adFormat === 'carousel' ? 'export_carousel' : 'assemble_video', {
          type: 'error',
          content: 'Shell server offline — start it to enable video assembly:\nnode scripts/agent-shell-server.cjs',
        });
      }

      // ── AI Review Gate (skip for carousel) ─────────────────────────────────────────
      if (!isStillFormat && videoUrl && session) {
        const review = await this.reviewVideo(scenes, videoUrl, configWithDetectedStyle, facts, onEvent);
        this.check();

        if (!review.approved || review.issues.length > 0) {
          const reviewGate = await this.gate(onEvent, configWithDetectedStyle, 'deliver',
            review.approved ? 'Review passed — ready to deliver?' : 'AI found issues — fix and re-assemble, or deliver as-is?',
            review.issues.length > 0
              ? `Issues: ${review.issues.join(' · ')}\n\nApprove to continue. Type feedback to fix (e.g. "change the model" · "regen VO with Gen Z hyper female").`
              : 'Approve to continue, or type selective redo feedback.');
          this.check();

          if (!reviewGate.approved) { this.emit(onEvent, 'stopped', { message: 'Stopped at review.' }); return; }

          if (reviewGate.feedback.trim()) {
            this.log(onEvent, 'deliver', `Applying review fixes: "${reviewGate.feedback}"`);
            const fixInterp = await this.interpretFeedback(reviewGate.feedback, scenes, facts, 'selective');
            this.check();
            const applied = await this.applySelectiveRedo(
              scenes,
              fixInterp,
              productBase64,
              session,
              onEvent,
              configWithDetectedStyle,
              chosenCaptionStyle,
            );
            scenes = applied.scenes;
            configWithDetectedStyle = applied.config;
            videoUrl = applied.videoUrl;
            this.check();
          }
        }
      }

      // ── Selective redo loop (cast / dress / voice without full re-run) ──────────
      if (!isStillFormat && videoUrl && session) {
        let redoRound = 0;
        while (redoRound < 3) {
          const redoGate = await this.gate(
            onEvent,
            configWithDetectedStyle,
            'deliver',
            redoRound === 0 ? 'Happy with the video — or selective redo?' : 'Redo applied — another change, or deliver?',
            'Approve = deliver as-is. Or type a selective redo, e.g.\n'
              + '• "use live motion on all scenes"\n'
              + '• "change the model to a blonde woman in her 30s"\n'
              + '• "regen audio with a Gen Z hyper loud energy female"\n'
              + '• "list session files and probe final.mp4 duration"\n'
              + '• "fix audio loudness with ffmpeg"\n'
              + 'Stop = end without further changes.',
          );
          this.check();
          if (!redoGate.approved) {
            this.emit(onEvent, 'stopped', { message: 'Stopped at selective redo.' });
            return;
          }
          if (!redoGate.feedback.trim()) break;

          this.log(onEvent, 'deliver', `Selective redo: "${redoGate.feedback}"`);

          // Open-ended ops asks → full tool director (shell/python/MCP), not just pipeline patches
          if (session && looksLikeOpenEndedAgentAsk(redoGate.feedback)) {
            this.out(onEvent, 'deliver', {
              type: 'markdown',
              label: 'Agent Director',
              content: `Open-ended ask detected — using tool runtime (shell / python / MCP) for:\n> ${redoGate.feedback}`,
            });
            const director = await runAgentDirector({
              goal: redoGate.feedback,
              sessionDir: session.sessionDir,
              context: [
                `Scenes: ${scenes.map((s) => `${s.index + 1}:${s.role} motion=${s.motionMode || 'still'}`).join(', ')}`,
                videoUrl ? `Current video URL: ${videoUrl}` : '',
                `Voice: ${configWithDetectedStyle.voice}`,
                this.taskMemory.formatForPrompt(12),
              ].filter(Boolean).join('\n'),
              maxSteps: 6,
              log: (m) => this.log(onEvent, 'deliver', m),
              out: (md, label) => this.out(onEvent, 'deliver', { type: 'markdown', content: md, label }),
            });
            this.taskMemory.rememberAction('deliver', `Director handled: ${redoGate.feedback.slice(0, 160)}`, ['director']);
            this.out(onEvent, 'deliver', {
              type: 'markdown',
              label: 'Director Result',
              content: director.finalAnswer,
            });
            // If director only answered (capabilities / inspect), stay in redo loop
            if (!/\b(reassemble|regen|rebuild|live motion|voiceover|ffmpeg)\b/i.test(redoGate.feedback)) {
              redoRound += 1;
              continue;
            }
          }

          const redoInterp = await this.interpretFeedback(redoGate.feedback, scenes, facts, 'selective');
          this.check();
          if (!redoInterp.motionMode) {
            const motionAsk = resolveLiveMotionFromFeedback(redoGate.feedback, scenes.length);
            if (motionAsk.matched) {
              redoInterp.motionMode = motionAsk.mode;
              redoInterp.motionSceneIndexes = motionAsk.sceneIndexes;
            }
          }
          const voiceNote = redoInterp.newVoice
            ? ` · voice → **${redoInterp.newVoice}**`
            : '';
          const vibeNote = redoInterp.newVibe ? ` · vibe → **${redoInterp.newVibe}**` : '';
          const motionNote = redoInterp.motionMode
            ? ` · motion → **${redoInterp.motionMode === 'live_motion' ? 'Live Motion' : 'Ken Burns'}**`
            : '';
          this.out(onEvent, 'deliver', {
            type: 'markdown',
            label: 'Selective Redo',
            content: `**Understood:** ${redoInterp.intent}\n\n`
              + `Regenerating ${redoInterp.patches.filter((p) => p.regenImage).length} scene image(s)`
              + (redoInterp.keepVoiceover !== false && !redoInterp.newVoice
                ? ' · keeping voiceover'
                : ' · regenerating voiceover')
              + voiceNote
              + vibeNote
              + motionNote
              + '.',
          });

          if (
            !redoInterp.patches.length
            && !redoInterp.newVoice
            && !redoInterp.motionMode
            && redoInterp.keepVoiceover !== false
          ) {
            this.log(onEvent, 'deliver', 'No patches from feedback — delivering as-is.');
            break;
          }

          const applied = await this.applySelectiveRedo(
            scenes,
            redoInterp,
            productBase64,
            session,
            onEvent,
            configWithDetectedStyle,
            chosenCaptionStyle,
          );
          scenes = applied.scenes;
          configWithDetectedStyle = applied.config;
          videoUrl = applied.videoUrl;
          this.check();
          redoRound += 1;
        }
      }

      // Phase 6: Deliver
      this.emit(onEvent, 'phase_start', { phase: 'deliver', message: 'Done.' });
      this.step(onEvent, 'deliver', 'Your ad is ready — preview and caption below.');
      if (this.decisionTrace) {
        assertFormatLocked(this.decisionTrace.requestedFormat, configWithDetectedStyle.adFormat, configWithDetectedStyle.platform);
        completeDecisionTrace(this.decisionTrace, configWithDetectedStyle.adFormat);
        this.traceDecision('deliver', 'format_delivery', `Delivered ${configWithDetectedStyle.adFormat}`, ['user-prompt'], 1);
        await this.persistDecisionTrace(session);
        this.out(onEvent, 'deliver', {
          type: 'markdown',
          label: 'Intelligence Trace',
          content: `Decision trace recorded with ${this.decisionTrace.decisions.length} evidence-linked decisions${session ? ' and saved as decision_trace.json' : ''}.`,
        });
      }
      await this.persistTaskMemory(session);
      this.emitTaskMemory(onEvent, 'deliver');
      if (!(await this.updateLoopSignals(onEvent, configWithDetectedStyle, {
        motionComplete: true,
        stitched: Boolean(videoUrl) || configWithDetectedStyle.adFormat !== 'stitched_video',
        criticsPass: true,
        delivered: true,
      }))) return;
      this.markRecreateStep('motion', 'Motion complete', onEvent);
      this.markRecreateStep('assemble', videoUrl ? 'Video stitched' : 'Export complete', onEvent);
      this.markRecreateStep('verify', 'Critics / delivery checks', onEvent);
      this.markRecreateStep('deliver', 'Deliverable ready', onEvent);
      const script = configWithDetectedStyle.adFormat === 'carousel'
        ? scenes.map((s) =>
            `[Slide ${s.index + 1} · ${s.role}]\nHeadline: ${s.slideHeadline || ''}\nBody: ${s.slideBody || ''}\nImage: ${s.imagePrompt.slice(0, 80)}...`
          ).join('\n\n')
        : configWithDetectedStyle.adFormat === 'static_image'
        ? `[Static Image]\nImage: ${scenes[0]?.imagePrompt || ''}`
        : scenes.map((s) =>
            `[Scene ${s.index + 1} · ${s.role} · ${s.actualDurationSec.toFixed(1)}s]\n${s.voiceoverText}`
          ).join('\n\n');

      this.emit(onEvent, 'complete', {
        phase: 'deliver',
        result: {
          adFormat: configWithDetectedStyle.adFormat,
          videoUrl: videoUrl || undefined,
          carouselImageUrls: carouselImageUrls || undefined,
          imageUrl: imageUrl || undefined,
          sceneImages: scenes.map((s) => ({ url: s.imageUrl || '', label: configWithDetectedStyle.adFormat === 'carousel' ? `Slide ${s.index + 1}: ${s.slideHeadline}` : `Scene ${s.index + 1}: ${s.role}` })).filter((s) => !!s.url),
          script,
          durationSec: configWithDetectedStyle.adFormat === 'static_image' || configWithDetectedStyle.adFormat === 'carousel' ? 0 : configWithDetectedStyle.durationSec,
          sessionDir: session?.sessionDir || '',
          postCaption: trends?.postCaption ?? '',
          trendInsights: trends,
        },
      });
    } catch (err: any) {
      if (this.decisionTrace) this.decisionTrace.errors.push(err.message || 'Agent failed.');
      if (err.message === 'Agent stopped by user.') this.emit(onEvent, 'stopped', { message: 'Stopped.' });
      else {
        this.emit(onEvent, 'error', {
          message: `${err.message || 'Agent failed.'} — Your prompt and setup are kept; click Run Agent to restart the flow.`,
        });
      }
    }
  }

  /**
   * Extract 2–4 punchy keyword bursts from a voiceover line for caption overlay.
   * Falls back to punctuation splitting if Gemini fails.
   */
  private async extractCaptionBursts(voiceoverText: string): Promise<string[]> {
    try {
      const raw = await this.geminiText(
        `Extract 2-4 punchy keyword bursts (2-4 words each, no punctuation) from this voiceover line for video captions.\nVoiceover: "${voiceoverText}"\nReturn ONLY a JSON array of strings. Example: ["Glass Skin","Every Morning"]`
      );
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const bursts = JSON.parse(match[0]) as string[];
        return bursts.filter((b) => typeof b === 'string' && b.trim()).slice(0, 4);
      }
    } catch {}
    // Fallback: split on sentence boundaries
    return voiceoverText
      .split(/[.!?,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.split(' ').length <= 5)
      .slice(0, 3);
  }

  /**
   * Apply selective redo: visuals, voice change, and/or VO restyle — then reassemble.
   */
  private async applySelectiveRedo(
    scenes: ScenePlan[],
    interp: FeedbackInterpretation,
    productBase64: string | null,
    session: SessionInfo,
    onEvent: (e: AgentEvent) => void,
    config: AgentConfig,
    captionStyle: CaptionStyle | null | undefined,
  ): Promise<{ scenes: ScenePlan[]; config: AgentConfig; videoUrl: string }> {
    let nextConfig = { ...config };
    if (interp.newVoice) {
      nextConfig.voice = coerceAdAgentVoice(interp.newVoice, config.voice);
      this.taskMemory.preferences.voice = nextConfig.voice;
      this.taskMemory.rememberAction('deliver', `Voice → ${nextConfig.voice}`, ['voice']);
      this.log(onEvent, 'deliver', `Voice → ${nextConfig.voice}`);
    }
    if (interp.newVibe) {
      nextConfig.vibe = coerceVideoVibe(interp.newVibe, config.vibe || 'balanced');
      this.taskMemory.preferences.vibe = nextConfig.vibe;
      this.taskMemory.rememberAction('deliver', `Vibe → ${nextConfig.vibe}`, ['vibe']);
      this.log(onEvent, 'deliver', `Vibe → ${nextConfig.vibe}`);
    }

    const motionIntent = interp.motionMode
      ? {
          matched: true as const,
          mode: interp.motionMode,
          sceneIndexes: interp.motionSceneIndexes,
        }
      : { matched: false as const, mode: 'still' as const };
    const needsMotion = motionIntent.matched;
    if (needsMotion) {
      nextConfig.preferLiveMotion = motionIntent.mode === 'live_motion';
      this.taskMemory.preferences.preferLiveMotion = motionIntent.mode === 'live_motion';
      this.taskMemory.rememberAction(
        'deliver',
        motionIntent.mode === 'live_motion' ? 'Enabled Live Motion from feedback' : 'Switched to Ken Burns stills',
        ['live_motion'],
      );
      this.log(
        onEvent,
        'deliver',
        motionIntent.mode === 'live_motion' ? 'Enabling Live Motion from feedback' : 'Switching to Ken Burns stills',
      );
    }

    const needsImageRegen = interp.patches.some((p) => p.regenImage);
    const needsAudio = interp.keepVoiceover === false || Boolean(interp.newVoice)
      || interp.patches.some((p) => !!p.newVoiceoverText);

    let nextScenes = this.applyFeedbackPatches(scenes, interp);
    if (needsMotion) {
      nextScenes = applyLiveMotionIntent(nextScenes, motionIntent);
    }
    if (this.sceneContinuity && (interp.continuityPatch || needsImageRegen)) {
      this.out(onEvent, 'deliver', {
        type: 'markdown',
        label: 'Continuity Lock',
        content: formatContinuityLockMarkdown(this.sceneContinuity),
      });
    }

    if (needsImageRegen) {
      nextScenes = await this.generateImages(nextScenes, productBase64, session, onEvent, nextConfig);
      this.check();
    }

    if (needsAudio && nextConfig.includeVoiceover !== false) {
      nextScenes = await this.generateVoiceovers(nextScenes, nextConfig.voice, session, onEvent);
      this.check();
    } else if (needsAudio && nextConfig.includeVoiceover === false) {
      this.log(onEvent, 'deliver', 'Voiceover disabled — skipping TTS regen (silent video).');
      nextScenes = nextScenes.map((s) => ({
        ...s,
        actualDurationSec: s.targetDurationSec > 0.5 ? s.targetDurationSec : s.actualDurationSec,
      }));
    } else if (!needsImageRegen && !needsMotion) {
      this.log(onEvent, 'deliver', 'Nothing to regenerate — reassembling with current assets.');
    } else if (!needsAudio) {
      this.log(onEvent, 'deliver', 'Keeping existing voiceover.');
    }

    const liveNeedsGen = nextScenes.filter(
      (s) => (s.motionMode || 'still') === 'live_motion' && !s.motionClipAbsPath,
    );
    const liveNeedsRefresh = needsImageRegen
      ? nextScenes.filter((s) => (s.motionMode || 'still') === 'live_motion' && s.regenerate)
      : [];
    if (liveNeedsRefresh.length > 0) {
      nextScenes = nextScenes.map((s) => (
        s.regenerate && (s.motionMode || 'still') === 'live_motion'
          ? { ...s, motionClipAbsPath: undefined }
          : s
      ));
    }
    if (liveNeedsGen.length > 0 || liveNeedsRefresh.length > 0 || (needsMotion && motionIntent.mode === 'live_motion')) {
      const liveCount = nextScenes.filter((s) => (s.motionMode || 'still') === 'live_motion').length;
      if (liveCount > 0) {
        nextScenes = await this.generateLiveMotionClips(
          nextScenes,
          nextConfig,
          session,
          onEvent,
          productBase64,
        );
        this.check();
      }
    }

    const videoUrl = await this.assembleVideo(
      nextScenes,
      session,
      onEvent,
      captionStyle,
      nextConfig.platform as AdPlatform,
    );

    const regenBits = [
      needsImageRegen ? 'images' : '',
      needsAudio ? 'voiceover' : '',
      needsMotion || liveNeedsGen.length > 0 || liveNeedsRefresh.length > 0 ? 'live motion' : '',
    ].filter(Boolean);
    this.taskMemory.rememberAction(
      'deliver',
      regenBits.length
        ? `Selective redo applied (${regenBits.join(' + ')}) · ${interp.intent || 'feedback'}`
        : `Reassembled after selective redo · ${interp.intent || 'feedback'}`,
      ['selective_redo'],
    );
    this.emitTaskMemory(onEvent, 'deliver');
    await this.persistTaskMemory(session);

    return { scenes: nextScenes, config: nextConfig, videoUrl };
  }

  /**
   * Use Gemini to understand the user's feedback and return structured patches.
   * Called for plan-phase, image-phase, and end-of-run selective redo.
   * phase = 'plan': may patch voiceover + image prompts, or trigger structural re-plan
   * phase = 'image': patches image prompts and flags which scenes to regenerate
   * phase = 'selective': prefer visual-only changes (model/dress/lighting) and keep VO
   *   — unless user asks to regen audio / change TTS voice
   */
  private async interpretFeedback(
    feedback: string,
    scenes: ScenePlan[],
    facts: string[],
    phase: 'plan' | 'image' | 'selective',
  ): Promise<FeedbackInterpretation> {
    const sceneSummary = scenes.map((s, i) =>
      `Scene ${i + 1} (${s.role}): voiceover="${s.voiceoverText.slice(0, 80)}" | imagePrompt="${s.imagePrompt.slice(0, 120)}"`
    ).join('\n');

    const factsText = facts.slice(0, 8).map((f, i) => `${i + 1}. ${f}`).join('\n');
    const continuitySummary = this.sceneContinuity
      ? `CURRENT CONTINUITY LOCK:\n- cast: ${this.sceneContinuity.cast}\n- wardrobe: ${this.sceneContinuity.wardrobe}\n- location: ${this.sceneContinuity.locationFamily}\n- lighting: ${this.sceneContinuity.lightingPalette}`
      : 'CURRENT CONTINUITY LOCK: (none)';

    const voiceCatalog = AD_AGENT_VOICE_OPTIONS
      .map((v) => `${v.value} (${v.desc})`)
      .join(', ');
    const voiceHint = resolveAdAgentVoiceFromFeedback(feedback);
    const motionHint = resolveLiveMotionFromFeedback(feedback, scenes.length);
    const taskMemBlock = this.taskMemory.formatForPrompt();

    const selectiveRules = phase === 'selective' || phase === 'image'
      ? `
SELECTIVE REDO RULES (important):
- If user wants a different model/person/talent/face → update continuityPatch.cast AND rewrite every affected scene's imagePrompt (keep same shot/composition/story), regenImage=true for ALL scenes that show a person, keepVoiceover=true.
- If user wants different dress/outfit/wardrobe/clothes → update continuityPatch.wardrobe + rewrite imagePrompts, regenImage=true for scenes with people, keepVoiceover=true.
- If user says video/audio/script/voiceover is fine / keep VO → keepVoiceover=true and do NOT set newVoiceoverText.
- LIVE MOTION: if user asks for live motion / Wan / animate stills / "consider live motion" → set motionMode="live_motion" (and motionSceneIndexes if they named scenes). keepVoiceover=true, regenImage=false, patches=[]. If they want Ken Burns / stills only → motionMode="still".
- VOICE / AUDIO REDO: if user asks to regenerate audio, change voice, or describes a narrator (e.g. "Gen Z hyper loud energy female", "calm luxury male", "switch to Leda") → set newVoice to the best match from AVAILABLE VOICES, keepVoiceover=false, regenImage=false, patches=[] (or only script patches). Set newVibe to "gen_z_bright" for Gen Z / hyper / hype energy, "premium_calm" for calm/soft/luxury/ASMR, else omit.
- If they want punchier / Gen Z spoken ENERGY (not just a new timbre), also rewrite newVoiceoverText for EVERY scene: same facts, shorter punchy creator voice — never invent claims.
- If user names specific scenes ("scene 2 and 4"), only patch those; if they say "the model" / "everywhere", patch all scenes that include talent.
- Prefer keepVoiceover=true unless they explicitly ask to change the script/narration OR change/regenerate the voice/audio.`
      : `
PLAN FEEDBACK RULES:
- LIVE MOTION: if user asks for live motion / Wan / animate / "consider live motion" → set motionMode="live_motion" (optionally motionSceneIndexes). This is NOT a structural re-plan.
- If they ask for Ken Burns / stills only → motionMode="still".`;

    const prompt = `You are an AI video production assistant. A user gave feedback on a ${scenes.length}-scene ad video.

CURRENT SCENES:
${sceneSummary}

${continuitySummary}

${taskMemBlock || 'TASK MEMORY: (empty — treat this feedback as the start of run preferences)'}

AVAILABLE VOICES (pick newVoice ONLY from this list): ${voiceCatalog}
HEURISTIC VOICE HINT (use if feedback is about voice/energy): ${voiceHint.voice}${voiceHint.vibe ? ` · vibe ${voiceHint.vibe}` : ''}
HEURISTIC MOTION HINT: ${motionHint.matched ? `${motionHint.mode}${motionHint.sceneIndexes ? ` scenes ${motionHint.sceneIndexes.map((i) => i + 1).join(',')}` : ' (all scenes)'}` : 'none'}

VERIFIED PRODUCT FACTS (only these may appear in voiceover or image prompts):
${factsText}

USER FEEDBACK: "${feedback}"

MEMORY RULES:
- Honor TASK MEMORY standing preferences unless this feedback clearly overrides them.
- If memory says USE Live Motion and feedback does not cancel it, keep motionMode="live_motion" when regenerating motion-related work.
- If memory has a preferred voice/vibe and feedback asks to regen audio without naming a new voice, reuse that voice/vibe.
- Prefer keepVoiceover=true when memory says keep VO, unless this feedback asks to change script/voice/audio.

TASK: Interpret the user's intent and return a JSON object with this exact shape:
{
  "intent": "<1 sentence: what you understood>",
  "structural": <true if scene count or scene order must change, false otherwise>,
  "replanHint": "<if structural=true: compact instruction for re-planning, otherwise empty string>",
  "keepVoiceover": <true if existing TTS files should stay; false if audio must be re-recorded>,
  "newVoice": "<optional Gemini TTS voice id from AVAILABLE VOICES, or omit>",
  "newVibe": "<optional: gen_z_bright | balanced | premium_calm>",
  "motionMode": "<optional: live_motion | still>",
  "motionSceneIndexes": [<optional 0-based scene indexes; omit = all scenes>],
  "continuityPatch": {
    "cast": "<optional new cast lock>",
    "wardrobe": "<optional new wardrobe lock>",
    "locationFamily": "<optional>",
    "lightingPalette": "<optional>"
  },
  "patches": [
    {
      "sceneIndex": <0-based integer>,
      "newVoiceoverText": "<full new voiceover text for this scene, or omit if unchanged>",
      "newImagePrompt": "<full new image prompt for this scene — must still include CONTINUITY LOCK if present, or omit if unchanged>",
      "regenImage": <true if the image must be regenerated>
    }
  ]
}

RULES:
- Only patch scenes that the feedback actually affects. Leave unchanged scenes out of patches[].
- If feedback is about colour/mood/lighting only, update imagePrompt and set regenImage=true, leave voiceover alone, keepVoiceover=true.
- If feedback is about what is said (script), update newVoiceoverText, set regenImage=false unless visuals must change too, keepVoiceover=false.
- If feedback is ONLY about voice/audio/energy of the narrator, set newVoice (+ optional newVibe), keepVoiceover=false, regenImage=false, and leave patches empty UNLESS restyling the spoken lines for energy.
- If feedback is ONLY about Live Motion / Wan / animate stills, set motionMode (and optional motionSceneIndexes), keepVoiceover=true, regenImage=false, patches=[], structural=false.
- NEVER invent ingredients not in the VERIFIED PRODUCT FACTS list.
- For ${phase === 'image' || phase === 'selective' ? 'image/selective feedback: focus on image prompts, continuityPatch, regenImage, motionMode, and/or newVoice; default keepVoiceover=true unless voice/audio/script change' : 'plan feedback: focus on voiceover / motionMode; only flag regenImage=true if the visual concept changes significantly'}.
${selectiveRules}
- Return ONLY the JSON object, no markdown fences, no explanation.`;

    try {
      const raw = await this.geminiText(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed: FeedbackInterpretation = JSON.parse(match[0]);
        parsed.patches = (parsed.patches || []).filter(
          (p) => typeof p.sceneIndex === 'number' && p.sceneIndex >= 0 && p.sceneIndex < scenes.length
        );
        // Merge heuristic voice resolve when model omitted voice fields
        if (!parsed.newVoice && voiceHint.regenAudio) {
          parsed.newVoice = voiceHint.voice;
        }
        if (parsed.newVoice) {
          parsed.newVoice = coerceAdAgentVoice(parsed.newVoice, voiceHint.voice);
          parsed.keepVoiceover = false;
        }
        if (!parsed.newVibe && voiceHint.vibe) {
          parsed.newVibe = voiceHint.vibe;
        }
        if (parsed.newVibe) {
          parsed.newVibe = coerceVideoVibe(parsed.newVibe);
        }
        if (!parsed.motionMode && motionHint.matched) {
          parsed.motionMode = motionHint.mode;
          parsed.motionSceneIndexes = motionHint.sceneIndexes;
        }
        // Standing Live Motion preference from earlier gates (unless this feedback cancels it)
        if (
          !parsed.motionMode
          && this.taskMemory.preferences.preferLiveMotion === true
          && !/\b(ken\s*burns|still only|no live(?:\s*motion)?|disable live)\b/i.test(feedback)
          && /\b(live\s*motion|wan|animate|motion|redo|regen|reassemble|fix|again)\b/i.test(feedback)
        ) {
          parsed.motionMode = 'live_motion';
        }
        if (parsed.motionMode && parsed.motionMode !== 'live_motion' && parsed.motionMode !== 'still') {
          parsed.motionMode = undefined;
        }
        // Prefer remembered voice when regen-audio ask omits an explicit voice
        if (!parsed.newVoice && voiceHint.regenAudio && this.taskMemory.preferences.voice) {
          parsed.newVoice = coerceAdAgentVoice(this.taskMemory.preferences.voice, voiceHint.voice);
        }
        if (!parsed.newVibe && voiceHint.regenAudio && this.taskMemory.preferences.vibe) {
          parsed.newVibe = coerceVideoVibe(this.taskMemory.preferences.vibe);
        }
        // Restyle spoken lines for Gen Z / hyper energy when requested and model skipped it
        if (voiceHint.restyleScript && !parsed.patches.some((p) => p.newVoiceoverText)) {
          const restyled = await this.restyleVoiceoversForEnergy(scenes, facts, feedback, parsed.newVibe || voiceHint.vibe || 'gen_z_bright');
          if (restyled.length) {
            parsed.patches = restyled;
            parsed.keepVoiceover = false;
          }
        }
        if (parsed.keepVoiceover === undefined) {
          const asksAudioChange = parsed.newVoice
            || /\b(script|voiceover|narration|audio|voice|what (he|she|they|we) say)\b/i.test(feedback);
          parsed.keepVoiceover = phase === 'selective' || phase === 'image'
            ? !asksAudioChange && (this.taskMemory.preferences.keepVoiceoverUnlessAsked !== false)
            : false;
        }
        this.taskMemory.rememberDecision(
          phase === 'plan' ? 'plan_scenes' : phase === 'image' ? 'generate_images' : 'deliver',
          parsed.intent || feedback.slice(0, 200),
          ['feedback_interp'],
        );
        return parsed;
      }
    } catch {}

    // Fallback
    const visualOnly = (phase === 'image' || phase === 'selective')
      && !voiceHint.regenAudio
      && !motionHint.matched
      && /\b(model|dress|outfit|wardrobe|cast|talent|lighting|color|colour)\b/i.test(feedback);
    let patches: FeedbackInterpretation['patches'] = visualOnly || phase === 'image'
      ? scenes.map((_, i) => ({ sceneIndex: i, regenImage: true }))
      : [];
    if (voiceHint.restyleScript) {
      const restyled = await this.restyleVoiceoversForEnergy(
        scenes,
        facts,
        feedback,
        voiceHint.vibe || this.taskMemory.preferences.vibe || 'gen_z_bright',
      );
      if (restyled.length) patches = restyled;
    }
    const fallbackVoice = voiceHint.regenAudio
      ? (voiceHint.voice || this.taskMemory.preferences.voice)
      : undefined;
    const fallbackMotion = motionHint.matched
      ? motionHint.mode
      : (
        this.taskMemory.preferences.preferLiveMotion === true
        && /\b(live\s*motion|wan|animate|motion|redo|regen|reassemble|fix|again)\b/i.test(feedback)
          ? 'live_motion' as const
          : undefined
      );
    return {
      intent: feedback,
      structural: false,
      replanHint: feedback,
      keepVoiceover: voiceHint.regenAudio || voiceHint.restyleScript ? false : true,
      newVoice: fallbackVoice ? coerceAdAgentVoice(fallbackVoice, voiceHint.voice) : undefined,
      newVibe: voiceHint.vibe
        || (voiceHint.regenAudio && this.taskMemory.preferences.vibe
          ? coerceVideoVibe(this.taskMemory.preferences.vibe)
          : undefined),
      motionMode: fallbackMotion,
      motionSceneIndexes: motionHint.matched ? motionHint.sceneIndexes : undefined,
      patches: patches.length
        ? patches
        : (fallbackMotion
          ? []
          : scenes.map((_, i) => ({ sceneIndex: i, regenImage: visualOnly || phase !== 'plan' }))),
    };
  }

  /** Punch up VO lines for Gen Z / energetic delivery without inventing claims. */
  private async restyleVoiceoversForEnergy(
    scenes: ScenePlan[],
    facts: string[],
    feedback: string,
    vibe: string,
  ): Promise<FeedbackInterpretation['patches']> {
    const factsText = facts.slice(0, 10).map((f, i) => `${i + 1}. ${f}`).join('\n');
    const lines = scenes.map((s, i) => `Scene ${i + 1}: ${s.voiceoverText}`).join('\n');
    const energy = vibe === 'premium_calm'
      ? 'calm, premium, measured'
      : 'bright Gen Z creator energy — punchy, casual, hyper-confident, like talking to a friend (NOT corporate ad copy)';
    const prompt = `Rewrite these ad voiceover lines for ${energy}.

USER ASKED: "${feedback}"

VERIFIED FACTS (do not invent claims/ingredients):
${factsText}

CURRENT LINES:
${lines}

Return ONLY JSON:
{ "lines": ["scene1 text", "scene2 text", ...] }
Same number of lines as scenes. Keep each line roughly similar length (±20%). No slogans. No new product claims.`;

    try {
      const raw = await this.geminiText(prompt);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]) as { lines?: string[] };
      const next = Array.isArray(parsed.lines) ? parsed.lines : [];
      if (next.length !== scenes.length) return [];
      return scenes.map((s, i) => ({
        sceneIndex: s.index,
        newVoiceoverText: cleanScriptText(String(next[i] || s.voiceoverText)),
        regenImage: false,
      }));
    } catch {
      return [];
    }
  }

  /** Apply continuity + image patches from selective redo feedback. */
  private applyFeedbackPatches(
    scenes: ScenePlan[],
    interp: FeedbackInterpretation,
  ): ScenePlan[] {
    if (interp.continuityPatch && this.sceneContinuity) {
      this.sceneContinuity = {
        ...this.sceneContinuity,
        cast: interp.continuityPatch.cast?.trim() || this.sceneContinuity.cast,
        wardrobe: interp.continuityPatch.wardrobe?.trim() || this.sceneContinuity.wardrobe,
        locationFamily: interp.continuityPatch.locationFamily?.trim() || this.sceneContinuity.locationFamily,
        lightingPalette: interp.continuityPatch.lightingPalette?.trim() || this.sceneContinuity.lightingPalette,
      };
    } else if (interp.continuityPatch && !this.sceneContinuity) {
      this.sceneContinuity = synthesizeContinuityFromScenes(scenes);
      this.sceneContinuity = {
        ...this.sceneContinuity,
        ...Object.fromEntries(
          Object.entries(interp.continuityPatch).filter(([, v]) => typeof v === 'string' && v.trim()),
        ),
      } as typeof this.sceneContinuity;
    }

    return scenes.map((s) => {
      const patch = interp.patches.find((p) => p.sceneIndex === s.index);
      if (!patch) return { ...s, regenerate: false };
      let imagePrompt = patch.newImagePrompt ?? s.imagePrompt;
      if (this.sceneContinuity && patch.regenImage && !s.preserveExactAsset) {
        // Strip old lock then re-apply updated bible
        imagePrompt = imagePrompt.replace(/^CONTINUITY LOCK[\s\S]*?\n\n/i, '');
        imagePrompt = prependContinuityLock(imagePrompt, this.sceneContinuity, s.index);
      }
      return {
        ...s,
        voiceoverText: patch.newVoiceoverText ?? s.voiceoverText,
        imagePrompt,
        regenerate: s.preserveExactAsset ? false : patch.regenImage,
      };
    });
  }
}
