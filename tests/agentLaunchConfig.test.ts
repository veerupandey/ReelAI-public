import { describe, expect, it } from 'vitest';
import { buildAgentConfigFromLaunchParams } from '../components/AgentConsole';

describe('buildAgentConfigFromLaunchParams', () => {
  it('preserves a requested carousel format and aligns its platform', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'carousel',
      platform: 'instagram_reels',
      durationSec: 30,
    });

    expect(config.adFormat).toBe('carousel');
    expect(config.platform).toBe('instagram_carousel');
  });

  it('preserves a requested 5s bumper duration for stitched video ads', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      platform: 'tiktok',
      durationSec: 5,
    });
    expect(config.durationSec).toBe(5);
  });

  it('preserves a requested static image format and aligns its platform', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'static_image',
      platform: 'instagram_reels',
    });

    expect(config.adFormat).toBe('static_image');
    expect(config.platform).toBe('instagram_feed');
  });

  it('preserves plannerModel preference from launch params', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      plannerModel: 'glm_53_flash',
    });
    expect(config.plannerModel).toBe('glm_53_flash');
  });

  it('defaults plannerModel to Gemini Flash when unset', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
    });
    expect(config.plannerModel).toBe('gemini_pro');
  });

  it('resolves vibe from params with platform-aware default', () => {
    expect(buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      platform: 'tiktok',
    }).vibe).toBe('gen_z_bright');

    expect(buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      platform: 'tiktok',
      vibe: 'premium_calm',
    }).vibe).toBe('premium_calm');
  });

  it('enables preferLiveMotion only for stitched video ads', () => {
    expect(buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      preferLiveMotion: true,
    }).preferLiveMotion).toBe(true);

    expect(buildAgentConfigFromLaunchParams({
      adFormat: 'carousel',
      preferLiveMotion: true,
    }).preferLiveMotion).toBe(false);
  });

  it('passes liveMotionModelId for stitched video ads', () => {
    const config = buildAgentConfigFromLaunchParams({
      adFormat: 'stitched_video',
      preferLiveMotion: true,
      liveMotionModelId: 'fal-ai/kling-video/v3/pro/image-to-video',
    });
    expect(config.liveMotionModelId).toBe('fal-ai/kling-video/v3/pro/image-to-video');

    expect(buildAgentConfigFromLaunchParams({
      adFormat: 'carousel',
      liveMotionModelId: 'fal-ai/kling-video/v3/pro/image-to-video',
    }).liveMotionModelId).toBeUndefined();
  });
});
