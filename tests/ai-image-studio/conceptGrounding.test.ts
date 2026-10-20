import { describe, expect, it } from 'vitest';
import { validateConceptAgainstProductTruth } from '../../components/AIImageStudio/conceptDirectorService';
import type { CreativeConcept, ProductTruth } from '../../components/AIImageStudio/types';

const concept = (overrides: Partial<CreativeConcept> = {}): CreativeConcept => ({
  id: 'c1',
  title: 'The Tactile Linen Ritual',
  oneLineIdea: 'A quiet morning matcha ceremony on linen',
  visualDirection: 'Editorial matcha tin and whisk on natural linen with soft daylight',
  brandFitRationale: 'Fits calm ritual brand',
  productTruthNotes: [],
  suggestedReferenceRoles: [],
  sourceTrendInsightIds: [],
  status: 'candidate',
  ...overrides,
});

const truth = (overrides: Partial<ProductTruth> = {}): ProductTruth => ({
  id: 'pt1',
  productName: 'Best Japanese Matcha in Canada',
  protectedAssetIds: [],
  preservationRules: ['Preserve exact product packaging, label, logo, and proportions.'],
  verifiedFacts: ['Japan-origin green tea powder', 'Shade-grown under tana cover'],
  unresolvedQuestions: [],
  userCorrections: [],
  ...overrides,
});

describe('validateConceptAgainstProductTruth', () => {
  it('accepts concepts that mention a significant product token like matcha', () => {
    expect(validateConceptAgainstProductTruth(concept(), truth()).valid).toBe(true);
  });

  it('rejects concepts with no product or fact tokens', () => {
    const result = validateConceptAgainstProductTruth(
      concept({
        title: 'Neon City Night',
        oneLineIdea: 'Abstract lights only',
        visualDirection: 'Blurry neon bokeh with no product in frame',
      }),
      truth(),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/does not reference/i);
  });
});
