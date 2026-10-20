import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AgentOrchestrator } from '../agents/AgentOrchestrator';
import ProductLockScreen from './productLock/ProductLockScreen';
import ProductImportScreen from './ProductImportScreen';
import { getBrands, createBrand, deleteBrand, addBrandAsset, updateBrandAsset, updateBrandMemory, getBrand } from '../services/brandService';
import { isBriefOnlyBrand } from '../services/brandDnaBootstrapService';
import { buildCampaignBlueprint, ensureVideoRenderArtifacts, markRenderManifestReady, resolveBrandAssetById } from '../services/campaignBlueprintService';
import {
  getProductAssetHistory,
  registerProductAsset,
  summarizeProductAssetHistory,
} from '../services/productAssetRegistryService';
import AgencyImageStudioPanel from './AIImageStudio/AgencyImageStudioPanel';
import { buildAgencyProductionPrompt } from './AIImageStudio/AgencyCreativeCopilot';
import {
  hydrateBrandAssetBase64,
  prepareAgencyStudioGenerateRefs,
  seedAgencyStudioContext,
} from './AIImageStudio/agencyStudioAdapter';
import type { CreativeConcept } from './AIImageStudio/types';
import StoryboardScreen from './StoryboardScreen';
import { useBrandAdSetup } from './hooks/useBrandAdSetup';
import { useProductLockScenePlan } from './productLock/hooks/useProductLockScenePlan';
import { useLockedAssetJobs } from './productLock/hooks/useLockedAssetJobs';
import type { ProductLockUndoAction, AgencySuggestedTrim, PlannerRequirement } from './productLock/productLockTypes';
import type { SubAgentState, AgentFinding, OrchestratorEvent } from '../agents/types';
import {
  getSceneDisplayAssetId,
  sceneIntendsFreshGeneration,
  toProductLockAssetPreviewUrl,
} from './productLock/productLockViewUtils';
import type {
  AssetLabMode,
  AdFormat,
  Brand,
  AdConcept,
  AdScene,
  ReviewFeedback,
  BrandAsset,
  ProductAssetRegistryEntry,
  CampaignBrief,
  CampaignBlueprint,
  CampaignObjective,
  CampaignPlatform,
  ExecutionMode,
  PlannedStoryboardScene,
  ProductContext,
  ProductResolutionCandidate,
  ProductUniverse,
  SceneRoute,
  SceneContract,
  StoryboardScene,
  StoryboardSceneState,
} from '../types/brand';
import { buildLockedProductContext, buildProductUniverse, resolveProductBrief } from '../services/productResolverService';
import { importProductPageAssetsRich, mergeProductKnowledge, parseProductImportUrls } from '../services/productPageImportService';
import { generateSingleScenePlan, suggestSceneImageEdit, suggestSceneTrims, planLockedProductSceneBindings, planCreativeStoryboard, researchTrendingAdPatterns, hasConfiguredGeminiApiKey, generateImageAsset, enhanceImagePrompt, analyzeUploadedImageForScenes, resolveFontFamily } from '../services/geminiService';
import { writeCarouselPrompts } from '../services/carouselPromptWriterAdapter';
import { buildStableProductConcept } from '../services/stableProductCampaignService';
import { inferSlideLayout } from '../services/carouselOverlayService';
import {
  assetLabModeToSceneRoute,
  sceneRouteToAssetLabMode,
  sourceModeToSceneRoute,
} from '../services/sceneRouter';
import TEST_ASSETS from '../src/testAssets.json';

// === TYPES ===
type BrandVideoStep = 'brand_hub' | 'product_import' | 'image_studio' | 'storyboard' | 'agents_working' | 'concept_review';

interface Props {
  userId: string;
  onBack: () => void;
  onConceptApproved?: (blueprint: CampaignBlueprint, brand: Brand | null) => void;
}

const inferScenePlannerBucket = (idea: Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt'>): number => {
  const text = `${idea.text} ${idea.visualDescription} ${idea.imagePrompt}`.toLowerCase();
  if (/(hook|scroll stop|opening|intro|pattern interrupt|first shot)/.test(text)) return 0;
  if (/(problem|pain|struggle|acne|issue|concern|before)/.test(text)) return 1;
  if (/(demo|apply|application|texture|ingredient|proof|benefit|result|after|comparison|routine)/.test(text)) return 2;
  if (/(cta|shop|buy|checkout|final shot|hero|packshot|closing)/.test(text)) return 4;
  return 3;
};

const planSceneIdeaOrder = (ideas: StoryboardSceneState[]): Array<StoryboardSceneState & { suggestedPosition: number }> => {
  return [...ideas]
    .sort((a, b) => {
      const bucketDelta = inferScenePlannerBucket(a) - inferScenePlannerBucket(b);
      if (bucketDelta !== 0) return bucketDelta;
      return a.id.localeCompare(b.id);
    })
    .map((idea, index) => ({ ...idea, suggestedPosition: index + 1 }));
};

const attachSuggestedPositions = (ideas: StoryboardSceneState[]): Array<StoryboardSceneState & { suggestedPosition: number }> => {
  const suggestionMap = new Map(planSceneIdeaOrder(ideas).map((idea) => [idea.id, idea.suggestedPosition]));
  return ideas.map((idea) => ({
    ...idea,
    suggestedPosition: suggestionMap.get(idea.id) || 1,
  }));
};

const buildScenePlannerWarnings = (
  ideas: Array<StoryboardSceneState & { suggestedPosition: number }>,
): PlannerRequirement[] => {
  if (ideas.length === 0) return [];

  const warnings: PlannerRequirement[] = [];
  const buckets = ideas.map(inferScenePlannerBucket);
  const hasHook = buckets.includes(0);
  const hasProof = buckets.includes(2);
  const hasClosing = buckets.includes(4);
  const approvedCount = ideas.filter((idea) => idea.approved).length;
  const unboundCount = ideas.filter((idea) => {
    if (idea.selectedVariantAssetId) return false;
    if (idea.visualTask === 'generate_new') return true;
    if (idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') return true;
    return !idea.baseAssetId;
  }).length;
  const duplicateBaseAssetIds = Object.entries(
    ideas.reduce<Record<string, number>>((acc, idea) => {
      if (!idea.baseAssetId) return acc;
      if (idea.visualTask && idea.visualTask !== 'use_imported') return acc;
      acc[idea.baseAssetId] = (acc[idea.baseAssetId] || 0) + 1;
      return acc;
    }, {}),
  )
    .filter(([, count]) => count > 1)
    .map(([assetId]) => assetId);

  if (!hasHook) warnings.push({ type: 'hook', message: 'Missing a clear hook or opening beat. Add one scene that stops the scroll immediately.' });
  if (!hasProof) warnings.push({ type: 'proof', message: 'Missing a proof, demo, or benefit beat. The plan needs a reason-to-believe scene.' });
  if (!hasClosing) warnings.push({ type: 'closing', message: 'Missing a closing hero or CTA beat. Add a final conversion-oriented scene.' });
  if (unboundCount > 0) warnings.push({ type: 'unbound', message: `${unboundCount} scene${unboundCount === 1 ? '' : 's'} still have no attached product asset or generated variant.` });
  if (approvedCount < ideas.length) warnings.push({ type: 'approval', message: `${ideas.length - approvedCount} scene${ideas.length - approvedCount === 1 ? '' : 's'} still need approval before continuing.` });
  if (duplicateBaseAssetIds.length > 0) warnings.push({ type: 'repetitive', message: 'Multiple scenes are anchored to the same base asset. Check that the sequence is not visually repetitive.' });

  return warnings;
};

// Helper function to map platform to adFormat
const getAdFormatForPlatform = (platform: CampaignPlatform): 'static_image' | 'carousel' | 'stitched_video' | 'veo3_video' => {
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

const getSceneReadiness = (ideas: Array<StoryboardSceneState & { suggestedPosition: number }>) => {
  if (ideas.length === 0) {
    return { isReady: true, message: '' };
  }

  const missingApproval = ideas.filter((idea) => !idea.approved).length;
  if (missingApproval > 0) {
    return {
      isReady: false,
      message: `${missingApproval} scene${missingApproval === 1 ? '' : 's'} still need approval.`,
    };
  }

  const missingAssetBinding = ideas.filter((idea) => {
    if (idea.selectedVariantAssetId) return false;
    if (idea.visualTask === 'generate_new') return false;
    if (idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') return true;
    return !idea.baseAssetId;
  }).length;
  if (missingAssetBinding > 0) {
    return {
      isReady: false,
      message: `${missingAssetBinding} scene${missingAssetBinding === 1 ? '' : 's'} still need a bound asset or generated variant.`,
    };
  }

  return { isReady: true, message: '' };
};

const getSceneStatusLabel = (idea: StoryboardSceneState): string => {
  if (idea.approved) return 'Approved';
  if (idea.selectedVariantAssetId) return 'Variant Selected';
  if (idea.baseAssetId) return 'Base Bound';
  return 'Needs Asset';
};

const toAssetPreviewUrl = (asset?: BrandAsset): string | undefined => {
  if (!asset) return undefined;
  if (asset.previewUrl) return asset.previewUrl;
  if (!asset.base64) return undefined;
  if (asset.base64.startsWith('data:') || asset.base64.startsWith('blob:') || asset.base64.startsWith('http')) {
    return asset.base64;
  }
  return `data:${asset.mimeType};base64,${asset.base64}`;
};

const downloadSlide = (dataUrl: string, filename: string) => {
  // Convert data URL to blob for reliable download
  fetch(dataUrl)
    .then(res => res.blob())
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    })
    .catch(() => {
      // Fallback: open in new tab
      window.open(dataUrl, '_blank');
    });
};

const normalizeUrlForKey = (value?: string): string => {
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

const titleFromProductUrl = (value?: string): string => {
  if (!value) return 'Featured Product';
  const slug = value.split('/').filter(Boolean).pop() || '';
  if (!slug) return 'Featured Product';
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const scopeBrandToProduct = (brand: Brand | null, productUrl?: string): Brand | null => {
  if (!brand) return null;
  const normalizedProductUrl = normalizeUrlForKey(productUrl || brand.websiteUrl);
  if (!normalizedProductUrl) return brand;

  const matchingAssets = brand.assets.filter((asset) => normalizeUrlForKey(asset.originPageUrl) === normalizedProductUrl);
  const matchingMemoryAssets = brand.brandMemory?.assets.filter((asset) => normalizeUrlForKey(asset.sourcePageUrl) === normalizedProductUrl) || [];
  if (matchingAssets.length === 0) {
    return {
      ...brand,
      websiteUrl: normalizedProductUrl,
      assets: [],
      brandMemory: brand.brandMemory
        ? {
            ...brand.brandMemory,
            websiteUrl: normalizedProductUrl,
            assets: matchingMemoryAssets,
          }
        : brand.brandMemory,
    };
  }

  return {
    ...brand,
    websiteUrl: normalizedProductUrl,
    assets: matchingAssets,
    brandMemory: brand.brandMemory
      ? {
          ...brand.brandMemory,
          websiteUrl: normalizedProductUrl,
          assets: matchingMemoryAssets,
        }
      : brand.brandMemory,
  };
};

const buildCombinedCampaignProductContext = (
  primaryProduct: ProductContext,
  productUniverse: ProductUniverse | null,
  sceneIdeas: StoryboardSceneState[],
  excludedAssetIds: string[],
): ProductContext => {
  const selectedProductIds = Array.from(new Set(sceneIdeas.map((idea) => idea.productId).filter(Boolean))) as string[];
  const universeProducts = productUniverse?.products || [primaryProduct];
  const relevantProducts = universeProducts.filter((product) =>
    selectedProductIds.length === 0 || selectedProductIds.includes(product.productId),
  );
  const mergedAssets = relevantProducts
    .flatMap((product) => product.productAssets)
    .filter((asset, index, assets) =>
      !excludedAssetIds.includes(asset.id) && assets.findIndex((entry) => entry.id === asset.id) === index,
    );
  const mergedFacts = Array.from(new Set(relevantProducts.flatMap((product) => product.productFacts).filter(Boolean)));
  const mergedClaims = Array.from(new Set(relevantProducts.flatMap((product) => product.allowedClaims).filter(Boolean)));

  return {
    ...primaryProduct,
    productAssets: mergedAssets.length > 0 ? mergedAssets : primaryProduct.productAssets.filter((asset) => !excludedAssetIds.includes(asset.id)),
    productFacts: mergedFacts.length > 0 ? mergedFacts : primaryProduct.productFacts,
    allowedClaims: mergedClaims.length > 0 ? mergedClaims : primaryProduct.allowedClaims,
  };
};

const resolveUniverseProductForAsset = (
  products: ProductContext[],
  assetId: string | undefined,
  fallbackProduct: ProductContext,
): ProductContext => {
  if (!assetId) return fallbackProduct;
  const matchedProduct = products.find((product) => product.productAssets.some((asset) => asset.id === assetId));
  return matchedProduct || fallbackProduct;
};

const resolveUniverseProductForScene = (
  idea: Pick<StoryboardSceneState, 'productId'>,
  products: ProductContext[],
  fallbackProduct: ProductContext,
): ProductContext => {
  if (!idea.productId) return fallbackProduct;
  return products.find((product) => product.productId === idea.productId) || fallbackProduct;
};

const groupSceneIdeasByProduct = (
  ideas: StoryboardSceneState[],
  products: ProductContext[],
  fallbackProduct: ProductContext,
): Array<{ product: ProductContext; ideas: StoryboardSceneState[] }> => {
  const grouped = new Map<string, { product: ProductContext; ideas: StoryboardSceneState[] }>();
  ideas.forEach((idea) => {
    const product = resolveUniverseProductForScene(idea, products, fallbackProduct);
    const existing = grouped.get(product.productId);
    if (existing) {
      existing.ideas.push(idea);
      return;
    }
    grouped.set(product.productId, { product, ideas: [idea] });
  });
  return Array.from(grouped.values());
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'onto', 'your', 'our',
  'best', 'in', 'of', 'a', 'an', 'to', 'on', 'at', 'by', 'is', 'are', 'as', 'or',
  'product', 'image', 'photo', 'shot', 'cdn', 'https', 'http', 'www', 'com',
]);

const normalizeSceneQueryTokens = (value: string): string[] => value
  .toLowerCase()
  .replace(/[^a-z0-9\s/_-]/g, ' ')
  .split(/[\s/_-]+/)
  .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

/** Pull distinctive tokens from CDN/path filenames (e.g. editorial-signature-ceremonial). */
const assetPathTokens = (asset: BrandAsset): string[] => {
  const raw = [asset.sourceUrl, asset.previewUrl, asset.id, asset.description]
    .filter(Boolean)
    .join(' ');
  return normalizeSceneQueryTokens(raw);
};

const pickBestMatchingAssetForStoryboardScene = (
  scene: Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt' | 'visualTask' | 'sceneNumber'>,
  product: ProductContext,
  usedIds: Set<string>,
  usedShotTypes: Set<string>,
): BrandAsset | undefined => {
  const assets = product.productAssets;
  if (assets.length === 0) return undefined;

  const query = `${scene.text}\n${scene.visualDescription}\n${scene.imagePrompt}`;
  const queryTokens = new Set(normalizeSceneQueryTokens(query));
  const queryText = query.toLowerCase();

  const scored = assets.map((asset) => {
    const textBlob = [
      asset.semanticDescription,
      asset.generationPrompt,
      asset.description,
      asset.shotType,
      ...(asset.bestSceneRoles || []),
      asset.sourceProductTitle,
    ].filter(Boolean).join(' ');
    const pathTokens = assetPathTokens(asset);
    const tokens = new Set([
      ...normalizeSceneQueryTokens(textBlob),
      ...pathTokens,
    ]);
    let score = 0;
    let semanticHits = 0;
    let shotBoost = false;
    for (const token of tokens) {
      if (queryTokens.has(token)) {
        score += 4;
        semanticHits += 1;
      }
    }
    // Filename/path tokens often carry the only distinctive signal on import galleries.
    for (const pathToken of pathTokens) {
      if (queryTokens.has(pathToken)) {
        score += 3;
        semanticHits += 1;
      }
      if (queryText.includes(pathToken)) {
        score += 2;
        semanticHits += 1;
      }
    }
    if (asset.verdict === 'use_as_is') score += scene.visualTask === 'use_imported' ? 10 : 4;
    if (asset.verdict === 'can_upgrade') score += scene.visualTask === 'edit_imported' || scene.visualTask === 'overlay_on_product' ? 10 : 3;
    if (asset.verdict === 'good_reference') score += scene.visualTask === 'overlay_on_product' ? 6 : 1;
    if (asset.verdict === 'do_not_use') score -= 30;
    if (asset.quality === 'hero') score += 8;
    if (asset.quality === 'strong') score += 5;
    if (asset.quality === 'weak') score -= 8;
    if (scene.visualTask === 'overlay_on_product' && (asset.shotType === 'packshot' || asset.shotType === 'bundle')) {
      score += 8;
      shotBoost = true;
    }
    if (scene.visualTask === 'edit_imported' && (asset.shotType === 'packshot' || asset.shotType === 'detail')) {
      score += 6;
      shotBoost = true;
    }
    if (/ingredient|texture|proof|demo|lather|foam|drop|serum|whisk|ceremonial|scoop/.test(queryText)
      && (asset.shotType === 'ingredient' || asset.shotType === 'texture' || asset.shotType === 'detail')) {
      score += 6;
      shotBoost = true;
    }
    if (/cta|hero|final|pack|bottle|product|checkout|shop|canister/.test(queryText)
      && (asset.shotType === 'packshot' || asset.shotType === 'bundle')) {
      score += 6;
      shotBoost = true;
    }
    if (/woman|man|model|smile|holding|bathroom|routine|vanity|pour|bowl|latte|soccer|jersey|remote|pitch/.test(queryText)
      && (asset.shotType === 'model_with_product' || asset.shotType === 'lifestyle')) {
      score += 5;
      shotBoost = true;
    }
    // Prefer unused assets strongly when there is a real semantic/shot signal.
    if (!usedIds.has(asset.id)) score += (semanticHits > 0 || shotBoost) ? 12 : 2;
    else score -= 20;
    // Spread shot types across the board when descriptions collide.
    if (asset.shotType && usedShotTypes.has(asset.shotType)) score -= 6;
    else if (asset.shotType) score += 3;
    return { asset, score, semanticHits, shotBoost };
  });

  scored.sort((a, b) => b.score - a.score);
  // Prefer highest unused; if all used, still return best.
  const unusedBest = scored.find((entry) => !usedIds.has(entry.asset.id));
  const best = unusedBest || scored[0];
  // Reject pure quality/position ties with no text or shot-type signal — leave unbound.
  if (!best || best.score < 6) return undefined;
  if (best.semanticHits === 0 && !best.shotBoost) return undefined;
  return best.asset;
};

const buildStoryboardSceneStateFromStoryboard = (
  storyboardScenes: StoryboardScene[],
  products: ProductContext[],
  fallbackProduct: ProductContext,
): StoryboardSceneState[] => {
  const usedBaseAssetIds = new Set<string>();
  const usedShotTypes = new Set<string>();

  return storyboardScenes.map((scene) => {
    const sceneProduct = resolveUniverseProductForScene({ productId: scene.recipe.productId }, products, fallbackProduct);
    const recommendedAsset = scene.recipe.recommendedBaseAssetId
      ? sceneProduct.productAssets.find((asset) => asset.id === scene.recipe.recommendedBaseAssetId)
      : undefined;
    // Skip recommended if already bound to an earlier scene — pick a fresh match instead.
    const recommendedAvailable = recommendedAsset && !usedBaseAssetIds.has(recommendedAsset.id)
      ? recommendedAsset
      : undefined;
    const needsBase = scene.recipe.visualTask !== 'generate_new' && scene.recipe.route !== 'generate_fresh';
    const bestMatch = needsBase && !recommendedAvailable
      ? pickBestMatchingAssetForStoryboardScene({
          text: scene.text,
          visualDescription: scene.visualDescription,
          imagePrompt: scene.imagePrompt,
          visualTask: scene.recipe.visualTask,
          sceneNumber: scene.sceneNumber,
        }, sceneProduct, usedBaseAssetIds, usedShotTypes)
      : undefined;
    const baseAsset = needsBase
      ? (recommendedAvailable || bestMatch)
      : undefined;

    if (baseAsset) {
      usedBaseAssetIds.add(baseAsset.id);
      if (baseAsset.shotType) usedShotTypes.add(baseAsset.shotType);
    }

    return {
      id: `seeded_scene_${sceneProduct.productId}_${scene.sceneNumber}`,
      sceneNumber: scene.sceneNumber,
      recipe: scene.recipe,
      text: scene.text,
      visualDescription: scene.visualDescription,
      imagePrompt: scene.imagePrompt,
      approved: true,
      productId: sceneProduct.productId,
      productTitle: sceneProduct.productTitle,
      route: scene.recipe.route,
      routeReason: scene.recipe.routeReason,
      sourceMode: scene.recipe.sourceMode,
      baseAssetId: baseAsset?.id,
      baseAssetDescription: baseAsset?.description,
      generationMode: sceneRouteToAssetLabMode(scene.recipe.route),
      visualTask: scene.recipe.visualTask,
      visualTaskReason: scene.recipe.visualTaskReason,
      directorsNote: scene.recipe.routeReason || scene.recipe.visualTaskReason,
      visualGap: scene.recipe.visualTask !== 'use_imported',
    } satisfies StoryboardSceneState;
  });
};

const buildInitialStoryboardSceneState = (
  brand: Brand,
  lockedProduct: ProductContext,
  planningProductContext: ProductContext,
  availableProducts: ProductContext[],
  brief: Pick<CampaignBrief, 'rawPrompt' | 'adFormat' | 'platform' | 'objective' | 'durationSec' | 'executionMode'>,
): { ideas: StoryboardSceneState[]; concept: AdConcept } => {
  const { concept } = buildStableProductConcept({
    ...brief,
    adFormat: brief.adFormat || 'stitched_video',
    productUrl: lockedProduct.productUrl,
    productContext: planningProductContext,
  }, brand);

  const ideas = concept.scenes.map((scene, index) => {
    const boundAsset = planningProductContext.productAssets.find((asset) => asset.id === scene.brandAssetRef);
    const sceneProduct = resolveUniverseProductForAsset(availableProducts, boundAsset?.id, lockedProduct);
    const route = scene.brandAssetEditAction === 'use_as_is' ? 'use_existing' : 'upgrade_existing';
    const sourceMode = scene.brandAssetEditAction === 'use_as_is' ? 'use_exact_asset' : 'edit_from_asset' as const;
    const visualTask = scene.brandAssetEditAction === 'use_as_is' ? 'use_imported' : 'edit_imported' as const;
    return {
      id: `seeded_scene_${sceneProduct.productId}_${index + 1}`,
      sceneNumber: index + 1,
      recipe: {
        productId: sceneProduct.productId,
        productTitle: sceneProduct.productTitle,
        route,
        sourceMode,
        visualTask,
        routeReason: scene.directorsNote,
      },
      text: scene.voiceoverText || scene.onScreenText || scene.visualDescription,
      visualDescription: scene.visualDescription,
      imagePrompt: scene.imagePrompt,
      productId: sceneProduct.productId,
      productTitle: sceneProduct.productTitle,
      directorsNote: scene.directorsNote,
      approved: true,
      route,
      sourceMode,
      baseAssetId: boundAsset?.id,
      baseAssetDescription: boundAsset?.description,
      generationMode: sceneRouteToAssetLabMode(route),
      visualGap: route !== 'use_existing',
    } satisfies StoryboardSceneState;
  });

  return { ideas, concept };
};

const buildBrandAestheticContext = (brand: Brand | null): string => {
  if (!brand?.dna) return '';

  const dna = brand.dna;
  const parts: string[] = [];

  if (dna.colors?.palette?.length) {
    parts.push(`Brand colors: ${dna.colors.palette.join(', ')}. Use these as the primary palette for backgrounds, text, and accents.`);
  } else if (dna.colors?.primary) {
    parts.push(`Brand primary color: ${dna.colors.primary}. Use this for key visual elements and text.`);
  }

  if (dna.typography?.headingStyle) {
    parts.push(`Heading font style: ${dna.typography.headingStyle}. Use this style for headlines and large text on the image.`);
  }
  if (dna.typography?.bodyStyle) {
    parts.push(`Body font style: ${dna.typography.bodyStyle}. Use this style for smaller body text and descriptions.`);
  }

  if (dna.visualSignature) {
    parts.push(`Visual signature: ${dna.visualSignature}. Maintain this aesthetic across all slides.`);
  }

  if (dna.aesthetic?.length) {
    parts.push(`Aesthetic keywords: ${dna.aesthetic.join(', ')}.`);
  }

  if (dna.brandVoice?.tone) {
    parts.push(`Brand tone: ${dna.brandVoice.tone}. Reflect this in the visual mood and text styling.`);
  }

  return parts.length > 0 ? `BRAND AESTHETIC DIRECTIVES:\n${parts.join('\n')}` : '';
};

const buildCarouselVisualIdentityLock = (brand: Brand | null): string => {
  if (!brand?.dna) return '';

  const dna = brand.dna;
  const parts: string[] = [];

  // Lock color palette
  if (dna.colors?.palette?.length) {
    parts.push(`LOCKED COLOR PALETTE: ${dna.colors.palette.slice(0, 4).join(', ')}. Every slide MUST use this palette. Background, surfaces, and props should draw from these colors only.`);
  } else if (dna.colors?.primary) {
    parts.push(`LOCKED PRIMARY COLOR: ${dna.colors.primary}. Use as dominant color across all slides.`);
  }

  // Lock visual signature / aesthetic
  if (dna.visualSignature) {
    parts.push(`LOCKED VISUAL STYLE: ${dna.visualSignature}. Apply this exact treatment to every slide — same lighting, same grading, same surface textures.`);
  }

  if (dna.aesthetic?.length) {
    parts.push(`LOCKED AESTHETIC: ${dna.aesthetic.slice(0, 3).join(', ')}. All slides must share this aesthetic — do not vary the visual mood between slides.`);
  }

  // Lock photography style
  parts.push('LOCKED PHOTOGRAPHY: Consistent lighting direction, same depth of field style, same color grading across all slides. If slide 1 uses warm soft light from the left, every slide uses warm soft light from the left.');

  // Lock composition rules
  parts.push('COMPOSITION RULES: Keep the product as the hero in every slide. Maintain consistent framing distance. Leave negative space at top (15% of frame) and bottom (20% of frame) for text overlay. Do NOT place important visual elements in the top 15% or bottom 20% of the frame.');

  return `VISUAL IDENTITY LOCK (applies to ALL slides — do not vary):\n${parts.join('\n')}`;
};

const pickAgencyAutopilotBaseAsset = (
  productAssets: BrandAsset[],
  idea: StoryboardSceneState,
  _index: number,
): BrandAsset | undefined => {
  if (!productAssets.length) return undefined;
  if (idea.selectedVariantAssetId) {
    return productAssets.find((asset) => asset.id === idea.selectedVariantAssetId);
  }
  if (idea.baseAssetId) {
    return productAssets.find((asset) => asset.id === idea.baseAssetId);
  }
  return undefined;
};

const buildAgencySceneExpansionPrompts = (
  durationSec: CampaignBrief['durationSec'],
): string[] => {
  const prompts = [
    'Add one premium proof or detail beat that uses the same product but gives the storyboard a stronger reason-to-believe moment.',
  ];

  if (durationSec >= 20) {
    prompts.push('Add one alternate hook or payoff beat that feels visually distinct from the existing scenes but still grounded in the imported product assets.');
  }

  if (durationSec >= 30) {
    prompts.push('Add one scene that turns an existing imported product image into a more elevated editorial or lifestyle-adjacent beat without losing product accuracy.');
  }

  return prompts;
};

// === MAIN COMPONENT ===
const BrandVideoCreator: React.FC<Props> = ({ userId, onBack, onConceptApproved }) => {
  const [step, setStep] = useState<BrandVideoStep>('brand_hub');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null);
  const [campaignBrand, setCampaignBrand] = useState<Brand | null>(null);
  const [productUrl, setProductUrl] = useState('');
  const [lockedProduct, setLockedProduct] = useState<ProductContext | null>(null);
  const [productUniverse, setProductUniverse] = useState<ProductUniverse | null>(null);
  const [activeProductId, setActiveProductId] = useState<string>('');
  const [productCandidates, setProductCandidates] = useState<ProductResolutionCandidate[]>([]);
  const [briefText, setBriefText] = useState('');
  const [platform, setPlatform] = useState<CampaignPlatform>('tiktok');
  const [adFormat, setAdFormat] = useState<'stitched_video' | 'static_image' | 'carousel' | 'veo3_video'>('stitched_video');
  const [objective, setObjective] = useState<CampaignObjective>('awareness');
  const [durationSec, setDurationSec] = useState<10 | 15 | 20 | 30 | 45 | 60>(30);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('balanced');
  const [plannerModel, setPlannerModel] = useState<import('../types/brand').PlannerModelPreference>('glm_53_flash');
  const [audience, setAudience] = useState('');
  const [callToAction, setCallToAction] = useState('');
  const [tone, setTone] = useState('');
  const [lockedAssetPrompt, setLockedAssetPrompt] = useState('');
  const [selectedContinuationAssetId, setSelectedContinuationAssetId] = useState<string>('');
  const [selectedSceneIdeaId, setSelectedSceneIdeaId] = useState<string>('');
  const [assetLabMode, setAssetLabMode] = useState<AssetLabMode>('continue_image_into_scene');
  const [isRunningAgencyAutopilot, setIsRunningAgencyAutopilot] = useState(false);
  const [agencyAutopilotProductId, setAgencyAutopilotProductId] = useState<string | null>(null);
  const [seededSceneProductId, setSeededSceneProductId] = useState<string | null>(null);
  const [productAssetHistory, setProductAssetHistory] = useState<ProductAssetRegistryEntry[]>([]);
  const [isWritingBriefPrompt, setIsWritingBriefPrompt] = useState(false);
  const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
  const [studioSelectedAssetId, setStudioSelectedAssetId] = useState<string | null>(null);
  const [isGeneratingStudioImage, setIsGeneratingStudioImage] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [isRewritingScene, setIsRewritingScene] = useState(false);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkGenerateProgress, setBulkGenerateProgress] = useState<{ current: number; total: number } | null>(null);
  const [revisionNote, setRevisionNote] = useState('');

  // Brand creation form
  const [showAddBrand, setShowAddBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandUrl, setNewBrandUrl] = useState('');
  const [newBrandIg, setNewBrandIg] = useState('');

  // ONE-TIME INJECTOR FOR TESTING
  useEffect(() => {
    if (import.meta.env.VITE_ENABLE_BRAND_TEST_INJECTOR !== 'true') return;
    if (selectedBrand && selectedBrand.name.toLowerCase().includes('bare')) {
      if (selectedBrand.assets.length === 0) {
        console.log('[Test Injector] Injecting 4 raw image assets to Bare & Fair brand...');
        const injectedAssets = Array.isArray(TEST_ASSETS) ? (TEST_ASSETS as any[]) : [];
        injectedAssets.forEach((asset) => {
          addBrandAsset(selectedBrand.id, asset as BrandAsset);
        });
        // Force refresh state so UI has the new assets
        setBrands(getBrands(userId));
        const updated = getBrands(userId).find(b => b.id === selectedBrand.id);
        if (updated) setSelectedBrand(updated);
      }
    }
  }, [selectedBrand?.id]);

  // Agent state
  const [agentStates, setAgentStates] = useState<SubAgentState[]>([]);
  const [liveFindings, setLiveFindings] = useState<AgentFinding[]>([]);
  const [currentPhase, setCurrentPhase] = useState('Initializing...');
  const [currentIteration, setCurrentIteration] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isResolvingProduct, setIsResolvingProduct] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [finalConcept, setFinalConcept] = useState<AdConcept | null>(null);
  const [campaignBlueprint, setCampaignBlueprint] = useState<CampaignBlueprint | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewFeedback[]>([]);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);
  const findingsFeedRef = useRef<HTMLDivElement>(null);
  const universeProducts = productUniverse?.products?.length ? productUniverse.products : (lockedProduct ? [lockedProduct] : []);
  const activeLockedProduct = universeProducts.find((product) => product.productId === activeProductId) || lockedProduct || universeProducts[0] || null;
  const rawLockedAssets = activeLockedProduct?.productAssets || [];
  const assetLabRoute = assetLabModeToSceneRoute(assetLabMode);

  const {
    sceneIdeaPrompt,
    setSceneIdeaPrompt,
    sceneIdeas,
    setSceneIdeas,
    isAddingSceneIdea,
    agencySuggestedScenes,
    setAgencySuggestedScenes,
    agencySuggestedTrims,
    setAgencySuggestedTrims,
    sceneReorderPrompt,
    setSceneReorderPrompt,
    isReorderingScenes,
    sceneReorderReasoning,
    setSceneReorderReasoning,
    excludedAssetIds,
    setExcludedAssetIds,
    lastProductLockUndoAction,
    setLastProductLockUndoAction,
    handleUpdateSceneIdea,
    handleUpdateSceneMotionMode,
    handleUpdateSceneRoute,
    handleToggleAssetExcluded,
    handleSuggestSceneOrder,
    handleAddSceneIdea,
    handleRemoveSceneIdea,
    handleUndoLastProductLockAction,
    handleMoveSceneIdea,
    handleApplySuggestedSceneOrder,
    handleUseSceneIdeaForAssetLab,
    handleAcceptAgencySuggestedScene,
    handleAssignSceneProduct,
    handleApproveSceneIdea,
    handleBindSceneIdeaToSelectedAsset,
    handleAssignSceneBaseAsset,
    handleSelectSceneVariant,
    handleUseSceneVariantAsBase,
    handleRejectSceneVariant,
    handleFixRequirement,
    narrativeArc,
    setNarrativeArc,
    creativeRationale,
    setCreativeRationale,
  } = useProductLockScenePlan({
    lockedProduct: activeLockedProduct,
    availableProducts: universeProducts,
    platform,
    availableLockedAssets: rawLockedAssets,
    selectedContinuationAssetId,
    setSelectedSceneIdeaId,
    setActiveProductId,
    setSelectedContinuationAssetId,
    setLockedAssetPrompt,
    setAssetLabMode,
    setErrorMessage,
    planSceneIdeaOrder,
  });

  const availableLockedAssets = rawLockedAssets.filter((asset) => !excludedAssetIds.includes(asset.id));
  const plannedSceneIdeas = attachSuggestedPositions(sceneIdeas);
  const plannerWarnings = buildScenePlannerWarnings(plannedSceneIdeas);
  const sceneReadiness = getSceneReadiness(plannedSceneIdeas);
  const productAssetHistorySummary = summarizeProductAssetHistory(productAssetHistory);

  const handleSetAssetLabRoute = useCallback((route: SceneRoute) => {
    const activeSceneId = selectedSceneIdeaId || sceneIdeas[0]?.id;
    setAssetLabMode(sceneRouteToAssetLabMode(route));
    if (activeSceneId) {
      handleUpdateSceneRoute(activeSceneId, route);
    }
  }, [handleUpdateSceneRoute, sceneIdeas, selectedSceneIdeaId]);

  const handleSelectUniverseProduct = useCallback((productId: string) => {
    setActiveProductId(productId);
    setSelectedContinuationAssetId('');
  }, []);

  // Load brands
  useEffect(() => {
    setBrands(getBrands(userId));
  }, [userId]);

  // Auto-scroll findings feed
  useEffect(() => {
    if (findingsFeedRef.current) {
      findingsFeedRef.current.scrollTop = findingsFeedRef.current.scrollHeight;
    }
  }, [liveFindings]);

  useEffect(() => {
    if (!universeProducts.length) {
      if (activeProductId) setActiveProductId('');
      return;
    }
    if (!activeProductId || !universeProducts.some((product) => product.productId === activeProductId)) {
      setActiveProductId(productUniverse?.primaryProductId || lockedProduct?.productId || universeProducts[0].productId);
    }
  }, [activeProductId, lockedProduct?.productId, productUniverse?.primaryProductId, universeProducts]);

  useEffect(() => {
    if (!sceneIdeas.length) {
      if (selectedSceneIdeaId) setSelectedSceneIdeaId('');
      return;
    }
    if (!selectedSceneIdeaId || !sceneIdeas.some((idea) => idea.id === selectedSceneIdeaId)) {
      setSelectedSceneIdeaId(sceneIdeas[0].id);
    }
  }, [sceneIdeas, selectedSceneIdeaId]);

  useEffect(() => {
    const selectedScene = sceneIdeas.find((idea) => idea.id === selectedSceneIdeaId);
    const nextProductId = selectedScene?.productId || productUniverse?.primaryProductId || lockedProduct?.productId;
    if (nextProductId && nextProductId !== activeProductId) {
      setActiveProductId(nextProductId);
    }
  }, [activeProductId, lockedProduct?.productId, productUniverse?.primaryProductId, sceneIdeas, selectedSceneIdeaId]);

  useEffect(() => {
    if (!selectedContinuationAssetId || !activeLockedProduct) return;
    if (!activeLockedProduct.productAssets.some((asset) => asset.id === selectedContinuationAssetId)) {
      setSelectedContinuationAssetId('');
    }
  }, [activeLockedProduct, selectedContinuationAssetId]);

  // NOTE: No auto-seed useEffect. Scenes are ONLY created when the user
  // clicks "AI: Write Storyboard" on the storyboard screen. This gives the
  // user full control: they can upload/edit images in the Image Studio first,
  // then configure campaign settings and brief, and THEN generate scenes
  // with the full context available.

  useEffect(() => {
    if (!activeLockedProduct) {
      setProductAssetHistory([]);
      return;
    }

    const activeBrand = campaignBrand || selectedBrand;
    if (!activeBrand) return;

    const history = getProductAssetHistory({
      brandName: activeBrand.name,
      productUrl: activeLockedProduct.productUrl,
      productTitle: activeLockedProduct.productTitle,
    });
    setProductAssetHistory(history);

    if (!history.length) return;
    setLiveFindings((prev) => {
      const findingId = `product_asset_registry_${activeLockedProduct.productId}`;
      if (prev.some((entry) => entry.id === findingId)) return prev;
      return [
        ...prev,
        {
          id: findingId,
          agentId: 'asset_registry',
          timestamp: Date.now(),
          type: 'asset',
          title: 'Loaded local product asset history',
          content: summarizeProductAssetHistory(history),
          confidence: 0.94,
        },
      ].slice(-50);
    });
  }, [activeLockedProduct, campaignBrand, selectedBrand]);

  const handleRunAgencyAutopilot = useCallback(async () => {
    if (!lockedProduct || executionMode !== 'agency' || sceneIdeas.length === 0 || isRunningAgencyAutopilot) return;
    const storyboardProducts = universeProducts.length > 0 ? universeProducts : [lockedProduct];
    const sceneGroups = groupSceneIdeasByProduct(sceneIdeas, storyboardProducts, lockedProduct);

    setIsRunningAgencyAutopilot(true);
    setErrorMessage(null);
    try {
      const assetSuggestionGroups = await Promise.all(sceneGroups.map(async ({ product, ideas }) => {
        const simulatedConcept: AdConcept = {
          title: product.productTitle,
          adFormat: adFormat,
          narrative: briefText,
          hook: ideas[0]?.text || sceneIdeas[0]?.text || briefText,
          scenes: ideas.map((idea, idx) => ({
            sceneNumber: idx + 1,
            visualDescription: idea.visualDescription,
            imagePrompt: idea.imagePrompt,
            voiceoverText: idea.text,
            onScreenText: idea.text,
            durationSec: 3,
            transitionIn: idx === 0 ? 'none' : 'fade',
            cameraMovement: 'slow push',
          })),
          musicDirection: 'Modern, premium pulse',
          captionStyle: 'Bold, high-contrast',
          colorMood: 'Premium apothecary aesthetic',
          estimatedDuration: durationSec,
          creativeRationale: 'Agency Autopilot initial pass',
        };

        const sceneContracts = await planLockedProductSceneBindings(
          { rawPrompt: briefText, adFormat, platform, objective, durationSec, executionMode },
          simulatedConcept,
          product,
        );

        return sceneContracts.map((contract, index) => {
          const binding = contract.assetBindings[0];
          const idea = ideas[index];
          const isVisualGap = contract.sourceMode === 'generate_matching_shot' || contract.sourceMode === 'generate_fresh';
          const route = sourceModeToSceneRoute(contract.sourceMode);
          return {
            ideaId: idea?.id,
            productId: product.productId,
            productTitle: product.productTitle,
            baseAssetId: binding?.assetId,
            baseAssetDescription: binding?.reason,
            prompt: contract.imagePrompt,
            reasoning: binding?.reason || contract.directorsNote || 'Director suggested this visual path.',
            route,
            mode: sceneRouteToAssetLabMode(route),
            directorsNote: contract.directorsNote,
            visualGap: isVisualGap,
          };
        }).filter((entry) => entry.ideaId);
      }));
      const assetSuggestions = assetSuggestionGroups.flat();

      const existingScenes = sceneIdeas.map((idea, index) => ({
        sceneNumber: index + 1,
        visualDescription: idea.visualDescription,
        imagePrompt: idea.imagePrompt,
        estimatedDuration: 3,
        scriptGuidance: idea.text,
      }));
      const assetSummary = lockedProduct.productAssets
        .slice(0, 8)
        .map((asset, index) => `Asset ${index + 1}: ${asset.semanticDescription || asset.description}`)
        .join('\n');
      const extraScenePrompts = buildAgencySceneExpansionPrompts(durationSec);
      const sceneSuggestions = await Promise.all(extraScenePrompts.map(async (instruction, index) => {
        const targetGroup = sceneGroups[index % sceneGroups.length] || { product: lockedProduct, ideas: sceneIdeas };
        const targetProduct = targetGroup.product;
        const targetAssetSummary = targetProduct.productAssets
          .slice(0, 8)
          .map((asset, assetIndex) => `Asset ${assetIndex + 1}: ${asset.semanticDescription || asset.description}`)
          .join('\n');
        const generatedScene = await generateSingleScenePlan(
          `Sensual Narrative for ${targetProduct.productTitle} on ${formatPlatformLabel(platform)}. Build a premium 'world' first.\nRetrieved product assets:\n${targetAssetSummary || assetSummary}`,
          targetGroup.ideas.length > 0
            ? targetGroup.ideas.map((idea, ideaIndex) => ({
                sceneNumber: ideaIndex + 1,
                visualDescription: idea.visualDescription,
                imagePrompt: idea.imagePrompt,
                estimatedDuration: 3,
                scriptGuidance: idea.text,
              }))
            : existingScenes,
          `${instruction}\nFocus on evocative textures, intimate lighting, and mood. Prefer 'imagined' shots (suggestedAssetIndex: 0) if they serve the narrative better than forced asset binding.`,
        );

        const suggestedAssetIdx = (generatedScene as any).suggestedAssetIndex;
        const suggestedAsset = (suggestedAssetIdx > 0 && suggestedAssetIdx <= targetProduct.productAssets.length)
          ? targetProduct.productAssets[suggestedAssetIdx - 1]
          : null;

        const route = suggestedAsset ? 'composite_product' as const : 'generate_fresh' as const;
        const sourceMode = suggestedAsset ? 'generate_matching_shot' as const : 'generate_fresh' as const;
        return {
          id: `agency_scene_${targetProduct.productId}_${Date.now().toString(36)}_${index}`,
          sceneNumber: index + 1,
          recipe: {
            productId: targetProduct.productId,
            productTitle: targetProduct.productTitle,
            route,
            sourceMode,
            visualTask: 'generate_new',
          },
          text: generatedScene.scriptGuidance,
          visualDescription: generatedScene.visualDescription,
          imagePrompt: generatedScene.imagePrompt,
          approved: false,
          productId: targetProduct.productId,
          productTitle: targetProduct.productTitle,
          route,
          sourceMode,
          generationMode: sceneRouteToAssetLabMode(route),
          agencySuggested: true,
          agencySuggestedBaseAssetId: suggestedAsset?.id,
          agencySuggestedBaseAssetDescription: suggestedAsset?.description,
          agencySuggestedPrompt: generatedScene.imagePrompt,
          agencySuggestedRoute: route,
          agencySuggestedMode: sceneRouteToAssetLabMode(route),
          visualGap: true,
        } satisfies StoryboardSceneState;
      }));

      setSceneIdeas((prev) => prev.map((idea) => {
        const suggestion = assetSuggestions.find((entry) => entry.ideaId === idea.id);
        if (!suggestion) return idea;
        return {
          ...idea,
          productId: suggestion.productId || idea.productId,
          productTitle: suggestion.productTitle || idea.productTitle,
          agencySuggestedBaseAssetId: suggestion.baseAssetId,
          agencySuggestedBaseAssetDescription: suggestion.baseAssetDescription,
          agencySuggestedPrompt: suggestion.prompt,
          agencySuggestedReasoning: suggestion.reasoning,
          agencySuggestedRoute: suggestion.route,
          agencySuggestedMode: suggestion.mode,
          directorsNote: suggestion.directorsNote,
          visualGap: suggestion.visualGap,
        };
      }));

      const trimSuggestions = await suggestSceneTrims(sceneIdeas.map(idea => ({
        id: idea.id,
        text: idea.text,
        visualDescription: idea.visualDescription,
      })));

      setAgencySuggestedScenes(sceneSuggestions);
      setAgencySuggestedTrims(trimSuggestions);
      setAgencyAutopilotProductId(productUniverse?.primaryProductId || lockedProduct.productId);
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `agency_autopilot_${Date.now().toString(36)}`,
          agentId: 'agency_autopilot',
          timestamp: Date.now(),
          type: 'recommendation',
          title: 'Agency autopilot prepared scene and asset suggestions',
          content: `Prepared ${assetSuggestions.length} scene-specific asset recommendations, ${sceneSuggestions.length} optional scene additions, and ${trimSuggestions.length} trim suggestions across ${sceneGroups.length} product lane${sceneGroups.length === 1 ? '' : 's'}.`,
          confidence: 0.88,
        },
      ]);
    } catch (error: any) {
      console.error('[BrandVideoCreator] Agency autopilot failed:', error);
      setErrorMessage(error.message || 'Agency autopilot could not finish the extra scene and asset planning.');
    } finally {
      setIsRunningAgencyAutopilot(false);
    }
  }, [briefText, durationSec, executionMode, isRunningAgencyAutopilot, lockedProduct, objective, platform, productUniverse?.primaryProductId, sceneIdeas, universeProducts]);

  // === HANDLERS ===

  const {
    handleAddBrand,
    handleDeleteBrand,
    handleSelectBrand,
    handleSkipBrand,
    ensureBrandAssets,
    handleResolveProduct,
    handleChooseProductCandidate,
    handleSuggestCampaignBriefPrompt,
    resetProductLockState,
  } = useBrandAdSetup({
    userId,
    selectedBrand,
    setSelectedBrand,
    campaignBrand,
    setCampaignBrand,
    setBrands,
    setStep,
    newBrandName,
    setNewBrandName,
    newBrandUrl,
    setNewBrandUrl,
    newBrandIg,
    setNewBrandIg,
    setShowAddBrand,
    briefText,
    setBriefText,
    platform,
    objective,
    durationSec,
    executionMode,
    audience,
    callToAction,
    tone,
    setIsWritingBriefPrompt,
    setIsResolvingProduct,
    setCurrentPhase,
    setLiveFindings,
    setErrorMessage,
    setLockedProduct,
    setProductUniverse,
    productCandidates,
    setProductCandidates,
    setProductAssetHistory,
    setExcludedAssetIds,
    setLastProductLockUndoAction,
    setSceneReorderReasoning,
    setSceneIdeas,
    setAgencySuggestedScenes,
    setAgencyAutopilotProductId,
    setSeededSceneProductId,
    setLockedAssetPrompt,
    setSceneIdeaPrompt,
    normalizeUrlForKey,
    titleFromProductUrl,
    scopeBrandToProduct,
  });

  const appendLockedProductAsset = useCallback((asset: BrandAsset) => {
    const activeBrand = campaignBrand || selectedBrand;
    const normalizedOriginUrl = normalizeUrlForKey(asset.originPageUrl);
    if (activeBrand) {
      addBrandAsset(activeBrand.id, asset);
      registerProductAsset({
        brandName: activeBrand.name,
        productUrl: asset.originPageUrl || activeLockedProduct?.productUrl || lockedProduct?.productUrl || activeBrand.websiteUrl,
        productTitle: asset.sourceProductTitle || activeLockedProduct?.productTitle || lockedProduct?.productTitle || 'Featured Product',
        asset,
        promptUsed: asset.generationPrompt,
      });
      setProductAssetHistory(getProductAssetHistory({
        brandName: activeBrand.name,
        productUrl: asset.originPageUrl || activeLockedProduct?.productUrl || lockedProduct?.productUrl || activeBrand.websiteUrl,
        productTitle: asset.sourceProductTitle || activeLockedProduct?.productTitle || lockedProduct?.productTitle,
      }));
    }

    setLockedProduct(prev => prev ? {
      ...prev,
      productAssets: prev.productAssets.some((existing) => existing.id === asset.id)
        ? prev.productAssets
        : [...prev.productAssets, asset],
      productFacts: Array.from(new Set([...prev.productFacts, asset.description].filter(Boolean))),
    } : prev);
    setProductUniverse(prev => prev ? {
      ...prev,
      products: prev.products.map((product) => 
        product.productAssets.some((existing) => existing.id === asset.id)
          ? product
          : {
              ...product,
              productAssets: [...product.productAssets, asset],
              productFacts: Array.from(new Set([...product.productFacts, asset.description].filter(Boolean))),
            }),
    } : prev);
    setCampaignBrand(prev => prev ? {
      ...prev,
      assets: prev.assets.some((existing) => existing.id === asset.id) ? prev.assets : [...prev.assets, asset],
    } : prev);
    setSelectedBrand(prev => prev ? {
      ...prev,
      assets: prev.assets.some((existing) => existing.id === asset.id) ? prev.assets : [...prev.assets, asset],
    } : prev);
    setBrands(prev => prev.map((brand) => {
      if (!activeBrand || brand.id !== activeBrand.id) return brand;
      return {
        ...brand,
        assets: brand.assets.some((existing) => existing.id === asset.id) ? brand.assets : [...brand.assets, asset],
      };
    }));
  }, [activeLockedProduct?.productTitle, activeLockedProduct?.productUrl, activeProductId, campaignBrand, lockedProduct, normalizeUrlForKey, selectedBrand]);

  /** Persist hydrated base64 onto an existing product/brand asset so gallery/export stop being preview-only. */
  const patchLockedProductAsset = useCallback((asset: BrandAsset) => {
    const activeBrand = campaignBrand || selectedBrand;
    if (activeBrand) {
      updateBrandAsset(activeBrand.id, asset);
    }

    const replaceAsset = (assets: BrandAsset[]) =>
      assets.map((existing) => (existing.id === asset.id ? { ...existing, ...asset } : existing));

    setLockedProduct((prev) => prev ? {
      ...prev,
      productAssets: replaceAsset(prev.productAssets),
    } : prev);
    setProductUniverse((prev) => prev ? {
      ...prev,
      products: prev.products.map((product) => ({
        ...product,
        productAssets: replaceAsset(product.productAssets),
      })),
    } : prev);
    setCampaignBrand((prev) => prev ? { ...prev, assets: replaceAsset(prev.assets) } : prev);
    setSelectedBrand((prev) => prev ? { ...prev, assets: replaceAsset(prev.assets) } : prev);
    setBrands((prev) => prev.map((brand) => {
      if (!activeBrand || brand.id !== activeBrand.id) return brand;
      return { ...brand, assets: replaceAsset(brand.assets) };
    }));
  }, [campaignBrand, selectedBrand]);

  const {
    lockedAssetJobs,
    isSuggestingLockedAssetPrompt,
    isGeneratingSelectedSceneAsset,
    selectedSceneLockedAssetActionIndex,
    handleGenerateLockedAsset,
    handleQuickGenerateSceneAsset,
    handleCancelSceneAssetJob,
    handleSmartEditLockedAsset,
    handleSuggestLockedAssetPrompt,
  } = useLockedAssetJobs({
    lockedProduct: activeLockedProduct,
    productUniverseProducts: universeProducts,
    availableLockedAssets,
    excludedAssetIds,
    sceneIdeas,
    briefText,
    selectedSceneIdeaId,
    selectedContinuationAssetId,
    assetLabMode,
    lockedAssetPrompt,
    appendLockedProductAsset,
    setSceneIdeas,
    setSelectedSceneIdeaId,
    setActiveProductId,
    setSelectedContinuationAssetId,
    setLockedAssetPrompt,
    setErrorMessage,
    setLiveFindings,
  });

  const handleGenerateStoryboard = useCallback(async () => {
    if (!(briefText || '').trim() || !lockedProduct) {
      setErrorMessage('Please provide a brief and import a product before generating the storyboard');
      console.log('[BrandVideoCreator] handleGenerateStoryboard: missing brief or lockedProduct');
      return;
    }

    setIsGeneratingStoryboard(true);
    setErrorMessage(null);

    try {
      const activeBrand = campaignBrand || selectedBrand;
      if (!activeBrand) {
        setErrorMessage('No brand selected');
        return;
      }

      const storyboardProducts = productUniverse?.products?.length ? productUniverse.products : [lockedProduct];
      const totalAssets = storyboardProducts.reduce((sum, p) => sum + p.productAssets.filter(a => !excludedAssetIds.includes(a.id)).length, 0);
      console.log('[BrandVideoCreator] Starting storyboard generation:', {
        product: lockedProduct.productTitle,
        platform,
        durationSec,
        executionMode,
        totalAssets,
        briefLength: briefText.length,
      });

      // Phase 1: Research trending ad patterns for this product + platform
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `trend_research_start_${Date.now().toString(36)}`,
          agentId: 'storyboard',
          timestamp: Date.now(),
          type: 'info',
          title: 'Researching trends...',
          content: `Analyzing trending ${platform.replace(/_/g, ' ')} ad patterns for "${lockedProduct.productTitle}"`,
          confidence: 0.9,
        },
      ].slice(-50));

      let trendResearch;
      try {
        trendResearch = await researchTrendingAdPatterns({
          productTitle: lockedProduct.productTitle,
          platform,
          objective,
          brief: (briefText || '').trim(),
        });
        console.log('[BrandVideoCreator] Trend research result:', trendResearch.summary ? 'got summary' : 'no summary');
      } catch (e) {
        console.warn('[BrandVideoCreator] Trend research failed, continuing without it:', e);
        trendResearch = { trendingFormats: [], viralHooks: [], pacingPatterns: [], contentStructures: [], platformSpecifics: '', summary: '' };
      }

      if (trendResearch.summary) {
        setLiveFindings((prev) => [
          ...prev,
          {
            id: `trend_research_done_${Date.now().toString(36)}`,
            agentId: 'storyboard',
            timestamp: Date.now(),
            type: 'info',
            title: 'Trend research complete',
            content: trendResearch.summary,
            confidence: 0.85,
          },
        ].slice(-50));
      }

      // Phase 2: Plan creative storyboard with trend research + all available images
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `storyboard_plan_start_${Date.now().toString(36)}`,
          agentId: 'storyboard',
          timestamp: Date.now(),
          type: 'info',
          title: 'Writing storyboard...',
          content: `Creating scenes for ${durationSec}s ${platform.replace(/_/g, ' ')} ad using ${totalAssets} available images`,
          confidence: 0.9,
        },
      ].slice(-50));

      console.log('[BrandVideoCreator] Calling planCreativeStoryboard...');
      const plan = await planCreativeStoryboard({
        brandName: lockedProduct.brandName,
        rawPrompt: (briefText || '').trim(),
        platform,
        objective,
        durationSec,
        executionMode,
        adFormat,
        products: storyboardProducts.map((product) => ({
          productId: product.productId,
          productTitle: product.productTitle,
          productUrl: product.productUrl,
          productFacts: product.productFacts,
          allowedClaims: product.allowedClaims,
          signalSummary: product.signalSummary,
          assets: product.productAssets
            .filter((asset) => !excludedAssetIds.includes(asset.id))
            .map((asset) => ({
              id: asset.id,
              description: asset.semanticDescription || asset.generationPrompt || asset.description || asset.sourceProductTitle || product.productTitle,
              verdict: asset.verdict,
              shotType: asset.shotType,
              quality: asset.quality,
            })),
        })),
        useWebResearch: executionMode === 'agency',
        audience: (audience || '').trim() || undefined,
        callToAction: (callToAction || '').trim() || undefined,
        tone: (tone || '').trim() || undefined,
        trendResearch,
      });

      console.log('[BrandVideoCreator] planCreativeStoryboard returned:', {
        sceneCount: plan.scenes?.length || 0,
        narrativeArc: plan.narrativeArc ? 'yes' : 'no',
        creativeRationale: plan.creativeRationale ? 'yes' : 'no',
      });

      if (!plan.scenes || plan.scenes.length === 0) {
        throw new Error('AI returned 0 scenes. Please try again with a more detailed brief.');
      }

      if (plan.narrativeArc) setNarrativeArc(plan.narrativeArc);
      if (plan.creativeRationale) setCreativeRationale(plan.creativeRationale);
      const ideas = buildStoryboardSceneStateFromStoryboard(plan.scenes, storyboardProducts, lockedProduct);
      console.log('[BrandVideoCreator] Built', ideas.length, 'scene ideas');
      setSceneIdeas(ideas);
      setSeededSceneProductId(
        productUniverse?.products?.length
          ? productUniverse.products.map((product) => product.productId).sort().join('|')
          : lockedProduct.productId
      );

      setLiveFindings((prev) => [
        ...prev,
        {
          id: `storyboard_done_${Date.now().toString(36)}`,
          agentId: 'storyboard',
          timestamp: Date.now(),
          type: 'info',
          title: 'Storyboard ready',
          content: `${ideas.length} scenes planned with images auto-assigned based on content fit.`,
          confidence: 0.95,
        },
      ].slice(-50));
    } catch (error: any) {
      console.error('[BrandVideoCreator] Storyboard generation failed:', error);
      setErrorMessage(error.message || 'Failed to generate storyboard');
    } finally {
      setIsGeneratingStoryboard(false);
    }
  }, [briefText, lockedProduct, campaignBrand, selectedBrand, productUniverse, platform, objective, durationSec, executionMode, adFormat, excludedAssetIds, audience, callToAction, tone]);

  const handleImportProduct = useCallback(async (productUrl: string) => {
    if (!productUrl.trim() || !selectedBrand) return;

    setIsResolvingProduct(true);
    setErrorMessage(null);
    setImportWarnings([]);
    setCurrentPhase('📦 Importing product...');
    setLiveFindings([]);
    setLockedProduct(null);
    setProductCandidates([]);
    setSceneIdeas([]);
    setExcludedAssetIds([]);

    try {
      const urls = parseProductImportUrls(productUrl);

      if (urls.length === 0) {
        setErrorMessage('No valid URLs detected. Try a domain like kageha.ca or a full https:// product URL.');
        return;
      }

      setCurrentPhase(`📦 Importing product shots from ${urls.length} URL${urls.length > 1 ? 's' : ''}...`);

      // Import from all URLs in parallel
      const results = await Promise.all(
        urls.map((url) =>
          importProductPageAssetsRich(url, selectedBrand.name, {
            executionMode,
            analyzeAssets: true,
          }).catch((err) => {
            console.warn(`[BrandVideoCreator] Import failed for ${url}:`, err);
            return { assets: [], productTitle: '', warnings: [err?.message || 'Import failed'], pageReachable: false, imageCount: 0 };
          }),
        ),
      );

      // Merge assets from all results, deduping by sourceUrl
      const seenKeys = new Set<string>();
      const allAssets: BrandAsset[] = [];
      const allWarnings: string[] = [];
      const productTitles: string[] = [];

      for (const result of results) {
        allWarnings.push(...result.warnings);
        if (result.productTitle) productTitles.push(result.productTitle);
        for (const asset of result.assets) {
          const key = asset.sourceUrl || `${asset.originPageUrl}::${asset.description}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            allAssets.push(asset);
          }
        }
      }

      // Prefer assets that downloaded successfully when merging multi-URL imports.
      allAssets.sort((a, b) => Number(Boolean(b.base64)) - Number(Boolean(a.base64)));

      if (allWarnings.length > 0) {
        setImportWarnings(Array.from(new Set(allWarnings)));
      }

      if (allAssets.length === 0) {
        const detail = allWarnings.length > 0
          ? allWarnings[0]
          : 'No product images were found on any of the provided pages.';
        setErrorMessage(detail);
        return;
      }

      // Use the first URL as the primary product, merge titles if multiple
      const primaryUrl = urls[0];
      const productTitle = productTitles[0] || titleFromProductUrl(primaryUrl);

      // Tag all imported assets with the primary URL so buildLockedProductContext
      // includes assets from every URL, not just the first one.
      const unifiedAssets = allAssets.map((asset) => ({
        ...asset,
        originPageUrl: primaryUrl,
      }));

      const mergedAssets = [...selectedBrand.assets, ...unifiedAssets];
      const mergedBrand: Brand = {
        ...selectedBrand,
        assets: mergedAssets,
      };
      setSelectedBrand(mergedBrand);

      const candidate: ProductResolutionCandidate = {
        productId: primaryUrl,
        productUrl: primaryUrl,
        productTitle,
        confidence: 999,
        source: 'explicit_url',
      };

      // Merge product knowledge (ingredients, claims) from all URLs into the primary
      if (urls.length > 1) {
        mergeProductKnowledge(primaryUrl, urls.slice(1));
      }

      const nextLockedProduct = buildLockedProductContext(mergedBrand, candidate, {
        platform,
        durationSec,
      });
      const nextProductUniverse = buildProductUniverse(mergedBrand, [candidate], {
        platform,
        durationSec,
      }, candidate.productId);

      setCampaignBrand(mergedBrand);
      setLockedProduct(nextLockedProduct);
      setProductUniverse(nextProductUniverse.products.length > 0 ? nextProductUniverse : {
        primaryProductId: nextLockedProduct.productId,
        products: [nextLockedProduct],
      });
      setProductCandidates([candidate]);

      setLiveFindings((prev) => [
        ...prev,
        {
          id: `product_import_${Date.now().toString(36)}`,
          agentId: 'product_import',
          timestamp: Date.now(),
          type: 'asset',
          title: `Imported ${productTitle}`,
          content: urls.length > 1
            ? `Imported ${allAssets.length} product assets from ${urls.length} URLs: ${urls.join(', ')}.`
            : `Imported ${allAssets.length} product assets from ${primaryUrl}.`,
          confidence: 0.92,
        },
      ].slice(-50));
    } catch (error: any) {
      console.error('[BrandVideoCreator] Product import failed:', error);
      setErrorMessage(error.message || 'Could not import the product.');
    } finally {
      setIsResolvingProduct(false);
    }
  }, [selectedBrand, executionMode, platform, durationSec, titleFromProductUrl]);

  const handleGenerateStudioImage = useCallback(async (
    prompt: string,
    route: SceneRoute,
    baseAssetId?: string,
    selectedConcept?: CreativeConcept | null,
    referenceAssetIds?: string[],
  ) => {
    if (!prompt.trim() || !lockedProduct) return;
    const effectiveBrand = campaignBrand || selectedBrand || null;

    setIsGeneratingStudioImage(true);
    setErrorMessage(null);

    try {
      const assetById = new Map(lockedProduct.productAssets.map((asset) => [asset.id, asset]));
      const baseAsset = (baseAssetId && baseAssetId.trim())
        ? assetById.get(baseAssetId)
        : undefined;
      const referenceAssets = (referenceAssetIds || [])
        .map((id) => assetById.get(id))
        .filter((asset): asset is BrandAsset => Boolean(asset));
      const latestBrand = effectiveBrand?.id ? (getBrand(effectiveBrand.id) || effectiveBrand) : effectiveBrand;
      const productionPrompt = buildAgencyProductionPrompt({
        userPrompt: prompt,
        brand: latestBrand,
        lockedProduct,
        selectedConcept,
      });

      const prepared = await prepareAgencyStudioGenerateRefs(route, baseAsset, referenceAssets);
      for (const hydrated of prepared.hydratedReferenceAssets) {
        patchLockedProductAsset(hydrated);
      }
      if (prepared.hydrationFailed) {
        setErrorMessage(
          'Could not load the selected image(s) for this route. Try other images, re-import the product, or use Generate Fresh with no selection.',
        );
        return;
      }

      const seeded = latestBrand
        ? seedAgencyStudioContext({ brand: latestBrand, lockedProduct })
        : null;
      const brandContext = seeded?.brandKnowledge
        ? `${seeded.brandKnowledge.brandName.value} — ${lockedProduct.productTitle}`
        : `${lockedProduct.brandName} - ${lockedProduct.productTitle}`;

      const result = await generateImageAsset({
        mode: prepared.mode,
        imagePrompt: productionPrompt,
        brandContext,
        primaryReference: prepared.primaryReference,
        references: prepared.references,
      });

      if (!result) {
        setErrorMessage('Image generation failed. Please try again.');
        return;
      }

      const sourceAssetIds = prepared.hydratedReferenceAssets.map((asset) => asset.id);
      const newAsset: BrandAsset = {
        id: `studio_asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'product',
        base64: result,
        mimeType: 'image/png',
        description: prompt,
        previewUrl: `data:image/png;base64,${result}`,
        originPageUrl: lockedProduct.productUrl,
        sourceProductTitle: lockedProduct.productTitle,
        generationPrompt: productionPrompt,
        sourceAssetIds: sourceAssetIds.length > 0 ? sourceAssetIds : undefined,
        derivedFromAssetId: sourceAssetIds[0],
        verdict: 'use_as_is',
        verdictReason: 'AI generated for storyboard use',
        shotType: 'packshot',
        quality: 'hero',
      };

      appendLockedProductAsset(newAsset);

      // Smart auto-assignment: find the best-matching scene for this new image
      const assignBestMatchingScene = () => {
        if (sceneIdeas.length === 0) return;

        const promptLower = prompt.toLowerCase();
        const promptWords = promptLower
          .replace(/[^a-z0-9\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 2);

        const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been', 'were', 'they', 'their', 'your', 'make', 'part', 'your', 'routine', 'effortless', 'key', 'copy', 'lines', 'strong', 'opening', 'frame', 'fast', 'vertical', 'viewing', 'close', 'crop', 'keep', 'product', 'recognizable', 'compose', 'described', 'scene', 'shop', 'final', 'hero', 'image']);

        const meaningfulWords = promptWords.filter(w => !stopWords.has(w));
        if (meaningfulWords.length === 0) return;

        let bestSceneId: string | null = null;
        let bestScore = 0;

        for (const scene of sceneIdeas) {
          const sceneText = `${scene.text} ${scene.visualDescription} ${scene.imagePrompt || ''}`.toLowerCase();
          let score = 0;
          for (const word of meaningfulWords) {
            if (sceneText.includes(word)) score += 1;
          }
          // Bonus for exact phrase matches
          const promptPhrases = promptLower.match(/\b\w{4,}\s+\w{4,}\b/g) || [];
          for (const phrase of promptPhrases) {
            if (sceneText.includes(phrase)) score += 3;
          }
          if (score > bestScore) {
            bestScore = score;
            bestSceneId = scene.id;
          }
        }

        // Only auto-assign if there's a meaningful match (at least 2 keyword hits or 1 phrase match)
        if (bestSceneId && bestScore >= 2) {
          handleAssignSceneBaseAsset(bestSceneId, newAsset.id, newAsset);
          setLiveFindings((prev) => [
            ...prev,
            {
              id: `auto_assign_${Date.now().toString(36)}`,
              agentId: 'image_studio',
              timestamp: Date.now(),
              type: 'info',
              title: 'Auto-assigned to scene',
              content: `Matched "${prompt.slice(0, 60)}..." to scene ${sceneIdeas.findIndex(s => s.id === bestSceneId) + 1} (score: ${bestScore})`,
              confidence: 0.85,
            },
          ].slice(-50));
        }
      };

      assignBestMatchingScene();

      setLiveFindings((prev) => [
        ...prev,
        {
          id: `studio_gen_${Date.now().toString(36)}`,
          agentId: 'image_studio',
          timestamp: Date.now(),
          type: 'asset',
          title: 'Generated new product image',
          content: `Created a new image: ${prompt.slice(0, 80)}...`,
          confidence: 0.95,
        },
      ].slice(-50));
    } catch (error: any) {
      console.error('[BrandVideoCreator] Studio image generation failed:', error);
      setErrorMessage(error.message || 'Failed to generate image');
    } finally {
      setIsGeneratingStudioImage(false);
    }
  }, [lockedProduct, selectedBrand, campaignBrand, appendLockedProductAsset, patchLockedProductAsset, setLiveFindings, sceneIdeas, handleAssignSceneBaseAsset]);

  const handleBulkGenerateFreshImages = useCallback(async () => {
    if (!lockedProduct || !selectedBrand) return;

    const isCarousel = adFormat === 'carousel';
    const isStaticImage = adFormat === 'static_image';
    const brandAesthetic = buildBrandAestheticContext(campaignBrand || selectedBrand);
    const visualIdentityLock = isCarousel ? buildCarouselVisualIdentityLock(campaignBrand || selectedBrand) : '';
    const effectiveBrand = campaignBrand || selectedBrand;
    const aspectRatio = isCarousel ? '1:1' : isStaticImage ? '4:5' : '9:16';

    // For carousel: ALL scenes need to be generated as slides with text overlay.
    // We don't skip scenes that already have a baseAssetId because the base asset
    // is the raw product image — the carousel slide still needs to be generated
    // with text baked in. We only skip scenes that already have a generated carousel
    // asset (i.e. they have a linkedAssetId from a previous bulk generation).
    // For other formats: only scenes explicitly marked as generate_fresh.
    const freshScenes = isCarousel
      ? sceneIdeas.filter((s) => !s.linkedAssetId)
      : sceneIdeas.filter((s) =>
        !s.baseAssetId &&
        (s.route === 'generate_fresh' || s.visualTask === 'generate_new'),
      );

    if (freshScenes.length === 0) {
      setErrorMessage('No scenes need fresh image generation. All scenes have assets assigned or use existing images.');
      return;
    }

    setIsBulkGenerating(true);
    setBulkGenerateProgress({ current: 0, total: freshScenes.length });
    setErrorMessage(null);

    // For carousel: use the Image Studio prompt writer to generate detailed,
    // Canva-style prompts with brand fonts, hex colors, and text placement per slide.
    // This reuses the same writePrompts() service that powers the AI Image Studio.
    let carouselSlides: { prompt: string; negativePrompt?: string; textElements: string[] }[] = [];
    if (isCarousel) {
      console.log('[BulkGen] Writing carousel prompts via promptWriterService...');
      try {
        const productAssets = lockedProduct.productAssets.filter(a => !excludedAssetIds.includes(a.id));
        const result = await writeCarouselPrompts(
          freshScenes,
          effectiveBrand,
          productAssets,
          lockedProduct.productTitle,
        );
        carouselSlides = result.slides.map(s => ({
          prompt: s.prompt,
          negativePrompt: s.negativePrompt,
          textElements: [
            s.canvaText?.heading || s.copy.headline || '',
            s.canvaText?.subtext || s.copy.supportingText || '',
            s.canvaText?.bodyText || '',
            s.canvaText?.footer || '',
          ].filter(Boolean),
        }));
        console.log(`[BulkGen] Got ${carouselSlides.length} carousel slide prompts from promptWriter`);
      } catch (e) {
        console.warn('[BulkGen] writeCarouselPrompts failed, using fallback prompts', e);
      }
    }

    // Resolve actual font names from brand DNA (used in fallback)
    const fonts = resolveFontFamily(effectiveBrand?.dna?.typography);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < freshScenes.length; i++) {
      const scene = freshScenes[i];
      setBulkGenerateProgress({ current: i + 1, total: freshScenes.length });

      try {
        const basePrompt = scene.imagePrompt || scene.visualDescription || scene.text;
        if (!basePrompt.trim()) {
          console.warn(`[BulkGen] Scene ${i + 1} has no prompt, skipping`);
          failCount++;
          continue;
        }

        const sceneIndex = sceneIdeas.indexOf(scene);

        // Find the best product asset to use as reference for this scene
        const productAssets = lockedProduct.productAssets.filter(a => !excludedAssetIds.includes(a.id));
        const referenceAsset = scene.baseAssetId
          ? productAssets.find(a => a.id === scene.baseAssetId)
          : productAssets.find(a => a.type === 'product' || a.type === 'lifestyle')
            || productAssets[0];

        const layout = isCarousel ? inferSlideLayout(sceneIndex, sceneIdeas.length) : 'cover';

        // Use the promptWriter-generated slide if available, otherwise fall back to manual
        const writerSlide = carouselSlides[i];
        const slideText: string[] = isCarousel
          ? (writerSlide?.textElements?.length ? writerSlide.textElements : [scene.text || ''])
          : [scene.text || ''];

        const promptParts: string[] = [];
        if (isCarousel && writerSlide?.prompt) {
          // promptWriterService produced a detailed 200-500 word prompt with:
          // - Canva-style text layout (heading, subtext, bodyText, footer)
          // - Brand font names (e.g. "Playfair Display", "Helvetica Neue")
          // - Brand colors with hex codes
          // - Exact text placement instructions
          promptParts.push(writerSlide.prompt);
          if (writerSlide.negativePrompt) promptParts.push(`NEGATIVE PROMPT (things to avoid): ${writerSlide.negativePrompt}`);
          if (visualIdentityLock) promptParts.push(visualIdentityLock);
          promptParts.push(`CAROUSEL SLIDE FORMAT: This is slide ${sceneIndex + 1} of ${sceneIdeas.length}. 1:1 square Instagram carousel.`);
        } else {
          // Fallback: manual prompt building
          promptParts.push(basePrompt);
          if (visualIdentityLock) promptParts.push(visualIdentityLock);
          if (brandAesthetic) promptParts.push(brandAesthetic);

          if (isCarousel) {
            const dna = effectiveBrand?.dna;
            const colorDirective = dna?.colors?.primary
              ? `Use brand color ${dna.colors.primary} for text and accents. Background elements should draw from: ${dna.colors.palette?.join(', ') || dna.colors.primary}.`
              : '';
            const fontDirective = `Text font: Use "${fonts.heading}" for headlines (bold, large) and "${fonts.body}" for body text. High contrast, legible at mobile size.`;

            const headline = slideText[0] || '';
            const body = slideText[1] || '';

            const layoutDirectives: Record<string, string> = {
              hook: `SLIDE ROLE: HOOK (slide ${sceneIndex + 1} of ${sceneIdeas.length}). This is the first slide — make it scroll-stopping. Render the headline "${headline}" prominently at the top third of the image in large bold ${fonts.heading} font. Dark gradient overlay at top for text readability.`,
              value: `SLIDE ROLE: VALUE (slide ${sceneIndex + 1} of ${sceneIdeas.length}). Render headline "${headline}" at top in ${fonts.heading} font. ${body ? `Render body text "${body}" at bottom in ${fonts.body} font with a dark gradient overlay.` : 'Clean negative space at bottom.'} The product should be the visual hero in the center.`,
              cta: `SLIDE ROLE: CTA (slide ${sceneIndex + 1} of ${sceneIdeas.length}). This is the final slide. Render "${headline}" centered in ${fonts.heading} font. Add a subtle "Shop now" badge at bottom. Full dark overlay for maximum text contrast.`,
              cover: `SLIDE ROLE: COVER (slide ${sceneIndex + 1} of ${sceneIdeas.length}). Render headline "${headline}" at top in ${fonts.heading} font. ${body ? `Render body text "${body}" below headline in ${fonts.body} font.` : ''} Product hero in center.`,
            };

            promptParts.push(`CAROUSEL SLIDE FORMAT: This is a 1:1 square Instagram carousel slide.`);
            promptParts.push(layoutDirectives[layout] || layoutDirectives.value);
            promptParts.push(`${colorDirective} ${fontDirective}`);
            promptParts.push(`Render the exact text specified above on the image. Text must be crisp, legible, and styled to match the brand. Do NOT add any other text, watermarks, or captions.`);
          } else if (isStaticImage) {
            promptParts.push('STATIC IMAGE AD: This is a single 4:5 hero image for Instagram Feed. Maximum visual impact, one powerful composition.');
            if (slideText[0]) {
              promptParts.push(`Render this text on the image: "${slideText[0]}". Place it in a high-contrast zone with a subtle dark gradient behind it.`);
            }
          }
        }

        const prompt = promptParts.join('\n\n');

        // Build the text that Gemini is allowed to render on the image
        const allowedOnImageText = isCarousel ? slideText.filter(Boolean) : (slideText[0] ? [slideText[0]] : undefined);

        // Fetch reference image as base64 for edit mode (CORS → Jina, then persist)
        const fetchImageAsBase64 = async (asset: BrandAsset): Promise<{ data: string; mimeType: string } | null> => {
          const hadBase64 = Boolean(asset.base64);
          const hydrated = await hydrateBrandAssetBase64(asset);
          if (!hydrated.base64) return null;
          if (!hadBase64) {
            patchLockedProductAsset(hydrated);
          }
          return { data: hydrated.base64, mimeType: hydrated.mimeType || 'image/jpeg' };
        };

        // Use edit mode with product image as reference, or generate mode as fallback
        let primaryReference: { data: string; mimeType: string } | undefined;
        let genMode: 'generate' | 'edit' = 'generate';

        if (referenceAsset) {
          console.log(`[BulkGen] Scene ${i + 1}: Found reference asset ${referenceAsset.id} (base64: ${!!referenceAsset.base64}, previewUrl: ${!!referenceAsset.previewUrl})`);
          const imgData = await fetchImageAsBase64(referenceAsset);
          if (imgData) {
            primaryReference = imgData;
            genMode = 'edit';
            console.log(`[BulkGen] Scene ${i + 1}: Using EDIT mode with product image (${imgData.data.length} chars base64)`);
          } else {
            console.warn(`[BulkGen] Scene ${i + 1}: Could not fetch reference image, falling back to GENERATE mode`);
          }
        } else {
          console.warn(`[BulkGen] Scene ${i + 1}: No reference asset found, using GENERATE mode`);
        }

        console.log(`[BulkGen] Scene ${i + 1}: allowedOnImageText =`, allowedOnImageText);
        console.log(`[BulkGen] Scene ${i + 1}: prompt length = ${prompt.length} chars`);

        const result = await generateImageAsset({
          mode: genMode,
          imagePrompt: prompt,
          visualDescription: scene.visualDescription,
          brandContext: `${effectiveBrand?.name || lockedProduct.brandName} - ${lockedProduct.productTitle}`,
          aspectRatio,
          primaryReference,
          allowedOnImageText,
        });

        if (!result) {
          console.warn(`[BulkGen] Scene ${i + 1} generation returned null`);
          failCount++;
          continue;
        }

        // Gemini renders text directly on the image — no canvas overlay needed
        const finalBase64 = result;
        const finalPreviewUrl = result.startsWith('data:') ? result : `data:image/png;base64,${result}`;

        const newAsset: BrandAsset = {
          id: `bulk_asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'product',
          base64: finalBase64,
          mimeType: 'image/png',
          description: prompt,
          previewUrl: finalPreviewUrl,
          originPageUrl: lockedProduct.productUrl,
          sourceProductTitle: lockedProduct.productTitle,
          generationPrompt: prompt,
          verdict: 'use_as_is',
          verdictReason: 'AI generated for storyboard scene',
          shotType: 'packshot',
          quality: 'hero',
        };

        appendLockedProductAsset(newAsset);
        handleAssignSceneBaseAsset(scene.id, newAsset.id, newAsset);
        // Mark scene as having a generated carousel asset so it's skipped on re-runs
        setSceneIdeas((prev) => prev.map((idea) => idea.id === scene.id ? {
          ...idea,
          linkedAssetId: newAsset.id,
          linkedAssetDescription: `Carousel slide ${i + 1}`,
        } : idea));
        successCount++;

        setLiveFindings((prev) => [
          ...prev,
          {
            id: `bulk_gen_${i}_${Date.now().toString(36)}`,
            agentId: 'bulk_image_gen',
            timestamp: Date.now(),
            type: 'asset',
            title: `Generated image ${i + 1}/${freshScenes.length}`,
            content: `Scene ${sceneIdeas.findIndex(s => s.id === scene.id) + 1}: ${prompt.slice(0, 60)}...`,
            confidence: 0.95,
          },
        ].slice(-50));
      } catch (error: any) {
        console.error(`[BulkGen] Scene ${i + 1} failed:`, error);
        failCount++;
      }
    }

    setLiveFindings((prev) => [
      ...prev,
      {
        id: `bulk_gen_summary_${Date.now().toString(36)}`,
        agentId: 'bulk_image_gen',
        timestamp: Date.now(),
        type: 'info',
        title: `Bulk generation complete: ${successCount} success, ${failCount} failed`,
        content: `Generated ${successCount} fresh images for scenes that needed them.`,
        confidence: 0.9,
      },
    ].slice(-50));

    setBulkGenerateProgress(null);
    setIsBulkGenerating(false);
  }, [lockedProduct, selectedBrand, campaignBrand, adFormat, sceneIdeas, appendLockedProductAsset, patchLockedProductAsset, handleAssignSceneBaseAsset, setLiveFindings, setSceneIdeas]);

  // Fallback: keyword-based scene matching when Gemini is unavailable
  const fallbackKeywordAssign = (
    fileName: string,
    asset: BrandAsset,
    scenes: typeof sceneIdeas,
    assignFn: typeof handleAssignSceneBaseAsset,
    setFindings: typeof setLiveFindings,
  ) => {
    if (scenes.length === 0) return;
    const name = fileName.toLowerCase().replace(/\.[^.]+$/, '');
    const terms = name.replace(/[^a-z0-9\s_-]/g, '').split(/[\s_-]+/).filter(w => w.length > 2);
    const stops = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'been', 'were', 'they', 'their', 'your', 'make', 'part', 'routine', 'effortless', 'key', 'copy', 'lines', 'strong', 'opening', 'frame', 'fast', 'vertical', 'viewing', 'close', 'crop', 'keep', 'product', 'recognizable', 'compose', 'described', 'scene', 'shop', 'final', 'hero', 'image', 'uploaded', 'photo', 'picture']);
    const keywords = terms.filter(w => !stops.has(w));
    if (keywords.length === 0) return;

    let bestId: string | null = null;
    let bestScore = 0;
    for (const scene of scenes) {
      const txt = `${scene.text} ${scene.visualDescription} ${scene.imagePrompt || ''}`.toLowerCase();
      let score = 0;
      for (const w of keywords) { if (txt.includes(w)) score += 1; }
      if (score > bestScore) { bestScore = score; bestId = scene.id; }
    }
    if (bestId && bestScore >= 1) {
      assignFn(bestId, asset.id, asset);
    }
    setFindings((prev) => [
      ...prev,
      {
        id: `upload_kw_${Date.now().toString(36)}`,
        agentId: 'image_studio',
        timestamp: Date.now(),
        type: 'asset',
        title: `Uploaded: ${fileName}`,
        content: `Added to asset library${bestId ? ' (keyword-matched to scene)' : ''}.`,
        confidence: 0.7,
      },
    ].slice(-50));
  };

  const handleUploadStudioImage = useCallback((file: File) => {
    if (!lockedProduct) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string).split(',')[1];
      const newAsset: BrandAsset = {
        id: `uploaded_asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'product',
        base64,
        mimeType: file.type || 'image/jpeg',
        description: file.name,
        originPageUrl: lockedProduct.productUrl,
        sourceProductTitle: lockedProduct.productTitle,
        verdict: 'use_as_is',
        verdictReason: 'User uploaded image',
        shotType: 'packshot',
        quality: 'hero',
      };

// Optionally analyze with Gemini Vision to get a better description (but no scene assignment)
       if (hasConfiguredGeminiApiKey()) {
         try {
           const result = await analyzeUploadedImageForScenes({
             imageBase64: base64,
             imageMimeType: file.type || 'image/jpeg',
             fileName: file.name,
             scenes: [], // Empty — no scene matching, just image analysis
             brief: briefText || '',
             productTitle: lockedProduct.productTitle,
             platform,
           });
           if (result.analysis?.description) {
             newAsset.description = result.analysis.description;
             newAsset.semanticDescription = result.analysis.suggestedVisualDescription;
           }
         } catch {
           // Analysis is optional — silently fall back to filename
         }
       }

      appendLockedProductAsset(newAsset);
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `upload_${Date.now().toString(36)}`,
          agentId: 'image_studio',
          timestamp: Date.now(),
          type: 'asset',
          title: `Uploaded: ${file.name}`,
          content: newAsset.semanticDescription
            ? `Added: "${newAsset.description}" — will be considered for scene assignment when you generate the storyboard.`
            : `Added image to library — will be considered for scene assignment when you generate the storyboard.`,
          confidence: 0.9,
        },
      ].slice(-50));
    };
    reader.readAsDataURL(file);
  }, [lockedProduct, appendLockedProductAsset, setLiveFindings]);

  const handleEnhancePrompt = useCallback(async (rawPrompt: string, route: SceneRoute, baseAssetId?: string) => {
    if (!rawPrompt.trim() || !lockedProduct) return rawPrompt;

    setIsEnhancingPrompt(true);
    try {
      const baseAsset = (baseAssetId && baseAssetId.trim())
        ? lockedProduct.productAssets.find(a => a.id === baseAssetId)
        : undefined;

      let baseImageBase64: string | undefined;
      let baseImageMimeType: string | undefined;

      if (baseAsset) {
        const hadBase64 = Boolean(baseAsset.base64);
        const hydrated = await hydrateBrandAssetBase64(baseAsset);
        if (hydrated.base64) {
          baseImageBase64 = hydrated.base64;
          baseImageMimeType = hydrated.mimeType || 'image/jpeg';
          if (!hadBase64) {
            patchLockedProductAsset(hydrated);
          }
        }
      }

      const enhanced = await enhanceImagePrompt({
        rawPrompt,
        productTitle: lockedProduct.productTitle,
        brandName: lockedProduct.brandName,
        route,
        baseImageDescription: baseAsset?.description || undefined,
        baseImageBase64,
        baseImageMimeType,
      });

      return enhanced.enhancedPrompt || rawPrompt;
    } catch (error) {
      console.warn('[BrandVideoCreator] Prompt enhancement failed:', error);
      return rawPrompt;
    } finally {
      setIsEnhancingPrompt(false);
    }
  }, [lockedProduct, patchLockedProductAsset]);


  const handleRewriteScene = useCallback(async (ideaId: string) => {
    const scene = sceneIdeas.find((s) => s.id === ideaId);
    if (!scene || !lockedProduct) return;

    setIsRewritingScene(true);
    try {
      const baseAsset = scene.baseAssetId
        ? lockedProduct.productAssets.find((a) => a.id === scene.baseAssetId)
        : undefined;

      let baseImageBase64: string | undefined;
      let baseImageMimeType: string | undefined;

      if (baseAsset) {
        const hadBase64 = Boolean(baseAsset.base64);
        const hydrated = await hydrateBrandAssetBase64(baseAsset);
        if (hydrated.base64) {
          baseImageBase64 = hydrated.base64;
          baseImageMimeType = hydrated.mimeType || 'image/jpeg';
          if (!hadBase64) {
            patchLockedProductAsset(hydrated);
          }
        }
      }

      const enhanced = await enhanceImagePrompt({
        rawPrompt: scene.imagePrompt || scene.visualDescription || scene.text,
        productTitle: lockedProduct.productTitle,
        brandName: lockedProduct.brandName,
        route: scene.route || 'generate_fresh',
        baseImageDescription: baseAsset?.description || undefined,
        baseImageBase64,
        baseImageMimeType,
      });

      if (enhanced.enhancedPrompt) {
        handleUpdateSceneIdea(ideaId, { imagePrompt: enhanced.enhancedPrompt });
      }
    } catch (error) {
      console.warn('[BrandVideoCreator] Scene rewrite failed:', error);
    } finally {
      setIsRewritingScene(false);
    }
  }, [sceneIdeas, lockedProduct, handleUpdateSceneIdea, patchLockedProductAsset]);

  const handleCarouselComplete = useCallback(() => {
    if (!lockedProduct || !selectedBrand) return;
    const effectiveBrand = campaignBrand || selectedBrand;

    // Build a minimal AdConcept from the existing storyboard scenes.
    // The carousel slides are already generated — no agent orchestrator needed.
    const scenes: AdScene[] = plannedSceneIdeas.map((idea, index) => ({
      sceneNumber: index + 1,
      visualDescription: idea.visualDescription || '',
      imagePrompt: idea.imagePrompt || '',
      onScreenText: idea.text || '',
      directorsNote: idea.directorsNote,
      brandAssetRef: idea.baseAssetId,
      brandAssetEditAction: 'use_as_is' as const,
      slideHeadline: idea.text || '',
    }));

    const concept: AdConcept = {
      title: `${lockedProduct.productTitle} Carousel`,
      adFormat: 'carousel',
      hook: plannedSceneIdeas[0]?.text || '',
      narrative: plannedSceneIdeas.map((s, i) => `Slide ${i + 1}: ${s.text}`).join(' → '),
      scenes,
      musicDirection: '',
      captionStyle: effectiveBrand?.dna?.brandVoice?.tone || '',
      colorMood: effectiveBrand?.dna?.colors?.primary || '',
      estimatedDuration: 0,
      creativeRationale: `${plannedSceneIdeas.length}-slide Instagram carousel for ${lockedProduct.productTitle}`,
    };

    const campaignProductContext = buildCombinedCampaignProductContext(
      lockedProduct, productUniverse, plannedSceneIdeas, excludedAssetIds,
    );

    const blueprint: CampaignBlueprint = {
      brief: {
        rawPrompt: (briefText || '').trim(),
        adFormat: 'carousel',
        platform,
        objective,
        durationSec,
        executionMode,
        audience: (audience || '').trim() || undefined,
        callToAction: (callToAction || '').trim() || undefined,
        productUrl: campaignProductContext?.productUrl || effectiveBrand?.websiteUrl,
        productContext: campaignProductContext || undefined,
      },
      productContext: campaignProductContext || null,
      concept,
      brandMemory: effectiveBrand?.brandMemory || null,
      sceneContracts: [],
      renderManifest: null,
      reviewHistory: [],
    };

    setFinalConcept(concept);
    setCampaignBlueprint(blueprint);
    setReviewHistory([]);
    setStep('concept_review');
  }, [lockedProduct, selectedBrand, campaignBrand, plannedSceneIdeas, briefText, platform, objective, durationSec, executionMode, audience, callToAction, productUniverse, excludedAssetIds]);

  const handleStartCampaign = useCallback(async () => {
    if (!(briefText || '').trim() || !lockedProduct) return;

    setStep('agents_working');
    setIsRunning(true);
    setErrorMessage(null);
    setAgentStates([]);
    setLiveFindings([]);
    setCurrentPhase('Initializing...');
    setCurrentIteration(0);
    setFinalConcept(null);
    setCampaignBlueprint(null);
    setReviewHistory([]);
    const orchestrator = new AgentOrchestrator();
    orchestratorRef.current = orchestrator;
    const activeBrand = campaignBrand || selectedBrand;
    const campaignProductContext = buildCombinedCampaignProductContext(
      lockedProduct,
      productUniverse,
      plannedSceneIdeas,
      excludedAssetIds,
    );

    // Subscribe to events
    orchestrator.onEvent((event: OrchestratorEvent) => {
      switch (event.type) {
        case 'agent_spawned':
        case 'child_spawned': {
          const agent = event.type === 'agent_spawned' ? event.agent : (event as any).child;
          setAgentStates(prev => {
            const exists = prev.find(a => a.id === agent.id);
            if (exists) return prev;
            return [...prev, agent];
          });
          break;
        }
        case 'agent_updated':
          setAgentStates(prev =>
            prev.map(a => (a.id === event.agentId ? { ...a, ...event.updates } : a))
          );
          break;
        case 'agent_completed':
          setAgentStates(prev =>
            prev.map(a =>
              a.id === event.agentId ? { ...a, status: 'complete' as const, progress: 100 } : a
            )
          );
          break;
        case 'finding_added':
          setLiveFindings(prev => [...prev, event.finding].slice(-50)); // Keep last 50
          break;
        case 'phase_changed':
          setCurrentPhase(event.description);
          break;
        case 'iteration_started':
          setCurrentIteration(event.iteration);
          break;
        case 'campaign_complete':
          setFinalConcept(event.concept);
          if (event.concept.narrativeArc) setNarrativeArc(event.concept.narrativeArc);
          if (event.concept.creativeRationale) setCreativeRationale(event.concept.creativeRationale);
          // Stay on agents_working until the blueprint (incl. renderManifest) is assembled below.
          setIsRunning(false);
          break;
        case 'error':
          console.error('[BrandVideoCreator] Agent error:', event.error);
          setErrorMessage(event.error);
          break;
      }
    });

    try {
      const preferredSceneDirections = plannedSceneIdeas.map((idea, index) =>
        `${index + 1}. ${idea.text}\nAssigned product: ${idea.productTitle || lockedProduct.productTitle}\nVisual intent: ${idea.visualDescription}\nImage direction: ${idea.imagePrompt}${idea.baseAssetDescription ? `\nBase asset: ${idea.baseAssetDescription}` : ''}${idea.linkedAssetDescription ? `\nSelected generated variant: ${idea.linkedAssetDescription}` : ''}${idea.variants && idea.variants.length > 1 ? `\nAvailable generated variants: ${idea.variants.length}` : ''}\nSuggested sequence position: ${idea.suggestedPosition}`
      );
      const preferredScenes = plannedSceneIdeas.map((idea, index) => {
        const boundAssetId = idea.selectedVariantAssetId || idea.linkedAssetId || idea.baseAssetId;
        const isFresh = (idea.route === 'generate_fresh' || idea.visualTask === 'generate_new' || idea.sourceMode === 'generate_fresh')
          && !idea.selectedVariantAssetId
          && !idea.linkedAssetId;
        return {
          sceneNumber: index + 1,
          text: idea.text,
          visualDescription: idea.visualDescription,
          imagePrompt: idea.imagePrompt,
          durationSec: idea.durationSec,
          motionMode: idea.motionMode || 'still',
          productId: idea.productId,
          productTitle: idea.productTitle,
          // Fresh scenes stay unbound until a generated variant exists — no random catalog id.
          assetId: isFresh ? undefined : boundAssetId,
          assetDescription: isFresh
            ? undefined
            : (idea.linkedAssetDescription || idea.baseAssetDescription),
          sourceMode: idea.selectedVariantAssetId || idea.linkedAssetId
            ? 'edit_from_asset' as const
            : isFresh
              ? 'generate_fresh' as const
              : idea.sourceMode || (idea.baseAssetId ? 'crop_reframe_asset' as const : 'generate_fresh' as const),
        };
      });
      const campaignBrief: CampaignBrief = {
        rawPrompt: [
          (briefText || '').trim(),
          revisionNote.trim()
            ? `REVISION FEEDBACK FROM PREVIOUS RUN:\n${revisionNote.trim()}\nAddress this feedback in the new version.`
            : undefined,
          productAssetHistory.length > 0
            ? `Local product asset memory:\n${productAssetHistorySummary}`
            : undefined,
          preferredSceneDirections.length > 0
            ? `Preferred scene directions for this locked product:\n${preferredSceneDirections.join('\n\n')}`
            : undefined,
        ].filter(Boolean).join('\n\n'),
        adFormat,
        platform,
        objective,
        durationSec,
        executionMode,
        plannerModel,
            audience: (audience || '').trim() || undefined,
            callToAction: (callToAction || '').trim() || undefined,
            productUrl: campaignProductContext.productUrl,
            productContext: campaignProductContext,
            preferredScenes,
            constraints: [
          `Respect ${durationSec}s runtime.`,
          productUniverse && productUniverse.products.length > 1
            ? 'Use only the approved product universe for this campaign and keep each scene tied to its assigned product.'
            : 'Use only the locked product for this campaign.',
          activeBrand ? 'Use the locked product assets whenever they are relevant to the scene.' : 'Infer brand context from the prompt.',
          ...(productAssetHistory.length > 0
            ? ['Prefer previously created local product assets before inventing net-new visuals.']
            : []),
          ...(preferredSceneDirections.length > 0
            ? ['Treat the preferred scene directions as high-priority guidance while preserving the exact locked product identity in every product-visible scene.']
            : []),
        ],
      };

      const concept = await orchestrator.runCampaign(campaignBrief, activeBrand || undefined);
      if (concept) {
        setErrorMessage(null);
        const isVideoAd = campaignBrief.adFormat !== 'carousel' && campaignBrief.adFormat !== 'static_image';
        const artifacts = isVideoAd
          ? ensureVideoRenderArtifacts({
              concept,
              brief: campaignBrief,
              brand: activeBrand,
              sceneContracts: orchestrator.context.sceneContracts,
              renderManifest: orchestrator.context.renderManifest,
              reviewHistory: orchestrator.context.reviewHistory,
            })
          : {
              sceneContracts: orchestrator.context.sceneContracts,
              renderManifest: null as null,
            };
        const nextBlueprint = buildCampaignBlueprint({
          brief: campaignBrief,
          productContext: campaignProductContext,
          concept,
          brandMemory: orchestrator.context.brandMemory,
          sceneContracts: artifacts.sceneContracts,
          renderManifest: artifacts.renderManifest,
          reviewHistory: orchestrator.context.reviewHistory,
        });
        setFinalConcept(concept);
        setReviewHistory(orchestrator.context.reviewHistory);
        setCampaignBlueprint(nextBlueprint);
        if (activeBrand && orchestrator.context.brandMemory) {
          const updatedBrand = updateBrandMemory(activeBrand.id, orchestrator.context.brandMemory);
          if (updatedBrand) {
            const nextBrands = getBrands(userId);
            setBrands(nextBrands);
            const refreshedBrand = nextBrands.find((brand) => brand.id === activeBrand.id);
            if (refreshedBrand) {
              setSelectedBrand(refreshedBrand);
            }
          }
        }
        setStep('concept_review');
      } else {
        const failedAgents = orchestrator.allAgentStates.filter((a) => a.status === 'error');
        const agentHint = failedAgents.length > 0
          ? ` Failed agents: ${failedAgents.map((a) => a.goal || a.id).slice(0, 3).join('; ')}.`
          : '';
        setErrorMessage(
          `The agency failed to complete the mission.${agentHint} Retry Create, adjust the brief, or check your connection.`,
        );
        setCurrentPhase('Execution failed — no ad concept was produced');
      }
    } catch (error: any) {
      console.error('[BrandVideoCreator] Campaign failed:', error);
      setErrorMessage(error.message || 'An unexpected error occurred.');
    } finally {
      setIsRunning(false);
    }
  }, [audience, briefText, callToAction, campaignBrand, durationSec, executionMode, plannerModel, excludedAssetIds, lockedProduct, objective, plannedSceneIdeas, platform, productAssetHistory.length, productAssetHistorySummary, productUniverse, selectedBrand, userId]);

  const handleStopCampaign = () => {
    orchestratorRef.current?.stop();
    setIsRunning(false);
    setErrorMessage((prev) => prev || 'Campaign stopped before a complete concept was ready. Retry Create, or go back to the storyboard.');
    setCurrentPhase((prev) => (prev?.startsWith('🛑') ? prev : `🛑 Stopped — ${prev || 'agents halted'}`));
  };


  const handleApproveConcept = () => {
    const effectiveBrand = campaignBrand || selectedBrand;
    const campaignProductContext = lockedProduct
      ? buildCombinedCampaignProductContext(lockedProduct, productUniverse, plannedSceneIdeas, excludedAssetIds)
      : null;
    if (onConceptApproved && finalConcept) {
      const preferredScenes = plannedSceneIdeas.map((idea, index) => ({
        sceneNumber: index + 1,
        text: idea.text,
        visualDescription: idea.visualDescription,
        imagePrompt: idea.imagePrompt,
        durationSec: idea.durationSec,
        motionMode: idea.motionMode || 'still' as const,
        productId: idea.productId,
        productTitle: idea.productTitle,
        assetId: idea.selectedVariantAssetId || idea.linkedAssetId || idea.baseAssetId,
        assetDescription: idea.linkedAssetDescription || idea.baseAssetDescription,
        sourceMode: idea.sourceMode,
      }));
      const brief = {
        ...(campaignBlueprint?.brief || {
          rawPrompt: (briefText || '').trim(),
          adFormat,
          platform,
          objective,
          durationSec,
          executionMode,
          audience: (audience || '').trim() || undefined,
          callToAction: (callToAction || '').trim() || undefined,
          productUrl: campaignProductContext?.productUrl || effectiveBrand?.websiteUrl,
          productContext: campaignProductContext || undefined,
        }),
        plannerModel,
        preferredScenes: campaignBlueprint?.brief?.preferredScenes?.length
          ? campaignBlueprint.brief.preferredScenes
          : preferredScenes,
      };
      const isVideoAd = brief.adFormat !== 'carousel' && brief.adFormat !== 'static_image';
      const productUrl = brief.productUrl || campaignProductContext?.productUrl || effectiveBrand?.websiteUrl;
      if (isVideoAd && !productUrl) {
        setErrorMessage('Add a product URL before opening Ad Agent — production needs the product page.');
        return;
      }
      const conceptWithMotion: AdConcept = {
        ...finalConcept,
        scenes: finalConcept.scenes.map((scene, index) => ({
          ...scene,
          durationSec: plannedSceneIdeas[index]?.durationSec || scene.durationSec,
          motionMode: plannedSceneIdeas[index]?.motionMode || scene.motionMode || 'still',
        })),
      };
      let sceneContracts = campaignBlueprint?.sceneContracts || [];
      let renderManifest = campaignBlueprint?.renderManifest || null;
      if (isVideoAd) {
        const artifacts = ensureVideoRenderArtifacts({
          concept: conceptWithMotion,
          brief,
          brand: effectiveBrand,
          sceneContracts,
          renderManifest,
          reviewHistory: campaignBlueprint?.reviewHistory || reviewHistory,
        });
        sceneContracts = artifacts.sceneContracts;
        // User confirmation clears remaining readiness blockers for the Ad Agent handoff.
        renderManifest = markRenderManifestReady(artifacts.renderManifest);
      } else {
        sceneContracts = [];
        renderManifest = null;
      }
      onConceptApproved(
        buildCampaignBlueprint({
          brief: { ...brief, productUrl: productUrl || brief.productUrl },
          productContext: campaignProductContext || campaignBlueprint?.productContext || undefined,
          concept: conceptWithMotion,
          brandMemory: campaignBlueprint?.brandMemory || effectiveBrand?.brandMemory || null,
          sceneContracts,
          renderManifest,
          reviewHistory: campaignBlueprint?.reviewHistory || reviewHistory,
        }),
        effectiveBrand,
      );
    }
  };

  // === RENDER ===

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-dark-bg/80 border-b border-dark-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (step === 'brand_hub') {
                  onBack();
                } else {
                  const prevMap: Record<string, string> = {
                    product_import: 'brand_hub',
                    image_studio: 'product_import',
                    storyboard: 'image_studio',
                    agents_working: 'storyboard',
                    concept_review: 'storyboard',
                  };
                  setStep(prevMap[step] || 'brand_hub');
                }
              }}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center text-xl">
                🏢
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Brand Ad Agency</h1>
                <p className="text-xs text-gray-400">
                  {step === 'brand_hub' && 'Curate brand → concept (production lives in Agent Hub)'}
                  {step === 'product_import' && 'Import and lock your product'}
                  {step === 'image_studio' && 'Curate product images'}
                  {step === 'storyboard' && 'Plan your storyboard'}
                  {step === 'agents_working' && currentPhase}
                  {step === 'concept_review' && 'Approve concept before production'}
                </p>
              </div>
            </div>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center gap-1">
            {[
              { key: 'brand_hub', label: 'Brand', icon: '🏷️' },
              { key: 'product_import', label: 'Product', icon: '📦' },
              { key: 'image_studio', label: 'Images', icon: '🖼️' },
              { key: 'storyboard', label: 'Story', icon: '🎬' },
              { key: 'agents_working', label: 'Create', icon: '⚡' },
              { key: 'concept_review', label: 'Review', icon: '✅' },
            ].map((s, i) => {
              const steps = ['brand_hub', 'product_import', 'image_studio', 'storyboard', 'agents_working', 'concept_review'];
              const currentIdx = steps.indexOf(step);
              const isActive = s.key === step;
              const isCompleted = currentIdx > i;
              return (
                <React.Fragment key={s.key}>
                  <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all duration-300 ${
                    isActive ? 'bg-purple-500/20 border border-purple-500/40' :
                    isCompleted ? 'bg-green-500/10 border border-green-500/20' :
                    'border border-transparent'
                  }`}>
                    <span className={`text-xs ${
                      isActive ? '' : isCompleted ? 'opacity-60' : 'opacity-30'
                    }`}>{isCompleted ? '✓' : s.icon}</span>
                    <span className={`text-[10px] font-medium ${
                      isActive ? 'text-purple-300' :
                      isCompleted ? 'text-green-400' : 'text-gray-500'
                    }`}>{s.label}</span>
                  </div>
                  {i < 5 && <div className={`w-6 h-px ${isCompleted ? 'bg-green-500/40' : 'bg-gray-700'}`} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {step === 'brand_hub' && (
          <BrandHubScreen
            brands={brands.filter((brand) => !isBriefOnlyBrand(brand))}
            showAddBrand={showAddBrand}
            setShowAddBrand={setShowAddBrand}
            newBrandName={newBrandName}
            setNewBrandName={setNewBrandName}
            newBrandUrl={newBrandUrl}
            setNewBrandUrl={setNewBrandUrl}
            newBrandIg={newBrandIg}
            setNewBrandIg={setNewBrandIg}
            onAddBrand={handleAddBrand}
            onSelectBrand={handleSelectBrand}
            onDeleteBrand={handleDeleteBrand}
            onSkipBrand={handleSkipBrand}
            onCancelAddBrand={() => {
              setShowAddBrand(false);
              setNewBrandName('');
              setNewBrandUrl('');
              setNewBrandIg('');
            }}
          />
        )}

        {step === 'product_import' && (
          <ProductImportScreen
            brand={selectedBrand}
            productUrl={productUrl}
            setProductUrl={setProductUrl}
            lockedProduct={lockedProduct}
            isImporting={isResolvingProduct}
            importWarnings={importWarnings}
            importError={errorMessage}
            onImport={(url) => handleImportProduct(url)}
            onBack={() => {
              setProductUrl('');
              setLockedProduct(null);
              setProductCandidates([]);
              setImportWarnings([]);
              setErrorMessage(null);
              setStep('brand_hub');
            }}
            onNext={() => {
              if (!lockedProduct?.productAssets?.length) {
                setErrorMessage('Import at least one product image before continuing to Images.');
                return;
              }
              setStep('image_studio');
            }}
          />
        )}

        {step === 'image_studio' && (
          <AgencyImageStudioPanel
            lockedProduct={lockedProduct}
            brand={campaignBrand || selectedBrand}
            excludedAssetIds={excludedAssetIds}
            selectedAssetId={studioSelectedAssetId}
            setSelectedAssetId={setStudioSelectedAssetId}
            onToggleAssetExcluded={handleToggleAssetExcluded}
            toAssetPreviewUrl={toAssetPreviewUrl}
            onGenerateImage={handleGenerateStudioImage}
            isGenerating={isGeneratingStudioImage}
            onEnhancePrompt={handleEnhancePrompt}
            isEnhancing={isEnhancingPrompt}
            onUploadImage={handleUploadStudioImage}
            onBack={() => setStep('product_import')}
            onNext={() => setStep('storyboard')}
            briefText={briefText}
            onBrandUpdated={(brand) => {
              setSelectedBrand((prev) => (prev?.id === brand.id ? brand : prev));
              setCampaignBrand((prev) => (prev?.id === brand.id ? brand : prev));
              setBrands((prev) => {
                const idx = prev.findIndex((b) => b.id === brand.id);
                if (idx < 0) return prev;
                const next = [...prev];
                next[idx] = brand;
                return next;
              });
            }}
          />
        )}

        {step === 'storyboard' && (
          <StoryboardScreen
            platform={platform}
            setPlatform={setPlatform}
            adFormat={adFormat}
            setAdFormat={setAdFormat}
            objective={objective}
            setObjective={setObjective}
            durationSec={durationSec}
            setDurationSec={setDurationSec}
            executionMode={executionMode}
            setExecutionMode={setExecutionMode}
            plannerModel={plannerModel}
            setPlannerModel={setPlannerModel}
            audience={audience}
            setAudience={setAudience}
            callToAction={callToAction}
            setCallToAction={setCallToAction}
            tone={tone}
            setTone={setTone}
            briefText={briefText}
            setBriefText={setBriefText}
            sceneCount={sceneIdeas.length}
            scenes={sceneIdeas}
            lockedProduct={lockedProduct}
            availableAssets={universeProducts.flatMap((product) => product.productAssets)}
            excludedAssetIds={excludedAssetIds}
            toAssetPreviewUrl={toAssetPreviewUrl}
            onGenerateStoryboard={handleGenerateStoryboard}
            isGeneratingStoryboard={isGeneratingStoryboard}
            onBack={() => setStep('image_studio')}
            onNext={adFormat === 'carousel' ? handleCarouselComplete : handleStartCampaign}
            onUpdateSceneIdea={handleUpdateSceneIdea}
            onUpdateSceneMotionMode={handleUpdateSceneMotionMode}
            onUpdateSceneRoute={handleUpdateSceneRoute}
            onAssignSceneBaseAsset={handleAssignSceneBaseAsset}
            onRewriteScene={handleRewriteScene}
            isRewritingScene={isRewritingScene}
            errorMessage={errorMessage}
            onAddScene={() => handleAddSceneIdea(false)}
            onRemoveScene={handleRemoveSceneIdea}
            onMoveScene={handleMoveSceneIdea}
            onBulkGenerateFreshImages={handleBulkGenerateFreshImages}
            isBulkGenerating={isBulkGenerating}
            bulkGenerateProgress={bulkGenerateProgress}
          />
        )}

        {step === 'agents_working' && (
          <AgentsWorkingScreen
            agentStates={agentStates}
            liveFindings={liveFindings}
            currentPhase={currentPhase}
            currentIteration={currentIteration}
            isRunning={isRunning}
            error={errorMessage}
            findingsFeedRef={findingsFeedRef}
            storyboardScenes={plannedSceneIdeas}
            productUniverseProducts={universeProducts}
            platform={platform}
            durationSec={durationSec}
            executionMode={executionMode}
            onStop={handleStopCampaign}
            onRetry={handleStartCampaign}
            onBackToStoryboard={() => setStep('storyboard')}
          />
        )}

        {step === 'concept_review' && (
          <ConceptReviewScreen
            blueprint={campaignBlueprint}
            concept={finalConcept}
            reviewHistory={reviewHistory}
            brand={campaignBrand || selectedBrand}
            storyboardScenes={plannedSceneIdeas}
            productUniverseProducts={universeProducts}
            adFormat={adFormat}
            carouselSlides={adFormat === 'carousel' ? plannedSceneIdeas
              .map((scene, index) => {
                const assetId = scene.selectedVariantAssetId || scene.linkedAssetId || scene.baseAssetId;
                const asset = lockedProduct?.productAssets.find(a => a.id === assetId)
                  || universeProducts.flatMap((product) => product.productAssets).find((a) => a.id === assetId);
                const url = asset ? toAssetPreviewUrl(asset) : undefined;
                if (!url || !asset) return null;
                return {
                  index,
                  previewUrl: url,
                  headline: scene.text || scene.visualDescription || `Slide ${index + 1}`,
                  assetId: asset.id,
                };
              })
              .filter((s): s is { index: number; previewUrl: string; headline: string; assetId: string } => s !== null)
              : undefined}
            onApprove={handleApproveConcept}
            onRevise={(note?: string) => {
              if (note) setRevisionNote(note);
              setStep('agents_working');
              handleStartCampaign();
            }}
            onBack={() => setStep('storyboard')}
          />
        )}
      </div>
    </div>
  );
};

// === SUB-SCREENS ===

const capitalize = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatPlatformLabel = (platform: CampaignPlatform): string => {
  switch (platform) {
    case 'instagram_reels':
      return 'Instagram Reels';
    case 'youtube_shorts':
      return 'YouTube Shorts';
    case 'tiktok':
    default:
      return 'TikTok';
  }
};

const formatObjectiveLabel = (objective: CampaignObjective): string => capitalize(objective);
const formatSourceMode = (mode: SceneContract['sourceMode']): string => capitalize(mode);
const formatStoryboardRoute = (route?: SceneRoute): string => {
  switch (route) {
    case 'use_existing':
      return 'Use Existing';
    case 'upgrade_existing':
      return 'Upgrade Existing';
    case 'composite_product':
      return 'Composite Product';
    case 'generate_fresh':
      return 'Generate Fresh';
    case 'continue_sequence':
      return 'Continue Sequence';
    default:
      return 'Route Pending';
  }
};

const BrandHubScreen: React.FC<{
  brands: Brand[];
  showAddBrand: boolean;
  setShowAddBrand: (v: boolean) => void;
  newBrandName: string;
  setNewBrandName: (v: string) => void;
  newBrandUrl: string;
  setNewBrandUrl: (v: string) => void;
  newBrandIg: string;
  setNewBrandIg: (v: string) => void;
  onAddBrand: () => void;
  onSelectBrand: (brand: Brand) => void;
  onDeleteBrand: (id: string) => void;
  onSkipBrand: () => void;
  onCancelAddBrand: () => void;
}> = (props) => (
  <div className="space-y-8">
    <div className="text-center mb-8">
      <h2 className="text-3xl font-bold text-white mb-2">Your Brands</h2>
      <p className="text-gray-400">Select a brand or create a new one to get started</p>
    </div>

    {props.brands.length === 0 && !props.showAddBrand && (
      <div className="rounded-2xl border border-dark-border bg-dark-card/40 px-6 py-8 text-center">
        <p className="text-white font-medium">No brands yet</p>
        <p className="text-sm text-gray-400 mt-2">
          Add a brand with a website to research DNA, or skip and continue with a brief-only campaign.
        </p>
      </div>
    )}

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {props.brands.map(brand => {
        const websiteLabel = (brand.websiteUrl || '').replace(/^https?:\/\//, '') || 'No website';
        const palette = brand.dna?.colors?.palette?.filter(Boolean) ?? [];
        const aesthetic = brand.dna?.aesthetic?.filter(Boolean) ?? [];
        return (
        <div
          key={brand.id}
          onClick={() => props.onSelectBrand(brand)}
          className="group relative bg-dark-card rounded-2xl border border-dark-border p-6 cursor-pointer hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10 transition-all duration-300"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onDeleteBrand(brand.id); }}
            className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
          >
            ×
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
              brand.status === 'ready'
                ? 'bg-green-500/20'
                : brand.status === 'researching'
                  ? 'bg-amber-500/20'
                  : 'bg-purple-500/20'
            }`}>
              {brand.status === 'ready' ? '✅' : brand.status === 'researching' ? '⏳' : '🏷️'}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white truncate">{brand.name}</h3>
              <p className="text-sm text-gray-400 truncate">{websiteLabel}</p>
              {brand.status === 'researching' && (
                <p className="text-[11px] text-amber-300 mt-1">Researching brand DNA…</p>
              )}
              {brand.status === 'ready' && !brand.dna && (
                <p className="text-[11px] text-gray-500 mt-1">Ready</p>
              )}
              {brand.status === 'new' && Boolean((brand.websiteUrl || '').trim()) && !brand.dna && (
                <p className="text-[11px] text-gray-500 mt-1">DNA pending — select to continue</p>
              )}
            </div>
          </div>
          {palette.length > 0 && (
            <div className="flex gap-1 mt-3">
              {palette.slice(0, 5).map((color, i) => (
                <div key={i} className="w-6 h-6 rounded-full border border-white/20" style={{ backgroundColor: color }} />
              ))}
            </div>
          )}
          {aesthetic.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {aesthetic.slice(0, 3).map((tag, i) => (
                <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-purple-500/10 text-purple-300">{tag}</span>
              ))}
            </div>
          )}
          {brand.instagramHandle && (
            <p className="text-xs text-gray-500 mt-2">📱 @{brand.instagramHandle}</p>
          )}
        </div>
        );
      })}

      {/* Add Brand Card */}
      <div
        onClick={() => props.setShowAddBrand(true)}
        className="bg-dark-card/50 rounded-2xl border-2 border-dashed border-dark-border p-6 cursor-pointer hover:border-purple-500/50 transition-all flex flex-col items-center justify-center min-h-[200px] group"
      >
        <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
          +
        </div>
        <p className="text-gray-400 mt-4 font-medium">Add New Brand</p>
        <p className="text-xs text-gray-500 mt-1">Enter website URL to research</p>
      </div>
    </div>

    {/* Skip brand option */}
    <div className="text-center">
      <button
        type="button"
        onClick={props.onSkipBrand}
        className="text-sm text-gray-500 hover:text-gray-300 transition-colors underline"
      >
        Skip — continue with a brief-only brand
      </button>
      <p className="text-[11px] text-gray-600 mt-2">
        Creates a temporary brand so product import and campaign handoff still work.
      </p>
    </div>

    {/* Add Brand Modal */}
    {props.showAddBrand && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={props.onCancelAddBrand}
      >
        <div
          className="bg-dark-card rounded-2xl border border-dark-border p-8 w-full max-w-md space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-xl font-bold text-white">Add Brand</h3>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Brand Name *</label>
            <input
              type="text"
              value={props.newBrandName}
              onChange={(e) => props.setNewBrandName(e.target.value)}
              placeholder="Your brand name"
              className="w-full px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Website URL *</label>
            <input
              type="text"
              value={props.newBrandUrl}
              onChange={(e) => props.setNewBrandUrl(e.target.value)}
              placeholder="yourbrand.com"
              className="w-full px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 block mb-1">Instagram Handle (optional)</label>
            <input
              type="text"
              value={props.newBrandIg}
              onChange={(e) => props.setNewBrandIg(e.target.value)}
              placeholder="yourbrand"
              className="w-full px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={props.onCancelAddBrand}
              className="flex-1 py-3 rounded-xl bg-dark-bg border border-dark-border text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={props.onAddBrand}
              disabled={!(props.newBrandName || '').trim() || !(props.newBrandUrl || '').trim()}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold disabled:opacity-50 hover:shadow-lg hover:shadow-purple-500/25 transition-all"
            >
              Add Brand
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);

const PLATFORM_META: Record<CampaignPlatform, { icon: string; label: string }> = {
  tiktok: { icon: '🎵', label: 'TikTok' },
  instagram_reels: { icon: '📸', label: 'Instagram Reels' },
  youtube_shorts: { icon: '▶️', label: 'YouTube Shorts' },
  instagram_feed: { icon: '🖼️', label: 'Instagram Feed' },
  instagram_carousel: { icon: '📑', label: 'Instagram Carousel' },
};

const OBJECTIVE_META: Record<CampaignObjective, { icon: string; label: string }> = {
  awareness: { icon: '📢', label: 'Awareness' },
  consideration: { icon: '🤔', label: 'Consideration' },
  conversion: { icon: '🛒', label: 'Conversion' },
  ugc_style: { icon: '🤳', label: 'UGC Style' },
  founder_story: { icon: '💡', label: 'Founder Story' },
};

const EXECUTION_META: Record<ExecutionMode, { icon: string; label: string; desc: string }> = {
  fast: { icon: '⚡', label: 'Fast', desc: 'Quick draft, fewer iterations' },
  balanced: { icon: '⚖️', label: 'Balanced', desc: 'Good quality, moderate time' },
  agency: { icon: '🏢', label: 'Agency', desc: 'Full pipeline with scene planning' },
};

const TONE_OPTIONS = [
  { value: 'minimalist', label: 'Minimalist', icon: '◻️' },
  { value: 'high-energy', label: 'High Energy', icon: '🔥' },
  { value: 'cinematic', label: 'Cinematic', icon: '🎬' },
  { value: 'raw-ugc', label: 'Raw / UGC', icon: '🤳' },
  { value: 'luxury', label: 'Luxury', icon: '✨' },
  { value: 'playful', label: 'Playful', icon: '🎨' },
  { value: 'editorial', label: 'Editorial', icon: '📰' },
  { value: 'asmr', label: 'ASMR', icon: '🌊' },
];

const DURATION_OPTIONS: (10 | 15 | 20 | 30 | 45 | 60)[] = [10, 15, 20, 30, 45, 60];

const estimateSceneCount = (seconds: number): string => {
  if (seconds <= 10) return '~2–3';
  if (seconds <= 15) return '~3–4';
  if (seconds <= 20) return '~4–5';
  if (seconds <= 30) return '~4–6';
  if (seconds <= 45) return '~6–8';
  return '~8–12';
};

const extractUrlsFromText = (text: string): string[] => {
  const matches = text.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi) || [];
  return Array.from(new Set(matches.map((value) => value.startsWith('http') ? value : `https://${value}`)));
};

const computeBriefQuality = (
  briefText: string,
  audience: string,
  callToAction: string,
  tone: string,
): { score: number; label: string; color: string; tips: string[] } => {
  let score = 0;
  const tips: string[] = [];
  const text = (briefText || '').trim();
  const detectedUrls = extractUrlsFromText(text);
  if (text.length > 0) score += 15;
  if (text.length > 40) score += 10;
  if (text.length > 120) score += 10;
  if (detectedUrls.length > 0) score += 20;
  else tips.push('Name the product, or add a product URL for best results');
  if (detectedUrls.length > 1) score += 5;
  if ((audience || '').trim()) score += 15;
  else tips.push('Define your target audience');
  if ((callToAction || '').trim()) score += 10;
  else tips.push('Set a CTA to guide the creative');
  if ((tone || '').trim()) score += 10;
  else tips.push('Pick a creative tone/vibe');
  if (/vibe|style|feel|aesthetic|mood|tone|energy/i.test(text)) score += 5;
  if (/benefit|ingredient|result|proof|claim/i.test(text)) score += 5;
  score = Math.min(100, score);
  const label = score < 30 ? 'Needs more detail' : score < 60 ? 'Getting there' : score < 85 ? 'Good brief' : 'Excellent';
  const color = score < 30 ? 'red' : score < 60 ? 'yellow' : score < 85 ? 'emerald' : 'cyan';
  return { score, label, color, tips: tips.slice(0, 3) };
};

const CampaignBriefScreen: React.FC<{
  brand: Brand | null;
  briefText: string;
  setBriefText: (v: string) => void;
  platform: CampaignPlatform;
  setPlatform: (v: CampaignPlatform) => void;
  objective: CampaignObjective;
  setObjective: (v: CampaignObjective) => void;
  durationSec: 10 | 15 | 20 | 30 | 45 | 60;
  setDurationSec: (v: 10 | 15 | 20 | 30 | 45 | 60) => void;
  executionMode: ExecutionMode;
  setExecutionMode: (v: ExecutionMode) => void;
  audience: string;
  setAudience: (v: string) => void;
  callToAction: string;
  setCallToAction: (v: string) => void;
  tone: string;
  setTone: (v: string) => void;
  errorMessage: string | null;
  isWritingBriefPrompt: boolean;
  isResolvingProduct: boolean;
  resolvePhase: string;
  onSuggestPrompt: () => void;
  onStart: () => void;
  onBack: () => void;
}> = ({
  brand,
  briefText,
  setBriefText,
  platform,
  setPlatform,
  objective,
  setObjective,
  durationSec,
  setDurationSec,
  executionMode,
  setExecutionMode,
  audience,
  setAudience,
  callToAction,
  setCallToAction,
  tone,
  setTone,
  errorMessage,
  isWritingBriefPrompt,
  isResolvingProduct,
  resolvePhase,
  onSuggestPrompt,
  onStart,
  onBack,
}) => {
  const detectedUrls = extractUrlsFromText(briefText);
  const detectedUrl = detectedUrls[0];
  const quality = computeBriefQuality(briefText, audience, callToAction, tone);
  const brandPrimaryColor = brand?.dna?.colors?.primary;

  // Smart audience suggestions from brand DNA
  const audienceSuggestions: string[] = (() => {
    if (!brand?.dna) return [];
    const suggestions: string[] = [];
    if (brand.dna.targetAudience?.demographics) suggestions.push(brand.dna.targetAudience.demographics);
    if (brand.dna.targetAudience?.painPoints) {
      brand.dna.targetAudience.painPoints.slice(0, 2).forEach((pp) => suggestions.push(pp));
    }
    return suggestions.filter(Boolean).slice(0, 3);
  })();

  // Smart CTA suggestions from brand DNA
  const ctaSuggestions: string[] = (() => {
    const defaults = ['Shop now', 'Save this', 'Learn more'];
    if (!brand?.dna) return defaults;
    const vps = brand.dna.valuePropositions?.slice(0, 2) || [];
    return [...vps.map((vp) => vp.length > 30 ? vp.slice(0, 28) + '…' : vp), ...defaults].slice(0, 4);
  })();

  // Context-aware quick suggestions
  const quickSuggestions: { label: string; text: string; icon: string }[] = (() => {
    const productName = brand?.dna?.products?.[0]?.name;
    const objLabel = OBJECTIVE_META[objective]?.label || 'Awareness';
    return [
      {
        label: productName ? `${productName} Hero` : 'Product Showcase',
        text: productName
          ? `Focus on ${productName} — hero close-up shots, clean backgrounds, premium feel.`
          : 'Focus on product showcase with hero close-up shots and clean backgrounds.',
        icon: '📦',
      },
      {
        label: brand?.dna?.keyIngredients?.length ? 'Key Ingredients' : 'Ingredients Focus',
        text: brand?.dna?.keyIngredients?.length
          ? `Highlight key ingredients: ${brand.dna.keyIngredients.slice(0, 3).join(', ')}. Show texture and application.`
          : 'Highlight key ingredients with texture shots and application close-ups.',
        icon: '🧪',
      },
      {
        label: objective === 'conversion' ? 'Urgency Hook' : objective === 'ugc_style' ? 'Authentic Story' : 'Premium Story',
        text: objective === 'conversion'
          ? 'Create urgency — limited-time feel, strong CTA, before-and-after transformation.'
          : objective === 'ugc_style'
          ? 'Raw, authentic feeling — handheld camera, genuine testimonial, relatable voiceover.'
          : `${objLabel}-driven storytelling with aspirational lifestyle shots and emotional hook.`,
        icon: objective === 'conversion' ? '🔥' : objective === 'ugc_style' ? '🤳' : '✨',
      },
    ];
  })();

  // Contextual agency tips
  const agencyTips: string[] = (() => {
    const tips: string[] = [];
    if (!detectedUrls.length) tips.push('Paste a direct product URL, or name the product if the brand site is already saved.');
    if (detectedUrls.length > 1) tips.push('Multiple product URLs detected. You will be able to choose which product becomes the campaign anchor next.');
    if (!(audience || '').trim()) tips.push('Add a target audience for more focused creative direction.');
    if (!(tone || '').trim()) {
      const aesthetic = brand?.dna?.aesthetic?.slice(0, 2).join(', ');
      tips.push(aesthetic ? `Your brand aesthetic is ${aesthetic} — select a matching tone.` : 'Select a creative tone to guide the visual direction.');
    }
    if (objective === 'conversion' && !(callToAction || '').trim()) tips.push('Conversion campaigns need a strong CTA — add one above.');
    if (brand?.dna?.keyIngredients?.length && !/ingredient/i.test(briefText)) tips.push(`Mention key ingredients like ${brand.dna.keyIngredients[0]} in the brief.`);
    if (tips.length < 3) tips.push('Describe the "vibe" you want (e.g., minimalist, high-energy, cinematic).');
    if (tips.length < 3) tips.push('Mention specific product benefits you want highlighted.');
    return tips.slice(0, 3);
  })();

  // Brand avatar
  const brandAvatar = (() => {
    if (!brand) return null;
    const logoAsset = brand.assets.find((a) => a.type === 'logo' && a.previewUrl);
    const productAsset = brand.assets.find((a) => a.previewUrl);
    const src = logoAsset?.previewUrl || productAsset?.previewUrl;
    if (src) return src;
    return null;
  })();

  // Dynamic placeholder
  const dynamicPlaceholder = brand
    ? `Create an ad for ${brand.name}${brand.dna?.products?.[0]?.name ? `'s ${brand.dna.products[0].name}` : ''}...\n\nPaste one or more product URLs, or name the product and describe the creative direction, tone, and key messages.`
    : 'Create an ad for your product...\n\nPaste one or more product URLs, or name the product and describe the creative direction, tone, and key messages.';

  return (
  <div className="space-y-8">
    {errorMessage && (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
        {errorMessage}
      </div>
    )}

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Left Column: Settings & Brand Context */}
      <div className="lg:col-span-4 space-y-6">
        {/* Brand Context Card */}
        {brand && (
          <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden shadow-xl shadow-black/20"
            style={brandPrimaryColor ? { borderColor: `${brandPrimaryColor}30` } : undefined}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-0">
              <div className="flex items-center gap-3 min-w-0">
                {brandAvatar ? (
                  <img src={brandAvatar} alt={brand.name} className="w-12 h-12 rounded-xl object-cover ring-2 ring-purple-500/30 shrink-0" />
                ) : (
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold text-white shrink-0"
                    style={{ background: brandPrimaryColor ? `linear-gradient(135deg, ${brandPrimaryColor}80, ${brandPrimaryColor}40)` : 'rgba(168,85,247,0.2)' }}
                  >
                    {brand.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-base truncate">{brand.name}</h3>
                  <p className="text-[11px] text-gray-400 truncate">{brand.websiteUrl.replace(/^https?:\/\//, '')}</p>
                </div>
              </div>
              <button
                onClick={onBack}
                className="p-2 rounded-lg text-gray-500 hover:text-white hover:bg-dark-bg transition-all shrink-0"
                title="Change brand"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
              </button>
            </div>
            {brand.dna?.tagline && (
              <p className="text-[11px] text-purple-300/80 italic px-5 pt-2">"{brand.dna.tagline}"</p>
            )}
            {brand.dna?.colors?.palette && brand.dna.colors.palette.length > 0 && (
              <div className="flex gap-1 px-5 pt-3">
                {brand.dna.colors.palette.slice(0, 6).map((color, i) => (
                  <div key={i} className="w-5 h-5 rounded-full ring-1 ring-white/10" style={{ backgroundColor: color }} />
                ))}
              </div>
            )}
            {brand.dna?.aesthetic && brand.dna.aesthetic.length > 0 && (
              <div className="flex flex-wrap gap-1 px-5 pt-2 pb-5">
                {brand.dna.aesthetic.slice(0, 4).map((tag, i) => (
                  <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300/70">{tag}</span>
                ))}
              </div>
            )}
            {(!brand.dna?.aesthetic || brand.dna.aesthetic.length === 0) && <div className="pb-5" />}
          </div>
        )}

        {/* Campaign Settings */}
        <div className="bg-dark-card rounded-2xl border border-dark-border p-6 space-y-5 shadow-xl shadow-black/20">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Campaign Settings</p>

          {/* Platform - pill selector */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-gray-400">Platform</span>
            <div className="flex gap-1.5">
              {(['tiktok', 'instagram_reels', 'youtube_shorts'] as CampaignPlatform[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`flex-1 px-2 py-2 rounded-lg text-[11px] font-medium transition-all ${
                    platform === p
                      ? 'bg-purple-500/20 border border-purple-500/50 text-purple-200'
                      : 'bg-dark-bg border border-dark-border text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
                >
                  <span className="mr-1">{PLATFORM_META[p].icon}</span>
                  {PLATFORM_META[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* Objective */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-gray-400">Objective</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(['awareness', 'consideration', 'conversion', 'ugc_style', 'founder_story'] as CampaignObjective[]).map((o) => (
                <button
                  key={o}
                  onClick={() => setObjective(o)}
                  className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all text-left ${
                    objective === o
                      ? 'bg-purple-500/20 border border-purple-500/50 text-purple-200'
                      : 'bg-dark-bg border border-dark-border text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
                >
                  <span className="mr-1">{OBJECTIVE_META[o].icon}</span>
                  {OBJECTIVE_META[o].label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration - pill toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-400">Duration</span>
              <span className="text-[10px] text-gray-500">{estimateSceneCount(durationSec)} scenes</span>
            </div>
            <div className="flex gap-1">
              {DURATION_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setDurationSec(s)}
                  className={`flex-1 py-2 rounded-lg text-[11px] font-medium transition-all ${
                    durationSec === s
                      ? 'bg-purple-500/20 border border-purple-500/50 text-purple-200'
                      : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white'
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>

          {/* Execution Mode - radio cards */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-gray-400">Execution Mode</span>
            <div className="space-y-1.5">
              {(['fast', 'balanced', 'agency'] as ExecutionMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setExecutionMode(m)}
                  className={`w-full px-3 py-2.5 rounded-lg text-left transition-all flex items-center gap-3 ${
                    executionMode === m
                      ? 'bg-purple-500/15 border border-purple-500/50'
                      : 'bg-dark-bg border border-dark-border hover:border-gray-500'
                  }`}
                >
                  <span className="text-base">{EXECUTION_META[m].icon}</span>
                  <div className="min-w-0">
                    <span className={`text-xs font-semibold ${executionMode === m ? 'text-purple-200' : 'text-gray-300'}`}>
                      {EXECUTION_META[m].label}
                    </span>
                    <p className="text-[10px] text-gray-500 leading-tight">{EXECUTION_META[m].desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tone / Vibe Selector */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-gray-400">Creative Tone</span>
            <div className="flex flex-wrap gap-1.5">
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTone(tone === t.value ? '' : t.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                    tone === t.value
                      ? 'bg-cyan-400/15 border border-cyan-400/50 text-cyan-200'
                      : 'bg-dark-bg border border-dark-border text-gray-500 hover:text-white hover:border-gray-500'
                  }`}
                >
                  <span className="mr-1">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Audience with smart chips */}
          <div className="space-y-2 pt-2">
            <span className="text-[11px] font-medium text-gray-400">Target Audience</span>
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g. women 25-40 with dull skin"
              className="w-full px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            />
            {audienceSuggestions.length > 0 && !(audience || '').trim() && (
              <div className="flex flex-wrap gap-1.5">
                {audienceSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setAudience(s)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300 hover:bg-emerald-500/20 transition-all"
                  >
                    + {s.length > 40 ? s.slice(0, 38) + '…' : s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CTA with smart chips */}
          <div className="space-y-2">
            <span className="text-[11px] font-medium text-gray-400">Call to Action</span>
            <input
              value={callToAction}
              onChange={(e) => setCallToAction(e.target.value)}
              placeholder="e.g. Shop now / Save this"
              className="w-full px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none"
            />
            {!(callToAction || '').trim() && (
              <div className="flex flex-wrap gap-1.5">
                {ctaSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setCallToAction(s)}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 hover:bg-amber-500/20 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Contextual Agency Tips */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-600/10 to-pink-500/10 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">💡</span>
            <h4 className="text-sm font-bold text-white">Agency Tips</h4>
          </div>
          <ul className="text-xs text-gray-400 space-y-2 list-disc pl-4">
            {agencyTips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Right Column: Brief Input & AI Tools */}
      <div className="lg:col-span-8 space-y-6">
        <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden shadow-2xl shadow-black/40">
          <div className="px-6 py-4 bg-dark-bg/50 border-b border-dark-border flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Campaign Brief</h2>
              <p className="text-xs text-gray-500">Paste product URLs or name the product and describe the ad</p>
            </div>
            <button
              onClick={onSuggestPrompt}
              disabled={isWritingBriefPrompt || isResolvingProduct}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-400/10 border border-cyan-400/30 text-xs font-bold text-cyan-200 hover:bg-cyan-400/20 transition-all disabled:opacity-50"
            >
              {isWritingBriefPrompt ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-100/30 border-t-cyan-100" />
              ) : '✨'}
              {isWritingBriefPrompt ? 'AI Writing...' : 'AI Write Prompt'}
            </button>
          </div>
          <div className="p-0 relative">
            <textarea
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              placeholder={dynamicPlaceholder}
              className="w-full px-6 py-6 bg-transparent text-white placeholder-gray-600 focus:outline-none resize-none text-lg leading-relaxed min-h-[320px]"
            />
            {/* Real-time URL detection badge */}
            {detectedUrls.length > 0 && (
              <div className="absolute bottom-3 left-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 animate-[fadeIn_0.3s_ease]">
                <span className="text-emerald-400 text-xs">🔗</span>
                <span className="text-[11px] text-emerald-300 font-medium truncate max-w-[280px]">
                  {detectedUrls.length === 1
                    ? detectedUrl?.replace(/^https?:\/\//, '').slice(0, 50)
                    : `${detectedUrls.length} product URLs detected`}
                </span>
                <span className="text-[9px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">Detected</span>
              </div>
            )}
          </div>
          <div className="px-6 py-3 bg-dark-bg/30 border-t border-dark-border space-y-3">
            {/* Context-aware quick suggestions */}
            <div className="flex flex-wrap gap-2">
              {quickSuggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setBriefText(prev => prev ? `${prev}\n\n${suggestion.text}` : suggestion.text)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-bg border border-dark-border text-[10px] text-gray-400 hover:text-white hover:border-purple-500/40 transition-all group"
                >
                  <span className="group-hover:scale-110 transition-transform">{suggestion.icon}</span>
                  {suggestion.label}
                </button>
              ))}
            </div>
            {/* Brief quality meter + character count */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex-1 h-1.5 bg-dark-bg rounded-full overflow-hidden max-w-[200px]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      quality.color === 'red' ? 'bg-red-500' :
                      quality.color === 'yellow' ? 'bg-yellow-500' :
                      quality.color === 'emerald' ? 'bg-emerald-500' :
                      'bg-cyan-400'
                    }`}
                    style={{ width: `${quality.score}%` }}
                  />
                </div>
                <span className={`text-[10px] font-medium ${
                  quality.color === 'red' ? 'text-red-400' :
                  quality.color === 'yellow' ? 'text-yellow-400' :
                  quality.color === 'emerald' ? 'text-emerald-400' :
                  'text-cyan-300'
                }`}>{quality.label}</span>
              </div>
              <p className="text-[10px] text-gray-500 shrink-0">
                {briefText.length} characters
              </p>
            </div>
          </div>
        </div>

        {/* Start Button */}
        <div className="space-y-4">
          <button
            onClick={onStart}
            disabled={!(briefText || '').trim() || isResolvingProduct}
            className="w-full py-5 rounded-2xl bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 bg-[length:200%_100%] animate-gradient-x text-white text-xl font-bold disabled:opacity-40 hover:shadow-2xl hover:shadow-purple-500/30 transition-all duration-300 flex items-center justify-center gap-3"
          >
            {isResolvingProduct && (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/35 border-t-white" />
            )}
            <span>{isResolvingProduct ? `Analyzing Product${detectedUrls.length > 1 ? 's' : ''}...` : `🚀 Analyze Product${detectedUrls.length > 1 ? 's' : ''}`}</span>
          </button>
          
          {isResolvingProduct && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100 animate-pulse text-center">
              {resolvePhase || `Analyzing product${detectedUrls.length > 1 ? 's' : ''} and importing product assets...`}
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
};

const AgentsWorkingScreen: React.FC<{
  agentStates: SubAgentState[];
  liveFindings: AgentFinding[];
  currentPhase: string;
  currentIteration: number;
  isRunning: boolean;
  error: string | null;
  findingsFeedRef: React.RefObject<HTMLDivElement>;
  storyboardScenes: PlannedStoryboardScene[];
  productUniverseProducts: ProductContext[];
  platform: CampaignPlatform;
  durationSec: CampaignBrief['durationSec'];
  executionMode: ExecutionMode;
  onStop: () => void;
  onRetry: () => void;
  onBackToStoryboard: () => void;
}> = ({
  agentStates,
  liveFindings,
  currentPhase,
  currentIteration,
  isRunning,
  error,
  findingsFeedRef,
  storyboardScenes,
  productUniverseProducts,
  platform,
  durationSec,
  executionMode,
  onStop,
  onRetry,
  onBackToStoryboard,
}) => {
  const topLevelAgents = agentStates.filter(a => a.parentId === null);
  const childAgentsMap: Record<string, SubAgentState[]> = agentStates.reduce((acc: Record<string, SubAgentState[]>, a) => {
    if (a.parentId) {
      if (!acc[a.parentId]) acc[a.parentId] = [];
      acc[a.parentId].push(a);
    }
    return acc;
  }, {} as Record<string, SubAgentState[]>);

  const completedCount = agentStates.filter(a => a.status === 'complete').length;
  const failedAgents = agentStates.filter(a => a.status === 'error');
  const totalCount = agentStates.length;
  const overallProgress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isStuck = !isRunning && !error && failedAgents.length === 0 && completedCount < totalCount && totalCount > 0;
  const sceneCountByProduct = productUniverseProducts
    .map((product) => ({
      product,
      count: storyboardScenes.filter((scene) => scene.productId === product.productId).length,
    }))
    .filter((entry) => entry.count > 0 || productUniverseProducts.length === 1);

  const bannerTitle = error
    ? '❌ Execution Failed'
    : isStuck
      ? '⚠️ Campaign stalled'
      : (currentPhase || 'Starting...');

  return (
    <div className="space-y-6">
      {/* Phase Banner */}
      <div className="bg-dark-card rounded-2xl border border-dark-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-gray-400">Current Phase</p>
            <h2 className="text-xl font-bold text-white">
              {bannerTitle}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            {currentIteration > 0 && !error && (
              <div className="px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                <span className="text-yellow-400 text-sm font-bold">Iteration {currentIteration}/5</span>
              </div>
            )}
            <div className="text-right">
              <p className="text-2xl font-bold text-purple-400">{completedCount}/{totalCount}</p>
              <p className="text-xs text-gray-500">agents complete</p>
            </div>
          </div>
        </div>
        
        {error ? (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-2 space-y-2">
            <p className="text-red-400 text-sm">{error}</p>
            {failedAgents.length > 0 && (
              <ul className="space-y-1">
                {failedAgents.slice(0, 4).map((agent) => (
                  <li key={agent.id} className="text-[11px] text-red-300/90">
                    {agent.emoji} {agent.goal}: {agent.statusText || 'failed'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : isStuck ? (
          <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 mb-2">
            <p className="text-yellow-300 text-sm">
              Agents stopped before a concept was ready. Retry Create to resume, or go back to the storyboard.
            </p>
          </div>
        ) : (
          <div className="h-2 bg-dark-bg rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isRunning ? 'bg-gradient-to-r from-purple-600 to-pink-500 animate-pulse' : 'bg-green-500'
              }`}
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        )}
      </div>

      <div className="bg-dark-card rounded-2xl border border-dark-border p-6">
        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5">
          <div>
            <p className="text-sm text-gray-400">Campaign Handoff</p>
            <h3 className="text-lg font-bold text-white">
              {storyboardScenes.length} storyboard scene{storyboardScenes.length === 1 ? '' : 's'} ready for execution
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-center">
              <p className="text-[10px] text-gray-500">Platform</p>
              <p className="text-xs text-white font-semibold">{formatPlatformLabel(platform)}</p>
            </div>
            <div className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-center">
              <p className="text-[10px] text-gray-500">Duration</p>
              <p className="text-xs text-white font-semibold">{durationSec}s</p>
            </div>
            <div className="rounded-xl border border-dark-border bg-dark-bg px-3 py-2 text-center">
              <p className="text-[10px] text-gray-500">Mode</p>
              <p className="text-xs text-white font-semibold capitalize">{executionMode}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-5">
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Product Lanes</p>
            {sceneCountByProduct.map(({ product, count }) => (
              <div key={product.productId} className="rounded-xl border border-dark-border bg-dark-bg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{product.productTitle}</p>
                    <p className="text-[11px] text-gray-500 truncate">{product.productUrl}</p>
                  </div>
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                    {count} scene{count === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Storyboard Queue</p>
            <div className="space-y-2">
              {storyboardScenes.map((scene, index) => (
                <div key={scene.id} className="rounded-xl border border-dark-border bg-dark-bg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">Scene {index + 1}: {scene.text}</p>
                      <p className="text-[12px] text-gray-400 mt-1 line-clamp-2">{scene.visualDescription}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-300 whitespace-nowrap">
                      {scene.productTitle || 'Product pending'}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-purple-200">
                      {formatStoryboardRoute(scene.route)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                      {scene.sourceMode ? formatSourceMode(scene.sourceMode) : 'Source pending'}
                    </span>
                    {scene.baseAssetDescription && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-400">
                        Base: {scene.baseAssetDescription.slice(0, 48)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Tree — 2 columns */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Active Agents</h3>
          <div className="space-y-2">
            {topLevelAgents.map(agent => (
              <AgentCard key={agent.id} agent={agent} children={childAgentsMap[agent.id]} allChildren={childAgentsMap} />
            ))}
            {topLevelAgents.length === 0 && !isRunning && (
              <p className="text-sm text-gray-500 rounded-xl border border-dark-border bg-dark-bg p-4">
                No agents spawned yet. Retry Create to start the campaign again.
              </p>
            )}
          </div>
        </div>

        {/* Live Feed — 1 column */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Live Findings</h3>
          <div
            ref={findingsFeedRef as any}
            className="bg-dark-card rounded-2xl border border-dark-border p-4 h-[600px] overflow-y-auto space-y-3"
          >
            {liveFindings.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">Waiting for agents to report findings...</p>
            )}
            {liveFindings.map((finding, i) => (
              <div key={i} className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                <div className="flex items-start gap-2">
                  <span className="text-xs mt-0.5">
                    {finding.type === 'data' ? '📊' : finding.type === 'insight' ? '💡' : finding.type === 'recommendation' ? '🎯' : finding.type === 'warning' ? '⚠️' : '📎'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{finding.title}</p>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-3">{finding.content}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onBackToStoryboard}
          disabled={isRunning}
          className="flex-1 py-4 rounded-2xl bg-dark-bg border border-dark-border text-gray-300 hover:border-white/20 hover:text-white transition-all font-bold disabled:opacity-40"
        >
          Back to Storyboard
        </button>
        <button
          onClick={onRetry}
          disabled={isRunning}
          className="flex-1 py-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all font-bold disabled:opacity-40"
        >
          Retry Create
        </button>
        <button
          onClick={onStop}
          disabled={!isRunning}
          className="flex-[2] py-4 rounded-2xl bg-gradient-to-r from-red-600 to-orange-500 text-white font-bold hover:shadow-2xl hover:shadow-red-500/25 transition-all text-lg disabled:opacity-40"
        >
          Stop
        </button>
      </div>
    </div>
  );
};

// === AGENT CARD ===
const AgentCard: React.FC<{
  agent: SubAgentState;
  children?: SubAgentState[];
  allChildren: Record<string, SubAgentState[]>;
  depth?: number;
}> = ({ agent, children, allChildren, depth = 0 }) => {
  const statusColors: Record<string, string> = {
    queued: 'bg-gray-500',
    spawning: 'bg-yellow-500 animate-pulse',
    running: 'bg-blue-500 animate-pulse',
    waiting: 'bg-yellow-500',
    complete: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <div className={`${depth > 0 ? 'ml-8 border-l-2 border-purple-500/20 pl-4' : ''}`}>
      <div className={`bg-dark-card rounded-xl border border-dark-border p-4 hover:border-purple-500/30 transition-all ${
        agent.status === 'running' ? 'border-blue-500/30 shadow-lg shadow-blue-500/5' : ''
      }`}>
        <div className="flex items-center gap-3">
          {/* Status dot */}
          <div className={`w-3 h-3 rounded-full ${statusColors[agent.status] || 'bg-gray-500'}`} />
          {/* Emoji + Name */}
          <span className="text-lg">{agent.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{agent.goal}</p>
            <p className="text-xs text-gray-400 truncate">{agent.statusText}</p>
          </div>
          {/* Progress */}
          <div className="text-right">
            <span className={`text-xs font-mono ${agent.status === 'complete' ? 'text-green-400' : 'text-gray-400'}`}>
              {agent.status === 'complete' ? '✓' : `${agent.progress}%`}
            </span>
            {agent.findings.length > 0 && (
              <p className="text-xs text-purple-400">{agent.findings.length} findings</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
            {capitalize(agent.workerProfile.replace('_worker', '').replace('_', ' '))}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-400">
            {agent.model}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-400">
            {agent.allowedTools.length} tools
          </span>
        </div>
        {agent.loadedSkills.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {agent.loadedSkills.slice(0, 4).map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[11px] text-purple-200"
              >
                {capitalize(skill)}
              </span>
            ))}
            {agent.loadedSkills.length > 4 && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-400">
                +{agent.loadedSkills.length - 4} more
              </span>
            )}
          </div>
        )}
        {/* Progress bar */}
        {agent.status === 'running' && (
          <div className="h-1 bg-dark-bg rounded-full overflow-hidden mt-3">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${agent.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Child agents */}
      {children && children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map(child => (
            <AgentCard
              key={child.id}
              agent={child}
              children={allChildren[child.id]}
              allChildren={allChildren}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// === CONCEPT REVIEW SCREEN ===
const ConceptReviewScreen: React.FC<{
  blueprint: CampaignBlueprint | null;
  concept: AdConcept | null;
  reviewHistory: ReviewFeedback[];
  brand: Brand | null;
  storyboardScenes: PlannedStoryboardScene[];
  productUniverseProducts: ProductContext[];
  onApprove: () => void;
  onRevise: (note?: string) => void;
  onBack: () => void;
  adFormat?: AdFormat;
  carouselSlides?: Array<{ index: number; previewUrl: string; headline: string; assetId: string }>;
}> = ({ blueprint, concept, reviewHistory, brand, storyboardScenes, productUniverseProducts, onApprove, onRevise, onBack, adFormat, carouselSlides }) => {
  const [revisionNote, setRevisionNote] = useState('');
  const effectiveConcept = blueprint?.concept || concept;
  const effectiveReviewHistory = blueprint?.reviewHistory || reviewHistory;
  const latestReview = effectiveReviewHistory[effectiveReviewHistory.length - 1];
  const brandMemory = blueprint?.brandMemory || brand?.brandMemory || null;
  const sceneContracts = blueprint?.sceneContracts || [];
  const renderManifest = blueprint?.renderManifest || null;
  const storyboardSceneCountByProduct = productUniverseProducts
    .map((product) => ({
      product,
      count: storyboardScenes.filter((scene) => scene.productId === product.productId).length,
    }))
    .filter((entry) => entry.count > 0 || productUniverseProducts.length === 1);

  if (!effectiveConcept) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400">No concept was generated. Try adjusting your brief.</p>
        <button onClick={onBack} className="mt-4 px-6 py-3 rounded-xl bg-purple-600 text-white">
          Go Back
        </button>
      </div>
    );
  }

  const scoreColor = (score: number) =>
    score >= 9 ? 'text-green-400' : score >= 7 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left side: Overview and Scores */}
        <div className="lg:w-1/3 space-y-6">
          {/* Score Card */}
          {latestReview && (
            <div className="bg-dark-card rounded-2xl border border-dark-border p-6 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Final Check</h3>
                <div className={`text-4xl font-bold ${scoreColor(latestReview.overallScore)}`}>
                  {latestReview.overallScore}/10
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { label: 'Brand', score: latestReview.brandConsistency },
                  { label: 'Hook', score: latestReview.hookStrength },
                  { label: 'Narrative', score: latestReview.narrativeFlow },
                  { label: 'Visuals', score: latestReview.visualImpact },
                  { label: 'Market Fit', score: latestReview.marketFit },
                ].map(({ label, score }) => (
                  <div key={label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">{label}</span>
                      <span className={`font-bold ${scoreColor(score)}`}>{score}/10</span>
                    </div>
                    <div className="h-1.5 bg-dark-bg rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${score >= 9 ? 'bg-green-500' : score >= 7 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${score * 10}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {effectiveReviewHistory.length > 1 && (
                <p className="text-[10px] text-gray-500 mt-6 pt-4 border-t border-dark-border">
                  Improved over {effectiveReviewHistory.length} iterations:
                  {effectiveReviewHistory.map((r, i) => ` ${r.overallScore}/10`).join(' → ')}
                </p>
              )}
            </div>
          )}

          {/* Campaign Details */}
          {blueprint && (
            <div className="bg-dark-card rounded-2xl border border-dark-border p-6 shadow-xl shadow-black/20 space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">Campaign Stats</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Platform</p>
                    <p className="text-xs text-white font-medium">{formatPlatformLabel(blueprint.brief.platform)}</p>
                  </div>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Duration</p>
                    <p className="text-xs text-white font-medium">{blueprint.brief.durationSec}s</p>
                  </div>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Scenes</p>
                    <p className="text-xs text-white font-medium">{sceneContracts.length || effectiveConcept.scenes.length}</p>
                  </div>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Mode</p>
                    <p className="text-xs text-white font-medium capitalize">{blueprint.brief.executionMode}</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-3">Product Universe</p>
                <div className="space-y-2">
                  {storyboardSceneCountByProduct.map(({ product, count }) => (
                    <div key={product.productId} className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-white font-medium truncate">{product.productTitle}</p>
                          <p className="text-[10px] text-gray-500 truncate">{product.productUrl}</p>
                        </div>
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-200">
                          {count} scene{count === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Creative Direction</p>
                <div className="space-y-2">
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Music</p>
                    <p className="text-xs text-white line-clamp-2">{effectiveConcept.musicDirection || 'Auto-selected'}</p>
                  </div>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50">
                    <p className="text-[10px] text-gray-500">Captions</p>
                    <p className="text-xs text-white">{effectiveConcept.captionStyle || 'Viral Static'}</p>
                  </div>
                </div>
              </div>

              {renderManifest ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Render Readiness</p>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-gray-500">Export Status</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold border ${
                        renderManifest.exportStatus === 'ready'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                          : renderManifest.exportStatus === 'blocked'
                            ? 'border-red-500/20 bg-red-500/10 text-red-200'
                            : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-200'
                      }`}>
                        {capitalize(renderManifest.exportStatus)}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400">{renderManifest.totalDurationSec}s across {renderManifest.scenes.length} manifest scene{renderManifest.scenes.length === 1 ? '' : 's'}</p>
                    {renderManifest.blockers.length > 0 && (
                      <div className="space-y-1 pt-1 border-t border-dark-border/50">
                        {renderManifest.blockers.map((blocker, index) => (
                          <p key={index} className="text-[11px] text-red-300">{blocker}</p>
                        ))}
                        <p className="text-[11px] text-gray-400 pt-1">
                          Confirm & Open Ad Agent still works — approval clears these readiness blockers for the handoff.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (adFormat === 'carousel' || adFormat === 'static_image' || blueprint?.brief.adFormat === 'carousel' || blueprint?.brief.adFormat === 'static_image') ? (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Render Readiness</p>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-gray-500">Export Status</span>
                      <span className="rounded-full px-2 py-1 text-[10px] font-semibold border border-cyan-500/20 bg-cyan-500/10 text-cyan-200">
                        Image slides
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Carousel / static ads export as downloadable image slides — no video render pipeline.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Render Readiness</p>
                  <div className="bg-dark-bg rounded-xl p-3 border border-dark-border/50 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] text-gray-500">Export Status</span>
                      <span className="rounded-full px-2 py-1 text-[10px] font-semibold border border-yellow-500/20 bg-yellow-500/10 text-yellow-200">
                        Draft
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Scene contracts are still assembling. Confirm to rebuild the video render manifest for Ad Agent production.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right side: Concept and Storyboard */}
        <div className="lg:w-2/3 space-y-6">
          <div className="bg-dark-card rounded-2xl border border-dark-border p-8 shadow-xl shadow-black/20">
            <h2 className="text-3xl font-bold text-white mb-2">{effectiveConcept.title}</h2>
            <div className="inline-block px-3 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-6">
              Hook: "{effectiveConcept.hook}"
            </div>
            <p className="text-gray-300 text-lg leading-relaxed mb-8">{effectiveConcept.narrative}</p>

            {effectiveConcept.creativeRationale && (
              <div className="bg-purple-500/5 rounded-xl border border-purple-500/20 p-5 mb-8">
                <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Strategy Reasoning</p>
                <p className="text-sm text-gray-300">{effectiveConcept.creativeRationale}</p>
              </div>
            )}

            <div className="space-y-6">
              <h3 className="text-xl font-bold text-white border-b border-dark-border pb-4">Storyboard</h3>
              <div className="grid grid-cols-1 gap-6">
                {effectiveConcept.scenes.map((scene, i) => {
                  const contract = sceneContracts.find((entry) => entry.sceneNumber === (scene.sceneNumber || i + 1));
                  const plannedScene = storyboardScenes[i];
                  const primaryBinding = contract?.assetBindings[0];
                  const intendsFresh = plannedScene
                    ? sceneIntendsFreshGeneration(plannedScene) && !plannedScene.selectedVariantAssetId && !plannedScene.linkedAssetId
                    : contract?.sourceMode === 'generate_fresh' && !(contract.assetBindings?.length);
                  const displayAssetId = intendsFresh
                    ? undefined
                    : (plannedScene
                      ? getSceneDisplayAssetId(plannedScene)
                      : primaryBinding?.assetId)
                      || (contract?.sourceMode === 'generate_fresh' ? undefined : primaryBinding?.assetId);
                  const boundAsset = displayAssetId
                    ? (
                      resolveBrandAssetById(brand, displayAssetId)
                      || blueprint?.productContext?.productAssets?.find((asset) => asset.id === displayAssetId)
                      || productUniverseProducts?.flatMap((product) => product.productAssets).find((asset) => asset.id === displayAssetId)
                      || (displayAssetId.startsWith('brand-index-')
                        ? brand?.assets?.[Number(displayAssetId.replace('brand-index-', ''))]
                        : undefined)
                    )
                    : undefined;
                  const previewUrl = toAssetPreviewUrl(boundAsset)
                    || toProductLockAssetPreviewUrl(boundAsset)
                    || brandMemory?.assets.find((asset) => asset.assetId === displayAssetId)?.previewUrl;
                  return (
                    <div key={i} className="bg-dark-bg/50 rounded-2xl overflow-hidden border border-dark-border/50 group hover:border-purple-500/30 transition-all">
                      <div className="flex flex-col md:flex-row">
                        {previewUrl ? (
                          <div className="md:w-48 shrink-0 relative">
                            <img
                              src={previewUrl}
                              alt={`Scene ${scene.sceneNumber || i + 1}`}
                              className="w-full h-full object-cover aspect-video md:aspect-square"
                            />
                            <div className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-sm font-bold text-white">
                              {scene.sceneNumber || i + 1}
                            </div>
                          </div>
                        ) : (
                          <div className="md:w-48 shrink-0 bg-dark-card flex flex-col items-center justify-center gap-2 aspect-video md:aspect-square border-r border-dark-border px-3 text-center">
                             <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-lg font-bold text-purple-300">
                                {scene.sceneNumber || i + 1}
                             </div>
                             {intendsFresh && (
                               <p className="text-[10px] text-gray-500 leading-snug">
                                 Generate Fresh — image created in Ad Agent
                               </p>
                             )}
                          </div>
                        )}
                        <div className="flex-1 p-6 space-y-4">
                          <div className="flex justify-between items-start">
                            <div className="space-y-2">
                              <p className="text-lg font-semibold text-white leading-snug">{scene.visualDescription}</p>
                              <div className="flex flex-wrap gap-2 text-[10px]">
                                {plannedScene?.productTitle && (
                                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-cyan-200">
                                    {plannedScene.productTitle}
                                  </span>
                                )}
                                {plannedScene?.route && (
                                  <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-purple-200">
                                    {formatStoryboardRoute(plannedScene.route)}
                                  </span>
                                )}
                                {plannedScene?.sourceMode && (
                                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-gray-300">
                                    {formatSourceMode(plannedScene.sourceMode)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] px-2 py-1 rounded bg-dark-card border border-dark-border text-gray-500 whitespace-nowrap">
                              {scene.durationSec}s · {scene.cameraMovement || 'Static'}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wider text-purple-400 font-bold">Narration</p>
                              <p className="text-sm text-gray-300 italic">"{scene.voiceoverText}"</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">Overlay Text</p>
                              <p className="text-sm text-gray-300">{scene.onScreenText || '—'}</p>
                            </div>
                          </div>

                          <div className="pt-4 border-t border-dark-border/30">
                            <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Visual Prompt</p>
                            <p className="text-xs text-gray-500 line-clamp-2 italic">{scene.imagePrompt}</p>
                            {(plannedScene?.baseAssetDescription || plannedScene?.linkedAssetDescription) && !intendsFresh && (
                              <p className="text-[11px] text-gray-400 mt-3">
                                {plannedScene.linkedAssetDescription
                                  ? `Generated variant: ${plannedScene.linkedAssetDescription}`
                                  : `Base asset: ${plannedScene.baseAssetDescription}`}
                              </p>
                            )}
                            {intendsFresh && (
                              <p className="text-[11px] text-purple-300/80 mt-3">
                                No catalog base — Ad Agent will generate this scene from the visual prompt.
                              </p>
                            )}
                            {contract?.assetBindings?.length && !intendsFresh ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {contract.assetBindings.map((binding) => (
                                  <span key={binding.assetId} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400">
                                    {binding.assetId}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Carousel Preview & Download */}
          {adFormat === 'carousel' && carouselSlides && carouselSlides.length > 0 && (
            <div className="bg-dark-card rounded-2xl border border-dark-border p-6 space-y-4 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Carousel Slides</h3>
                <div className="flex gap-2">
                  <span className="text-[11px] text-gray-500">{carouselSlides.length} slides · 1080px</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Download all as 1:1 PNG
                    carouselSlides.forEach((slide, i) => {
                      setTimeout(() => downloadSlide(slide.previewUrl, `carousel_slide_${i + 1}.png`), i * 400);
                    });
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600/20 to-cyan-500/20 border border-emerald-500/30 text-emerald-300 hover:from-emerald-600/30 hover:to-cyan-500/30 transition-all text-xs font-bold"
                >
                  ⬇ PNG (1:1)
                </button>
                <button
                  onClick={() => {
                    // Download all as 4:5 portrait (cropped from 1:1)
                    carouselSlides.forEach((slide, i) => {
                      setTimeout(() => {
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement('canvas');
                          canvas.width = 1080;
                          canvas.height = 1350;
                          const ctx = canvas.getContext('2d');
                          if (!ctx) return;
                          // Center-crop 1:1 to 4:5
                          const scale = 1350 / img.height;
                          const srcW = 1080 * scale;
                          const srcX = (img.width - srcW) / 2;
                          ctx.drawImage(img, srcX, 0, srcW, img.height, 0, 0, 1080, 1350);
                          downloadSlide(canvas.toDataURL('image/png'), `carousel_4x5_slide_${i + 1}.png`);
                        };
                        img.src = slide.previewUrl;
                      }, i * 400);
                    });
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600/10 border border-purple-500/30 text-purple-300 hover:bg-purple-600/20 transition-all text-xs font-bold"
                >
                  ⬇ PNG (4:5)
                </button>
                <button
                  onClick={() => {
                    // Export as single PDF (LinkedIn document post)
                    import('jspdf').then(({ jsPDF }) => {
                      const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [1080, 1080] });
                      carouselSlides.forEach((slide, i) => {
                        if (i > 0) pdf.addPage([1080, 1080], 'portrait');
                        pdf.addImage(slide.previewUrl, 'PNG', 0, 0, 1080, 1080);
                      });
                      pdf.save('carousel_linkedin.pdf');
                    }).catch(() => {
                      // Fallback: download individual PNGs
                      carouselSlides.forEach((slide, i) => {
                        setTimeout(() => downloadSlide(slide.previewUrl, `carousel_slide_${i + 1}.png`), i * 400);
                      });
                    });
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600/10 border border-blue-500/30 text-blue-300 hover:bg-blue-600/20 transition-all text-xs font-bold"
                >
                  ⬇ PDF (LinkedIn)
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {carouselSlides.map((slide) => (
                  <div key={slide.assetId} className="relative group">
                    <img
                      src={slide.previewUrl}
                      alt={`Slide ${slide.index + 1}`}
                      className="w-full aspect-square object-cover rounded-xl border border-dark-border"
                    />
                    <div className="absolute top-2 left-2 w-6 h-6 rounded-lg bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center text-xs font-bold text-white">
                      {slide.index + 1}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent rounded-b-xl">
                      <p className="text-[10px] text-white/90 line-clamp-2">{slide.headline}</p>
                    </div>
                    <button
                      onClick={() => downloadSlide(slide.previewUrl, `carousel_slide_${slide.index + 1}.png`)}
                      className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl cursor-pointer"
                    >
                      <span className="text-white text-xs font-medium">⬇ Download</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-gray-500">Revision Feedback (optional)</label>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="e.g. Make the hook more punchy, show more product detail in scene 2, use a warmer color palette..."
                className="w-full min-h-[60px] rounded-xl border border-dark-border bg-black/30 px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => onRevise(revisionNote.trim() || undefined)}
                className="flex-1 py-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 transition-all font-bold"
              >
                Revise
              </button>
              <button
                onClick={onApprove}
                className="flex-[2] py-4 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-500 text-white font-bold hover:shadow-2xl hover:shadow-green-500/25 transition-all text-lg"
              >
                {adFormat === 'carousel' ? 'Confirm & Done' : 'Confirm & Open Ad Agent'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BrandVideoCreator;
