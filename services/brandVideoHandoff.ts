/**
 * Brand Agency concept → Script Studio / text-to-reel handoff.
 * Keeps product image lane indices aligned with scene brandImageIndex + asset catalog.
 */
import type {
  ApprovedStoryboardSceneMetadata,
  BrandAssetCatalogEntry,
  BrandKit,
  ReelPlan,
  ScenePlan,
  VisualAsset,
} from '../types';
import type {
  Brand,
  BrandAsset,
  CampaignBlueprint,
  SceneContract,
  SceneSourceMode,
  SceneVisualTask,
} from '../types/brand';
import {
  ensureVideoRenderArtifacts,
  resolveBrandAssetById,
} from './campaignBlueprintService';
import { sourceModeToSceneRoute } from './sceneRouter';
import { stashAgentLaunchHeavy } from './agentLaunchStore';

const asDataUrl = (base64?: string, mimeType = 'image/jpeg'): string => {
  if (!base64) return '';
  if (base64.startsWith('data:') || base64.startsWith('blob:') || base64.startsWith('http')) {
    return base64;
  }
  return `data:${mimeType};base64,${base64}`;
};

const sourceModeToStoryboardVisualTask = (sourceMode?: SceneSourceMode): SceneVisualTask | undefined => {
  switch (sourceMode) {
    case 'use_exact_asset':
    case 'crop_reframe_asset':
      return 'use_imported';
    case 'edit_from_asset':
      return 'edit_imported';
    case 'generate_matching_shot':
      return 'overlay_on_product';
    case 'generate_fresh':
      return 'generate_new';
    default:
      return undefined;
  }
};

const shotTypeFromAsset = (
  type?: string,
): BrandAssetCatalogEntry['shotType'] => {
  if (type === 'logo') return 'logo';
  if (type === 'lifestyle') return 'lifestyle';
  if (type === 'detail') return 'detail';
  return 'packshot';
};

const toVisualAsset = (
  asset: BrandAsset,
  productIdentity?: string,
): VisualAsset => ({
  file: new File([], `brand_asset_${asset.id}.${(asset.mimeType || 'image/jpeg').split('/')[1] || 'jpg'}`),
  base64: asset.base64 || '',
  mimeType: asset.mimeType || 'image/jpeg',
  previewUrl: asset.previewUrl || asDataUrl(asset.base64, asset.mimeType),
  assetId: asset.id,
  description: asset.description,
  productIdentity,
  shotType: asset.type,
});

/** Resolve a bound asset from brand assets or locked product context. */
export const resolveHandoffBrandAsset = (
  brand: Brand | null | undefined,
  blueprint: CampaignBlueprint,
  assetId: string | undefined,
): BrandAsset | undefined => {
  if (!assetId) return undefined;
  const fromBrand = resolveBrandAssetById(brand, assetId);
  if (fromBrand) return fromBrand;
  const productAssets = blueprint.productContext?.productAssets
    || blueprint.brief.productContext?.productAssets
    || [];
  if (assetId.startsWith('brand-index-')) {
    const index = Number(assetId.replace('brand-index-', ''));
    return Number.isFinite(index) ? productAssets[index] : undefined;
  }
  return productAssets.find((asset) => asset.id === assetId);
};

/**
 * Build one ordered product-image lane used by Script Studio generation.
 * Prefer brand.assets, then fill any locked product assets missing from the brand.
 */
export const buildHandoffProductImageLane = (
  brand: Brand | null | undefined,
  blueprint: CampaignBlueprint,
): { productImages: VisualAsset[]; assetCatalog: BrandAssetCatalogEntry[] } => {
  const productIdentity = blueprint.productContext?.productTitle
    || blueprint.brief.productContext?.productTitle
    || brand?.name
    || blueprint.concept.title;

  const seen = new Set<string>();
  const lane: BrandAsset[] = [];

  const pushAsset = (asset: BrandAsset | undefined) => {
    if (!asset?.id || seen.has(asset.id)) return;
    // Prefer assets that can actually render; keep remote-only as last resort.
    seen.add(asset.id);
    lane.push(asset);
  };

  (brand?.assets || []).forEach(pushAsset);
  (blueprint.productContext?.productAssets || blueprint.brief.productContext?.productAssets || [])
    .forEach(pushAsset);

  // If brand memory lists assets in a different order, keep brand/product order for index stability.
  // Memory is only used for catalog semantic enrichment below.
  const memoryById = new Map(
    (blueprint.brandMemory?.assets || []).map((entry) => [entry.assetId || entry.brandAssetId || '', entry]),
  );

  const productImages = lane.map((asset) => {
    const memory = memoryById.get(asset.id);
    return toVisualAsset(asset, memory?.productIdentity || productIdentity);
  });

  const assetCatalog: BrandAssetCatalogEntry[] = lane.map((asset, imageIndex) => {
    const memory = memoryById.get(asset.id);
    return {
      assetId: asset.id,
      source: asset.type === 'logo' ? 'logo' : 'product',
      semanticDescription: memory?.description || asset.description || productIdentity,
      productIdentity: memory?.productIdentity || productIdentity,
      shotType: shotTypeFromAsset(memory?.type || asset.type),
      imageIndex,
    };
  });

  return { productImages, assetCatalog };
};

const indexInLane = (
  productImages: VisualAsset[],
  asset: BrandAsset | undefined,
): number | undefined => {
  if (!asset) return undefined;
  const byId = productImages.findIndex((entry) => entry.assetId === asset.id);
  if (byId >= 0) return byId;
  return undefined;
};

export const mapSceneContractToPlanScene = ({
  scene,
  index,
  contract,
  blueprint,
  brand,
  productImages,
}: {
  scene: CampaignBlueprint['concept']['scenes'][number];
  index: number;
  contract?: SceneContract;
  blueprint: CampaignBlueprint;
  brand: Brand | null | undefined;
  productImages: VisualAsset[];
}): ScenePlan => {
  const sceneNumber = scene.sceneNumber || index + 1;
  const preferredScene = blueprint.brief.preferredScenes?.find((entry) => entry.sceneNumber === sceneNumber)
    || blueprint.brief.preferredScenes?.[index];
  const primaryBinding = contract?.assetBindings[0];
  const resolvedBrandAsset = resolveHandoffBrandAsset(brand, blueprint, primaryBinding?.assetId)
    || (typeof scene.brandImageIndex === 'number' ? brand?.assets?.[scene.brandImageIndex] : undefined)
    || (scene.brandAssetRef ? resolveHandoffBrandAsset(brand, blueprint, scene.brandAssetRef) : undefined);

  const brandImageIndex = indexInLane(productImages, resolvedBrandAsset);
  const hasEditableBrandReference = contract
    ? contract.sourceMode !== 'generate_fresh' && Boolean(resolvedBrandAsset)
    : brandImageIndex !== undefined || scene.brandImageIndex !== undefined;

  const shouldUseExactAsset = contract
    ? contract.sourceMode === 'use_exact_asset'
    : scene.brandAssetEditAction === 'use_as_is';
  const derivedEditAction = shouldUseExactAsset
    ? 'use_as_is' as const
    : hasEditableBrandReference
      ? 'edit' as const
      : scene.brandAssetEditAction;

  const memoryAssetNode = (blueprint.brandMemory?.assets || []).find((entry) =>
    entry.assetId === preferredScene?.assetId
    || entry.assetId === primaryBinding?.assetId
    || entry.brandAssetId === preferredScene?.assetId
    || entry.brandAssetId === primaryBinding?.assetId,
  );

  const storyboardSourceMode = preferredScene?.sourceMode || contract?.sourceMode;
  const storyboardMetadata: ApprovedStoryboardSceneMetadata = {
    productId: preferredScene?.productId || blueprint.productContext?.productId,
    productTitle: preferredScene?.productTitle
      || memoryAssetNode?.productIdentity
      || blueprint.productContext?.productTitle,
    productUrl: memoryAssetNode?.sourcePageUrl
      || resolvedBrandAsset?.originPageUrl
      || blueprint.productContext?.productUrl,
    storyboardRoute: sourceModeToSceneRoute(storyboardSourceMode),
    storyboardSourceMode,
    storyboardVisualTask: sourceModeToStoryboardVisualTask(storyboardSourceMode),
    storyboardVisualTaskReason: contract?.visualIntent || preferredScene?.visualDescription || scene.visualDescription,
    storyboardRouteReason: contract?.directorsNote
      || contract?.visualIntent
      || preferredScene?.visualDescription
      || scene.visualDescription,
    storyboardSuggestedPosition: index + 1,
    storyboardBaseAssetId: primaryBinding?.assetId || resolvedBrandAsset?.id,
    storyboardBaseAssetDescription: resolvedBrandAsset?.description
      || primaryBinding?.reason
      || preferredScene?.assetDescription,
    storyboardLinkedAssetId: preferredScene?.assetId || primaryBinding?.assetId || resolvedBrandAsset?.id,
    storyboardLinkedAssetDescription: preferredScene?.assetDescription || resolvedBrandAsset?.description,
    storyboardDirectorsNote: contract?.directorsNote || scene.directorsNote,
    referenceImageBase64: hasEditableBrandReference ? resolvedBrandAsset?.base64 : undefined,
    referenceImageMimeType: hasEditableBrandReference ? resolvedBrandAsset?.mimeType : undefined,
  };

  const userProvidedImage = shouldUseExactAsset && resolvedBrandAsset
    ? {
        name: resolvedBrandAsset.description || `brand_asset_${resolvedBrandAsset.id}`,
        previewUrl: resolvedBrandAsset.previewUrl || asDataUrl(resolvedBrandAsset.base64, resolvedBrandAsset.mimeType),
        base64: resolvedBrandAsset.base64 || '',
        type: (resolvedBrandAsset.mimeType?.startsWith('video') ? 'video' : 'image') as 'image' | 'video',
        mimeType: resolvedBrandAsset.mimeType || 'image/jpeg',
        duration: 0,
        file: new File([], `brand_asset_${resolvedBrandAsset.id}.jpg`),
        ...storyboardMetadata,
      }
    : undefined;

  return {
    sceneNumber,
    visualDescription: scene.visualDescription,
    imagePrompt: contract?.imagePrompt || scene.imagePrompt,
    estimatedDuration: contract?.durationTargetSec || scene.durationSec,
    scriptGuidance: contract?.voiceoverText || scene.voiceoverText || '',
    onScreenText: contract?.onScreenText || scene.onScreenText || undefined,
    brandImageIndex: hasEditableBrandReference ? brandImageIndex : undefined,
    brandAssetEditAction: derivedEditAction,
    userProvidedImage,
    ...storyboardMetadata,
  };
};

export interface BrandVideoStudioHandoff {
  reelPlan: ReelPlan;
  productImages: VisualAsset[];
  assetCatalog: BrandAssetCatalogEntry[];
  brandKitPatch: Partial<BrandKit>;
  textToReelTopic: string;
  userPrompt: string;
  targetDuration: number;
  sceneContracts: SceneContract[];
  isVideoAd: boolean;
}

/** Map an approved campaign blueprint into a usable Script Studio reel plan + brand kit lane. */
export const mapCampaignBlueprintToStudioHandoff = (
  blueprint: CampaignBlueprint,
  brand: Brand | null | undefined,
): BrandVideoStudioHandoff => {
  const concept = blueprint.concept;
  const isVideoAd = blueprint.brief.adFormat !== 'carousel' && blueprint.brief.adFormat !== 'static_image';

  const artifacts = isVideoAd
    ? ensureVideoRenderArtifacts({
        concept,
        brief: blueprint.brief,
        brand,
        sceneContracts: blueprint.sceneContracts || [],
        renderManifest: blueprint.renderManifest,
        reviewHistory: blueprint.reviewHistory || [],
      })
    : {
        sceneContracts: blueprint.sceneContracts || [],
        renderManifest: blueprint.renderManifest,
      };

  const { productImages, assetCatalog } = buildHandoffProductImageLane(brand, {
    ...blueprint,
    sceneContracts: artifacts.sceneContracts,
  });

  const scenes = concept.scenes.map((scene, index) => {
    const sceneNumber = scene.sceneNumber || index + 1;
    const contract = artifacts.sceneContracts.find((entry) => entry.sceneNumber === sceneNumber);
    return mapSceneContractToPlanScene({
      scene,
      index,
      contract,
      blueprint,
      brand,
      productImages,
    });
  });

  const reelPlan: ReelPlan = {
    topic: concept.title,
    vibe: concept.colorMood || 'Premium',
    strategicReasoning: concept.creativeRationale,
    scenes,
  };

  const textToReelTopic = blueprint.brief.rawPrompt || concept.title;
  const userPrompt = [
    blueprint.brief.rawPrompt,
    `Platform: ${blueprint.brief.platform}`,
    `Objective: ${blueprint.brief.objective}`,
    concept.hook,
    concept.narrative,
  ].filter(Boolean).join(' | ');

  const brandKitPatch: Partial<BrandKit> = {
    websiteUrl: brand?.websiteUrl,
    websiteUrls: brand?.websiteUrl ? [brand.websiteUrl] : undefined,
    hexColor: brand?.dna?.colors?.primary,
    brandNotes: brand?.dna?.visualSignature,
    aestheticAnalysis: brand?.dna?.aesthetic ? JSON.stringify(brand.dna.aesthetic) : undefined,
    visualSignature: brand?.dna?.visualSignature,
    productImages,
    assetCatalog,
  };

  return {
    reelPlan,
    productImages,
    assetCatalog,
    brandKitPatch,
    textToReelTopic,
    userPrompt,
    targetDuration: blueprint.brief.durationSec || 30,
    sceneContracts: artifacts.sceneContracts,
    isVideoAd,
  };
};

// ── Brand Agency → AutonomousAgent launch ─────────────────────────────────────

const AGENT_DURATIONS = [15, 20, 30, 45, 60] as const;

export const clampAgentDurationSec = (
  durationSec?: number,
): (typeof AGENT_DURATIONS)[number] => {
  if (!durationSec || durationSec <= 15) return 15;
  if (durationSec <= 20) return 20;
  if (durationSec <= 30) return 30;
  if (durationSec <= 45) return 45;
  return 60;
};

const stripDataUrlBase64 = (value?: string): string => {
  if (!value) return '';
  return value.startsWith('data:') ? value.split(',')[1] || '' : value;
};

/** Max distinct locked scene images embedded for Agent Console (lean + stashed). */
const MAX_SCENE_ASSET_BANK = 4;
/** Max extra reference uploads beyond scene bank. */
const MAX_REFERENCE_UPLOADS = 1;

const sourceModeToAgentVisual = (
  sourceMode?: SceneSourceMode,
): { useProductAsReference: boolean; visualMode: 'product_locked' | 'product_composite' | 'generated_fresh' } => {
  switch (sourceMode) {
    case 'use_exact_asset':
    case 'crop_reframe_asset':
      return { useProductAsReference: true, visualMode: 'product_locked' };
    case 'edit_from_asset':
    case 'generate_matching_shot':
      return { useProductAsReference: true, visualMode: 'product_composite' };
    case 'generate_fresh':
      return { useProductAsReference: false, visualMode: 'generated_fresh' };
    default:
      return { useProductAsReference: true, visualMode: 'product_composite' };
  }
};

export interface AgencyAgentSeedScene {
  index: number;
  role: string;
  targetDurationSec: number;
  actualDurationSec: number;
  imagePrompt: string;
  voiceoverText: string;
  useProductAsReference: boolean;
  visualMode?: 'product_locked' | 'product_composite' | 'generated_fresh';
  motionMode?: import('../types/brand').SceneMotionMode;
  slideHeadline?: string;
  slideBody?: string;
  preserveExactAsset?: boolean;
  lockedAssetId?: string;
  agencySourceMode?: SceneSourceMode;
}

export interface AgencyAgentLaunchParams {
  productUrl: string;
  adFormat: CampaignBlueprint['brief']['adFormat'];
  platform: CampaignBlueprint['brief']['platform'];
  durationSec: (typeof AGENT_DURATIONS)[number];
  style: 'luxe_minimalist' | 'earthy_organic' | 'high_energy' | 'ugc_style';
  voice: string;
  plannerModel?: import('../types/brand').PlannerModelPreference;
  /** false = HITL review gates (Agency default) */
  reviewMode: boolean;
  autoApproveSec: number;
  creativeBrief: string;
  referenceUploads: Array<{
    id: string;
    name: string;
    base64: string;
    mimeType: string;
    previewUrl?: string;
    note: string;
  }>;
  source: 'brand_video_agency';
  brandId?: string;
  autoStart: boolean;
  lockPlan: boolean;
  skipResearch: boolean;
  productTitle?: string;
  productFacts: string[];
  productBase64?: string;
  productMimeType?: string;
  seedScenes: AgencyAgentSeedScene[];
  /** Deduped curated assets referenced by seedScenes.lockedAssetId */
  sceneAssetBank: Record<string, { base64: string; mimeType: string; name?: string }>;
  approvedConcept: {
    title: string;
    hook: string;
    narrative: string;
    proposition: string;
    visualDirection: string;
  };
}

export interface BrandVideoAgentHandoff {
  agentId: 'ad-agent';
  params: AgencyAgentLaunchParams;
  isVideoAd: boolean;
}

/** Map an approved Agency blueprint into an Agent Console / AutonomousAgent launch. */
export const mapCampaignBlueprintToAgentLaunch = (
  blueprint: CampaignBlueprint,
  brand: Brand | null | undefined,
): BrandVideoAgentHandoff => {
  const concept = blueprint.concept;
  const isVideoAd = blueprint.brief.adFormat !== 'carousel' && blueprint.brief.adFormat !== 'static_image';
  const productUrl =
    blueprint.brief.productUrl
    || blueprint.productContext?.productUrl
    || blueprint.brief.productContext?.productUrl
    || brand?.websiteUrl
    || '';

  const durationSec = clampAgentDurationSec(blueprint.brief.durationSec);
  const sceneCount = Math.max(1, concept.scenes.length);
  const defaultSceneDuration = Math.max(2, Math.round(durationSec / sceneCount));

  const artifacts = isVideoAd
    ? ensureVideoRenderArtifacts({
        concept,
        brief: blueprint.brief,
        brand,
        sceneContracts: blueprint.sceneContracts || [],
        renderManifest: blueprint.renderManifest,
        reviewHistory: blueprint.reviewHistory || [],
      })
    : {
        sceneContracts: blueprint.sceneContracts || [],
        renderManifest: blueprint.renderManifest,
      };

  const { productImages } = buildHandoffProductImageLane(brand, {
    ...blueprint,
    sceneContracts: artifacts.sceneContracts,
  });

  const sceneAssetBank: AgencyAgentLaunchParams['sceneAssetBank'] = {};
  const seedScenes: AgencyAgentSeedScene[] = concept.scenes.map((scene, index) => {
    const sceneNumber = scene.sceneNumber || index + 1;
    const contract = artifacts.sceneContracts.find((entry) => entry.sceneNumber === sceneNumber);
    const sourceMode = contract?.sourceMode
      || (scene.brandAssetEditAction === 'use_as_is' ? 'use_exact_asset' : undefined)
      || (scene.brandAssetEditAction === 'edit' ? 'edit_from_asset' : undefined);
    const visual = sourceModeToAgentVisual(sourceMode);
    const preferred = blueprint.brief.preferredScenes?.find((p) => p.sceneNumber === sceneNumber);
    const targetDurationSec = scene.durationSec
      || preferred?.durationSec
      || contract?.durationTargetSec
      || defaultSceneDuration;
    const boundAssetId = contract?.assetBindings?.[0]?.assetId || scene.brandAssetRef;
    const boundAsset = resolveHandoffBrandAsset(brand, blueprint, boundAssetId);
    const lockedBytes = stripDataUrlBase64(boundAsset?.base64);
    const preserveExactAsset = sourceMode === 'use_exact_asset' || sourceMode === 'crop_reframe_asset';

    if (boundAsset?.id && lockedBytes && !sceneAssetBank[boundAsset.id] && Object.keys(sceneAssetBank).length < MAX_SCENE_ASSET_BANK) {
      sceneAssetBank[boundAsset.id] = {
        base64: lockedBytes,
        mimeType: boundAsset.mimeType || 'image/jpeg',
        name: boundAsset.description || boundAsset.id,
      };
    }

    return {
      index,
      role: contract?.role || scene.onScreenText?.slice(0, 24) || `scene_${index + 1}`,
      targetDurationSec,
      actualDurationSec: targetDurationSec,
      imagePrompt: scene.imagePrompt || contract?.imagePrompt || scene.visualDescription || '',
      voiceoverText: scene.voiceoverText || contract?.voiceoverText || '',
      useProductAsReference: visual.useProductAsReference || Boolean(boundAssetId),
      visualMode: visual.visualMode,
      motionMode: scene.motionMode || preferred?.motionMode || 'still',
      slideHeadline: scene.slideHeadline,
      slideBody: scene.slideBody,
      preserveExactAsset: Boolean(preserveExactAsset && lockedBytes),
      lockedAssetId: lockedBytes && boundAsset?.id && sceneAssetBank[boundAsset.id] ? boundAsset.id : undefined,
      agencySourceMode: sourceMode,
    };
  });

  const bankIds = new Set(Object.keys(sceneAssetBank));
  const referenceUploads = productImages
    .filter((image) => Boolean(stripDataUrlBase64(image.base64)))
    .filter((image) => !image.assetId || !bankIds.has(image.assetId))
    .slice(0, MAX_REFERENCE_UPLOADS)
    .map((image, index) => {
      const base64 = stripDataUrlBase64(image.base64);
      const mimeType = image.mimeType || 'image/jpeg';
      return {
        id: image.assetId || `agency-ref-${index}`,
        name: image.description || `Product asset ${index + 1}`,
        base64,
        mimeType,
        previewUrl: image.previewUrl || `data:${mimeType};base64,${base64}`,
        note: 'Primary product packshot — preserve identity across scenes',
      };
    });

  const productFacts = [
    ...(blueprint.productContext?.productFacts || blueprint.brief.productContext?.productFacts || []),
    ...(blueprint.productContext?.allowedClaims || blueprint.brief.productContext?.allowedClaims || []),
  ].filter(Boolean).slice(0, 24);

  // Prefer first scene-locked asset as hero so we don't duplicate another full image.
  const heroFromBank = Object.entries(sceneAssetBank)[0];
  const heroBase64 = heroFromBank?.[1]?.base64 || referenceUploads[0]?.base64;
  const heroMime = heroFromBank?.[1]?.mimeType || referenceUploads[0]?.mimeType;
  const creativeBrief = [
    blueprint.brief.rawPrompt,
    `Approved concept: ${concept.title}`,
    `Hook: ${concept.hook}`,
    `Narrative: ${concept.narrative}`,
    concept.creativeRationale ? `Rationale: ${concept.creativeRationale}` : '',
    `Platform: ${blueprint.brief.platform}`,
    `Objective: ${blueprint.brief.objective}`,
    blueprint.brief.audience ? `Audience: ${blueprint.brief.audience}` : '',
    blueprint.brief.callToAction ? `CTA: ${blueprint.brief.callToAction}` : '',
    'AGENCY LOCK: Honor the approved scene plan, voiceover, and locked assets. Do not invent a conflicting story.',
  ].filter(Boolean).join('\n');

  return {
    agentId: 'ad-agent',
    isVideoAd,
    params: {
      productUrl,
      adFormat: blueprint.brief.adFormat,
      platform: blueprint.brief.platform,
      durationSec,
      style: 'luxe_minimalist',
      voice: 'Kore',
      plannerModel: blueprint.brief.plannerModel || 'glm_53_flash',
      reviewMode: false,
      autoApproveSec: 15,
      creativeBrief,
      referenceUploads,
      source: 'brand_video_agency',
      brandId: brand?.id,
      autoStart: true,
      lockPlan: true,
      skipResearch: Boolean(productFacts.length && heroBase64),
      productTitle: blueprint.productContext?.productTitle
        || blueprint.brief.productContext?.productTitle
        || concept.title,
      productFacts,
      productBase64: heroBase64,
      productMimeType: heroMime,
      seedScenes,
      sceneAssetBank,
      approvedConcept: {
        title: concept.title,
        hook: concept.hook,
        narrative: concept.narrative,
        proposition: concept.creativeRationale || concept.hook,
        visualDirection: concept.colorMood || concept.musicDirection || 'premium product-led',
      },
    },
  };
};

/**
 * Split heavy base64 fields into an in-memory stash and return a lean payload
 * safe for sessionStorage (~5MB quota).
 */
export const prepareAgentLaunchForSessionStorage = (
  handoff: BrandVideoAgentHandoff,
): { agentId: 'ad-agent'; params: AgencyAgentLaunchParams; launchId: string } => {
  const launchId = `agency-launch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const { sceneAssetBank, referenceUploads, productBase64, productMimeType, ...leanRest } = handoff.params;

  stashAgentLaunchHeavy(launchId, {
    sceneAssetBank,
    referenceUploads,
    productBase64,
    productMimeType,
  });

  // Lean params: keep structure but strip binaries (rehydrated in AgentConsole).
  const leanParams: AgencyAgentLaunchParams = {
    ...leanRest,
    referenceUploads: referenceUploads.map(({ base64: _b, previewUrl: _p, ...meta }) => ({
      ...meta,
      base64: '',
      previewUrl: undefined,
    })),
    productBase64: undefined,
    productMimeType,
    sceneAssetBank: Object.fromEntries(
      Object.entries(sceneAssetBank).map(([id, entry]) => [
        id,
        { mimeType: entry.mimeType, name: entry.name, base64: '' },
      ]),
    ),
  };

  return { agentId: handoff.agentId, params: leanParams, launchId };
};

