import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgencyCreativeCopilot, {
  buildAgencyProductionPrompt,
} from '../../components/AIImageStudio/AgencyCreativeCopilot';
import type { Brand, BrandAsset, ProductContext } from '../../types/brand';
import type { CreativeConcept } from '../../components/AIImageStudio/types';

const runCreativeCopilot = vi.hoisted(() => vi.fn());
const generateMoreConcepts = vi.hoisted(() => vi.fn());
const persistBrandKnowledge = vi.hoisted(() => vi.fn());

vi.mock('../../components/AIImageStudio/creativeCopilotService', () => ({
  runCreativeCopilot: (...args: unknown[]) => runCreativeCopilot(...args),
  generateMoreConcepts: (...args: unknown[]) => generateMoreConcepts(...args),
  getCopilotWarnings: () => [],
}));

vi.mock('../../components/AIImageStudio/brandKnowledgeService', () => ({
  normalizeBrandUrls: (urls: string[]) =>
    urls.map((u) => (u.startsWith('http') ? u : `https://${u}`)).filter(Boolean),
  researchBrand: vi.fn(),
}));

vi.mock('../../services/brandKnowledgeAdapter', () => ({
  persistBrandKnowledge: (...args: unknown[]) => persistBrandKnowledge(...args),
  mergeBrandKnowledgeIntoBrandDNA: vi.fn(),
}));

vi.mock('../../services/brandService', () => ({
  updateBrandDNA: vi.fn(),
}));

function makeAsset(id: string): BrandAsset {
  return {
    id,
    type: 'product',
    base64: 'YWJj',
    mimeType: 'image/png',
    description: `Asset ${id}`,
    sourceProductTitle: 'Glow Serum',
    verdict: 'use_as_is',
  };
}

const lockedProduct: ProductContext = {
  productId: 'p1',
  productTitle: 'Glow Serum',
  productUrl: 'https://example.com/glow',
  brandName: 'Glow Co',
  productAssets: [makeAsset('a1')],
  productFacts: [],
  allowedClaims: [],
  platform: 'instagram_feed',
  durationSec: 15,
};

const brand: Brand = {
  id: 'brand-1',
  userId: 'u1',
  name: 'Glow Co',
  websiteUrl: 'https://glow.example',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dna: {
    colors: {
      primary: '#112233',
      secondary: '#FFFFFF',
      accent: '#888888',
      palette: ['#112233', '#FFFFFF'],
      reasoning: 'Test',
    },
    typography: { headingStyle: 'Sans', bodyStyle: 'Sans', characterTraits: '' },
    visualSignature: 'Soft',
    aesthetic: ['Soft daylight'],
    brandVoice: { tone: 'Calm', personality: '', vocabulary: ['Ritual'] },
    tagline: '',
    valuePropositions: [],
    targetAudience: { demographics: '', psychographics: '', painPoints: [] },
    products: [],
    keyIngredients: [],
    instagramAesthetic: '',
    contentPillars: [],
    topPerformingPatterns: [],
    postingFrequency: '',
    competitorInsights: '',
    differentiators: [],
    marketPosition: '',
  },
  assets: [],
  status: 'ready',
};

const concept: CreativeConcept = {
  id: 'c1',
  title: 'Quiet Ritual',
  oneLineIdea: 'Morning serum ceremony',
  visualDirection: 'Soft daylight product ceremony on linen',
  hook: 'Start soft',
  negativePrompt: 'No neon',
  brandFitRationale: 'Fits brand calm tone',
  productTruthNotes: [],
  suggestedReferenceRoles: [],
  sourceTrendInsightIds: [],
  status: 'candidate',
};

describe('AgencyCreativeCopilot', () => {
  beforeEach(() => {
    runCreativeCopilot.mockReset();
    generateMoreConcepts.mockReset();
    persistBrandKnowledge.mockReset();
  });

  it('builds production prompt with brand and product truth', () => {
    const prompt = buildAgencyProductionPrompt({
      userPrompt: 'Hero packshot',
      brand,
      lockedProduct,
      selectedConcept: concept,
    });
    expect(prompt).toMatch(/Glow/i);
    expect(prompt).toMatch(/Glow Serum|PRODUCT|Hero packshot|Soft daylight/i);
  });

  it('applies selected concept to generate prompt', async () => {
    runCreativeCopilot.mockResolvedValue({
      brand: {
        knowledge: {
          id: 'bk',
          brandName: { value: 'Glow Co', status: 'inferred', confidence: 0.8, sourceIds: [] },
          sourceUrls: ['https://glow.example'],
          sources: [],
          fonts: [],
          colors: [{ value: '#112233', status: 'inferred', confidence: 0.8, sourceIds: [] }],
          logoRules: [],
          visualPrinciples: [
            { value: 'Soft daylight', status: 'inferred', confidence: 0.8, sourceIds: [] },
          ],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: new Date().toISOString(),
        },
      },
      trends: {
        result: {
          id: 't1',
          query: 'glow',
          researchedAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          sources: [],
          insights: [],
        },
      },
      concepts: { concepts: [concept] },
    });

    const onApplyConcept = vi.fn();
    const onSelectedConceptChange = vi.fn();

    render(
      <AgencyCreativeCopilot
        brand={brand}
        lockedProduct={lockedProduct}
        studioAssets={[]}
        gallerySelectionIds={new Set()}
        selectedConcept={null}
        onSelectedConceptChange={onSelectedConceptChange}
        onApplyConcept={onApplyConcept}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Research Brand & Market, Create Concepts/i }),
    );

    await waitFor(() => {
      expect(screen.getByText('Quiet Ritual')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Quiet Ritual'));
    expect(onSelectedConceptChange).toHaveBeenCalledWith(concept);
    expect(onApplyConcept).toHaveBeenCalled();
    expect(onApplyConcept.mock.calls[0][1]).toContain('Soft daylight product ceremony');
    expect(persistBrandKnowledge).toHaveBeenCalled();
  });
});
