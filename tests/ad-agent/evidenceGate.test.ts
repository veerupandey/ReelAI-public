import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph } from '../../services/adIntelligence/evidenceGraph';
import { gateCreativeScenes } from '../../services/adIntelligence/evidenceGate';

const matchaGraph = buildEvidenceGraph({
  productUrl: 'https://matcha.test/product',
  productTitle: 'Ceremonial Matcha',
  facts: ['Ceremonial matcha powder.', 'Whisk with hot water and drink.'],
});

describe('evidenceGate', () => {
  it('blocks incorrect intended use and replaces it with grounded direction', () => {
    const result = gateCreativeScenes([{
      index: 0,
      imagePrompt: 'A person applying matcha powder to their face',
      voiceoverText: 'Apply it to your face for glowing skin.',
    }], matchaGraph);

    expect(result.approved).toBe(false);
    expect(result.scenes[0].imagePrompt).not.toContain('applying matcha powder to their face');
    expect(result.scenes[0].imagePrompt).toContain('Whisk with hot water and drink');
    expect(result.scenes[0].imagePrompt).toContain('Preserve this scene\'s original composition');
  });

  it('removes unsupported claims before production', () => {
    const result = gateCreativeScenes([{
      index: 0,
      imagePrompt: 'A cup of matcha',
      voiceoverText: 'This matcha cures anxiety.',
    }], matchaGraph);

    expect(result.approved).toBe(false);
    expect(result.scenes[0].voiceoverText).not.toContain('cures anxiety');
    expect(result.issues.some((issue) => issue.type === 'unsupported_claim')).toBe(true);
  });
});
