import { describe, expect, it } from 'vitest';
import type { AdConcept, Brand, CampaignBrief, ReviewFeedback, SceneContract } from '../types/brand';
import {
  buildRenderManifestFromSceneContracts,
  buildSceneContractsFromConcept,
  ensureVideoRenderArtifacts,
  getRenderApprovalThreshold,
  isExportReviewReady,
  markRenderManifestReady,
} from '../services/campaignBlueprintService';
import { buildStableProductConcept, canUseStableProductCampaign } from '../services/stableProductCampaignService';

const baseBrief = (overrides: Partial<CampaignBrief> = {}): CampaignBrief => ({
  rawPrompt: 'Launch a 30s TikTok for our cleanser',
  adFormat: 'stitched_video',
  platform: 'tiktok',
  objective: 'conversion',
  durationSec: 15,
  executionMode: 'balanced',
  productUrl: 'https://example.com/products/glow-cleanser',
  ...overrides,
});

const sampleConcept = (): AdConcept => ({
  title: 'Glow Cleanser',
  adFormat: 'stitched_video',
  hook: 'Meet your new cleanser',
  narrative: 'Product-first story',
  scenes: [
    {
      sceneNumber: 1,
      visualDescription: 'Hero product packshot',
      imagePrompt: 'Hero product packshot',
      voiceoverText: 'Meet Glow Cleanser',
      onScreenText: 'Glow Cleanser',
      durationSec: 5,
      brandAssetRef: 'asset-1',
      brandAssetEditAction: 'edit',
    },
    {
      sceneNumber: 2,
      visualDescription: 'CTA with product',
      imagePrompt: 'CTA with product',
      voiceoverText: 'Shop now',
      onScreenText: 'Shop now',
      durationSec: 5,
      brandAssetRef: 'asset-1',
      brandAssetEditAction: 'use_as_is',
    },
  ],
  musicDirection: 'Clean pulse',
  captionStyle: 'Bold',
  colorMood: 'Warm',
  estimatedDuration: 15,
  creativeRationale: 'Keep the product on screen',
});

const sampleBrand = (): Brand => ({
  id: 'brand-1',
  userId: 'user-1',
  name: 'Glow Co',
  websiteUrl: 'https://example.com',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dna: null,
  assets: [
    {
      id: 'asset-1',
      type: 'product',
      mimeType: 'image/jpeg',
      base64: 'abc',
      description: 'Hero packshot of Glow Cleanser bottle',
      sourceProductTitle: 'Glow Cleanser',
    },
  ],
  status: 'ready',
});

const review = (overrides: Partial<ReviewFeedback> = {}): ReviewFeedback => ({
  stage: 'concept',
  overallScore: 8.6,
  brandConsistency: 8.5,
  hookStrength: 8.5,
  narrativeFlow: 8.5,
  visualImpact: 8.5,
  marketFit: 8.5,
  verdict: 'needs_revision',
  critiques: [],
  mandatoryFixes: [],
  suggestions: [],
  ...overrides,
});

describe('getRenderApprovalThreshold', () => {
  it('matches orchestrator execution-mode thresholds', () => {
    expect(getRenderApprovalThreshold('fast')).toBe(7);
    expect(getRenderApprovalThreshold('balanced')).toBe(8.5);
    expect(getRenderApprovalThreshold('agency')).toBe(9);
  });
});

describe('isExportReviewReady', () => {
  it('treats threshold-passing scores without mandatory fixes as ready', () => {
    expect(isExportReviewReady(review({ overallScore: 8.6 }), 8.5)).toBe(true);
    expect(isExportReviewReady(review({ overallScore: 7.2, verdict: 'needs_revision' }), 7)).toBe(true);
    expect(isExportReviewReady(review({ overallScore: 9.1, verdict: 'approved' }), 9)).toBe(true);
  });

  it('blocks when score is below the mode threshold', () => {
    expect(isExportReviewReady(review({ overallScore: 8.2, verdict: 'needs_revision' }), 8.5)).toBe(false);
  });

  it('blocks when mandatoryFixes remain even if score is high', () => {
    expect(
      isExportReviewReady(
        review({
          overallScore: 9.2,
          verdict: 'approved',
          mandatoryFixes: ['Bind scene 2 to a product asset'],
        }),
        8.5,
      ),
    ).toBe(false);
    expect(isExportReviewReady(review({ overallScore: 9.5, mandatoryFixes: ['Fix binding'] }), 7)).toBe(false);
  });
});

describe('buildRenderManifestFromSceneContracts', () => {
  it('marks balanced-mode drafts ready at 8.6 without requiring a hard 9', () => {
    const brief = baseBrief({ executionMode: 'balanced' });
    const contracts = buildSceneContractsFromConcept(sampleConcept(), brief, sampleBrand());
    const manifest = buildRenderManifestFromSceneContracts(contracts, brief, [
      review({ overallScore: 8.6, verdict: 'needs_revision' }),
    ]);

    expect(manifest.scenes).toHaveLength(2);
    expect(manifest.exportStatus).toBe('ready');
    expect(manifest.blockers).toEqual([]);
    expect(manifest.scenes.every((scene) => scene.assetIds.length > 0)).toBe(true);
  });

  it('stays blocked when mandatoryFixes exist', () => {
    const brief = baseBrief({ executionMode: 'fast' });
    const contracts = buildSceneContractsFromConcept(sampleConcept(), brief, sampleBrand());
    const manifest = buildRenderManifestFromSceneContracts(contracts, brief, [
      review({
        overallScore: 9,
        verdict: 'approved',
        mandatoryFixes: ['Ground more scenes in product assets'],
      }),
    ]);

    expect(manifest.exportStatus).toBe('blocked');
    expect(manifest.blockers[0]).toContain('Ground more scenes');
  });

  it('stays blocked when score is below the mode threshold', () => {
    const brief = baseBrief({ executionMode: 'agency' });
    const contracts = buildSceneContractsFromConcept(sampleConcept(), brief, sampleBrand());
    const manifest = buildRenderManifestFromSceneContracts(contracts, brief, [
      review({ overallScore: 8.6, verdict: 'needs_revision' }),
    ]);

    expect(manifest.exportStatus).toBe('blocked');
    expect(manifest.blockers[0]).toMatch(/8\.6\/10/);
  });
});

describe('markRenderManifestReady', () => {
  it('clears blockers for user approve handoff', () => {
    const blocked: ReturnType<typeof buildRenderManifestFromSceneContracts> = {
      manifestId: 'manifest_test',
      adFormat: 'stitched_video',
      platform: 'tiktok',
      totalDurationSec: 10,
      scenes: [],
      exportStatus: 'blocked',
      blockers: ['Ground more scenes'],
    };

    expect(markRenderManifestReady(blocked)).toEqual({
      ...blocked,
      exportStatus: 'ready',
      blockers: [],
    });
  });
});

describe('ensureVideoRenderArtifacts', () => {
  it('rebuilds missing sceneContracts and a usable renderManifest from the concept', () => {
    const brief = baseBrief();
    const concept = sampleConcept();
    const artifacts = ensureVideoRenderArtifacts({
      concept,
      brief,
      brand: sampleBrand(),
      sceneContracts: [],
      renderManifest: null,
      reviewHistory: [review({ overallScore: 9, verdict: 'approved' })],
    });

    expect(artifacts.sceneContracts.length).toBe(2);
    expect(artifacts.renderManifest.scenes.length).toBe(2);
    expect(artifacts.renderManifest.exportStatus).toBe('ready');
  });

  it('refreshes a stale blocked manifest when the score now meets the mode threshold', () => {
    const brief = baseBrief({ executionMode: 'balanced' });
    const concept = sampleConcept();
    const contracts = buildSceneContractsFromConcept(concept, brief, sampleBrand());
    const staleBlocked: ReturnType<typeof buildRenderManifestFromSceneContracts> = {
      manifestId: 'stale',
      adFormat: 'stitched_video',
      platform: 'tiktok',
      totalDurationSec: 10,
      scenes: contracts.map((scene) => ({
        sceneId: scene.sceneId,
        durationSec: scene.durationTargetSec || 0,
        voiceoverText: scene.voiceoverText || '',
        onScreenText: scene.onScreenText,
        assetIds: scene.assetBindings.map((b) => b.assetId),
      })),
      exportStatus: 'blocked',
      blockers: ['Concept scored 8.6/10; needs 9+ or approval before export.'],
    };

    const artifacts = ensureVideoRenderArtifacts({
      concept,
      brief,
      brand: sampleBrand(),
      sceneContracts: contracts,
      renderManifest: staleBlocked,
      reviewHistory: [review({ overallScore: 8.6 })],
    });

    expect(artifacts.renderManifest.exportStatus).toBe('ready');
    expect(artifacts.renderManifest.blockers).toEqual([]);
  });

  it('preserves existing scene contracts when present', () => {
    const existing: SceneContract[] = [{
      sceneId: 'scene_custom',
      sceneNumber: 1,
      role: 'HOOK',
      durationTargetSec: 4,
      platform: 'tiktok',
      objective: 'conversion',
      adFormat: 'stitched_video',
      voiceoverText: 'Custom',
      onScreenText: 'Custom',
      visualIntent: 'Custom',
      sourceMode: 'use_exact_asset',
      assetBindings: [{ assetId: 'asset-1', mode: 'use_exact_asset', reason: 'test', required: true }],
      status: 'planned',
    }];

    const artifacts = ensureVideoRenderArtifacts({
      concept: sampleConcept(),
      brief: baseBrief(),
      brand: sampleBrand(),
      sceneContracts: existing,
      renderManifest: null,
      reviewHistory: [],
    });

    expect(artifacts.sceneContracts).toBe(existing);
    expect(artifacts.renderManifest.scenes[0].sceneId).toBe('scene_custom');
  });
});

describe('stableProductCampaignService handoff', () => {
  it('can build a product-first concept with grounded scene contracts + ready manifest', () => {
    const brand = sampleBrand();
    const productUrl = 'https://example.com/products/glow-cleanser';
    const brief = baseBrief({
      productUrl,
      productContext: {
        productId: 'p1',
        productTitle: 'Glow Cleanser',
        productUrl,
        brandName: brand.name,
        productAssets: brand.assets,
        allowedClaims: ['Gentle daily cleanse'],
        productFacts: ['Fragrance-free cleanser'],
        signalSummary: 'Clean beauty cleanser',
        platform: 'tiktok',
        durationSec: 15,
      },
    });

    expect(canUseStableProductCampaign(brief, brand)).toBe(true);

    const { concept, review: stableReview } = buildStableProductConcept(brief, brand);
    const contracts = buildSceneContractsFromConcept(concept, brief, brand);
    const manifest = buildRenderManifestFromSceneContracts(contracts, brief, [stableReview]);

    expect(concept.scenes.length).toBeGreaterThan(0);
    expect(contracts.every((c: SceneContract) => c.assetBindings.length > 0)).toBe(true);
    expect(manifest.exportStatus).toBe('ready');
    expect(manifest.scenes.length).toBe(contracts.length);
  });

  it('does not invent catalog bindings for preferred generate_fresh scenes', () => {
    const brand = sampleBrand();
    const productUrl = 'https://example.com/products/glow-cleanser';
    const brief = baseBrief({
      productUrl,
      productContext: {
        productId: 'p1',
        productTitle: 'Glow Cleanser',
        productUrl,
        brandName: brand.name,
        productAssets: [
          ...brand.assets,
          {
            id: 'asset-2',
            type: 'product',
            mimeType: 'image/jpeg',
            base64: 'def',
            description: 'Lifestyle flat lay',
          },
        ],
        allowedClaims: ['Gentle daily cleanse'],
        productFacts: ['Fragrance-free cleanser'],
        signalSummary: 'Clean beauty cleanser',
        platform: 'tiktok',
        durationSec: 15,
      },
      preferredScenes: [
        {
          sceneNumber: 1,
          text: 'Hand taps remote in a soccer jersey',
          visualDescription: 'Hand taps remote in a soccer jersey with product tin in sunlight',
          imagePrompt: 'Cinematic living-room nerves before kickoff',
          sourceMode: 'generate_fresh',
        },
        {
          sceneNumber: 2,
          text: 'Hero packshot',
          visualDescription: 'Hero packshot of Glow Cleanser',
          imagePrompt: 'Clean packshot',
          assetId: 'asset-1',
          sourceMode: 'use_exact_asset',
        },
      ],
    });

    const { concept } = buildStableProductConcept(brief, brand);
    expect(concept.scenes[0].brandAssetRef).toBeUndefined();
    expect(concept.scenes[1].brandAssetRef).toBe('asset-1');

    const contracts = buildSceneContractsFromConcept(concept, brief, brand);
    expect(contracts[0].sourceMode).toBe('generate_fresh');
    expect(contracts[0].assetBindings).toEqual([]);
    expect(contracts[1].assetBindings[0]?.assetId).toBe('asset-1');
  });
});
