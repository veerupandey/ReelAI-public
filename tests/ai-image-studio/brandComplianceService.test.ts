import { describe, expect, it } from 'vitest';
import {
  buildBrandCompliancePrompt,
  buildLimitedComplianceReport,
  normalizeComplianceResponse,
} from '../../components/AIImageStudio/brandComplianceService';
import type { BrandKnowledge } from '../../components/AIImageStudio/types';

function evidence<T>(value: T) {
  return {
    value,
    status: 'verified' as const,
    confidence: 1,
    sourceIds: ['source'],
  };
}

const brandKnowledge: BrandKnowledge = {
  id: 'brand-1',
  brandName: evidence('Kageha'),
  sourceUrls: ['https://kageha.ca'],
  sources: [],
  fonts: [
    evidence({
      family: 'Inter',
      role: 'body' as const,
      weights: [400, 600],
      source: 'website_css' as const,
    }),
  ],
  colors: [evidence('#123456')],
  logoRules: [evidence('Keep clear space')],
  visualPrinciples: [evidence('calm premium minimalism')],
  toneAttributes: [evidence('calm')],
  approvedLanguage: [evidence('slow ritual')],
  prohibitedLanguage: [evidence('miracle cure')],
  imageStyle: {
    lighting: [evidence('soft daylight')],
    composition: [],
    backgrounds: [],
    textures: [],
  },
  updatedAt: '2026-07-12T00:00:00.000Z',
};

describe('brandComplianceService', () => {
  it('builds a grounded prompt from brand and product truth', () => {
    const prompt = buildBrandCompliancePrompt({
      brandKnowledge,
      productTruth: {
        id: 'product-1',
        productName: 'Ceremonial Matcha',
        protectedAssetIds: [],
        preservationRules: ['Keep tin label exact'],
        verifiedFacts: ['Stone-ground matcha'],
        unresolvedQuestions: [],
        userCorrections: [],
      },
    });

    expect(prompt).toContain('Kageha');
    expect(prompt).toContain('#123456');
    expect(prompt).toContain('Inter');
    expect(prompt).toContain('Keep tin label exact');
    expect(prompt).toContain('miracle cure');
    expect(prompt).toContain('instagram_readability');
  });

  it('normalizes all categories and computes a weighted score', () => {
    const report = normalizeComplianceResponse(
      {
        summary: 'Mixed compliance.',
        checks: [
          { category: 'brand_colors', score: 100, finding: 'Exact palette.' },
          { category: 'visual_style', score: 80, finding: 'Mostly aligned.' },
          { category: 'product_fidelity', score: 60, finding: 'Label differs.' },
          { category: 'typography', score: 40, finding: 'Wrong type.' },
          { category: 'claims', score: 20, finding: 'Claim unsupported.' },
          { category: 'logo_treatment', score: 0, finding: 'Logo distorted.' },
          {
            category: 'instagram_readability',
            score: 100,
            finding: 'Readable.',
          },
        ],
      },
      '2026-07-12T00:00:00.000Z',
    );

    expect(report.score).toBe(59);
    expect(report.status).toBe('fail');
    expect(report.checks).toHaveLength(7);
    expect(report.checks[0].status).toBe('pass');
    expect(report.checks[2].status).toBe('warning');
    expect(report.checks[3].status).toBe('fail');
    expect(report.evaluationMode).toBe('visual_ai');
  });

  it('fills missing categories without overstating compliance', () => {
    const report = normalizeComplianceResponse({
      checks: [{ category: 'brand_colors', score: 95, finding: 'Aligned.' }],
    });

    expect(report.checks).toHaveLength(7);
    expect(
      report.checks.find((check) => check.category === 'product_fidelity')
        ?.score,
    ).toBe(50);
    expect(report.status).toBe('fail');
  });

  it('marks fallback reviews as limited', () => {
    const report = buildLimitedComplianceReport('API unavailable.');
    expect(report.evaluationMode).toBe('limited');
    expect(report.score).toBe(50);
    expect(report.summary).toContain('API unavailable');
    expect(report.checks.every((check) => check.status === 'warning')).toBe(
      true,
    );
  });
});
