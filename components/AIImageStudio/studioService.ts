/**
 * Service adapter for the AI Image Studio.
 * Maps studio state to existing geminiService functions with timeout handling.
 */

import type { ImageGenerationRequest } from '../../types';
import {
  generateImageAsset,
  enhanceImagePrompt,
  type ImagePromptEnhancementRequest,
} from '../../services/geminiService';
import type {
  CreativeRoute,
  AspectRatio,
  StudioAsset,
  RoleAssignment,
  StudioState,
  ComposerReference,
} from './types';
import { inferStudioOperation } from './studioOperation';
import { buildCreativeProductionPrompt } from './creativeContextService';
import { aspectRatioPromptSuffix } from './aspectRatioCatalog';

/** Result of a successful image generation */
export interface GenerationResult {
  base64: string;
  mimeType: 'image/png';
}

/** Parameters for generating a studio image */
export interface GenerateStudioImageParams {
  prompt: string;
  creativeRoute: CreativeRoute;
  aspectRatio: AspectRatio;
  baseAsset?: StudioAsset;
  selectionAssets?: StudioAsset[];
  roleAssignments?: Map<string, RoleAssignment>;
}

/** Parameters for enhancing a studio prompt */
export interface EnhanceStudioPromptParams {
  rawPrompt: string;
  creativeRoute: CreativeRoute;
  baseAsset?: StudioAsset;
  aspectRatio?: AspectRatio;
  brandName?: string;
  productTitle?: string;
  brandPersonality?: string;
  brandVisualLanguage?: string;
  brandAestheticsBrief?: string;
  productFacts?: string[];
  productClaims?: string[];
  productPreservationRules?: string[];
  trendInsights?: string[];
  referenceImageCount?: number;
  referenceRoles?: string[];
  referenceImages?: Array<{
    base64: string;
    mimeType: string;
    role?: string;
    label?: string;
  }>;
  intent?: string;
  intentRationale?: string;
  intentDirectives?: string[];
  isAlreadyEnriched?: boolean;
}

/** Timeout durations in milliseconds */
const GENERATION_TIMEOUT_MS = 60_000;
/** Longer when vision refs / brand brief are attached */
const ENHANCEMENT_TIMEOUT_MS = 45_000;

/**
 * Maps a studio CreativeRoute to the enhanceImagePrompt route parameter.
 */
function mapCreativeRouteToEnhancementRoute(
  route: CreativeRoute
): ImagePromptEnhancementRequest['route'] {
  switch (route) {
    case 'generate_fresh':
      return 'generate_fresh';
    case 'ai_upgrade':
      return 'upgrade_existing';
    case 'composite':
      return 'composite_product';
    case 'edit':
      return 'use_existing';
  }
}

/**
 * Builds an ImageGenerationRequest for the "Generate Fresh" creative route.
 * If context assets are provided (locked assets), they're passed as style/reference
 * context so the AI understands the product and brand aesthetic while creating
 * something new. Without context assets, it generates purely from the prompt.
 */
export function buildGenerateRequest(
  prompt: string,
  aspectRatio: AspectRatio,
  contextAssets?: StudioAsset[],
): ImageGenerationRequest {
  // No context assets — pure text-to-image generation
  if (!contextAssets || contextAssets.length === 0) {
    return {
      mode: 'generate',
      imagePrompt: `${prompt}${aspectRatioPromptSuffix(aspectRatio)}`,
      aspectRatio,
    };
  }

  // With context assets — use composite mode with all assets as "style_guide" references
  // This tells the AI: "create something new inspired by these references"
  const references = contextAssets.map((asset) => ({
    input: { data: asset.base64, mimeType: asset.mimeType },
    role: 'style_guide' as const,
    preserve: ['product_identity', 'brand_aesthetic'],
    modify: 'Create a fresh composition inspired by these references',
  }));

  return {
    mode: 'composite',
    imagePrompt: `CREATE A FRESH NEW IMAGE (do not replicate the references exactly — use them only for style, product identity, and brand context):\n\n${prompt}${aspectRatioPromptSuffix(aspectRatio)}`,
    aspectRatio,
    references,
  };
}

/**
 * Builds an ImageGenerationRequest for the "AI Upgrade" or "Edit" creative routes.
 * Uses the base asset as primaryReference with mode 'edit'.
 */
export function buildEditRequest(
  prompt: string,
  aspectRatio: AspectRatio,
  baseAsset: StudioAsset
): ImageGenerationRequest {
  return {
    mode: 'edit',
    imagePrompt: prompt,
    aspectRatio,
    primaryReference: {
      data: baseAsset.base64,
      mimeType: baseAsset.mimeType,
    },
  };
}

/**
 * Builds an ImageGenerationRequest for the "Composite" creative route.
 * Maps each selection asset to a reference entry with its assigned role.
 */
export function buildCompositeRequest(
  prompt: string,
  aspectRatio: AspectRatio,
  selectionAssets: StudioAsset[],
  roleAssignments: Map<string, RoleAssignment>
): ImageGenerationRequest {
  const references = selectionAssets.map((asset) => {
    const assignment = roleAssignments.get(asset.id);
    return {
      input: { data: asset.base64, mimeType: asset.mimeType },
      role: assignment?.role || 'product',
      preserve: assignment?.preserve ? [assignment.preserve] : undefined,
      modify: assignment?.modify,
    };
  });

  return {
    mode: 'composite',
    imagePrompt: prompt,
    aspectRatio,
    references,
  };
}

/**
 * Wraps a promise with a timeout. Rejects with a timeout error if the
 * promise does not resolve within the specified duration.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000} seconds.`));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Builds the appropriate request based on creative route and executes generation.
 * Applies a 60-second timeout.
 */
export async function generateStudioImage(
  params: GenerateStudioImageParams
): Promise<GenerationResult> {
  const { prompt, creativeRoute, aspectRatio, baseAsset, selectionAssets, roleAssignments } = params;

  let request: ImageGenerationRequest;

  switch (creativeRoute) {
    case 'generate_fresh':
      request = buildGenerateRequest(prompt, aspectRatio, selectionAssets);
      break;

    case 'ai_upgrade':
    case 'edit':
      if (!baseAsset) {
        throw new Error(`Creative route "${creativeRoute}" requires a base asset.`);
      }
      request = buildEditRequest(prompt, aspectRatio, baseAsset);
      break;

    case 'composite':
      if (!selectionAssets || selectionAssets.length < 2) {
        throw new Error('Composite route requires at least 2 selection assets.');
      }
      request = buildCompositeRequest(
        prompt,
        aspectRatio,
        selectionAssets,
        roleAssignments || new Map()
      );
      break;

    default:
      throw new Error(`Unknown creative route: ${creativeRoute}`);
  }

  const base64 = await withTimeout(
    generateImageAsset(request),
    GENERATION_TIMEOUT_MS,
    'Generation'
  );

  return { base64, mimeType: 'image/png' };
}

/**
 * Enhances a raw prompt using the AI prompt enhancement service.
 * Applies a 15-second timeout.
 */
export async function enhanceStudioPrompt(
  params: EnhanceStudioPromptParams
): Promise<{ enhancedPrompt: string; negativePrompt?: string }> {
  const {
    rawPrompt, creativeRoute, baseAsset,
    aspectRatio, brandName, productTitle,
    brandPersonality, brandVisualLanguage, brandAestheticsBrief,
    productFacts, productClaims, productPreservationRules, trendInsights,
    referenceImageCount, referenceRoles, referenceImages,
    intent, intentRationale, intentDirectives,
    isAlreadyEnriched,
  } = params;

  const enhancementRequest: ImagePromptEnhancementRequest = {
    rawPrompt,
    route: mapCreativeRouteToEnhancementRoute(creativeRoute),
    baseImageBase64: baseAsset?.base64,
    baseImageMimeType: baseAsset?.mimeType,
    aspectRatio,
    brandName,
    productTitle,
    brandPersonality,
    brandVisualLanguage,
    brandAestheticsBrief,
    productFacts,
    productClaims,
    productPreservationRules,
    trendInsights,
    referenceImageCount,
    referenceRoles,
    referenceImages,
    intent,
    intentRationale,
    intentDirectives,
    isAlreadyEnriched,
  };

  const result = await withTimeout(
    enhanceImagePrompt(enhancementRequest),
    ENHANCEMENT_TIMEOUT_MS,
    'Enhancement'
  );

  return result;
}

// ---------------------------------------------------------------------------
// Phase 1.2: Session-based generation request builder
// ---------------------------------------------------------------------------

/**
 * Maps a ComposerReferenceRole to the internal AssetProvenanceRole used by the
 * existing generation service. Style and composition references are mapped to
 * 'style_guide'; include and product are mapped to their canonical equivalents.
 */
function mapComposerRoleToProvenance(
  role: ComposerReference['role'],
): 'product' | 'style_guide' {
  switch (role) {
    case 'product':
      return 'product';
    case 'include':
      return 'product';
    case 'style':
      return 'style_guide';
    case 'composition':
      return 'style_guide';
  }
}

/**
 * Builds an ImageGenerationRequest from the current StudioState using the new
 * Phase 1 session fields (composerReferences, activeDocument).
 *
 * - edit:      active document present → edit mode with activeDocument's root asset
 * - composite: two or more `include` references → composite mode
 * - generate:  fallback → generate mode with optional product/style references
 *
 * Product Truth preservation is applied only to references with role 'product'.
 * Style references never impose product identity.
 */
export function buildStudioGenerationRequest(
  state: Pick<StudioState, 'prompt' | 'aspectRatio' | 'composerReferences' | 'activeDocument' | 'assets' | 'productTruth' | 'brandKnowledge' | 'trendResearch' | 'conceptCandidates' | 'selectedConceptId' | 'socialPostDraft' | 'outputIntent' | 'isPromptEnriched'>,
): ImageGenerationRequest {
  const { activeDocument, assets, conceptCandidates, selectedConceptId, socialPostDraft } = state;
  const isSocialPost = state.outputIntent === 'social_post' && !!socialPostDraft;
  const aspectRatio = isSocialPost
    ? socialPostDraft!.aspectRatio
    : state.aspectRatio;

  // For social posts, the draft's hero/supporting assets are the locked product
  // images and must always travel with the generation request as product
  // references, even if they are no longer selected in the gallery.
  let composerReferences = state.composerReferences;
  if (isSocialPost) {
    const draftAssetIds = [socialPostDraft!.heroAssetId, ...(socialPostDraft!.supportingAssetIds || [])];
    const existingIds = new Set(composerReferences.map((r) => r.assetId));
    const missing = draftAssetIds.filter(
      (id) => id && !existingIds.has(id) && assets.some((a) => a.id === id),
    );
    if (missing.length > 0) {
      composerReferences = [
        ...composerReferences,
        ...missing.map((assetId) => ({ assetId, role: 'product' as const })),
      ];
    }
  }

  // Get selected concept if available
  const selectedConcept = selectedConceptId
    ? conceptCandidates.find(c => c.id === selectedConceptId)
    : undefined;

  // For social posts, the generation brief and art direction plan carry all the
  // creative direction. The prompt box may contain leftover text from concept
  // selection that shouldn't override the social post planning. Use the art
  // direction visual strategy as primary direction for social posts.
  const userDirection = isSocialPost
    ? (socialPostDraft!.artDirectionPlan?.visualStrategy ?? socialPostDraft!.generationBrief.slice(0, 200))
    : state.prompt;

  const prompt = buildCreativeProductionPrompt({
    userDirection,
    productTruth: state.productTruth,
    brandKnowledge: state.brandKnowledge,
    trendResearch: state.trendResearch,
    selectedConcept: isSocialPost ? undefined : selectedConcept, // Don't duplicate concept for social posts — it's in the brief
    socialPostDraft,
    outputIntent: state.outputIntent,
    aspectRatio,
    isPromptEnriched: state.isPromptEnriched,
  });

  if (isSocialPost) {
    console.log('[studioService] Social post generation — prompt length:', prompt.length, 'artDirection:', socialPostDraft!.artDirectionPlan?.textDecision);
  }

  // Social posts: when an art direction plan exists, enforce its text decision;
  // otherwise fall back to the legacy behavior of allowing all non-empty copy.
  const NO_TEXT_INSTRUCTION = 'DO NOT include any text, typography, letters, words, or watermarks in the generated image.';

  let allowedOnImageText: string[] = [];
  let noTextInstruction: string | undefined;

  if (isSocialPost) {
    const plan = socialPostDraft!.artDirectionPlan;
    if (plan) {
      // Art direction plan controls text decisions
      if (plan.textDecision === 'none') {
        allowedOnImageText = [];
        noTextInstruction = NO_TEXT_INSTRUCTION;
      } else {
        // Allow only exact validated strings from plan's visibleText
        allowedOnImageText = plan.visibleText
          .map((v) => v.content)
          .filter((t) => !!t && t.trim().length > 0);
      }
    } else {
      // Backward compat: no art direction plan — use legacy copy fields
      allowedOnImageText = [
        socialPostDraft!.copy.headline,
        socialPostDraft!.copy.supportingText,
        socialPostDraft!.copy.callToAction,
      ].filter((t): t is string => !!t && t.trim().length > 0);
    }
  } else if (state.isPromptEnriched) {
    // Prompt Writer enriched prompts may contain text rendering instructions
    // like: Render the headline "..." or Place "..." at the top or render bullet points.
    // Extract quoted strings so they're passed as allowedOnImageText,
    // which skips the QA reviewer that would otherwise strip text directives.
    const textPatterns = prompt.match(/(?:Render|Place|Add|Write|Display|Show)\s+(?:the\s+)?(?:headline|text|body text|subtext|sub-heading|subheading|CTA|call.?to.?action|caption|title|heading|footer|tagline|quote|word|phrase|stat|number|bullet|bullet point|slide number)\s+["']([^"']+)["']/gi);
    if (textPatterns && textPatterns.length > 0) {
      allowedOnImageText = textPatterns
        .map((m) => {
          const match = m.match(/["']([^"']+)["']/);
          return match ? match[1] : null;
        })
        .filter((t): t is string => !!t && t.trim().length > 0);
    }
    // Also catch patterns like: render three bullet points: "• ...", "• ...", "• ..."
    const bulletPatterns = prompt.match(/["']([•▪‣].*?)["']/g);
    if (bulletPatterns) {
      for (const bp of bulletPatterns) {
        const match = bp.match(/["']([^"']+)["']/);
        if (match && match[1] && !allowedOnImageText.includes(match[1])) {
          allowedOnImageText.push(match[1]);
        }
      }
    }
  }

  const finalize = (request: ImageGenerationRequest): ImageGenerationRequest => {
    let result = request;
    if (allowedOnImageText.length > 0) {
      result = { ...result, allowedOnImageText };
    }
    if (noTextInstruction) {
      result = { ...result, imagePrompt: `${result.imagePrompt}\n\n${noTextInstruction}` };
    }
    return result;
  };
  const productPreservation = state.productTruth?.preservationRules.length
    ? state.productTruth.preservationRules
    : ['product_identity', 'packaging', 'label', 'colors', 'proportions'];

  const operation = inferStudioOperation({ activeDocument, composerReferences });

  if (operation === 'edit') {
    const rootAsset = assets.find((a) => a.id === activeDocument!.rootAssetId);
    if (!rootAsset) {
      throw new Error('Active document root asset not found in session.');
    }
    return finalize(buildEditRequest(prompt, aspectRatio, rootAsset));
  }

  if (operation === 'composite') {
    const allRefs = composerReferences;

    const references = allRefs.flatMap((ref) => {
      const asset = assets.find((a) => a.id === ref.assetId);
      if (!asset) return [];

      const provenanceRole = mapComposerRoleToProvenance(ref.role);
      const isProduct = ref.role === 'product' || ref.role === 'include';

      return [{
        input: { data: asset.base64, mimeType: asset.mimeType },
        role: provenanceRole as 'product' | 'style_guide',
        preserve: isProduct
          ? productPreservation
          : undefined,
        modify: isProduct
          ? [ref.instructions, 'Use this image as a reference for the product\'s visual identity (packaging, colors, label, shape). Generate the creative scene described in the prompt — do NOT simply reproduce or copy this reference image. The product should appear naturally within the new scene.'].filter(Boolean).join(' ')
          : ref.instructions,
      }];
    });

    if (references.length < 2) {
      throw new Error(
        `Composite requires at least 2 references, but only ${references.length} matched assets.`,
      );
    }

    return finalize({ mode: 'composite', imagePrompt: prompt, aspectRatio, references });
  }

  // generate — with optional product/style reference assets
  const contextRefs = composerReferences.filter(
    (r) => r.role === 'product' || r.role === 'style' || r.role === 'include' || r.role === 'composition',
  );

  if (contextRefs.length === 0) {
    return finalize({ mode: 'generate', imagePrompt: prompt, aspectRatio });
  }

  const references = contextRefs.flatMap((ref) => {
    const asset = assets.find((a) => a.id === ref.assetId);
    if (!asset) return [];
    const isProduct = ref.role === 'product' || ref.role === 'include';
    return [{
      input: { data: asset.base64, mimeType: asset.mimeType },
      role: mapComposerRoleToProvenance(ref.role) as 'product' | 'style_guide',
      preserve: isProduct
        ? productPreservation
        : undefined,
      modify: isProduct
        ? [ref.instructions, 'Use this image as a reference for the product\'s visual identity (packaging, colors, label, shape). Generate the creative scene described in the prompt — do NOT simply reproduce or copy this reference image. The product should appear naturally within the new scene.'].filter(Boolean).join(' ')
        : ref.instructions,
    }];
  });

  if (references.length === 0) {
    return finalize({ mode: 'generate', imagePrompt: prompt, aspectRatio });
  }

  return finalize({ mode: 'composite', imagePrompt: prompt, aspectRatio, references });
}

/**
 * Executes generation using a pre-built ImageGenerationRequest.
 * This is the canonical generation entry point for the new architecture.
 * Applies a 60-second timeout.
 */
export async function executeGeneration(
  request: ImageGenerationRequest,
): Promise<GenerationResult> {
  const base64 = await withTimeout(
    generateImageAsset(request),
    GENERATION_TIMEOUT_MS,
    'Generation'
  );

  return { base64, mimeType: 'image/png' };
}
