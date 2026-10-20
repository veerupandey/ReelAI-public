import { describe, expect, it } from 'vitest';
import { assertFormatLocked, getNativePlannerSpec, scoreNativePlan } from '../../services/adIntelligence/planners';

describe('format-native planning', () => {
  it('locks requested format and compatible platform', () => {
    expect(() => assertFormatLocked('carousel', 'carousel', 'instagram_carousel')).not.toThrow();
    expect(() => assertFormatLocked('carousel', 'stitched_video', 'instagram_reels')).toThrow(/Format lock violated/);
    expect(() => assertFormatLocked('static_image', 'static_image', 'instagram_reels')).toThrow(/Platform.format mismatch/);
  });

  it('provides genuinely different native rules per format', () => {
    const carousel = getNativePlannerSpec('carousel', 'instagram_carousel');
    const video = getNativePlannerSpec('stitched_video', 'tiktok');
    const staticImage = getNativePlannerSpec('static_image', 'instagram_feed');

    expect(carousel.aspectRatio).toBe('1:1');
    expect(carousel.requiredElements).toContain('swipe incentive');
    expect(video.aspectRatio).toBe('9:16');
    expect(video.requiredElements).toContain('first-three-second proposition');
    expect(staticImage.requiredElements).toContain('single-message hierarchy');
  });

  it('allows 1–2 scenes for 5s bumper video ads', () => {
    const bumper = getNativePlannerSpec('stitched_video', 'tiktok', 5);
    expect(bumper.minScenes).toBe(1);
    expect(bumper.maxScenes).toBe(2);

    const score = scoreNativePlan(bumper, {
      format: 'stitched_video',
      platform: 'tiktok',
      aspectRatio: '9:16',
      elements: bumper.requiredElements,
      sceneCount: 1,
    });
    expect(score.passed).toBe(true);
  });

  it('scores native-plan compliance', () => {
    const score = scoreNativePlan(getNativePlannerSpec('carousel', 'instagram_carousel'), {
      format: 'carousel',
      platform: 'instagram_carousel',
      aspectRatio: '1:1',
      elements: ['swipe incentive', 'standalone slide value', 'final CTA'],
      sceneCount: 5,
    });
    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });
});
