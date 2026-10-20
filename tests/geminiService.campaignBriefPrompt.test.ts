import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGenerateContent } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
  Modality: {
    AUDIO: 'AUDIO',
  },
  Type: {
    ARRAY: 'ARRAY',
    BOOLEAN: 'BOOLEAN',
    NUMBER: 'NUMBER',
    OBJECT: 'OBJECT',
    STRING: 'STRING',
  },
}));

import { suggestCampaignBriefPrompt } from '../services/geminiService';

describe('suggestCampaignBriefPrompt', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
  });

  it('preserves custom creative cues when the AI result falls back to the local brief builder', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'Too short to use',
      usageMetadata: {},
    });

    const productUrl = 'https://bareandfair.ca/products/clove-curcumin-aloe-vera-serum';
    const existingPrompt = [
      `Create an ad for ${productUrl}`,
      'Keep it native, punchy, hook-first, and fast-moving. Optimize it for awareness in 30 seconds using balanced mode.',
      'Use the product page copy, positioning, and imported product images as the source of truth before inventing any new visuals.',
      'Build a clear structure with a strong hook, product proof, and a conversion-focused closing beat without making unsupported claims.',
      'Make it captivating and sensory with slow, indulgent texture shots.',
    ].join('\n');

    const result = await suggestCampaignBriefPrompt({
      brandName: 'Bare and Fair',
      productUrl,
      platform: 'tiktok',
      objective: 'awareness',
      durationSec: 30,
      executionMode: 'balanced',
      tone: 'luxury',
      existingPrompt,
    });

    const request = mockGenerateContent.mock.calls[0]?.[0];
    const prompt = request?.contents?.parts?.[0]?.text || '';

    expect(prompt).toContain('Selected tone: luxury');
    expect(prompt).toContain('Creative cues to preserve: Make it captivating and sensory with slow, indulgent texture shots.');
    expect(result).toContain(`Create an ad for ${productUrl}`);
    expect(result).toContain('Preserve this creative direction from the brief: Make it captivating and sensory with slow, indulgent texture shots.');
    expect(result).toContain('Tone: luxury. Use it to sharpen the existing creative direction instead of replacing it with generic ad copy.');
    expect(result).not.toContain('Keep it native, punchy, hook-first, and fast-moving. Optimize it for awareness in 30 seconds using balanced mode.');
  });
});
