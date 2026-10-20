import { describe, expect, it } from 'vitest';
import { formatWanImagePayload } from '../services/siliconflow/client';
import { wanImageSizeForPlatform } from '../services/producers/wanI2vProducer';

describe('formatWanImagePayload', () => {
  it('wraps raw base64 as a data URL', () => {
    const raw = 'A'.repeat(80);
    expect(formatWanImagePayload(raw, 'image/jpeg')).toBe(`data:image/jpeg;base64,${raw}`);
  });

  it('preserves an existing data URL', () => {
    const dataUrl = `data:image/png;base64,${'B'.repeat(80)}`;
    expect(formatWanImagePayload(dataUrl)).toBe(dataUrl);
  });

  it('preserves http(s) image URLs', () => {
    const url = 'https://example.com/still.jpg';
    expect(formatWanImagePayload(url)).toBe(url);
  });

  it('rejects empty / tiny payloads', () => {
    expect(() => formatWanImagePayload('')).toThrow(/empty/i);
    expect(() => formatWanImagePayload('abc')).toThrow(/too small/i);
  });
});

describe('wanImageSizeForPlatform', () => {
  it('uses 9:16 for short-form platforms', () => {
    expect(wanImageSizeForPlatform('instagram_reels')).toBe('720x1280');
    expect(wanImageSizeForPlatform('tiktok')).toBe('720x1280');
    expect(wanImageSizeForPlatform('youtube_shorts')).toBe('720x1280');
  });

  it('uses square for feed/carousel', () => {
    expect(wanImageSizeForPlatform('instagram_feed')).toBe('960x960');
    expect(wanImageSizeForPlatform('instagram_carousel')).toBe('960x960');
  });
});
