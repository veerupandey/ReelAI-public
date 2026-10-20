import type { AdFormat, AssetLabMode, BrandAsset, CampaignPlatform, PlannedStoryboardScene, ProductContext, SceneRoute, StoryboardSceneState } from '../../types/brand';
import { assetLabModeToSceneRoute, resolveSceneIdeaRoute } from '../../services/sceneRouter';
import type { PlannerRequirement } from './productLockTypes';

export const capitalizeProductCandidateSource = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const toProductLockAssetPreviewUrl = (asset?: BrandAsset): string | undefined => {
  if (!asset) return undefined;
  if (asset.previewUrl) return asset.previewUrl;
  if (!asset.base64) return undefined;
  if (asset.base64.startsWith('data:') || asset.base64.startsWith('blob:') || asset.base64.startsWith('http')) {
    return asset.base64;
  }
  return `data:${asset.mimeType};base64,${asset.base64}`;
};

export const normalizeProductLockUrlForKey = (value?: string): string => {
  if (!value) return '';
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
};

export const getAssetLabModeLabel = (mode?: AssetLabMode): string => {
  return getSceneRouteLabel(assetLabModeToSceneRoute(mode));
};

export const getSceneRouteLabel = (route?: SceneRoute): string => {
  switch (route) {
    case 'use_existing':
      return 'Use This Shot';
    case 'upgrade_existing':
      return 'Upgrade Shot';
    case 'composite_product':
      return 'Place In New World';
    case 'generate_fresh':
      return 'Imagine New Scene';
    case 'continue_sequence':
      return 'Continue From Previous';
    default:
      return 'Place In New World';
  }
};

export const getSceneRouteTone = (route?: SceneRoute): string => {
  switch (route) {
    case 'use_existing':
      return 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20';
    case 'upgrade_existing':
      return 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20';
    case 'composite_product':
      return 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/20';
    case 'generate_fresh':
      return 'bg-amber-500/10 text-amber-200 border-amber-500/20';
    case 'continue_sequence':
      return 'bg-indigo-500/10 text-indigo-200 border-indigo-500/20';
    default:
      return 'bg-white/5 text-gray-300 border-white/10';
  }
};

export const getProductLockSceneStatusLabel = (idea: PlannedStoryboardScene): string => {
  if (idea.approved) return 'Approved';
  if ((idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product' || idea.visualTask === 'generate_new') && !idea.selectedVariantAssetId) {
    return 'Needs Visual';
  }
  if (idea.selectedVariantAssetId) return 'Variant Selected';
  if (idea.baseAssetId) return 'Base Bound';
  return 'Needs Asset';
};

export const getProductLockSceneAssetRequirement = (
  idea: PlannedStoryboardScene,
  lockedProduct: ProductContext | null,
  getAssetNumberLabel: (assetId?: string) => string | null,
): { title: string; detail: string } => {
  const route = resolveSceneIdeaRoute(idea);
  if (!lockedProduct) {
    return {
      title: 'Asset required',
      detail: 'Lock a product first.',
    };
  }

  if ((route === 'generate_fresh' || idea.visualTask === 'generate_new' || idea.sourceMode === 'generate_fresh') && !idea.selectedVariantAssetId) {
    return {
      title: 'New scene image recommended',
      detail: idea.visualTaskReason
        ? `Generate a fresh scene image (no base import needed). ${idea.visualTaskReason}`
        : 'Generate a fresh scene image (no base import needed).',
    };
  }

  if ((route === 'upgrade_existing' || route === 'composite_product' || idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') && !idea.selectedVariantAssetId) {
    const baseLabel = idea.baseAssetId ? (getAssetNumberLabel(idea.baseAssetId) || 'Imported asset') : 'Imported asset';
    return {
      title: route === 'composite_product' || idea.visualTask === 'overlay_on_product' ? 'Composite scene image recommended' : 'Upgrade image recommended',
      detail: idea.visualTaskReason
        ? `${baseLabel} is the recommended base. ${idea.visualTaskReason}`
        : `${baseLabel} is the recommended base.`,
    };
  }

  if (idea.selectedVariantAssetId) {
    const variantLabel = getAssetNumberLabel(idea.selectedVariantAssetId) || 'Generated variant';
    return {
      title: 'Scene asset ready',
      detail: `${variantLabel} is selected for this scene.`,
    };
  }

  if (idea.baseAssetId) {
    const baseLabel = getAssetNumberLabel(idea.baseAssetId) || 'Imported asset';
    return {
      title: 'Imported base image required',
      detail: `${baseLabel} is the required source image for this scene.`,
    };
  }

  return {
    title: 'Asset required',
    detail: 'Pick one imported product image, then generate or attach a scene-specific asset.',
  };
};

/** Prefer generated/selected visual over imported base for storyboard thumbnails. */
export const getSceneDisplayAssetId = (
  idea: Pick<StoryboardSceneState, 'selectedVariantAssetId' | 'linkedAssetId' | 'baseAssetId'>,
): string | undefined =>
  idea.selectedVariantAssetId || idea.linkedAssetId || idea.baseAssetId;

export const sceneIntendsFreshGeneration = (
  idea: Pick<StoryboardSceneState, 'route' | 'visualTask' | 'sourceMode' | 'generationMode'>,
): boolean => {
  const route = resolveSceneIdeaRoute(idea);
  return route === 'generate_fresh' || idea.visualTask === 'generate_new' || idea.sourceMode === 'generate_fresh';
};

/** True when the scene already has a usable visual or intentionally plans to generate one. */
export const sceneHasVisualReady = (idea: StoryboardSceneState): boolean => {
  if (idea.selectedVariantAssetId || idea.linkedAssetId || idea.baseAssetId) return true;
  return sceneIntendsFreshGeneration(idea);
};

/** Routes that need an imported/generated base before execution (not pure generate_fresh). */
export const sceneNeedsBoundAsset = (idea: StoryboardSceneState): boolean => {
  if (idea.selectedVariantAssetId || idea.linkedAssetId || idea.baseAssetId) return false;
  return !sceneIntendsFreshGeneration(idea);
};

export const getAdFormatForPlatform = (
  platform: CampaignPlatform,
): AdFormat => {
  switch (platform) {
    case 'instagram_carousel':
      return 'carousel';
    case 'instagram_feed':
      return 'static_image';
    case 'tiktok':
    case 'instagram_reels':
    case 'youtube_shorts':
    default:
      return 'stitched_video';
  }
};

export const getPreferredPlatformForAdFormat = (
  adFormat: AdFormat,
  currentPlatform: CampaignPlatform,
): CampaignPlatform => {
  if (adFormat === 'carousel') return 'instagram_carousel';
  if (adFormat === 'static_image') {
    return currentPlatform === 'instagram_feed' ? currentPlatform : 'instagram_feed';
  }
  if (
    currentPlatform === 'instagram_carousel' ||
    currentPlatform === 'instagram_feed'
  ) {
    return 'instagram_reels';
  }
  return currentPlatform;
};

const inferAgencyStoryboardBucket = (
  idea: Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt'>,
): number => {
  const text = `${idea.text} ${idea.visualDescription} ${idea.imagePrompt}`.toLowerCase();
  if (/(hook|scroll stop|opening|intro|pattern interrupt|first shot)/.test(text)) return 0;
  if (/(problem|pain|struggle|acne|issue|concern|before)/.test(text)) return 1;
  if (/(demo|apply|application|texture|ingredient|proof|benefit|result|after|comparison|routine)/.test(text)) return 2;
  if (/(cta|shop|buy|checkout|final shot|hero|packshot|closing)/.test(text)) return 4;
  return 3;
};

/**
 * Soft readiness for Brand Agency Storyboard (no per-scene approval gate).
 * Hard blockers only cover empty brief/scenes; structural issues are warnings.
 */
export const buildAgencyStoryboardWarnings = (
  scenes: StoryboardSceneState[],
  adFormat: AdFormat,
): PlannerRequirement[] => {
  if (scenes.length === 0) return [];

  const warnings: PlannerRequirement[] = [];
  const buckets = scenes.map(inferAgencyStoryboardBucket);
  const unboundCount = scenes.filter(sceneNeedsBoundAsset).length;
  const duplicateBaseAssetIds = Object.entries(
    scenes.reduce<Record<string, number>>((acc, idea) => {
      if (!idea.baseAssetId) return acc;
      if (sceneIntendsFreshGeneration(idea)) return acc;
      if (idea.visualTask && idea.visualTask !== 'use_imported') return acc;
      acc[idea.baseAssetId] = (acc[idea.baseAssetId] || 0) + 1;
      return acc;
    }, {}),
  )
    .filter(([, count]) => count > 1)
    .map(([assetId]) => assetId);

  if (!buckets.includes(0)) {
    warnings.push({
      type: 'hook',
      message: 'Missing a clear hook or opening beat. Add one scene that stops the scroll immediately.',
    });
  }
  if (!buckets.includes(2)) {
    warnings.push({
      type: 'proof',
      message: 'Missing a proof, demo, or benefit beat. The plan needs a reason-to-believe scene.',
    });
  }
  if (!buckets.includes(4)) {
    warnings.push({
      type: 'closing',
      message: 'Missing a closing hero or CTA beat. Add a final conversion-oriented scene.',
    });
  }
  if (unboundCount > 0) {
    warnings.push({
      type: 'unbound',
      message: `${unboundCount} scene${unboundCount === 1 ? '' : 's'} still need a bound product image (or switch the route to Generate Fresh).`,
    });
  }
  if (duplicateBaseAssetIds.length > 0) {
    warnings.push({
      type: 'repetitive',
      message: 'Multiple scenes share the same base image. Check that the sequence is not visually repetitive.',
    });
  }
  if (adFormat === 'carousel') {
    const pendingSlides = scenes.filter((scene) => !scene.linkedAssetId).length;
    if (pendingSlides > 0) {
      warnings.push({
        type: 'unbound',
        message: `${pendingSlides} carousel slide${pendingSlides === 1 ? '' : 's'} still need generation before review looks final.`,
      });
    }
  }

  return warnings;
};

export const getAgencyStoryboardNextState = (
  briefText: string,
  scenes: StoryboardSceneState[],
  adFormat: AdFormat,
): { canProceed: boolean; blockers: string[]; warnings: PlannerRequirement[] } => {
  const blockers: string[] = [];
  if (!(briefText || '').trim()) {
    blockers.push('Add a campaign brief before continuing.');
  }
  if (scenes.length === 0) {
    blockers.push('Generate or add at least one scene before continuing.');
  }

  const emptyCopyCount = scenes.filter((scene) => !(scene.text || '').trim()).length;
  if (scenes.length > 0 && emptyCopyCount === scenes.length) {
    blockers.push('Scenes need text or voiceover before continuing.');
  }

  return {
    canProceed: blockers.length === 0,
    blockers,
    warnings: buildAgencyStoryboardWarnings(scenes, adFormat),
  };
};
