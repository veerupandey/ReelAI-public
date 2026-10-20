import { describe, expect, it, vi } from 'vitest';
import { mergeBrandKnowledgeIntoBrandDNA, persistBrandKnowledge } from '../../services/brandKnowledgeAdapter';
import type { BrandKnowledge } from '../../components/AIImageStudio/types';
import type { Brand, BrandDNA } from '../../types/brand';
import { updateBrandDNA } from '../../services/brandService';

vi.mock('../../services/brandService', () => ({
  updateBrandDNA: vi.fn(),
}));

function ev<T>(value: T) {
  return { value, status: 'inferred' as const, confidence: 0.8, sourceIds: [] as string[] };
}

function makeKnowledge(overrides: Partial<BrandKnowledge> = {}): BrandKnowledge {
  return {
    id: 'bk-1',
    brandName: ev('Glow Co'),
    sourceUrls: ['https://glow.example'],
    sources: [],
    fonts: [
      ev({ family: 'Inter', role: 'heading' as const, weights: [700], source: 'visual_inference' as const }),
      ev({ family: 'Georgia', role: 'body' as const, weights: [400], source: 'visual_inference' as const }),
    ],
    colors: [ev('#112233'), ev('#FFFFFF'), ev('#AA3344')],
    logoRules: [],
    visualPrinciples: [ev('Soft daylight'), ev('Negative space')],
    toneAttributes: [ev('Calm')],
    approvedLanguage: [ev('Ritual'), ev('Glow')],
    prohibitedLanguage: [],
    imageStyle: {
      lighting: [ev('Soft window light')],
      composition: [ev('Centered product')],
      backgrounds: [ev('Warm linen')],
      textures: [ev('Matte ceramic')],
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('brandKnowledgeAdapter', () => {
  it('persists BrandKnowledge into Brand DNA', () => {
    const brand = { id: 'brand-1', dna: null } as Brand;
    const knowledge = makeKnowledge();
    const brandId = persistBrandKnowledge(brand, knowledge);
    expect(brandId).toBe('brand-1');
    expect(updateBrandDNA).toHaveBeenCalledWith('brand-1', expect.objectContaining({
      colors: expect.objectContaining({ primary: '#112233' }),
    }));
  });

  it('merges BrandKnowledge into BrandDNA without wiping products', () => {
    const existing: BrandDNA = {
      colors: {
        primary: '#000000',
        secondary: '#111111',
        accent: '#222222',
        palette: ['#000000'],
        reasoning: 'old',
      },
      typography: { headingStyle: 'Old', bodyStyle: 'Old', characterTraits: '' },
      visualSignature: 'old sig',
      aesthetic: ['old'],
      brandVoice: { tone: 'Loud', personality: 'Bold', vocabulary: ['Old'] },
      tagline: 'Keep me',
      valuePropositions: ['Keep VP'],
      targetAudience: { demographics: '25-40', psychographics: '', painPoints: [] },
      products: [{
        name: 'Serum',
        description: 'Hero',
        keyIngredients: [],
        benefits: [],
        imageDescription: '',
      }],
      keyIngredients: ['niacinamide'],
      instagramAesthetic: 'editorial',
      contentPillars: ['education'],
      topPerformingPatterns: [],
      postingFrequency: '3x/week',
      competitorInsights: 'strong',
      differentiators: ['clean'],
      marketPosition: 'premium',
    };

    const merged = mergeBrandKnowledgeIntoBrandDNA(existing, makeKnowledge());
    expect(merged.colors.primary).toBe('#112233');
    expect(merged.typography.headingStyle).toBe('Inter');
    expect(merged.brandVoice.tone).toBe('Calm');
    expect(merged.tagline).toBe('Keep me');
    expect(merged.products[0].name).toBe('Serum');
    expect(merged.marketPosition).toBe('premium');
  });
});
