import { describe, expect, it } from 'vitest';
import {
  ADAPT_FORMAT_TARGETS,
  buildAdaptFormatPrompt,
  buildAdaptFormatRequest,
  getAdaptFormatTargets,
} from '../../components/AIImageStudio/adaptFormatService';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: 'src-1',
    name: 'Hero',
    description: '',
    base64: btoa('fake-image'),
    mimeType: 'image/png',
    width: 1080,
    height: 1350,
    source: 'generated',
    createdAt: new Date().toISOString(),
    aspectRatio: '4:5',
    generationPrompt: 'Premium matcha tin on marble, soft daylight',
    ...overrides,
  };
}

describe('adaptFormatService', () => {
  it('excludes the current aspect from adapt targets', () => {
    expect(getAdaptFormatTargets('4:5')).not.toContain('4:5');
    expect(getAdaptFormatTargets('4:5')).toEqual(
      ADAPT_FORMAT_TARGETS.filter((r) => r !== '4:5'),
    );
    expect(getAdaptFormatTargets(undefined)).toEqual([...ADAPT_FORMAT_TARGETS]);
  });

  it('builds a reframe brief that forbids stretch/letterbox', () => {
    const prompt = buildAdaptFormatPrompt(makeAsset(), '9:16');
    expect(prompt).toMatch(/FORMAT ADAPT/i);
    expect(prompt).toContain('9:16');
    expect(prompt).toMatch(/not a simple crop/i);
    expect(prompt).toMatch(/Do NOT stretch/i);
    expect(prompt).toContain('Premium matcha tin');
  });

  it('builds an edit request with skipPromptReview', () => {
    const asset = makeAsset();
    const request = buildAdaptFormatRequest(asset, '1:1');
    expect(request.mode).toBe('edit');
    expect(request.aspectRatio).toBe('1:1');
    expect(request.skipPromptReview).toBe(true);
    expect(request.primaryReference?.data).toBe(asset.base64);
  });

  it('rejects assets without local image data', () => {
    expect(() =>
      buildAdaptFormatRequest(makeAsset({ base64: '' }), '1:1'),
    ).toThrow(/no exportable data/i);
  });
});
