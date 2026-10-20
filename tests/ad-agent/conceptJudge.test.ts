import { describe, expect, it } from 'vitest';
import { judgeConceptsPairwise, type CreativeConceptTerritory } from '../../services/adIntelligence/conceptJudge';

const concept = (id: string, score: number, hardFailures: string[] = []): CreativeConceptTerritory => ({
  id,
  territory: id as CreativeConceptTerritory['territory'],
  title: id,
  proposition: `${id} proposition`,
  hook: `${id} hook`,
  narrativeDevice: `${id} narrative`,
  visualDirection: `${id} visual`,
  evidenceIds: ['product-fact-1'],
  scores: {
    evidenceCorrectness: score,
    brandDistinctiveness: score,
    audienceRelevance: score,
    platformNativeness: score,
    clarity: score,
    originality: score,
    conversionPotential: score,
    productionFeasibility: score,
  },
  hardFailures,
});

describe('conceptJudge', () => {
  it('selects the strongest concept through pairwise comparisons', () => {
    const result = judgeConceptsPairwise([concept('product_led', .7), concept('audience_led', .9), concept('culture_led', .8)]);
    expect(result.winner.id).toBe('audience_led');
    expect(result.comparisons).toHaveLength(3);
  });

  it('rejects a higher-scoring concept with a hard evidence failure', () => {
    const result = judgeConceptsPairwise([concept('product_led', .8), concept('audience_led', 1, ['unsupported claim'])]);
    expect(result.winner.id).toBe('product_led');
  });
});
