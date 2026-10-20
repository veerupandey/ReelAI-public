import { describe, expect, it } from 'vitest';
import {
  applyParsedDirection,
  describeParsedDirection,
  parseAdDirection,
} from '../../runtime/adDirectionParse';

const IG = 'https://www.instagram.com/reel/DK7xyz/';
const SHOP = 'https://kageha.ca/products/matcha-whisk';

describe('parseAdDirection', () => {
  it('reads format, platform, duration, style and vibe from plain words', () => {
    const parsed = parseAdDirection({
      text: '30s TikTok video ad, UGC creator energy, punchy fast cuts',
    });
    expect(parsed.values.adFormat).toBe('stitched_video');
    expect(parsed.values.platform).toBe('tiktok');
    expect(parsed.values.durationSec).toBe(30);
    expect(parsed.values.style).toBe('ugc_style');
    expect(parsed.confidence).toBeGreaterThan(0.6);
  });

  it('parses 5s / 5secs / 5-second bumper asks without upscaling past 5', () => {
    expect(parseAdDirection({ text: 'create a video for 5secs' }).values.durationSec).toBe(5);
    expect(parseAdDirection({ text: 'Make a 5s TikTok ad' }).values.durationSec).toBe(5);
    expect(parseAdDirection({ text: '5-second Instagram Reel' }).values.durationSec).toBe(5);
  });

  it('splits product and reference URLs by role', () => {
    const parsed = parseAdDirection({ text: `Recreate ${IG} for ${SHOP}` });
    expect(parsed.values.productUrl).toBe(SHOP);
    expect(parsed.values.referenceUrl).toBe(IG);
    expect(parsed.isRecreate).toBe(true);
  });

  it('keeps a user-set product URL over anything in the text', () => {
    const parsed = parseAdDirection({
      text: `Match ${IG} and https://other.com/products/x`,
      explicitProductUrl: SHOP,
    });
    expect(parsed.values.productUrl).toBe(SHOP);
  });

  it('detects carousel and static formats', () => {
    expect(parseAdDirection({ text: 'Carousel of 5 slides' }).values.adFormat).toBe('carousel');
    expect(parseAdDirection({ text: 'Single image feed post' }).values.adFormat).toBe('static_image');
  });

  it('detects live motion and silent video asks', () => {
    const parsed = parseAdDirection({ text: 'Animate the scenes, no voiceover, music only' });
    expect(parsed.values.preferLiveMotion).toBe(true);
    expect(parsed.values.includeVoiceover).toBe(false);
  });

  it('returns nothing to apply for empty direction', () => {
    const parsed = parseAdDirection({ text: '   ' });
    expect(parsed.values).toEqual({});
    expect(parsed.confidence).toBe(0);
    expect(describeParsedDirection(parsed)).toBe('');
  });

  it('summarises what it understood', () => {
    const parsed = parseAdDirection({ text: '15s Reels, quiet luxury, calm' });
    expect(describeParsedDirection(parsed)).toContain('15s');
  });
});

describe('applyParsedDirection', () => {
  const parsed = parseAdDirection({ text: '15s TikTok video ad, high energy' });

  it('writes parsed values the user has not touched', () => {
    const updates = applyParsedDirection({
      parsed,
      current: { platform: 'instagram_reels', durationSec: 30 },
      touched: [],
    });
    expect(updates.platform).toBe('tiktok');
    expect(updates.durationSec).toBe(15);
  });

  it('leaves touched keys alone', () => {
    const updates = applyParsedDirection({
      parsed,
      current: { platform: 'instagram_reels', durationSec: 30 },
      touched: ['platform'],
    });
    expect(updates.platform).toBeUndefined();
    expect(updates.durationSec).toBe(15);
  });

  it('drops writes that would not change anything', () => {
    const updates = applyParsedDirection({
      parsed,
      current: { platform: 'tiktok', durationSec: 15, adFormat: 'stitched_video', style: 'high_energy' },
      touched: [],
    });
    expect(updates).toEqual({});
  });
});
