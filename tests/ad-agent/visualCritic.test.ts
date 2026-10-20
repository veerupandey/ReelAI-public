import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph } from '../../services/adIntelligence/evidenceGraph';
import { reviewVisualSceneFallback } from '../../services/adIntelligence/visualCritic';

const graph = buildEvidenceGraph({
  productUrl: 'https://matcha.test/product',
  productTitle: 'Ceremonial Matcha',
  facts: ['Whisk with hot water and drink.'],
});

describe('visualCritic', () => {
  it('fails scenes whose described visual contradicts intended use', () => {
    const review = reviewVisualSceneFallback({
      sceneIndex: 0,
      imagePrompt: 'Person applying matcha powder to their face',
      visualDescription: 'Matcha skincare beauty scene',
      hasProductReference: true,
      generatedImageBase64: 'image',
      evidenceGraph: graph,
      assignedReferenceCount: 1,
    });
    expect(review.passed).toBe(false);
    expect(review.failures).toContain('incorrect_intended_use');
    expect(review.correctionPrompt).toContain('Whisk with hot water and drink');
  });

  it('passes grounded scenes with product references and bounded creative references', () => {
    const review = reviewVisualSceneFallback({
      sceneIndex: 0,
      imagePrompt: 'Person whisking matcha with hot water',
      visualDescription: 'Grounded preparation ritual',
      hasProductReference: true,
      generatedImageBase64: 'image',
      evidenceGraph: graph,
      assignedReferenceCount: 2,
    });
    expect(review.passed).toBe(true);
  });
});
