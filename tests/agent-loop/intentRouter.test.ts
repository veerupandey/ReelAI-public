import { describe, expect, it } from 'vitest';
import { classifyIntent, isRecreateReferenceIntent } from '../../services/agentLoop/intentRouter';

describe('classifyIntent', () => {
  it('detects recreate-reference language', () => {
    const c = classifyIntent({
      prompt: 'Recreate this reference video for my brand https://example.com/p/1',
      adFormat: 'stitched_video',
    });
    expect(c.skillPath).toBe('recreate_reference_video');
    expect(isRecreateReferenceIntent(c)).toBe(true);
    expect(c.confidence).toBeGreaterThan(0.8);
  });

  it('detects match-structure with uploads', () => {
    const c = classifyIntent({
      prompt: 'Match the same structure and vibe with our product',
      referenceUploadCount: 3,
    });
    expect(c.skillPath).toBe('recreate_reference_video');
    expect(c.hasReferenceUploads).toBe(true);
  });

  it('routes carousel format to static_or_carousel', () => {
    const c = classifyIntent({
      prompt: 'Make an ad',
      adFormat: 'carousel',
    });
    expect(c.skillPath).toBe('static_or_carousel');
  });

  it('defaults to standard stitched video', () => {
    const c = classifyIntent({
      prompt: 'Make a 30s TikTok for this product https://brand.com/p/x',
      adFormat: 'stitched_video',
    });
    expect(c.skillPath).toBe('standard_stitched_video');
  });

  it('splits product and reference URLs regardless of order', () => {
    const ig = 'https://www.instagram.com/reel/DK7xyz/';
    const shop = 'https://kageha.ca/products/matcha-whisk';
    const refFirst = classifyIntent({ prompt: `Recreate ${ig} for ${shop}` });
    const productFirst = classifyIntent({ prompt: `Recreate ${shop} in the style of ${ig}` });

    for (const c of [refFirst, productFirst]) {
      expect(c.referenceUrl).toBe(ig);
      expect(c.productUrl).toBe(shop);
      expect(c.skillPath).toBe('recreate_reference_video');
    }
  });

  it('uses roles passed by the caller instead of re-reading the prompt', () => {
    const c = classifyIntent({
      prompt: 'Recreate this reel https://other.com/products/decoy',
      productUrl: 'https://kageha.ca/products/matcha-whisk',
      referenceUrl: 'https://www.instagram.com/reel/DK7xyz/',
    });
    expect(c.productUrl).toBe('https://kageha.ca/products/matcha-whisk');
    expect(c.referenceUrl).toBe('https://www.instagram.com/reel/DK7xyz/');
  });

  it('never reports a shop URL as the reference', () => {
    const c = classifyIntent({ prompt: 'Make a 30s TikTok for https://brand.com/products/x' });
    expect(c.referenceUrl).toBeUndefined();
    expect(c.productUrl).toBe('https://brand.com/products/x');
  });

  it('detects open-ended tool asks', () => {
    const c = classifyIntent({
      prompt: 'Please inspect the session files and fix the audio with ffmpeg loudnorm',
    });
    expect(c.skillPath).toBe('open_ended_tools');
  });
});
