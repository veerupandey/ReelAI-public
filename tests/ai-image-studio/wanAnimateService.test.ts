import { describe, expect, it, vi } from 'vitest';
import type { StudioAsset } from '../../components/AIImageStudio/types';
import {
  animateStudioStill,
  mapAspectToWanSize,
  resolveStillImagePayload,
} from '../../components/AIImageStudio/studioAnimateService';
import { WAN_I2V_MODEL } from '../../services/siliconflow/client';

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: 'still-1',
    name: 'Hero still',
    description: '',
    base64: 'a'.repeat(80),
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1350,
    source: 'upload',
    createdAt: new Date().toISOString(),
    aspectRatio: '4:5',
    ...overrides,
  };
}

describe('mapAspectToWanSize', () => {
  it('maps vertical studio ratios to 720x1280', () => {
    expect(mapAspectToWanSize('9:16')).toBe('720x1280');
    expect(mapAspectToWanSize('4:5')).toBe('720x1280');
    expect(mapAspectToWanSize('3:4')).toBe('720x1280');
    expect(mapAspectToWanSize('2:3')).toBe('720x1280');
  });

  it('maps landscape ratios to 1280x720', () => {
    expect(mapAspectToWanSize('16:9')).toBe('1280x720');
    expect(mapAspectToWanSize('3:2')).toBe('1280x720');
  });

  it('maps square and unknown to 960x960', () => {
    expect(mapAspectToWanSize('1:1')).toBe('960x960');
    expect(mapAspectToWanSize(undefined)).toBe('960x960');
    expect(mapAspectToWanSize('weird')).toBe('960x960');
  });
});

describe('resolveStillImagePayload', () => {
  it('prefers base64 on the asset', () => {
    expect(resolveStillImagePayload(makeAsset())).toEqual({
      imageBase64: 'a'.repeat(80),
      mimeType: 'image/jpeg',
    });
  });

  it('accepts https preview URLs when base64 is missing', () => {
    expect(
      resolveStillImagePayload(
        makeAsset({ base64: '', previewUrl: 'https://cdn.example.com/still.jpg' }),
      ),
    ).toEqual({
      imageBase64: 'https://cdn.example.com/still.jpg',
      mimeType: 'image/jpeg',
    });
  });

  it('throws when no image data is available', () => {
    expect(() => resolveStillImagePayload(makeAsset({ base64: '', previewUrl: '' }))).toThrow(
      /no image data/i,
    );
  });
});

describe('animateStudioStill', () => {
  it('throws a clear error when SiliconFlow is not configured', async () => {
    await expect(
      animateStudioStill({
        asset: makeAsset(),
        model: WAN_I2V_MODEL,
        getHealth: async () => ({ ok: true, siliconflowConfigured: false, falConfigured: false }),
        submitVideo: vi.fn(),
        pollVideo: vi.fn(),
      }),
    ).rejects.toThrow(/SILICONFLOW_API_KEY/i);
  });

  it('throws when agent shell is offline', async () => {
    await expect(
      animateStudioStill({
        asset: makeAsset(),
        model: WAN_I2V_MODEL,
        getHealth: async () => ({ ok: false, siliconflowConfigured: false, falConfigured: false }),
        submitVideo: vi.fn(),
        pollVideo: vi.fn(),
      }),
    ).rejects.toThrow(/agent shell is offline/i);
  });

  it('submits and polls until Succeed, returning the video URL', async () => {
    const submitVideo = vi.fn(async () => ({ requestId: 'req-wan-1' }));
    const pollVideo = vi
      .fn()
      .mockResolvedValueOnce({ status: 'InQueue', videoUrl: undefined })
      .mockResolvedValueOnce({
        status: 'Succeed',
        videoUrl: 'https://cdn.example.com/clip.mp4',
      });
    const onProgress = vi.fn();
    let t = 0;

    const result = await animateStudioStill({
      asset: makeAsset({ aspectRatio: '9:16' }),
      model: WAN_I2V_MODEL,
      prompt: 'Gentle product push-in',
      getHealth: async () => ({ ok: true, siliconflowConfigured: true, falConfigured: false }),
      submitVideo,
      pollVideo,
      sleep: async () => undefined,
      now: () => {
        t += 1_000;
        return t;
      },
      onProgress,
    });

    expect(submitVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        model: WAN_I2V_MODEL,
        prompt: 'Gentle product push-in',
        imageSize: '720x1280',
        imageBase64: 'a'.repeat(80),
      }),
    );
    expect(pollVideo).toHaveBeenCalledWith('req-wan-1');
    expect(result.videoUrl).toBe('https://cdn.example.com/clip.mp4');
    expect(result.requestId).toBe('req-wan-1');
    expect(result.imageSize).toBe('720x1280');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'done', message: 'Clip ready' }),
    );
  });
});
