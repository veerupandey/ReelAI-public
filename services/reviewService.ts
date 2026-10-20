import type { ReviewFeedback, Brand, CampaignBrief, SceneContract } from '../types/brand';
import type { SceneDraft } from '../types';

const PRODUCT_FOCUSED_REGEX = /(product|pack|packshot|hero|label|bottle|jar|tube|dropper|cleanser|serum|balm|cream|oil|mist|wash|soap|foam|routine|apply|application|ingredients?|texture|shop|buy|order|cta|bare\s*&\s*fair|bareandfair|honey|probiotic)/i;
const ABSTRACT_DRIFT_REGEX = /(forest|jungle|moss|trail|waterfall|river|mountain|landscape|tree bark|woodland|leaf canopy|nature path|stone steps)/i;

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const scoreFromIssues = (mandatoryFixes: string[], critiques: string[]): number => {
  const raw = 10 - (mandatoryFixes.length * 1.2) - (critiques.length * 0.4);
  return Number(Math.max(1, Math.min(10, raw)).toFixed(1));
};

const isProductCampaign = (brief: CampaignBrief, brand?: Brand | null): boolean =>
  Boolean(brief.productUrl && (brand?.assets?.length || 0) > 0);

const isProductFocusedScene = (text: string): boolean => PRODUCT_FOCUSED_REGEX.test(text);

const buildSceneText = (scene: Pick<SceneContract, 'role' | 'voiceoverText' | 'onScreenText' | 'visualIntent' | 'imagePrompt'>): string =>
  `${scene.role || ''} ${scene.voiceoverText || ''} ${scene.onScreenText || ''} ${scene.visualIntent || ''} ${scene.imagePrompt || ''}`.trim();

export const reviewSceneBindings = (
  brief: CampaignBrief,
  sceneContracts: SceneContract[],
  brand?: Brand | null,
): ReviewFeedback | null => {
  if (!isProductCampaign(brief, brand) || sceneContracts.length === 0) {
    return null;
  }

  const critiques: string[] = [];
  const mandatoryFixes: string[] = [];
  const suggestions: string[] = [];
  const failingSceneNumbers: number[] = [];

  const isIntentionalFresh = (scene: SceneContract): boolean => {
    if (scene.sourceMode !== 'generate_fresh') return false;
    const preferred = brief.preferredScenes?.find((entry) => entry.sceneNumber === scene.sceneNumber);
    // Preferred plan overrides: only intentional when storyboard asked for fresh (or left unbound).
    if (preferred?.sourceMode && preferred.sourceMode !== 'generate_fresh') return false;
    if (preferred?.sourceMode === 'generate_fresh') return true;
    if (preferred && !preferred.assetId) return true;
    return scene.assetBindings.length === 0;
  };

  const bindableScenes = sceneContracts.filter((scene) => !isIntentionalFresh(scene));
  const groundedScenes = bindableScenes.filter((scene) => scene.assetBindings.length > 0);
  const requiredGroundedSceneCount = bindableScenes.length === 0
    ? 0
    : Math.min(
      bindableScenes.length,
      Math.max(1, Math.ceil(bindableScenes.length * 0.6)),
    );

  if (requiredGroundedSceneCount > 0 && groundedScenes.length < requiredGroundedSceneCount) {
    mandatoryFixes.push(`Ground more scenes in the actual product assets. ${groundedScenes.length}/${bindableScenes.length} bindable scenes are product-bound, but at least ${requiredGroundedSceneCount} are required.`);
  }

  sceneContracts.forEach((scene, index) => {
    const text = buildSceneText(scene);
    const productFocused = isProductFocusedScene(text) || index === sceneContracts.length - 1;
    const intentionalFresh = isIntentionalFresh(scene);
    const hasBinding = scene.assetBindings.length > 0;

    if (productFocused && !hasBinding && !intentionalFresh) {
      mandatoryFixes.push(`Scene ${scene.sceneNumber} is product-focused but not bound to a real product asset.`);
      failingSceneNumbers.push(scene.sceneNumber);
    }

    if (scene.sourceMode === 'generate_fresh' && productFocused && !intentionalFresh) {
      critiques.push(`Scene ${scene.sceneNumber} is still set to generate fresh even though it talks about the product.`);
      failingSceneNumbers.push(scene.sceneNumber);
    }

    if (ABSTRACT_DRIFT_REGEX.test(text) && scene.sourceMode !== 'use_exact_asset') {
      critiques.push(`Scene ${scene.sceneNumber} is using abstract metaphor imagery instead of keeping the real product on screen.`);
      failingSceneNumbers.push(scene.sceneNumber);
    }
  });

  if (mandatoryFixes.length === 0 && critiques.length === 0) {
    return {
      stage: 'scene_binding',
      overallScore: 10,
      brandConsistency: 10,
      hookStrength: 10,
      narrativeFlow: 10,
      visualImpact: 10,
      marketFit: 10,
      verdict: 'approved',
      critiques: [],
      mandatoryFixes: [],
      suggestions: ['Keep the product visible in the majority of scenes as the concept moves into generation.'],
      metadata: {
        failingSceneNumbers: [],
        groundedSceneCount: groundedScenes.length,
        requiredGroundedSceneCount,
      },
    };
  }

  suggestions.push('Prefer use_exact_asset or edit_from_asset for product scenes and reserve generate_fresh for supporting/context shots only.');

  const overallScore = scoreFromIssues(mandatoryFixes, critiques);
  return {
    stage: 'scene_binding',
    overallScore,
    brandConsistency: overallScore,
    hookStrength: Math.max(6, overallScore),
    narrativeFlow: Math.max(6, overallScore + 0.5),
    visualImpact: Math.max(6, overallScore),
    marketFit: overallScore,
    verdict: mandatoryFixes.length > 0 ? 'needs_revision' : 'approved',
    critiques: uniqueStrings(critiques),
    mandatoryFixes: uniqueStrings(mandatoryFixes),
    suggestions: uniqueStrings(suggestions),
    metadata: {
      failingSceneNumbers: Array.from(new Set(failingSceneNumbers)),
      groundedSceneCount: groundedScenes.length,
      requiredGroundedSceneCount,
    },
  };
};

export const reviewGeneratedSceneOutputs = (
  brief: CampaignBrief,
  drafts: SceneDraft[],
  brandAssetCount: number,
): ReviewFeedback | null => {
  if (!brief.productUrl || brandAssetCount === 0 || drafts.length === 0) {
    return null;
  }

  const critiques: string[] = [];
  const mandatoryFixes: string[] = [];
  const suggestions: string[] = [];
  const failingSceneNumbers: number[] = [];

  const groundedScenes = drafts.filter((draft) =>
    draft.media?.assetOrigin === 'brand_asset'
    || draft.media?.assetOrigin === 'brand_edit'
    || Boolean(draft.brandAssetId),
  );
  const requiredGroundedSceneCount = Math.min(
    drafts.length,
    Math.max(2, Math.ceil(drafts.length * 0.6)),
  );

  if (groundedScenes.length < requiredGroundedSceneCount) {
    mandatoryFixes.push(`Generated output is under-grounded. ${groundedScenes.length}/${drafts.length} scenes are tied to real product assets, but at least ${requiredGroundedSceneCount} are required.`);
  }

  drafts.forEach((draft, index) => {
    const text = `${draft.voiceoverText || ''} ${draft.onScreenText || ''} ${draft.visualDescription || ''} ${draft.imagePrompt || ''}`.trim();
    const productFocused = isProductFocusedScene(text) || index === drafts.length - 1;
    const grounded = draft.media?.assetOrigin === 'brand_asset'
      || draft.media?.assetOrigin === 'brand_edit'
      || Boolean(draft.brandAssetId);

    if (productFocused && !grounded) {
      mandatoryFixes.push(`Scene ${draft.sceneNumber} generated without a bound product asset.`);
      failingSceneNumbers.push(draft.sceneNumber);
    }

    if (ABSTRACT_DRIFT_REGEX.test(text) && draft.media?.assetOrigin !== 'brand_asset') {
      mandatoryFixes.push(`Scene ${draft.sceneNumber} drifted into abstract metaphor imagery. Use the real product asset instead of a synthetic nature scene.`);
      failingSceneNumbers.push(draft.sceneNumber);
    }
  });

  if (mandatoryFixes.length === 0 && critiques.length === 0) {
    return {
      stage: 'final_output',
      overallScore: 10,
      brandConsistency: 10,
      hookStrength: 10,
      narrativeFlow: 10,
      visualImpact: 10,
      marketFit: 10,
      verdict: 'approved',
      critiques: [],
      mandatoryFixes: [],
      suggestions: [],
      metadata: {
        failingSceneNumbers: [],
        groundedSceneCount: groundedScenes.length,
        requiredGroundedSceneCount,
      },
    };
  }

  suggestions.push('Auto-correct failing scenes to exact product assets or edit-from-asset before opening Script Studio.');
  const overallScore = scoreFromIssues(mandatoryFixes, critiques);
  return {
    stage: 'final_output',
    overallScore,
    brandConsistency: overallScore,
    hookStrength: Math.max(6, overallScore),
    narrativeFlow: Math.max(6, overallScore + 0.5),
    visualImpact: Math.max(6, overallScore),
    marketFit: overallScore,
    verdict: mandatoryFixes.length > 0 ? 'needs_revision' : 'approved',
    critiques: uniqueStrings(critiques),
    mandatoryFixes: uniqueStrings(mandatoryFixes),
    suggestions: uniqueStrings(suggestions),
    metadata: {
      failingSceneNumbers: Array.from(new Set(failingSceneNumbers)),
      groundedSceneCount: groundedScenes.length,
      requiredGroundedSceneCount,
    },
  };
};

export const combineReviewFeedback = (...reviews: Array<ReviewFeedback | null | undefined>): ReviewFeedback | null => {
  const validReviews = reviews.filter((review): review is ReviewFeedback => Boolean(review));
  if (validReviews.length === 0) return null;

  const mandatoryFixes = uniqueStrings(validReviews.flatMap((review) => review.mandatoryFixes || []));
  const critiques = uniqueStrings(validReviews.flatMap((review) => review.critiques || []));
  const suggestions = uniqueStrings(validReviews.flatMap((review) => review.suggestions || []));
  const failingSceneNumbers = Array.from(new Set(validReviews.flatMap((review) => review.metadata?.failingSceneNumbers || [])));
  const overallScore = Math.min(...validReviews.map((review) => review.overallScore));

  return {
    stage: 'concept',
    overallScore,
    brandConsistency: Math.min(...validReviews.map((review) => review.brandConsistency)),
    hookStrength: Math.min(...validReviews.map((review) => review.hookStrength)),
    narrativeFlow: Math.min(...validReviews.map((review) => review.narrativeFlow)),
    visualImpact: Math.min(...validReviews.map((review) => review.visualImpact)),
    marketFit: Math.min(...validReviews.map((review) => review.marketFit)),
    verdict: mandatoryFixes.length > 0 || validReviews.some((review) => review.verdict === 'needs_revision') ? 'needs_revision' : 'approved',
    critiques,
    mandatoryFixes,
    suggestions,
    metadata: {
      failingSceneNumbers,
    },
  };
};
