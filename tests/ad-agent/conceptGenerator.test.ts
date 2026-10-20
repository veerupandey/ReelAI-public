import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph } from '../../services/adIntelligence/evidenceGraph';
import { generateFallbackConceptTerritories, validateConceptDistinctness } from '../../services/adIntelligence/conceptGenerator';

const graph = buildEvidenceGraph({
  productUrl: 'https://matcha.test/product',
  productTitle: 'Ceremonial Matcha',
  facts: ['Stone-ground ceremonial matcha.', 'Whisk with hot water and drink.'],
});

describe('conceptGenerator', () => {
  it('creates three evidence-cited concept territories with different strategies', () => {
    const concepts = generateFallbackConceptTerritories({
      productTitle: 'Ceremonial Matcha',
      platform: 'tiktok',
      format: 'stitched_video',
      evidenceGraph: graph,
    });

    expect(concepts).toHaveLength(3);
    expect(new Set(concepts.map((concept) => concept.territory)).size).toBe(3);
    expect(concepts.every((concept) => concept.evidenceIds.length > 0)).toBe(true);
    expect(validateConceptDistinctness(concepts).passed).toBe(true);
  });
});
