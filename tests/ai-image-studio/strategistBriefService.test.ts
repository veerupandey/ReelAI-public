import { describe, expect, it } from 'vitest';
import {
  applyStrategistBriefPolish,
  buildStrategistBriefFromResearch,
  detectExecutionMode,
  formatCreativeTerritoriesText,
  formatStrategistBriefForPrompt,
  normalizeExecutionMode,
  parseCreativeTerritoriesText,
  parseStrategistBriefPolish,
  shouldUseBriefPolishSearch,
} from '../../components/AIImageStudio/strategistBriefService';
import { ensureProductTruthFromLockedReferences } from '../../components/AIImageStudio/creativeCopilotService';
import type {
  BrandKnowledge,
  ProductTruth,
  StrategistBrief,
  StudioAsset,
  TrendResearchResult,
} from '../../components/AIImageStudio/types';

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

function makeBrief(overrides: Partial<StrategistBrief> = {}): StrategistBrief {
  return {
    id: 'brief-1',
    campaignGoal: 'Recreate this carousel for busy professionals',
    audience: 'busy professionals',
    platform: 'instagram_feed',
    executionMode: 'recreate',
    summary: 'Rough draft summary about matcha ritual.',
    brandFit: 'Kageha. Tone: calm expert.',
    productFit: 'Product: Ceremonial Matcha Tin.',
    trendAngles: ['Quiet ritual aesthetic: Soft daylight'],
    preservationPriorities: ['Preserve tin label typography'],
    creativeTerritories: ['Product-hero', 'Brand-led'],
    constraints: ['Avoid language: miracle cure'],
    openQuestions: ['Confirm single SKU only'],
    brandKnowledgeId: 'brand-1',
    trendResearchId: 'trend-1',
    productTruthId: 'pt-1',
    sourceInsightIds: ['i1'],
    createdAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('strategistBriefService', () => {
  it('detects recreate vs original execution modes', () => {
    expect(detectExecutionMode('Recreate this carousel for Kageha')).toBe('recreate');
    expect(detectExecutionMode('Create an original brand post from scratch')).toBe('original');
    expect(detectExecutionMode('Launch a calm matcha ritual')).toBe('hybrid');
  });

  it('normalizes execution mode toggle values', () => {
    expect(normalizeExecutionMode('Original')).toBe('original');
    expect(normalizeExecutionMode('RECREATE')).toBe('recreate');
    expect(normalizeExecutionMode('hybrid')).toBe('hybrid');
    expect(normalizeExecutionMode('something-else')).toBeUndefined();
  });

  it('parses creative territories from comma or newline text', () => {
    expect(parseCreativeTerritoriesText('A\nB, C')).toEqual(['A', 'B', 'C']);
    expect(formatCreativeTerritoriesText(['A', 'B'])).toBe('A\nB');
  });

  it('builds a readable brief from brand, product, and trends', () => {
    const { brief, warnings } = buildStrategistBriefFromResearch({
      campaignGoal: 'Recreate this carousel for busy professionals who want calm energy',
      brandKnowledge: makeBrand(),
      trendResearch: makeTrends(),
      productTruth: makeTruth(),
      platform: 'instagram_feed',
    });

    expect(brief.executionMode).toBe('recreate');
    expect(brief.summary).toContain('Recreate');
    expect(brief.brandFit).toContain('Kageha');
    expect(brief.productFit).toContain('Ceremonial Matcha Tin');
    expect(brief.trendAngles[0]).toContain('Quiet ritual aesthetic');
    expect(brief.preservationPriorities[0]).toContain('Preserve tin label typography');
    expect(brief.creativeTerritories.length).toBeGreaterThan(2);
    expect(brief.constraints.some((item) => item.includes('miracle cure'))).toBe(true);
    expect(brief.audience).toContain('busy professionals');
    expect(warnings.length).toBe(0);
    expect(formatStrategistBriefForPrompt(brief)).toContain('Creative territories');
    expect(formatStrategistBriefForPrompt(brief)).toContain('Strategist brief (recreate)');
  });

  it('warns when research context is thin', () => {
    const { warnings } = buildStrategistBriefFromResearch({
      campaignGoal: 'Promote matcha',
    });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('parses polish JSON and preserves identity fields by default', () => {
    const brief = makeBrief();
    const patch = parseStrategistBriefPolish({
      summary: 'Polished plan for a calm matcha ritual.',
      creativeTerritories: ['Ritual hero', 'Quiet social proof'],
      brandFit: 'Kageha calm expert voice.',
      productFit: 'Lead with tin fidelity.',
      executionMode: 'hybrid',
      garbage: true,
    });

    expect(patch.summary).toContain('Polished plan');
    expect(patch.creativeTerritories).toEqual(['Ritual hero', 'Quiet social proof']);
    expect(patch.executionMode).toBe('hybrid');

    const applied = applyStrategistBriefPolish(brief, patch);
    expect(applied.id).toBe('brief-1');
    expect(applied.executionMode).toBe('recreate');
    expect(applied.preservationPriorities).toEqual(['Preserve tin label typography']);
    expect(applied.sourceInsightIds).toEqual(['i1']);
    expect(applied.summary).toContain('Polished plan');
    expect(applied.creativeTerritories).toEqual(['Ritual hero', 'Quiet social proof']);
    expect(applied.userEdits).toContain('Polished with AI');
  });

  it('allows executionMode change only when explicitly requested', () => {
    const brief = makeBrief({ executionMode: 'original' });
    const patch = parseStrategistBriefPolish({ executionMode: 'recreate', summary: 'Keep mode unless asked.' });
    const locked = applyStrategistBriefPolish(brief, patch);
    expect(locked.executionMode).toBe('original');

    const unlocked = applyStrategistBriefPolish(brief, patch, { allowExecutionModeChange: true });
    expect(unlocked.executionMode).toBe('recreate');
  });

  it('uses search for polish when brief is not grounded', () => {
    expect(
      shouldUseBriefPolishSearch(
        makeBrief({
          brandKnowledgeId: undefined,
          productTruthId: undefined,
          trendResearchId: undefined,
          trendAngles: [],
        }),
      ),
    ).toBe(true);

    expect(shouldUseBriefPolishSearch(makeBrief())).toBe(false);
    expect(shouldUseBriefPolishSearch(makeBrief(), { forceWebSearch: true })).toBe(true);
  });

  it('formats polished brief for prompt writer', () => {
    const brief = applyStrategistBriefPolish(makeBrief(), {
      summary: 'Polished summary for concepts.',
      creativeTerritories: ['Territory A', 'Territory B'],
    });
    const block = formatStrategistBriefForPrompt(brief);
    expect(block).toContain('Polished summary for concepts.');
    expect(block).toContain('Territory A');
    expect(block).toContain('Preservation priorities');
  });
});

describe('ensureProductTruthFromLockedReferences', () => {
  it('returns a warning when no locked images exist', async () => {
    const result = await ensureProductTruthFromLockedReferences({
      references: [],
      assets: [],
    });
    expect(result.productTruth).toBeUndefined();
    expect(result.warnings[0]).toMatch(/No locked product images/);
  });

  it('reuses existing product truth when protected assets are unchanged', async () => {
    const existing = makeTruth();
    const assets: StudioAsset[] = [
      {
        id: 'a1',
        name: 'Tin',
        description: '',
        base64: 'abc',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'upload',
        createdAt: '2026-07-12T00:00:00.000Z',
      },
    ];
    const result = await ensureProductTruthFromLockedReferences({
      references: [{ assetId: 'a1', role: 'product' }],
      assets,
      existing,
    });
    expect(result.productTruth).toBe(existing);
    expect(result.warnings).toEqual([]);
  });
});
