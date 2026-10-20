import { describe, expect, it } from 'vitest';
import {
  coerceVideoVibe,
  defaultVibeForPlatform,
  fallbackVideoTreatment,
  formatVideoTreatmentBlock,
  isVideoAdFormat,
} from '../services/adAgentVideoTreatment';

describe('adAgentVideoTreatment', () => {
  it('detects video ad formats', () => {
    expect(isVideoAdFormat('stitched_video')).toBe(true);
    expect(isVideoAdFormat('veo3_video')).toBe(true);
    expect(isVideoAdFormat('carousel')).toBe(false);
    expect(isVideoAdFormat('static_image')).toBe(false);
  });

  it('defaults short-form platforms to Gen Z bright', () => {
    expect(defaultVibeForPlatform('tiktok')).toBe('gen_z_bright');
    expect(defaultVibeForPlatform('instagram_reels')).toBe('gen_z_bright');
    expect(defaultVibeForPlatform('youtube_shorts')).toBe('gen_z_bright');
    expect(defaultVibeForPlatform('instagram_feed')).toBe('balanced');
  });

  it('coerces invalid vibes to fallback', () => {
    expect(coerceVideoVibe('gen_z_bright')).toBe('gen_z_bright');
    expect(coerceVideoVibe('nope', 'premium_calm')).toBe('premium_calm');
    expect(coerceVideoVibe(undefined)).toBe('balanced');
  });

  it('fallback treatment opens with a high-energy hook and ends with a CTA', () => {
    const treatment = fallbackVideoTreatment({
      campaignGoal: 'Launch the matcha tin',
      productTitle: 'Matcha Tin',
      platform: 'tiktok',
      durationSec: 30,
      vibe: 'gen_z_bright',
    });

    expect(treatment.beats[0].label).toBe('hook');
    expect(treatment.beats[0].energy).toBe('high');
    expect(treatment.beats[treatment.beats.length - 1].label).toBe('cta');
    const total = treatment.beats.reduce((sum, b) => sum + b.seconds, 0);
    expect(total).toBeGreaterThan(20);
    expect(total).toBeLessThan(40);
    expect(treatment.hookSpoken.length).toBeGreaterThan(0);
  });

  it('fallback treatment stays near 5s for bumper ads', () => {
    const treatment = fallbackVideoTreatment({
      campaignGoal: 'Flash offer',
      productTitle: 'Matcha Tin',
      platform: 'tiktok',
      durationSec: 5,
      vibe: 'gen_z_bright',
    });
    const total = treatment.beats.reduce((sum, b) => sum + b.seconds, 0);
    expect(treatment.beats.length).toBeLessThanOrEqual(3);
    expect(total).toBeGreaterThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(7);
  });

  it('formats a VIDEO TREATMENT block the planner can follow', () => {
    const treatment = fallbackVideoTreatment({
      campaignGoal: 'goal',
      productTitle: 'Product',
      platform: 'instagram_reels',
      durationSec: 15,
      vibe: 'premium_calm',
    });
    const block = formatVideoTreatmentBlock(treatment, {
      platform: 'instagram_reels',
      durationSec: 15,
      vibe: 'premium_calm',
    });

    expect(block).toContain('VIDEO TREATMENT');
    expect(block).toContain('Hook (first 2s)');
    expect(block).toContain('1. HOOK');
    expect(block).toContain('Pacing:');
  });
});
