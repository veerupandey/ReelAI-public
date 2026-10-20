import { describe, expect, it, vi } from 'vitest';
import type { StudioAsset } from '../../components/AIImageStudio/types';
import { generateMotionPrompt } from '../../components/AIImageStudio/motionPromptService';
import { DEFAULT_STUDIO_MOTION_PROMPT } from '../../components/AIImageStudio/studioAnimateService';

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: 'still-1',
    name: 'Hero',
    description: '',
    base64: 'b'.repeat(80),
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1350,
    source: 'upload',
    createdAt: new Date().toISOString(),
    aspectRatio: '4:5',
    ...overrides,
  };
}

describe('generateMotionPrompt', () => {
  it('returns the default prompt when intent and references are empty', async () => {
    const generateContent = vi.fn();
    const result = await generateMotionPrompt({
      asset: makeAsset(),
      intent: '',
      generateContent,
    });
    expect(result.motionPrompt).toBe(DEFAULT_STUDIO_MOTION_PROMPT);
    expect(result.referenceFrameCount).toBe(0);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('calls Gemini with still + intent and parses JSON', async () => {
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        motionPrompt: 'Slow orbit around the tin, soft daylight, label sharp',
        negativePrompt: 'warped logo',
        rationale: 'Product-hero ad energy',
      }),
    );

    const result = await generateMotionPrompt({
      asset: makeAsset(),
      intent: 'Instagram product ad',
      generateContent,
    });

    expect(generateContent).toHaveBeenCalledOnce();
    const parts = generateContent.mock.calls[0][0].parts;
    expect(parts[0]).toHaveProperty('inlineData');
    expect(parts.at(-1)).toMatchObject({
      text: expect.stringMatching(/Instagram product ad/i),
    });
    expect(result.motionPrompt).toMatch(/Slow orbit/);
    expect(result.negativePrompt).toBe('warped logo');
    expect(result.rationale).toMatch(/Product-hero/);
  });

  it('attaches Playwright reference frames when a URL is provided', async () => {
    const captureScreenshots = vi.fn(async () => ({
      screenshots: [
        { base64: 'c'.repeat(80), mimeType: 'image/jpeg', slideNumber: 1 },
        { base64: 'd'.repeat(80), mimeType: 'image/jpeg', slideNumber: 2 },
      ],
      count: 2,
      url: 'https://instagram.com/reel/x',
    }));
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        motionPrompt: 'Match reference pacing with a gentle push-in',
        negativePrompt: 'new brands',
      }),
    );

    const result = await generateMotionPrompt({
      asset: makeAsset(),
      intent: 'match this ad energy',
      referenceUrl: 'https://instagram.com/reel/x',
      captureScreenshots,
      generateContent,
      maxReferenceFrames: 3,
    });

    expect(captureScreenshots).toHaveBeenCalledWith('https://instagram.com/reel/x', 3);
    expect(result.referenceFrameCount).toBe(2);
    const parts = generateContent.mock.calls[0][0].parts;
    // still + 2 refs + text
    expect(parts.filter((p: Record<string, unknown>) => p.inlineData)).toHaveLength(3);
  });
});
