import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph } from '../../services/adIntelligence/evidenceGraph';
import { runCriticCouncil } from '../../services/adIntelligence/critics';
import { getNativePlannerSpec } from '../../services/adIntelligence/planners';

const graph = buildEvidenceGraph({
  productUrl: 'https://matcha.test/product',
  productTitle: 'Ceremonial Matcha',
  facts: ['Stone-ground ceremonial matcha.', 'Whisk with hot water and drink.'],
});

describe('specialist critic council', () => {
  it('blocks incorrect intended use and unsupported claims', () => {
    const result = runCriticCouncil({
      scenes: [{ index: 0, role: 'ritual', imagePrompt: 'Apply matcha to face', voiceoverText: 'Cures anxiety.' }],
      evidenceGraph: graph,
      plannerSpec: getNativePlannerSpec('stitched_video', 'tiktok'),
      brandStyle: 'earthy organic',
      selectedConceptTitle: 'A Better Everyday Moment',
      stage: 'planning',
    });

    expect(result.passed).toBe(false);
    expect(result.mandatoryFixes.length).toBeGreaterThan(0);
    expect(result.reviews.some((review) => review.critic === 'evidence' && !review.passed)).toBe(true);
  });

  it('passes grounded platform-native creative', () => {
    const spec = getNativePlannerSpec('carousel', 'instagram_carousel');
    const result = runCriticCouncil({
      scenes: [
        { index: 0, role: 'hook', imagePrompt: 'Product hero with swipe incentive', voiceoverText: '', slideHeadline: 'Whisk Better Matcha', slideBody: 'Swipe for the ritual.' },
        { index: 1, role: 'ritual', imagePrompt: 'Whisk with hot water and drink', voiceoverText: '', slideHeadline: 'The Ritual', slideBody: 'Whisk with hot water and drink.' },
        { index: 2, role: 'cta', imagePrompt: 'Product CTA', voiceoverText: '', slideHeadline: 'Try The Ritual', slideBody: 'Discover ceremonial matcha.' },
      ],
      evidenceGraph: graph,
      plannerSpec: spec,
      brandStyle: 'earthy organic',
      selectedConceptTitle: 'Proof In The Product',
      stage: 'pre_production',
    });

    expect(result.passed).toBe(true);
  });
});
