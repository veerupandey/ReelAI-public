import { describe, expect, it } from 'vitest';
import {
  buildHandoffProductImageLane,
  clampAgentDurationSec,
  mapCampaignBlueprintToAgentLaunch,
  mapCampaignBlueprintToStudioHandoff,
  prepareAgentLaunchForSessionStorage,
  resolveHandoffBrandAsset,
} from '../services/brandVideoHandoff';
import { peekAgentLaunchHeavy, takeAgentLaunchHeavy } from '../services/agentLaunchStore';
import { buildCampaignBlueprint, buildSceneContractsFromConcept } from '../services/campaignBlueprintService';
import type { AdConcept, Brand, BrandMemory, CampaignBrief } from '../types/brand';

const brand = (): Brand => ({
  id: 'brand-1',
  userId: 'user-1',
  name: 'Glow Co',
  websiteUrl: 'https://example.com',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dna: null,
  assets: [
    {
      id: 'asset-hero',
      type: 'product',
      mimeType: 'image/jpeg',
      base64: 'hero-bytes',
      description: 'Hero bottle',
      originPageUrl: 'https://example.com/products/glow',
    },
    {
      id: 'asset-detail',
      type: 'product',
      mimeType: 'image/jpeg',
      base64: 'detail-bytes',
      description: 'Detail texture',
    },
  ],
  status: 'ready',
});

const brief = (): CampaignBrief => ({
  rawPrompt: 'Sell Glow Cleanser on TikTok',
  adFormat: 'stitched_video',
  platform: 'tiktok',
  objective: 'conversion',
  durationSec: 15,
  executionMode: 'balanced',
  productUrl: 'https://example.com/products/glow',
  productContext: {
    productId: 'p1',
    productTitle: 'Glow Cleanser',
    productUrl: 'https://example.com/products/glow',
    brandName: 'Glow Co',
    productAssets: [
      {
        id: 'asset-hero',
        type: 'product',
        mimeType: 'image/jpeg',
        base64: 'hero-bytes',
        description: 'Hero bottle',
      },
      {
        id: 'asset-detail',
        type: 'product',
        mimeType: 'image/jpeg',
        base64: 'detail-bytes',
        description: 'Detail texture',
      },
    ],
    allowedClaims: ['Gentle cleanse'],
    productFacts: ['Fragrance-free'],
    platform: 'tiktok',
    durationSec: 15,
  },
});

const concept = (): AdConcept => ({
  title: 'Glow Launch',
  adFormat: 'stitched_video',
  hook: 'Meet Glow',
  narrative: 'Product first',
  creativeRationale: 'Keep the bottle on screen',
  musicDirection: 'Soft pulse',
  captionStyle: 'Bold',
  colorMood: 'Warm',
  estimatedDuration: 15,
  scenes: [
    {
      sceneNumber: 1,
      visualDescription: 'Hero packshot',
      imagePrompt: 'Hero packshot of Glow Cleanser',
      voiceoverText: 'Meet Glow Cleanser',
      onScreenText: 'Glow Cleanser',
      durationSec: 5,
      brandAssetRef: 'asset-hero',
      brandAssetEditAction: 'use_as_is',
    },
    {
      sceneNumber: 2,
      visualDescription: 'Texture detail',
      imagePrompt: 'Macro texture of cleanser',
      voiceoverText: 'Clean skin starts here',
      onScreenText: 'Shop now',
      durationSec: 5,
      brandAssetRef: 'asset-detail',
      brandAssetEditAction: 'edit',
    },
  ],
});

describe('brandVideoHandoff', () => {
  it('aligns brandImageIndex with productImages even when brandMemory order differs', () => {
    const activeBrand = brand();
    const memory: BrandMemory = {
      brandId: activeBrand.id,
      name: activeBrand.name,
      websiteUrl: activeBrand.websiteUrl,
      dna: null,
      assets: [
        {
          assetId: 'asset-detail',
          brandAssetId: 'asset-detail',
          type: 'product',
          origin: 'imported',
          mimeType: 'image/jpeg',
          description: 'Detail first in memory',
          productIdentity: 'Glow Cleanser',
        },
        {
          assetId: 'asset-hero',
          brandAssetId: 'asset-hero',
          type: 'product',
          origin: 'imported',
          mimeType: 'image/jpeg',
          description: 'Hero second in memory',
          productIdentity: 'Glow Cleanser',
        },
      ],
      approvedClaims: [],
      evidenceSummary: [],
    };

    const sceneContracts = buildSceneContractsFromConcept(concept(), brief(), activeBrand);
    const blueprint = buildCampaignBlueprint({
      brief: brief(),
      concept: concept(),
      brandMemory: memory,
      productContext: brief().productContext,
      sceneContracts,
      renderManifest: null,
      reviewHistory: [],
    });

    const handoff = mapCampaignBlueprintToStudioHandoff(blueprint, activeBrand);

    expect(handoff.isVideoAd).toBe(true);
    expect(handoff.productImages.map((asset) => asset.assetId)).toEqual(['asset-hero', 'asset-detail']);
    expect(handoff.assetCatalog.map((entry) => entry.imageIndex)).toEqual([0, 1]);
    expect(handoff.reelPlan.scenes[0].brandImageIndex).toBe(0);
    expect(handoff.reelPlan.scenes[0].userProvidedImage?.base64).toBe('hero-bytes');
    expect(handoff.reelPlan.scenes[0].storyboardSourceMode).toBe('use_exact_asset');
    expect(handoff.reelPlan.scenes[1].brandImageIndex).toBe(1);
    expect(handoff.reelPlan.scenes[1].brandAssetEditAction).toBe('edit');
    expect(handoff.reelPlan.scenes[1].scriptGuidance).toBe('Clean skin starts here');
    expect(handoff.reelPlan.scenes[1].onScreenText).toBe('Shop now');
    expect(handoff.reelPlan.scenes.every((scene) => scene.storyboardBaseAssetId)).toBe(true);
  });

  it('rebuilds missing scene contracts so approve still produces a usable plan', () => {
    const activeBrand = brand();
    const blueprint = buildCampaignBlueprint({
      brief: brief(),
      concept: concept(),
      brandMemory: null,
      productContext: brief().productContext,
      sceneContracts: [],
      renderManifest: null,
      reviewHistory: [],
    });

    const handoff = mapCampaignBlueprintToStudioHandoff(blueprint, activeBrand);

    expect(handoff.sceneContracts.length).toBe(2);
    expect(handoff.reelPlan.scenes).toHaveLength(2);
    expect(handoff.productImages.length).toBeGreaterThan(0);
    expect(handoff.reelPlan.scenes[0].brandImageIndex).toBeDefined();
  });

  it('resolves locked product assets that are not yet on brand.assets', () => {
    const activeBrand = brand();
    activeBrand.assets = [];
    const productOnlyAsset = {
      id: 'locked-only',
      type: 'product' as const,
      mimeType: 'image/jpeg',
      base64: 'locked-bytes',
      description: 'Locked product packshot',
    };
    const campaignBrief = {
      ...brief(),
      productContext: {
        ...brief().productContext!,
        productAssets: [productOnlyAsset],
      },
    };
    const adConcept = {
      ...concept(),
      scenes: [
        {
          ...concept().scenes[0],
          brandAssetRef: 'locked-only',
          brandAssetEditAction: 'use_as_is' as const,
        },
      ],
    };
    const blueprint = buildCampaignBlueprint({
      brief: campaignBrief,
      concept: adConcept,
      brandMemory: null,
      productContext: campaignBrief.productContext,
      sceneContracts: buildSceneContractsFromConcept(adConcept, campaignBrief, activeBrand),
      renderManifest: null,
      reviewHistory: [],
    });

    expect(resolveHandoffBrandAsset(activeBrand, blueprint, 'locked-only')?.id).toBe('locked-only');

    const { productImages } = buildHandoffProductImageLane(activeBrand, blueprint);
    expect(productImages.map((asset) => asset.assetId)).toEqual(['locked-only']);

    const handoff = mapCampaignBlueprintToStudioHandoff(blueprint, activeBrand);
    expect(handoff.reelPlan.scenes[0].brandImageIndex).toBe(0);
    expect(handoff.reelPlan.scenes[0].userProvidedImage?.base64).toBe('locked-bytes');
  });

  it('skips video pipeline flags for carousel handoffs', () => {
    const handoff = mapCampaignBlueprintToStudioHandoff(
      buildCampaignBlueprint({
        brief: { ...brief(), adFormat: 'carousel' },
        concept: { ...concept(), adFormat: 'carousel' },
        brandMemory: null,
        sceneContracts: [],
        renderManifest: null,
        reviewHistory: [],
      }),
      brand(),
    );

    expect(handoff.isVideoAd).toBe(false);
  });

  it('maps approved Agency video blueprint into AutonomousAgent launch params', () => {
    const activeBrand = brand();
    const sceneContracts = buildSceneContractsFromConcept(concept(), brief(), activeBrand);
    const blueprint = buildCampaignBlueprint({
      brief: brief(),
      concept: concept(),
      brandMemory: null,
      productContext: brief().productContext,
      sceneContracts,
      renderManifest: null,
      reviewHistory: [],
    });

    const handoff = mapCampaignBlueprintToAgentLaunch(blueprint, activeBrand);

    expect(handoff.agentId).toBe('ad-agent');
    expect(handoff.isVideoAd).toBe(true);
    expect(handoff.params.source).toBe('brand_video_agency');
    expect(handoff.params.autoStart).toBe(true);
    expect(handoff.params.lockPlan).toBe(true);
    expect(handoff.params.reviewMode).toBe(false);
    expect(handoff.params.productUrl).toBe('https://example.com/products/glow');
    expect(handoff.params.skipResearch).toBe(true);
    expect(handoff.params.productFacts.length).toBeGreaterThan(0);
    expect(handoff.params.seedScenes).toHaveLength(2);
    expect(handoff.params.seedScenes[0].imagePrompt).toContain('Glow Cleanser');
    expect(handoff.params.seedScenes[0].preserveExactAsset).toBe(true);
    expect(handoff.params.seedScenes[0].lockedAssetId).toBe('asset-hero');
    expect(handoff.params.sceneAssetBank['asset-hero']?.base64).toBe('hero-bytes');
    expect(handoff.params.approvedConcept.title).toBe('Glow Launch');
    expect(handoff.params.creativeBrief).toContain('AGENCY LOCK');
    expect(clampAgentDurationSec(10)).toBe(15);
  });

  it('stores lean sessionStorage payload and rehydrates heavy binaries from stash', () => {
    const activeBrand = brand();
    const sceneContracts = buildSceneContractsFromConcept(concept(), brief(), activeBrand);
    const blueprint = buildCampaignBlueprint({
      brief: brief(),
      concept: concept(),
      brandMemory: null,
      productContext: brief().productContext,
      sceneContracts,
      renderManifest: null,
      reviewHistory: [],
    });

    const handoff = mapCampaignBlueprintToAgentLaunch(blueprint, activeBrand);
    const lean = prepareAgentLaunchForSessionStorage(handoff);
    const serialized = JSON.stringify(lean);

    expect(serialized.length).toBeLessThan(50_000);
    expect(lean.params.productBase64).toBeUndefined();
    expect(Object.values(lean.params.sceneAssetBank).every((entry) => entry.base64 === '')).toBe(true);
    expect(lean.params.referenceUploads.every((entry) => entry.base64 === '')).toBe(true);

    const heavy = takeAgentLaunchHeavy(lean.launchId);
    expect(heavy?.sceneAssetBank['asset-hero']?.base64).toBe('hero-bytes');
    expect(heavy?.productBase64).toBeTruthy();
    expect(peekAgentLaunchHeavy(lean.launchId)).toBeUndefined();
  });

  it('keeps carousel Agency approvals off the Agent Console path', () => {
    const handoff = mapCampaignBlueprintToAgentLaunch(
      buildCampaignBlueprint({
        brief: { ...brief(), adFormat: 'carousel' },
        concept: { ...concept(), adFormat: 'carousel' },
        brandMemory: null,
        sceneContracts: [],
        renderManifest: null,
        reviewHistory: [],
      }),
      brand(),
    );

    expect(handoff.isVideoAd).toBe(false);
  });
});
