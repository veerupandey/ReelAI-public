import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BrandVideoCreator from '../components/BrandVideoCreator';
import type { AdConcept, CampaignBrief, ProductContext } from '../types/brand';

const {
  mockImportedProductAssets,
  mockResolveProductBrief,
  mockSuggestCampaignBriefPrompt,
} = vi.hoisted(() => ({
  mockImportedProductAssets: [
    {
      id: 'asset_saffron_oil_1',
      type: 'product' as const,
      base64: 'ZmFrZQ==',
      mimeType: 'image/jpeg',
      description: 'Bare and Fair saffron oil bottle on warm stone',
      sourceUrl: 'https://cdn.example.com/saffron-oil.jpg',
      previewUrl: 'data:image/jpeg;base64,ZmFrZQ==',
      sourceProductTitle: 'Saffron Oil',
    },
  ],
  mockResolveProductBrief: vi.fn(),
  mockSuggestCampaignBriefPrompt: vi.fn(),
}));

vi.mock('../services/productPageImportService', async () => {
  const actual = await vi.importActual<typeof import('../services/productPageImportService')>('../services/productPageImportService');
  return {
    ...actual,
    importProductPageAssets: vi.fn(async (productUrl: string) =>
      mockImportedProductAssets.map((asset) => ({ ...asset, originPageUrl: productUrl })),
    ),
    importProductPageAssetsRich: vi.fn(async (productUrl: string) => ({
      assets: mockImportedProductAssets.map((asset) => ({ ...asset, originPageUrl: productUrl })),
      productTitle: 'Saffron Oil',
      warnings: [],
      pageReachable: true,
      imageCount: mockImportedProductAssets.length,
    })),
  };
});

vi.mock('../services/productResolverService', async () => {
  const actual = await vi.importActual<typeof import('../services/productResolverService')>('../services/productResolverService');
  return {
    ...actual,
    resolveProductBrief: mockResolveProductBrief,
  };
});

vi.mock('../services/geminiService', async () => {
  const actual = await vi.importActual<typeof import('../services/geminiService')>('../services/geminiService');
  return {
    ...actual,
    suggestCampaignBriefPrompt: mockSuggestCampaignBriefPrompt,
    analyzeProductAssets: vi.fn(async ({ assets }: { assets: any[] }) => assets),
  };
});

const mockConcept: AdConcept = {
  title: 'Saffron Oil Reset',
  adFormat: 'stitched_video',
  hook: 'Dull skin, meet saffron glow.',
  narrative: 'A short premium skincare spot built from the locked product page and approved product visuals.',
  creativeRationale: 'Lead with the bottle, then move into proof and payoff while preserving exact product identity.',
  scenes: [
    {
      sceneNumber: 1,
      durationSec: 5,
      transitionIn: 'cut',
      visualDescription: 'Hero packshot of the saffron oil bottle.',
      cameraMovement: 'slow push',
      voiceoverText: 'Meet the saffron oil ritual for dull skin.',
      onScreenText: 'Saffron Oil',
      imagePrompt: 'Premium hero packshot of the Bare and Fair saffron oil bottle on warm natural stone.',
      brandAssetRef: 'asset_saffron_oil_1',
      brandAssetEditAction: 'use_as_is',
    },
    {
      sceneNumber: 2,
      durationSec: 5,
      transitionIn: 'cut',
      visualDescription: 'Close detail shot showing texture and premium finish.',
      cameraMovement: 'macro glide',
      voiceoverText: 'Rich texture, refined finish, glow-first feel.',
      onScreenText: 'Glow-first finish',
      imagePrompt: 'Macro detail of saffron oil bottle and rich golden oil texture.',
      brandAssetRef: 'asset_saffron_oil_1',
      brandAssetEditAction: 'edit',
    },
  ],
  musicDirection: 'Soft premium percussion with warm organic textures.',
  captionStyle: 'Minimal premium captions',
  colorMood: 'warm golden tones with soft shadows',
  estimatedDuration: 10,
};

vi.mock('../agents/AgentOrchestrator', () => {
  return {
    AgentOrchestrator: class MockAgentOrchestrator {
      public context = {
        brandMemory: {
          name: 'Bare and Fair',
          websiteUrl: 'https://bareandfair.ca/products/saffron-oil',
          dna: null,
          approvedClaims: [],
          bannedTerms: [],
          assets: [],
        },
        sceneContracts: [
          {
            sceneId: 'scene_1',
            sceneNumber: 1,
            role: 'HOOK',
            durationTargetSec: 5,
            platform: 'tiktok',
            objective: 'conversion',
            adFormat: 'stitched_video',
            voiceoverText: 'Meet the saffron oil ritual for dull skin.',
            onScreenText: 'Saffron Oil',
            visualIntent: 'Hero packshot of the saffron oil bottle.',
            sourceMode: 'use_exact_asset',
            assetBindings: [{ assetId: 'asset_saffron_oil_1', mode: 'use_exact_asset', reason: 'locked', required: true }],
            status: 'planned',
          },
          {
            sceneId: 'scene_2',
            sceneNumber: 2,
            role: 'SCENE',
            durationTargetSec: 5,
            platform: 'tiktok',
            objective: 'conversion',
            adFormat: 'stitched_video',
            voiceoverText: 'Rich texture, refined finish, glow-first feel.',
            onScreenText: 'Glow-first finish',
            visualIntent: 'Close detail shot showing texture and premium finish.',
            sourceMode: 'edit_from_asset',
            assetBindings: [{ assetId: 'asset_saffron_oil_1', mode: 'edit_from_asset', reason: 'locked', required: true }],
            status: 'planned',
          },
        ],
        renderManifest: {
          manifestId: 'manifest_test',
          adFormat: 'stitched_video',
          platform: 'tiktok',
          totalDurationSec: 10,
          scenes: [
            { sceneId: 'scene_1', durationSec: 5, voiceoverText: 'Meet the saffron oil ritual for dull skin.', onScreenText: 'Saffron Oil', assetIds: ['asset_saffron_oil_1'] },
            { sceneId: 'scene_2', durationSec: 5, voiceoverText: 'Rich texture, refined finish, glow-first feel.', onScreenText: 'Glow-first finish', assetIds: ['asset_saffron_oil_1'] },
          ],
          exportStatus: 'ready',
          blockers: [],
        },
        reviewHistory: [
          {
            overallScore: 9,
            brandConsistency: 9,
            hookStrength: 9,
            narrativeFlow: 9,
            visualImpact: 9,
            marketFit: 9,
            verdict: 'approved',
            mandatoryFixes: [],
            suggestedImprovements: [],
          },
        ],
      };

      onEvent() {
        return () => {};
      }

      stop() {}

      async runCampaign(_brief: CampaignBrief | string, _brand?: unknown) {
        return mockConcept;
      }
    },
  };
});

describe('BrandVideoCreator flow', () => {
  beforeEach(() => {
    localStorage.clear();
    mockResolveProductBrief.mockReset();
    mockResolveProductBrief.mockResolvedValue({
      status: 'resolved',
      selectedCandidate: {
        productId: 'https://bareandfair.ca/products/saffron-oil',
        productUrl: 'https://bareandfair.ca/products/saffron-oil',
        productTitle: 'Saffron Oil',
        confidence: 999,
        source: 'explicit_url',
      },
      candidates: [],
    });
    mockSuggestCampaignBriefPrompt.mockReset();
    mockSuggestCampaignBriefPrompt.mockImplementation(async ({ productUrl }: { productUrl: string }) =>
      `Create an ad for ${productUrl}\nKeep it premium and conversion-focused.`,
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('walks from brand hub to concept review and hands off to script studio', async () => {
    const onConceptApproved = vi.fn();

    render(
      <BrandVideoCreator
        userId="test-user"
        onBack={() => {}}
        onConceptApproved={onConceptApproved}
      />,
    );

    expect(screen.getByText('Your Brands')).toBeTruthy();

    fireEvent.click(screen.getByText('Add New Brand'));
    fireEvent.change(screen.getByPlaceholderText('Your brand name'), { target: { value: 'Bare and Fair' } });
    fireEvent.change(screen.getByPlaceholderText('yourbrand.com'), { target: { value: 'https://bareandfair.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Brand' }));

    fireEvent.click(await screen.findByText('Bare and Fair'));

    expect(await screen.findByText('Import Product')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/example\.com\/products\/your-product/), {
      target: {
        value: 'https://bareandfair.ca/products/saffron-oil',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Product Knowledge')).toBeTruthy();
    expect(await screen.findByText('Saffron Oil')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Images →' }));

    expect(await screen.findByText('Image Studio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build Storyboard →' }));

    expect(await screen.findByText('Storyboard')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Describe the ad creative direction/i), {
      target: {
        value: 'Create an ad for https://bareandfair.ca/products/saffron-oil\nTarget acne-prone skin. Keep it premium and conversion-focused.',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /AI: Write Storyboard/i }));
  });

  it('uses the saved brand site to resolve a product before AI writes the brief', async () => {
    render(
      <BrandVideoCreator
        userId="test-user"
        onBack={() => {}}
        onConceptApproved={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('Add New Brand'));
    fireEvent.change(screen.getByPlaceholderText('Your brand name'), { target: { value: 'Bare and Fair' } });
    fireEvent.change(screen.getByPlaceholderText('yourbrand.com'), { target: { value: 'https://bareandfair.ca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Brand' }));

    fireEvent.click(await screen.findByText('Bare and Fair'));

    expect(await screen.findByText('Import Product')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/example\.com\/products\/your-product/), {
      target: {
        value: 'https://bareandfair.ca/products/clove-curcumin-aloe-vera-serum',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Product Knowledge')).toBeTruthy();
    expect(await screen.findByText('Saffron Oil')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to Images →' }));
    expect(await screen.findByText('Image Studio')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build Storyboard →' }));
    expect(await screen.findByText('Storyboard')).toBeTruthy();
  });
});
