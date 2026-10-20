import { describe, expect, it } from 'vitest';
import cases from '../../evals/ad-agent/cases.json';
import { gradeIntelligenceCase, summarizeIntelligenceGrades } from '../../evals/ad-agent/rubric';

describe('ad-agent intelligence baseline', () => {
  it('contains a representative golden dataset', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.some((item) => item.tags.includes('incorrect_use'))).toBe(true);
    expect(cases.some((item) => item.tags.includes('format_routing'))).toBe(true);
    expect(cases.some((item) => item.tags.includes('unsupported_claim'))).toBe(true);
  });

  it('detects known format, intended-use, and claim failures', () => {
    const grade = gradeIntelligenceCase(cases[0], {
      adFormat: 'stitched_video',
      claims: ['Cures anxiety'],
      intendedUse: 'Apply matcha powder to face',
      citations: [],
      referencesPerScene: [4],
    });

    expect(grade.formatAccuracy).toBe(0);
    expect(grade.intendedUseAccuracy).toBe(0);
    expect(grade.supportedClaimPrecision).toBe(0);
    expect(grade.referenceLimitAccuracy).toBe(0);
  });

  it('summarizes grades into stable metrics', () => {
    const summary = summarizeIntelligenceGrades([
      { formatAccuracy: 1, intendedUseAccuracy: 1, supportedClaimPrecision: 1, citationCoverage: 1, referenceLimitAccuracy: 1 },
      { formatAccuracy: 0, intendedUseAccuracy: 1, supportedClaimPrecision: .5, citationCoverage: 0, referenceLimitAccuracy: 1 },
    ]);
    expect(summary.formatAccuracy).toBe(.5);
    expect(summary.intendedUseAccuracy).toBe(1);
    expect(summary.supportedClaimPrecision).toBe(.75);
  });
});
