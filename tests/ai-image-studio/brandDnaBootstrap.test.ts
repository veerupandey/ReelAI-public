import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '../../types/brand';
import type { BrandKnowledge } from '../../components/AIImageStudio/types';

const researchBrand = vi.hoisted(() => vi.fn());
const updateBrandDNA = vi.hoisted(() => vi.fn());
const updateBrandStatus = vi.hoisted(() => vi.fn());
const getBrand = vi.hoisted(() => vi.fn());
const mergeBrandKnowledgeIntoBrandDNA = vi.hoisted(() => vi.fn());

vi.mock('../../components/AIImageStudio/brandKnowledgeService', () => ({
  researchBrand: (...args: unknown[]) => researchBrand(...args),
}));

vi.mock('../../services/brandService', () => ({
  updateBrandDNA: (...args: unknown[]) => updateBrandDNA(...args),
  updateBrandStatus: (...args: unknown[]) => updateBrandStatus(...args),
  getBrand: (...args: unknown[]) => getBrand(...args),
}));

vi.mock('../../services/brandKnowledgeAdapter', () => ({
  mergeBrandKnowledgeIntoBrandDNA: (...args: unknown[]) =>
    mergeBrandKnowledgeIntoBrandDNA(...args),
}));

import {
  BRIEF_ONLY_WEBSITE,
  bootstrapBrandDnaFromResearch,
  brandHasUsableDna,
  isBriefOnlyBrand,
  isResearchableBrandWebsite,
} from '../../services/brandDnaBootstrapService';

function ev<T>(value: T) {
  return { value, status: 'inferred' as const, confidence: 0.8, sourceIds: [] as string[] };
}

const knowledge: BrandKnowledge = {
  id: 'bk-1',
  brandName: ev('Glow Co'),
  sourceUrls: ['https://glow.example'],
  sources: [],
  fonts: [],
  colors: [ev('#112233')],
  logoRules: [],
  visualPrinciples: [ev('Soft daylight')],
  toneAttributes: [ev('Calm')],
  approvedLanguage: [ev('Ritual')],
  prohibitedLanguage: [],
  imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
  updatedAt: new Date().toISOString(),
};

const brand: Brand = {
  id: 'brand-1',
  userId: 'u1',
  name: 'Glow Co',
  websiteUrl: 'https://glow.example',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  dna: null,
  assets: [],
  status: 'new',
};

describe('brandDnaBootstrapService', () => {
  beforeEach(() => {
    researchBrand.mockReset();
    updateBrandDNA.mockReset();
    updateBrandStatus.mockReset();
    getBrand.mockReset();
    mergeBrandKnowledgeIntoBrandDNA.mockReset();
  });

  it('brandHasUsableDna requires palette or aesthetic', () => {
    expect(brandHasUsableDna(brand)).toBe(false);
    expect(
      brandHasUsableDna({
        ...brand,
        dna: {
          colors: {
            primary: '#111',
            secondary: '#fff',
            accent: '#888',
            palette: ['#111'],
            reasoning: 'x',
          },
          typography: { headingStyle: 'Sans', bodyStyle: 'Sans', characterTraits: '' },
          visualSignature: '',
          aesthetic: [],
          brandVoice: { tone: 'Calm', personality: '', vocabulary: [] },
          tagline: '',
          valuePropositions: [],
          targetAudience: { demographics: '', psychographics: '', painPoints: [] },
          products: [{ name: 'Serum', description: '', keyBenefits: [] }],
          keyIngredients: [],
          instagramAesthetic: '',
          contentPillars: [],
          topPerformingPatterns: [],
          postingFrequency: '',
          competitorInsights: '',
          differentiators: [],
          marketPosition: '',
        },
      }),
    ).toBe(true);
  });

  it('brandHasUsableDna tolerates missing colors.palette', () => {
    expect(
      brandHasUsableDna({
        ...brand,
        dna: {
          colors: undefined as any,
          typography: { headingStyle: 'Sans', bodyStyle: 'Sans', characterTraits: '' },
          visualSignature: 'Soft glow',
          aesthetic: [],
          brandVoice: { tone: 'Calm', personality: '', vocabulary: [] },
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
      }),
    ).toBe(true);
  });

  it('detects brief-only and non-researchable websites', () => {
    expect(isBriefOnlyBrand({ name: 'Brief-only campaign', websiteUrl: BRIEF_ONLY_WEBSITE })).toBe(true);
    expect(isBriefOnlyBrand({ name: 'Glow', websiteUrl: 'https://glow.example' })).toBe(false);
    expect(isResearchableBrandWebsite('https://glow.example')).toBe(true);
    expect(isResearchableBrandWebsite(BRIEF_ONLY_WEBSITE)).toBe(false);
    expect(isResearchableBrandWebsite('localhost')).toBe(false);
    expect(isResearchableBrandWebsite('')).toBe(false);
    expect(isResearchableBrandWebsite('glow.example')).toBe(true);
  });

  it('skips research for brief-only websites', async () => {
    const briefBrand: Brand = {
      ...brand,
      websiteUrl: BRIEF_ONLY_WEBSITE,
      name: 'Brief-only campaign',
    };
    getBrand.mockReturnValue(briefBrand);

    const result = await bootstrapBrandDnaFromResearch(briefBrand);

    expect(researchBrand).not.toHaveBeenCalled();
    expect(updateBrandStatus).not.toHaveBeenCalled();
    expect(result).toEqual(briefBrand);
  });

  it('researches brand and persists merged DNA', async () => {
    const mergedDna = {
      colors: {
        primary: '#112233',
        secondary: '#FFFFFF',
        accent: '#6B7280',
        palette: ['#112233'],
        reasoning: 'Merged',
      },
      typography: { headingStyle: 'Sans', bodyStyle: 'Sans', characterTraits: '' },
      visualSignature: '',
      aesthetic: ['Soft daylight'],
      brandVoice: { tone: 'Calm', personality: '', vocabulary: ['Ritual'] },
      tagline: '',
      valuePropositions: [],
      targetAudience: { demographics: '', psychographics: '', painPoints: [] },
      products: [{ name: 'Glow Serum', description: 'Serum', keyBenefits: [] }],
      keyIngredients: [],
      instagramAesthetic: '',
      contentPillars: [],
      topPerformingPatterns: [],
      postingFrequency: '',
      competitorInsights: '',
      differentiators: [],
      marketPosition: '',
    };

    researchBrand.mockResolvedValue({ knowledge, warnings: [], needsConfirmation: [] });
    getBrand.mockReturnValue(brand);
    mergeBrandKnowledgeIntoBrandDNA.mockReturnValue(mergedDna);
    updateBrandDNA.mockReturnValue({ ...brand, dna: mergedDna, status: 'ready' });

    const result = await bootstrapBrandDnaFromResearch(brand);

    expect(updateBrandStatus).toHaveBeenCalledWith('brand-1', 'researching');
    expect(researchBrand).toHaveBeenCalledWith(
      { sourceUrls: ['https://glow.example'] },
      expect.any(Function),
    );
    expect(mergeBrandKnowledgeIntoBrandDNA).toHaveBeenCalledWith(null, knowledge);
    expect(updateBrandDNA).toHaveBeenCalledWith('brand-1', mergedDna);
    expect(result?.dna?.products).toEqual(mergedDna.products);
  });

  it('restores status on research failure', async () => {
    researchBrand.mockRejectedValue(new Error('offline'));
    getBrand.mockReturnValue(brand);

    const result = await bootstrapBrandDnaFromResearch(brand);
    expect(updateBrandStatus).toHaveBeenCalledWith('brand-1', 'new');
    expect(result).toEqual(brand);
  });
});
