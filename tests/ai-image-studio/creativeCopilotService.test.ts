import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  areProtectedAssetsInSync,
  buildCopilotPrompt,
  buildLockedProductContext,
  buildResearchQuery,
  extractCampaignGoal,
  getCopilotWarnings,
  mergeLockedReferences,
  promptForConcept,
  regenerateConceptsFromBrief,
  resolveGenerationReferences,
} from '../../components/AIImageStudio/creativeCopilotService';
import type { ProductTruth, StrategistBrief } from '../../components/AIImageStudio/types';
import { generateConcepts } from '../../components/AIImageStudio/conceptDirectorService';
import { researchBrand } from '../../components/AIImageStudio/brandKnowledgeService';
import { researchTrends } from '../../components/AIImageStudio/trendResearchService';

vi.mock('../../components/AIImageStudio/conceptDirectorService', () => ({
  generateConcepts: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/brandKnowledgeService', () => ({
  researchBrand: vi.fn(),
}));

vi.mock('../../components/AIImageStudio/trendResearchService', () => ({
  researchTrends: vi.fn(),
}));

vi.mock('../../services/creativeReferenceDirector', () => ({
  analyzeCreativeReferences: vi.fn().mockRejectedValue(new Error('skip visual')),
}));

const mockGenerateConcepts = vi.mocked(generateConcepts);
const mockResearchBrand = vi.mocked(researchBrand);
const mockResearchTrends = vi.mocked(researchTrends);

function makeProductTruth(overrides: Partial<ProductTruth> = {}): ProductTruth {
  return {
    id: 'pt-1',
    productName: 'Matcha Tin',
    protectedAssetIds: ['a1', 'a2'],
    preservationRules: ['Keep label text'],
    verifiedFacts: ['Ceremonial grade'],
    unresolvedQuestions: [],
    userCorrections: [],
    ...overrides,
  };
}

describe('creativeCopilotService', () => {
  beforeEach(() => {
    mockGenerateConcepts.mockReset();
    mockResearchBrand.mockReset();
    mockResearchTrends.mockReset();
  });

  it('builds a market research query from product, goal, and platform', () => {
    expect(buildResearchQuery({
      campaignGoal: 'Launch a premium ritual campaign',
      productName: 'Ceremonial Matcha',
      platform: 'instagram_feed',
    })).toContain('Ceremonial Matcha');
  });

  it('builds a ready prompt grounded in brand, market trend, and concept', () => {
    const prompt = buildCopilotPrompt({
      campaignGoal: 'Launch campaign',
      brandName: 'Example',
      conceptTitle: 'Quiet Ritual',
      conceptDirection: 'Soft daylight product ceremony',
      trendTitles: ['Ritual aesthetic'],
    });

    expect(prompt).toContain('Example');
    expect(prompt).toContain('Quiet Ritual');
    expect(prompt).toContain('Soft daylight product ceremony');
    expect(prompt).toContain('Ritual aesthetic');
  });

  it('surfaces provider and fallback warnings from every research stage', () => {
    expect(getCopilotWarnings({
      brand: { warnings: ['brand fallback'] },
      trends: { warnings: ['trend fallback'] },
      concepts: { warnings: ['concept fallback'] },
      strategistBrief: { warnings: ['brief gap'] },
      warnings: ['pipeline note'],
    })).toEqual(['pipeline note', 'brand fallback', 'trend fallback', 'concept fallback', 'brief gap']);
  });

  it('builds product context from actual locked assets and roles', () => {
    expect(buildLockedProductContext(
      [{ assetId: 'tin', role: 'product', instructions: 'Preserve exact label' }],
      [{ id: 'tin', name: 'Ceremonial Matcha Tin', description: 'Green tea powder', base64: '', mimeType: 'image/png', width: 1, height: 1, source: 'upload', createdAt: '' }],
    )).toContain('Ceremonial Matcha Tin');
  });

  it('treats gallery-selected images as locked product references without duplicates', () => {
    expect(mergeLockedReferences(
      [{ assetId: 'existing', role: 'style' }],
      new Set(['existing', 'selected']),
    )).toEqual([
      { assetId: 'existing', role: 'style' },
      { assetId: 'selected', role: 'product' },
    ]);
  });

  it('uses only the currently selected gallery images for direct generation', () => {
    expect(resolveGenerationReferences(
      [{ assetId: 'old-reference', role: 'product' }],
      new Set(['selected-image']),
    )).toEqual([
      { assetId: 'selected-image', role: 'product' },
    ]);
  });

  it('preserves typed composer roles for selected gallery images', () => {
    expect(resolveGenerationReferences(
      [{ assetId: 'selected-image', role: 'style', instructions: 'Muted tones' }],
      new Set(['selected-image']),
    )).toEqual([
      { assetId: 'selected-image', role: 'style', instructions: 'Muted tones' },
    ]);
  });

  it('defaults only newly selected assets to product while preserving existing roles', () => {
    expect(resolveGenerationReferences(
      [{ assetId: 'existing', role: 'style' }],
      new Set(['existing', 'new-one']),
    )).toEqual([
      { assetId: 'existing', role: 'style' },
      { assetId: 'new-one', role: 'product' },
    ]);
  });

  it('uses persistent references when no gallery images are selected', () => {
    expect(resolveGenerationReferences(
      [{ assetId: 'locked-reference', role: 'product' }],
      new Set(),
    )).toEqual([
      { assetId: 'locked-reference', role: 'product' },
    ]);
  });

  it('builds a concise concept prompt without duplicating repeated trends', () => {
    const prompt = buildCopilotPrompt({
      campaignGoal: 'Create an Instagram post',
      brandName: 'Example',
      conceptTitle: 'Morning Ritual',
      conceptDirection: 'Soft daylight',
      trendTitles: ['Ritual', 'Ritual', 'Flat Lay', 'Flat Lay'],
    });
    expect(prompt.match(/Ritual/g)).toHaveLength(2);
    expect(prompt.match(/Flat Lay/g)).toHaveLength(1);
  });

  it('keeps the complete selected concept prompt visible while preserving the original campaign goal', () => {
    const prompt = buildCopilotPrompt({
      campaignGoal: 'Creating instagram post on matcha benefit',
      brandName: 'Kageha',
      conceptTitle: 'Komorebi Clarity',
      conceptDirection: 'High-contrast product photography with dappled sunlight',
      trendTitles: ['Ritual Aesthetic'],
    });

    expect(prompt).toContain('Selected concept: Komorebi Clarity.');
    expect(prompt).toContain('Visual direction: High-contrast product photography with dappled sunlight.');
    expect(extractCampaignGoal(prompt)).toBe('Creating instagram post on matcha benefit');
  });

  it('keeps the user prompt unchanged when a research concept is selected', () => {
    const prompt = promptForConcept(
      'Create an advanced educational 4:5 Instagram post about ceremonial matcha',
      {
        id: 'concept-1',
        title: 'Tana Architecture & Geometry',
        oneLineIdea: 'Explain shade-grown matcha through layered architectural forms',
        visualDirection: 'Precise overhead composition, deep matcha green planes, soft directional daylight',
        hook: 'The structure behind umami',
        brandFitRationale: 'Balances Japanese craft with modern editorial education',
        trendFitRationale: 'Uses diagrammatic editorial storytelling',
        productTruthNotes: ['Keep the matcha tin and label recognizable'],
        suggestedReferenceRoles: [],
        sourceTrendInsightIds: ['trend-1'],
        status: 'selected',
      },
      'Kageha',
      ['Editorial diagrams'],
    );

    expect(prompt).toBe('Create an advanced educational 4:5 Instagram post about ceremonial matcha');
  });

  describe('areProtectedAssetsInSync', () => {
    it('returns false when product truth is missing', () => {
      expect(areProtectedAssetsInSync(undefined, ['a1'])).toBe(false);
    });

    it('returns true when locked ids match protectedAssetIds in any order', () => {
      const truth = makeProductTruth({ protectedAssetIds: ['a1', 'a2'] });
      expect(areProtectedAssetsInSync(truth, ['a2', 'a1'])).toBe(true);
    });

    it('returns false when an id is added or removed', () => {
      const truth = makeProductTruth({ protectedAssetIds: ['a1', 'a2'] });
      expect(areProtectedAssetsInSync(truth, ['a1'])).toBe(false);
      expect(areProtectedAssetsInSync(truth, ['a1', 'a2', 'a3'])).toBe(false);
      expect(areProtectedAssetsInSync(truth, ['a1', 'a3'])).toBe(false);
    });

    it('returns true for empty protected and empty locked sets', () => {
      const truth = makeProductTruth({ protectedAssetIds: [] });
      expect(areProtectedAssetsInSync(truth, [])).toBe(true);
    });
  });

  describe('regenerateConceptsFromBrief', () => {
    it('rejects missing campaign goal', async () => {
      await expect(
        regenerateConceptsFromBrief({
          campaignGoal: '  ',
          productTruth: makeProductTruth(),
          references: [],
          assets: [],
        }),
      ).rejects.toThrow(/campaign goal/i);
    });

    it('rejects when brand, product truth, and strategist brief are all missing', async () => {
      await expect(
        regenerateConceptsFromBrief({
          campaignGoal: 'Launch campaign',
          references: [],
          assets: [],
        }),
      ).rejects.toThrow(/brand knowledge|product truth|strategist brief/i);
    });

    it('rebuilds strategist brief when absent and calls generateConcepts without re-research', async () => {
      mockGenerateConcepts.mockResolvedValue({
        concepts: [
          {
            id: 'c1',
            title: 'Fresh Concept',
            oneLineIdea: 'Idea',
            visualDirection: 'Soft light',
            brandFitRationale: 'Fit',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'candidate',
          },
        ],
        warnings: [],
      });

      const productTruth = makeProductTruth();
      const result = await regenerateConceptsFromBrief({
        campaignGoal: 'Launch a ritual campaign',
        productTruth,
        platform: 'instagram_feed',
        references: [{ assetId: 'a1', role: 'product' }],
        assets: [
          {
            id: 'a1',
            name: 'Tin',
            description: 'Matcha tin',
            base64: '',
            mimeType: 'image/png',
            width: 1,
            height: 1,
            source: 'upload',
            createdAt: '',
          },
        ],
        aspectRatio: '4:5',
        conceptCount: 3,
      });

      expect(mockResearchBrand).not.toHaveBeenCalled();
      expect(mockResearchTrends).not.toHaveBeenCalled();
      expect(mockGenerateConcepts).toHaveBeenCalledTimes(1);

      const call = mockGenerateConcepts.mock.calls[0][0];
      expect(call.productTruth).toBe(productTruth);
      expect(call.strategistBrief?.campaignGoal).toBe('Launch a ritual campaign');
      expect(call.userDirection).toContain('Launch a ritual campaign');
      expect(call.userDirection).toContain('Strategist brief');
      expect(call.userDirection).toContain('LOCKED PRODUCT CONTEXT');
      expect(call.availableReferences).toEqual([{ assetId: 'a1', role: 'product' }]);
      expect(call.aspectRatio).toBe('4:5');
      expect(call.conceptCount).toBe(3);

      expect(result.strategistBrief.brief.productTruthId).toBe(productTruth.id);
      expect(result.concepts.concepts).toHaveLength(1);
    });

    it('reuses an existing strategist brief when provided', async () => {
      const existingBrief: StrategistBrief = {
        id: 'brief-1',
        campaignGoal: 'Existing goal',
        executionMode: 'hybrid',
        summary: 'Existing summary',
        brandFit: 'Brand fit',
        productFit: 'Product fit',
        trendAngles: [],
        preservationPriorities: ['Keep tin'],
        creativeTerritories: ['Product-hero'],
        constraints: [],
        openQuestions: [],
        sourceInsightIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      mockGenerateConcepts.mockResolvedValue({ concepts: [], warnings: [] });

      const result = await regenerateConceptsFromBrief({
        campaignGoal: 'Launch a ritual campaign',
        productTruth: makeProductTruth(),
        strategistBrief: existingBrief,
        references: [],
        assets: [],
      });

      expect(result.strategistBrief.brief).toBe(existingBrief);
      expect(mockGenerateConcepts.mock.calls[0][0].strategistBrief).toBe(existingBrief);
      expect(mockResearchBrand).not.toHaveBeenCalled();
      expect(mockResearchTrends).not.toHaveBeenCalled();
    });
  });
});
