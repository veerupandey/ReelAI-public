import type {
  AdConcept,
  AdScene,
  AssetBinding,
  Brand,
  BrandAsset,
  BrandMemory,
  CampaignBlueprint,
  CampaignBrief,
  ExecutionMode,
  RenderManifest,
  ReviewFeedback,
  SceneContract,
  SceneSourceMode,
} from '../types/brand';

export interface MappedVisualAsset {
  file: File;
  base64: string;
  mimeType: string;
  previewUrl: string;
  assetId: string;
  description: string;
  productIdentity: string | undefined;
  shotType: string;
}

const DEFAULT_SCENE_DURATION = 4;
const asDataUrl = (base64?: string, mimeType = 'image/jpeg'): string | undefined => {
  if (!base64) return undefined;
  if (base64.startsWith('data:') || base64.startsWith('blob:') || base64.startsWith('http')) {
    return base64;
  }
  return `data:${mimeType};base64,${base64}`;
};

const inferSceneRole = (text: string, index: number): string => {
  const normalized = text.trim().toUpperCase();
  if (normalized.startsWith('HOOK:')) return 'HOOK';
  if (normalized.startsWith('PROBLEM:')) return 'PROBLEM';
  if (normalized.startsWith('PRODUCT:')) return 'PRODUCT';
  if (normalized.startsWith('PROOF:')) return 'PROOF';
  if (normalized.startsWith('DEMO:')) return 'DEMO';
  if (normalized.startsWith('CTA:')) return 'CTA';
  return index === 0 ? 'HOOK' : 'SCENE';
};

const resolveSourceMode = (scene: AdScene, hasBinding: boolean): SceneSourceMode => {
  if (scene.brandAssetEditAction === 'use_as_is') return 'use_exact_asset';
  if (scene.brandAssetEditAction === 'edit') return 'edit_from_asset';
  return hasBinding ? 'edit_from_asset' : 'generate_fresh';
};

export const buildBrandMemoryFromBrand = (
  brand?: Brand,
  fallbackUrl?: string,
  evidenceSummary: string[] = [],
): BrandMemory | null => {
  if (!brand && !fallbackUrl) return null;

  const assets = brand?.assets.map((asset) => ({
    assetId: asset.id,
    brandAssetId: asset.id,
    type: asset.type,
    origin: asset.sourceUrl ? 'imported' as const : 'uploaded' as const,
    mimeType: asset.mimeType,
    description: asset.description,
    productIdentity: brand?.name,
    sourceUrl: asset.sourceUrl,
    previewUrl: asset.previewUrl || asset.sourceUrl || asDataUrl(asset.base64, asset.mimeType),
    sourcePageUrl: asset.originPageUrl,
    sourceProductTitle: asset.sourceProductTitle,
  })) || brand?.brandMemory?.assets || [];

  return {
    brandId: brand?.id,
    name: brand?.name || 'Ad hoc brand',
    websiteUrl: brand?.websiteUrl || fallbackUrl,
    dna: brand?.dna || brand?.brandMemory?.dna || null,
    assets,
    approvedClaims: brand?.dna?.valuePropositions || brand?.brandMemory?.approvedClaims || [],
    evidenceSummary: evidenceSummary.length > 0
      ? evidenceSummary
      : brand?.brandMemory?.evidenceSummary || [],
  };
};

export const resolveBrandAssetById = (
  brand: Brand | null | undefined,
  assetId: string | undefined,
): BrandAsset | undefined => {
  if (!brand || !assetId) return undefined;
  if (assetId.startsWith('brand-index-')) {
    const index = Number(assetId.replace('brand-index-', ''));
    return Number.isFinite(index) ? brand.assets[index] : undefined;
  }
  return brand.assets.find((asset) => asset.id === assetId);
};

export const resolveBrandAssetIndex = (
  brand: Brand | null | undefined,
  assetId: string | undefined,
): number | undefined => {
  if (!brand || !assetId) return undefined;
  if (assetId.startsWith('brand-index-')) {
    const index = Number(assetId.replace('brand-index-', ''));
    return Number.isFinite(index) ? index : undefined;
  }
  const resolvedIndex = brand.assets.findIndex((asset) => asset.id === assetId);
  return resolvedIndex >= 0 ? resolvedIndex : undefined;
};

export const mapBrandAssetsToVisuals = (
  brandMemory: BrandMemory | null | undefined,
  brand: Brand | null | undefined
): MappedVisualAsset[] => {
  const asDataUrlSafe = (base64?: string, mimeType = 'image/jpeg'): string => {
    if (!base64) return '';
    if (base64.startsWith('data:') || base64.startsWith('blob:') || base64.startsWith('http')) {
      return base64;
    }
    return `data:${mimeType};base64,${base64}`;
  };

  if (brandMemory?.assets?.length) {
    const mapped = brandMemory.assets.map((entry) => {
      const asset = resolveBrandAssetById(brand, entry.assetId) || resolveBrandAssetById(brand, entry.brandAssetId);
      if (!asset) return null;
      return {
        file: new File([], `brand_asset_${asset.id}.${asset.mimeType.split('/')[1] || 'jpg'}`),
        base64: asset.base64,
        mimeType: asset.mimeType,
        previewUrl: asset.previewUrl || asDataUrlSafe(asset.base64, asset.mimeType),
        assetId: asset.id,
        description: asset.description,
        productIdentity: entry.productIdentity || brand?.name,
        shotType: entry.type || asset.type,
      };
    }).filter(Boolean) as MappedVisualAsset[];
    if (mapped.length > 0) return mapped;
  }

  // Fallback: map brand.assets directly so Script Studio still has a product lane
  // when brandMemory is missing or asset IDs cannot be resolved.
  return (brand?.assets || []).map((asset) => ({
    file: new File([], `brand_asset_${asset.id}.${asset.mimeType.split('/')[1] || 'jpg'}`),
    base64: asset.base64,
    mimeType: asset.mimeType,
    previewUrl: asset.previewUrl || asDataUrlSafe(asset.base64, asset.mimeType),
    assetId: asset.id,
    description: asset.description,
    productIdentity: brand?.name,
    shotType: asset.type,
  }));
};

const buildAssetBindings = (
  scene: AdScene,
  brand: Brand | undefined,
  brief?: CampaignBrief,
  sceneIndex = 0,
): AssetBinding[] => {
  const lockedProductAssetIds = new Set((brief?.productContext?.productAssets || []).map((asset) => asset.id));
  const resolveLockedFallbackAsset = (): BrandAsset | undefined => {
    const lockedAssets = brief?.productContext?.productAssets || [];
    if (!lockedAssets.length) return undefined;
    return lockedAssets[Math.min(sceneIndex, lockedAssets.length - 1)] || lockedAssets[0];
  };
  const assetId = scene.brandAssetRef
    || (typeof scene.brandImageIndex === 'number' ? brand?.assets[scene.brandImageIndex]?.id || `brand-index-${scene.brandImageIndex}` : undefined);

  if (!assetId) {
    // No explicit asset on the scene → generate_fresh. Do not invent a positional
    // catalog binding (that made Review show random unrelated product thumbs).
    const preferred = brief?.preferredScenes?.find((entry) => entry.sceneNumber === scene.sceneNumber)
      || brief?.preferredScenes?.[sceneIndex];
    if (preferred?.sourceMode && preferred.sourceMode !== 'generate_fresh' && preferred.sourceMode !== undefined) {
      const lockedAsset = resolveLockedFallbackAsset()
        || (brief?.productUrl && brand?.assets?.length
          ? brand.assets[Math.min(sceneIndex, brand.assets.length - 1)]
          : undefined);
      if (lockedAsset && (
        preferred.sourceMode === 'use_exact_asset'
        || preferred.sourceMode === 'crop_reframe_asset'
        || preferred.sourceMode === 'edit_from_asset'
        || preferred.sourceMode === 'generate_matching_shot'
      )) {
        return [{
          assetId: lockedAsset.id,
          mode: preferred.sourceMode === 'use_exact_asset' ? 'use_exact_asset' : 'edit_from_asset',
          reason: 'Preferred scene mode requires a product base; bound a locked product asset.',
          required: true,
        }];
      }
    }
    return [];
  }

  if (brief?.productContext && lockedProductAssetIds.size > 0 && !lockedProductAssetIds.has(assetId)) {
    const lockedAsset = resolveLockedFallbackAsset();
    if (!lockedAsset) {
      return [];
    }
    return [{
      assetId: lockedAsset.id,
      mode: scene.brandAssetEditAction === 'use_as_is' ? 'use_exact_asset' : 'edit_from_asset',
      reason: `Locked-product mode rejected non-product asset "${assetId}" and remapped this scene to the selected product asset set.`,
      required: true,
    }];
  }

  const mode = resolveSourceMode(scene, true);
  return [{
    assetId,
    mode,
    reason: scene.brandAssetEditAction === 'use_as_is'
      ? 'Creative concept requested using the uploaded brand asset as-is.'
      : 'Creative concept requested grounding this scene in a specific brand asset.',
    required: true,
  }];
};

export const buildSceneContractsFromConcept = (
  concept: AdConcept,
  brief: CampaignBrief,
  brand?: Brand,
): SceneContract[] => {
  return concept.scenes.map((scene, index) => {
    const assetBindings = buildAssetBindings(scene, brand, brief, index);
    const sourceMode = resolveSourceMode(scene, assetBindings.length > 0);
    return {
      sceneId: `scene_${scene.sceneNumber || index + 1}`,
      sceneNumber: scene.sceneNumber || index + 1,
      role: inferSceneRole(scene.voiceoverText || scene.onScreenText || scene.visualDescription || '', index),
      durationTargetSec: Number(scene.durationSec) || DEFAULT_SCENE_DURATION,
      platform: brief.platform,
      objective: brief.objective,
      adFormat: brief.adFormat || 'stitched_video',
      voiceoverText: scene.voiceoverText || '',
      onScreenText: scene.onScreenText || scene.voiceoverText || '',
      visualIntent: scene.visualDescription || '',
      imagePrompt: scene.imagePrompt,
      sourceMode,
      assetBindings,
      cameraMovement: scene.cameraMovement,
      status: 'planned',
    };
  });
};

/** Aligns export readiness with orchestrator approval thresholds per execution mode. */
export const getRenderApprovalThreshold = (executionMode?: ExecutionMode): number => {
  switch (executionMode) {
    case 'fast':
      return 7;
    case 'agency':
      return 9;
    case 'balanced':
    default:
      return 8.5;
  }
};

export const isExportReviewReady = (
  review: ReviewFeedback | null | undefined,
  approvalThreshold: number,
): boolean => {
  if (!review) return true;
  const mandatoryFixes = review.mandatoryFixes || [];
  if (mandatoryFixes.length > 0) return false;
  if (review.verdict === 'approved') return true;
  return review.overallScore >= approvalThreshold;
};

export const buildRenderManifestFromSceneContracts = (
  sceneContracts: SceneContract[],
  brief: CampaignBrief,
  reviewHistory: ReviewFeedback[] = [],
): RenderManifest => {
  const latestReview = reviewHistory[reviewHistory.length - 1];
  const approvalThreshold = getRenderApprovalThreshold(brief.executionMode);
  const exportReady = isExportReviewReady(latestReview, approvalThreshold);
  const blockers = !exportReady && latestReview
    ? (latestReview.mandatoryFixes?.length
      ? latestReview.mandatoryFixes
      : [`Concept scored ${latestReview.overallScore}/10; needs ${approvalThreshold}+ or approval before export.`])
    : [];

  return {
    manifestId: `manifest_${Date.now().toString(36)}`,
    adFormat: brief.adFormat || 'stitched_video',
    platform: brief.platform,
    totalDurationSec: sceneContracts.reduce((sum, scene) => sum + (scene.durationTargetSec || 0), 0),
    scenes: sceneContracts.map((scene) => ({
      sceneId: scene.sceneId,
      durationSec: scene.durationTargetSec || 0,
      voiceoverText: scene.voiceoverText || '',
      onScreenText: scene.onScreenText,
      assetIds: scene.assetBindings.map((binding) => binding.assetId),
    })),
    exportStatus: blockers.length > 0 ? 'blocked' : (sceneContracts.length > 0 ? 'ready' : 'draft'),
    blockers,
  };
};

/** Guarantee scene contracts + a render manifest when a video concept exists. */
export const ensureVideoRenderArtifacts = ({
  concept,
  brief,
  brand,
  sceneContracts = [],
  reviewHistory = [],
}: {
  concept: AdConcept;
  brief: CampaignBrief;
  brand?: Brand | null;
  sceneContracts?: SceneContract[];
  renderManifest?: RenderManifest | null;
  reviewHistory?: ReviewFeedback[];
}): { sceneContracts: SceneContract[]; renderManifest: RenderManifest } => {
  const nextContracts = sceneContracts.length > 0
    ? sceneContracts
    : buildSceneContractsFromConcept(concept, brief, brand || undefined);
  // Always rebuild export status from current review history so stale blocked
  // manifests (e.g. hardcoded score>=9) do not stick after threshold-aligned approval.
  const nextManifest = buildRenderManifestFromSceneContracts(nextContracts, brief, reviewHistory);
  return { sceneContracts: nextContracts, renderManifest: nextManifest };
};

export const markRenderManifestReady = (manifest: RenderManifest | null): RenderManifest | null => {
  if (!manifest) return null;
  return {
    ...manifest,
    exportStatus: 'ready',
    blockers: [],
  };
};

export const buildCampaignBlueprint = ({
  brief,
  concept,
  brandMemory,
  productContext,
  sceneContracts,
  renderManifest,
  reviewHistory,
}: {
  brief: CampaignBrief;
  concept: AdConcept;
  brandMemory: BrandMemory | null;
  productContext?: CampaignBlueprint['productContext'];
  sceneContracts: SceneContract[];
  renderManifest: RenderManifest | null;
  reviewHistory: ReviewFeedback[];
}): CampaignBlueprint => ({
  brief,
  productContext: productContext || brief.productContext || null,
  concept,
  brandMemory,
  sceneContracts,
  renderManifest,
  reviewHistory,
});
