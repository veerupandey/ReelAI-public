import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph, findEvidenceSupportingText } from '../../services/adIntelligence/evidenceGraph';

describe('evidenceGraph', () => {
  it('extracts intended use and approved claims with provenance', () => {
    const graph = buildEvidenceGraph({
      productUrl: 'https://matcha.test/product',
      productTitle: 'Ceremonial Matcha',
      facts: ['Ceremonial grade matcha powder.', 'Whisk one teaspoon with hot water and drink.'],
    });

    expect(graph.nodes.some((node) => node.type === 'intended_use' && node.text.includes('Whisk'))).toBe(true);
    expect(graph.nodes.every((node) => node.sourceUrl === 'https://matcha.test/product')).toBe(true);
    expect(graph.edges.some((edge) => edge.type === 'supports')).toBe(true);
  });

  it('finds evidence supporting text and rejects unrelated claims', () => {
    const graph = buildEvidenceGraph({
      productUrl: 'https://matcha.test/product',
      productTitle: 'Ceremonial Matcha',
      facts: ['Stone-ground ceremonial matcha.', 'Whisk with water and drink.'],
    });

    expect(findEvidenceSupportingText(graph, 'stone-ground matcha')).toHaveLength(1);
    expect(findEvidenceSupportingText(graph, 'cures anxiety')).toHaveLength(0);
  });
});
