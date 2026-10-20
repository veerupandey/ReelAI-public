import { describe, it, expect } from 'vitest';
import type { BrandKnowledge, EvidenceValue, BrandFont } from '../../components/AIImageStudio/types';
import {
  confirmEvidence,
  extractWebsiteEvidence,
  normalizeBrandUrl,
  normalizeBrandUrls,
  rejectEvidence,
} from '../../components/AIImageStudio/brandKnowledgeService';

describe('brandKnowledgeService', () => {
  describe('normalizeBrandUrl', () => {
    it('adds https:// to bare domains', () => {
      expect(normalizeBrandUrl('kageha.ca')).toBe('https://kageha.ca/');
      expect(normalizeBrandUrl('www.example.com')).toBe('https://www.example.com/');
    });

    it('preserves full https URLs', () => {
      expect(normalizeBrandUrl('https://kageha.ca/products')).toBe('https://kageha.ca/products');
    });

    it('rejects empty and invalid values', () => {
      expect(() => normalizeBrandUrl('')).toThrow(/empty/i);
      expect(() => normalizeBrandUrl('not a url')).toThrow(/Invalid brand URL/i);
      expect(() => normalizeBrandUrl('ftp://example.com')).toThrow(/protocol/i);
    });

    it('normalizes a list and dedupes', () => {
      expect(normalizeBrandUrls(['kageha.ca', 'https://kageha.ca/', '  '])).toEqual(['https://kageha.ca/']);
    });
  });

  it('extracts exact fonts, metadata, and colors from website HTML and CSS', () => {
    const evidence = extractWebsiteEvidence(
      'https://example-brand.com',
      `<title>Example Brand</title>
       <meta name="description" content="Example premium brand language.">
       <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&family=Inter:wght@400;600">`,
      `:root { --primary: #65202f; --background: #eee9df; }
       h1 { font-family: "Cormorant Garamond", serif; }
       body { font-family: Inter, sans-serif; }`,
    );

    expect(evidence.fontFaces.map(font => font.family)).toContain('Cormorant Garamond');
    expect(evidence.fontFaces.map(font => font.family)).toContain('Inter');
    expect(evidence.computedColors).toContain('#65202f');
    expect(evidence.visibleCopy).toContain('Example premium brand language.');
  });

  describe('confirmEvidence', () => {
    it('marks evidence as user_confirmed with 100% confidence', () => {
      const evidence: EvidenceValue<string> = {
        value: 'Test Brand',
        status: 'inferred',
        confidence: 0.7,
        sourceIds: ['source-1'],
      };

      const confirmed = confirmEvidence(evidence, 'user_confirmed');

      expect(confirmed.status).toBe('user_confirmed');
      expect(confirmed.confidence).toBe(1.0);
      expect(confirmed.value).toBe('Test Brand');
      expect(confirmed.sourceIds).toEqual(['source-1']);
    });

    it('marks evidence as verified with 100% confidence', () => {
      const evidence: EvidenceValue<string> = {
        value: '#FF5733',
        status: 'inferred',
        confidence: 0.6,
        sourceIds: ['source-1'],
      };

      const verified = confirmEvidence(evidence, 'verified');

      expect(verified.status).toBe('verified');
      expect(verified.confidence).toBe(1.0);
    });

    it('preserves all existing fields', () => {
      const font: EvidenceValue<BrandFont> = {
        value: {
          family: 'Inter',
          role: 'body',
          weights: [400, 700],
          source: 'google_fonts',
          loadUrl: 'https://fonts.googleapis.com/css2?family=Inter',
        },
        status: 'inferred',
        confidence: 0.8,
        sourceIds: ['source-1', 'source-2'],
      };

      const confirmed = confirmEvidence(font, 'user_confirmed');

      expect(confirmed.value.family).toBe('Inter');
      expect(confirmed.value.loadUrl).toBe('https://fonts.googleapis.com/css2?family=Inter');
      expect(confirmed.sourceIds).toEqual(['source-1', 'source-2']);
    });
  });

  describe('rejectEvidence', () => {
    it('marks evidence as rejected with 0 confidence', () => {
      const evidence: EvidenceValue<string> = {
        value: 'Wrong Brand',
        status: 'inferred',
        confidence: 0.5,
        sourceIds: ['source-1'],
      };

      const rejected = rejectEvidence(evidence);

      expect(rejected.status).toBe('rejected');
      expect(rejected.confidence).toBe(0);
      expect(rejected.value).toBe('Wrong Brand');
    });

    it('preserves value and source IDs for reference', () => {
      const evidence: EvidenceValue<string> = {
        value: '#000000',
        status: 'inferred',
        confidence: 0.6,
        sourceIds: ['source-1', 'source-2'],
      };

      const rejected = rejectEvidence(evidence, 'Not a brand color');

      expect(rejected.value).toBe('#000000');
      expect(rejected.sourceIds).toEqual(['source-1', 'source-2']);
    });
  });

  describe('BrandKnowledge structure', () => {
    it('supports all required evidence fields', () => {
      const knowledge: BrandKnowledge = {
        id: 'test-brand-1',
        sourceUrls: ['https://example.com'],
        sources: [
          {
            id: 'source-1',
            url: 'https://example.com',
            label: 'example.com',
            capturedAt: '2026-06-09T00:00:00.000Z',
          },
        ],
        brandName: {
          value: 'Example Brand',
          status: 'verified',
          confidence: 1,
          sourceIds: ['source-1'],
        },
        fonts: [
          {
            value: {
              family: 'Inter',
              role: 'body',
              weights: [400, 700],
              source: 'google_fonts',
            },
            status: 'verified',
            confidence: 0.95,
            sourceIds: ['source-1'],
          },
        ],
        colors: [
          {
            value: '#FF5733',
            status: 'inferred',
            confidence: 0.7,
            sourceIds: ['source-1'],
          },
        ],
        logoRules: [
          {
            value: 'Maintain clear space around logo',
            status: 'user_confirmed',
            confidence: 1,
            sourceIds: ['source-1'],
          },
        ],
        visualPrinciples: [
          {
            value: 'Minimalist aesthetic',
            status: 'inferred',
            confidence: 0.8,
            sourceIds: ['source-1'],
          },
        ],
        toneAttributes: [
          {
            value: 'Friendly',
            status: 'verified',
            confidence: 0.9,
            sourceIds: ['source-1'],
          },
        ],
        approvedLanguage: [
          {
            value: 'Sustainable',
            status: 'user_confirmed',
            confidence: 1,
            sourceIds: ['source-1'],
          },
        ],
        prohibitedLanguage: [
          {
            value: 'Cheap',
            status: 'user_confirmed',
            confidence: 1,
            sourceIds: ['source-1'],
          },
        ],
        imageStyle: {
          lighting: [
            {
              value: 'Natural light',
              status: 'inferred',
              confidence: 0.7,
              sourceIds: ['source-1'],
            },
          ],
          composition: [
            {
              value: 'Rule of thirds',
              status: 'inferred',
              confidence: 0.6,
              sourceIds: ['source-1'],
            },
          ],
          backgrounds: [
            {
              value: 'Clean white',
              status: 'verified',
              confidence: 0.9,
              sourceIds: ['source-1'],
            },
          ],
          textures: [
            {
              value: 'Smooth surfaces',
              status: 'inferred',
              confidence: 0.5,
              sourceIds: ['source-1'],
            },
          ],
        },
        updatedAt: '2026-06-09T00:00:00.000Z',
      };

      expect(knowledge.id).toBe('test-brand-1');
      expect(knowledge.brandName.value).toBe('Example Brand');
      expect(knowledge.fonts[0].value.family).toBe('Inter');
      expect(knowledge.colors[0].value).toBe('#FF5733');
      expect(knowledge.imageStyle.lighting[0].value).toBe('Natural light');
    });

    it('supports different evidence statuses', () => {
      const knowledge: BrandKnowledge = {
        id: 'test-2',
        sourceUrls: [],
        sources: [],
        brandName: { value: '', status: 'inferred', confidence: 0, sourceIds: [] },
        fonts: [],
        colors: [
          { value: '#verified', status: 'verified', confidence: 1, sourceIds: [] },
          { value: '#inferred', status: 'inferred', confidence: 0.6, sourceIds: [] },
          { value: '#confirmed', status: 'user_confirmed', confidence: 1, sourceIds: [] },
          { value: '#rejected', status: 'rejected', confidence: 0, sourceIds: [] },
        ],
        logoRules: [],
        visualPrinciples: [],
        toneAttributes: [],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: '2026-06-09T00:00:00.000Z',
      };

      const statuses = knowledge.colors.map(c => c.status);
      expect(statuses).toContain('verified');
      expect(statuses).toContain('inferred');
      expect(statuses).toContain('user_confirmed');
      expect(statuses).toContain('rejected');
    });
  });
});
