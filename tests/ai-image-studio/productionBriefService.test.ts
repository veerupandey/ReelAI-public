import { describe, expect, it } from 'vitest';
import {
  generateProductionBrief,
  validateProductionBrief,
} from '../../components/AIImageStudio/productionBriefService';
import type {
  BrandKnowledge,
  CreativeConcept,
  ProductTruth,
  StrategistBrief,
  TrendResearchResult,
} from '../../components/AIImageStudio/types';

function makeConcept(overrides: Partial<CreativeConcept> = {}): CreativeConcept {
  return {
    id: 'concept-1',
    title: 'Quiet Matcha Ritual',
    oneLineIdea: 'Soft daylight product ceremony',
    visualDirection: 'Ceramic tin on linen, soft window light, calm negative space',
    hook: 'Start slow, stay sharp',
    brandFitRationale: 'Matches calm expert tone',
    trendFitRationale: 'Quiet ritual aesthetic',
    productTruthNotes: ['Show ceremonial tin label'],
    suggestedReferenceRoles: [],
    sourceTrendInsightIds: ['i1'],
    status: 'selected',
    ...overrides,
  };
}

function makeBrand(): BrandKnowledge {
  return {
    id: 'brand-1',
    brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
    sourceUrls: ['https://kageha.ca'],
    sources: [],
    fonts: [],
    colors: [],
    logoRules: [],
    visualPrinciples: [
      { value: 'Japanese minimalism', status: 'verified', confidence: 1, sourceIds: [] },
    ],
    toneAttributes: [
      { value: 'calm expert', status: 'verified', confidence: 1, sourceIds: [] },
    ],
    approvedLanguage: [],
    prohibitedLanguage: [
      { value: 'miracle cure', status: 'verified', confidence: 1, sourceIds: [] },
    ],
    imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

function makeTrends(): TrendResearchResult {
  return {
    id: 'trend-1',
    query: 'matcha',
    researchedAt: '2026-07-12T00:00:00.000Z',
    expiresAt: '2026-08-12T00:00:00.000Z',
    sources: [],
    insights: [
      {
        id: 'i1',
        title: 'Quiet ritual aesthetic',
        description: 'Soft daylight product ceremonies',
        applicability: 'High',
        risk: 'Can feel generic',
        confidence: 0.9,
        sourceIds: [],
      },
    ],
  };
}

function makeTruth(): ProductTruth {
  return {
    id: 'pt-1',
    productName: 'Ceremonial Matcha Tin',
    protectedAssetIds: ['a1'],
    preservationRules: ['Preserve tin label typography'],
    verifiedFacts: ['Ceremonial grade matcha'],
    unresolvedQuestions: ['Confirm single SKU only'],
    userCorrections: [],
  };
}

function makeStrategist(
  overrides: Partial<StrategistBrief> = {},
): Pick<StrategistBrief, 'executionMode' | 'preservationPriorities' | 'summary' | 'constraints'> {
  return {
    executionMode: 'recreate',
    preservationPriorities: ['Keep locked product framing', 'Preserve label readability'],
    summary: 'Adapt the reference carousel into a calm Kageha ritual post',
    constraints: ['No medical claims'],
    ...overrides,
  };
}

describe('generateProductionBrief', () => {
  it('builds a brief from concept, product truth, and brand', () => {
    const brief = generateProductionBrief({
      selectedConcept: makeConcept(),
      brandKnowledge: makeBrand(),
      trendResearch: makeTrends(),
      productTruth: makeTruth(),
      userDirection: 'Keep it airy and premium',
      availableReferences: [{ assetId: 'a1', role: 'product' }],
      preferredAspectRatio: '4:5',
    });

    expect(brief.summary).toContain('Quiet Matcha Ritual');
    expect(brief.generationPrompt).toContain('PRESERVATION REQUIREMENTS');
    expect(brief.generationPrompt).toContain('Preserve tin label typography');
    expect(brief.preservationInstructions.some((line) => line.includes('tin label'))).toBe(true);
    expect(brief.avoidList.some((line) => line.includes('miracle cure'))).toBe(true);
    expect(brief.recommendedAspectRatio).toBe('4:5');
    expect(validateProductionBrief(brief).valid).toBe(true);
  });

  it('includes strategist execution mode and preservation in summary and prompt', () => {
    const brief = generateProductionBrief({
      selectedConcept: makeConcept(),
      brandKnowledge: makeBrand(),
      productTruth: makeTruth(),
      strategistBrief: makeStrategist(),
      userDirection: '',
      availableReferences: [],
    });

    expect(brief.summary).toContain('Mode: recreate');
    expect(brief.summary).toContain('Strategist Brief');
    expect(brief.generationPrompt).toContain('Execution mode: recreate');
    expect(brief.generationPrompt).toContain('Adapt the reference carousel');
    expect(
      brief.preservationInstructions.some((line) => line.includes('Keep locked product framing')),
    ).toBe(true);
    expect(brief.avoidList.some((line) => line.includes('No medical claims'))).toBe(true);
  });

  it('dedupes overlapping strategist and product preservation lines', () => {
    const brief = generateProductionBrief({
      selectedConcept: makeConcept(),
      productTruth: {
        ...makeTruth(),
        preservationRules: ['Keep locked product framing'],
      },
      strategistBrief: makeStrategist({
        preservationPriorities: ['Keep locked product framing'],
      }),
      userDirection: '',
      availableReferences: [],
    });

    const framingLines = brief.preservationInstructions.filter((line) =>
      line.toLowerCase().includes('keep locked product framing'),
    );
    expect(framingLines.length).toBe(1);
  });
});
