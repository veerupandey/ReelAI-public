import { describe, expect, it } from 'vitest';
import { createDecisionTrace, recordTraceDecision, validateTraceCompleteness } from '../../services/adIntelligence/decisionTraceService';

describe('decisionTraceService', () => {
  it('records evidence-linked decisions and phases', () => {
    const trace = createDecisionTrace({
      prompt: 'Make a carousel for matcha',
      productUrl: 'https://matcha.test/product',
      requestedFormat: 'carousel',
      platform: 'instagram_carousel',
    });
    recordTraceDecision(trace, {
      phase: 'research',
      decisionType: 'intended_use',
      decision: 'Prepare and drink as matcha',
      evidenceIds: ['product-fact-1'],
      confidence: .95,
    });

    expect(trace.decisions).toHaveLength(1);
    expect(trace.decisions[0].evidenceIds).toEqual(['product-fact-1']);
    expect(validateTraceCompleteness(trace).missing).toContain('completedAt');
  });
});
