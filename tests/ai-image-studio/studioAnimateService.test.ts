import { describe, expect, it, vi } from 'vitest';
import type { StudioAsset } from '../../components/AIImageStudio/types';
import {
  animateStudioStill,
  estimateStudioI2vCostUsd,
  formatStudioI2vOptionLabel,
  getStudioI2vModel,
  mapAspectToWanSize,
  STUDIO_I2V_MODELS,
} from '../../components/AIImageStudio/studioAnimateService';
import { WAN_I2V_MODEL } from '../../services/siliconflow/client';
import {
  FAL_GROK_IMAGINE_I2V,
  FAL_KLING_26_PRO_I2V,
  FAL_KLING_30_PRO_I2V,
  FAL_SEEDANCE_20_I2V,
  FAL_VEO31_FAST_I2V,
} from '../../services/fal/client';

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

describe('studioAnimateService catalog', () => {
  it('includes SiliconFlow Wan and top fal I2V models', () => {
    const ids = STUDIO_I2V_MODELS.map((m) => m.id);
    expect(ids).toContain(WAN_I2V_MODEL);
    expect(ids).toContain(FAL_VEO31_FAST_I2V);
    expect(ids).toContain(FAL_KLING_26_PRO_I2V);
    expect(ids).toContain(FAL_KLING_30_PRO_I2V);
    expect(ids).toContain(FAL_SEEDANCE_20_I2V);
    expect(ids).toContain(FAL_GROK_IMAGINE_I2V);
    expect(ids).not.toContain('xai/grok-imagine-video/fast/image-to-video');
    expect(ids).not.toContain('xai/grok-imagine-video/flash/image-to-video');
    expect(getStudioI2vModel(FAL_SEEDANCE_20_I2V).provider).toBe('fal');
    expect(getStudioI2vModel(WAN_I2V_MODEL).provider).toBe('siliconflow');
  });

  it('remaps legacy invented Grok Fast/Flash fal paths to the real Grok I2V model', () => {
    expect(getStudioI2vModel('xai/grok-imagine-video/fast/image-to-video').id).toBe(
      FAL_GROK_IMAGINE_I2V,
    );
    expect(getStudioI2vModel('xai/grok-imagine-video/flash/image-to-video').falModel).toBe(
      FAL_GROK_IMAGINE_I2V,
    );
  });

  it('maps aspects and estimates fal cost from duration', () => {
    expect(mapAspectToWanSize('9:16')).toBe('720x1280');
    expect(estimateStudioI2vCostUsd(WAN_I2V_MODEL)).toBe(0.29);
    expect(estimateStudioI2vCostUsd(FAL_VEO31_FAST_I2V, 6)).toBe(0.9);
  });

  it('formats dropdown labels with source and pricing', () => {
    expect(formatStudioI2vOptionLabel(getStudioI2vModel(WAN_I2V_MODEL))).toBe(
      'Wan 2.2 I2V · SiliconFlow · ~$0.29/clip',
    );
    expect(formatStudioI2vOptionLabel(getStudioI2vModel(FAL_SEEDANCE_20_I2V), 5)).toBe(
      'Seedance 2.0 · fal.ai · ~$1.50/clip (~$0.30/s)',
    );
  });
});

describe('animateStudioStill routing', () => {
  it('throws when SiliconFlow is not configured for Wan', async () => {
    await expect(
      animateStudioStill({
        asset: makeAsset(),
        model: WAN_I2V_MODEL,
        getHealth: async () => ({ ok: true, siliconflowConfigured: false, falConfigured: true }),
        submitVideo: vi.fn(),
        pollVideo: vi.fn(),
      }),
    ).rejects.toThrow(/SILICONFLOW_API_KEY/i);
  });

  it('throws when fal is not configured for Seedance', async () => {
    await expect(
      animateStudioStill({
        asset: makeAsset(),
        model: FAL_SEEDANCE_20_I2V,
        getFalHealthFn: async () => ({ ok: true, falConfigured: false, siliconflowConfigured: true }),
        falUpload: vi.fn(),
        falSubmit: vi.fn(),
        falPoll: vi.fn(),
      }),
    ).rejects.toThrow(/FAL_KEY/i);
  });

  it('fal path uploads, submits, and polls to COMPLETED', async () => {
    const falUpload = vi.fn(async () => ({ url: 'https://v3b.fal.media/files/still.jpg' }));
    const falSubmit = vi.fn(async () => ({
      requestId: 'fal-req-1',
      statusUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/fal-req-1/status',
      responseUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/fal-req-1',
    }));
    const falPoll = vi
      .fn()
      .mockResolvedValueOnce({ status: 'IN_PROGRESS' })
      .mockResolvedValueOnce({
        status: 'COMPLETED',
        videoUrl: 'https://cdn.example.com/clip.mp4',
      });
    let t = 0;

    const result = await animateStudioStill({
      asset: makeAsset({ aspectRatio: '9:16' }),
      model: FAL_SEEDANCE_20_I2V,
      prompt: 'Gentle product push-in',
      durationSec: 5,
      getFalHealthFn: async () => ({ ok: true, falConfigured: true, siliconflowConfigured: true }),
      falUpload,
      falSubmit,
      falPoll,
      sleep: async () => undefined,
      now: () => {
        t += 1_000;
        return t;
      },
    });

    expect(falUpload).toHaveBeenCalled();
    expect(falSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        model: FAL_SEEDANCE_20_I2V,
        input: expect.objectContaining({
          prompt: 'Gentle product push-in',
          image_url: 'https://v3b.fal.media/files/still.jpg',
          duration: '5',
        }),
      }),
    );
    expect(falPoll).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'fal-req-1',
        statusUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/fal-req-1/status',
        responseUrl: 'https://queue.fal.run/bytedance/seedance-2.0/requests/fal-req-1',
      }),
    );
    expect(result.provider).toBe('fal');
    expect(result.videoUrl).toBe('https://cdn.example.com/clip.mp4');
  });

  it('SiliconFlow Wan path still succeeds with mocked submit/poll', async () => {
    const submitVideo = vi.fn(async () => ({ requestId: 'req-wan-1' }));
    const pollVideo = vi.fn().mockResolvedValue({
      status: 'Succeed',
      videoUrl: 'https://cdn.example.com/wan.mp4',
    });
    let t = 0;

    const result = await animateStudioStill({
      asset: makeAsset(),
      model: WAN_I2V_MODEL,
      getHealth: async () => ({ ok: true, siliconflowConfigured: true, falConfigured: false }),
      submitVideo,
      pollVideo,
      sleep: async () => undefined,
      now: () => {
        t += 1_000;
        return t;
      },
    });

    expect(result.provider).toBe('siliconflow');
    expect(result.videoUrl).toBe('https://cdn.example.com/wan.mp4');
  });
});
