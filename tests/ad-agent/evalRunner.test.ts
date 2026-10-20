import { describe, expect, it } from 'vitest';
import cases from '../../evals/ad-agent/cases.json';
import { runIntelligenceEval } from '../../services/adIntelligence/evalRunner';

describe('evalRunner', () => {
  it('runs the golden dataset and reports aggregate metrics', () => {
    const result = runIntelligenceEval(cases.slice(0, 2), (item) => ({
      adFormat: item.expectedFormat,
      claims: item.approvedClaims,
      intendedUse: item.allowedUses[0] || 'show product',
      citations: item.approvedClaims.map((_, index) => `citation-${index}`),
      referencesPerScene: [2],
    }));
    expect(result.caseCount).toBe(2);
    expect(result.metrics.formatAccuracy).toBe(1);
    expect(result.metrics.intendedUseAccuracy).toBe(1);
  });
});
