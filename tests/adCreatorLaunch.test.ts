import { describe, expect, it } from 'vitest';
import { buildAdCreatorLaunchParams } from '../services/adCreatorLaunch';

const baseForm = {
  productUrl: 'https://example.com/matcha',
  durationSec: 15,
  platform: 'instagram_reels',
  style: 'cinematic',
  voice: 'warm_female',
  reviewMode: true,
  plannerModel: 'glm_53_flash',
  adFormat: 'video',
};

describe('buildAdCreatorLaunchParams', () => {
  it('preserves user Direction separately from locked research brief', () => {
    const direction = 'Make it feel like a quiet morning ritual';
    const lockedBrief = 'Concept: Steam & Stillness. Open on ceramic bowl…';

    const params = buildAdCreatorLaunchParams({
      formValues: baseForm,
      direction,
      researchSeed: {
        creativeBrief: lockedBrief,
        productTitle: 'Matcha',
        productFacts: ['Ceremonial grade', 'Shade-grown'],
        productBase64: 'abc123',
        productMimeType: 'image/png',
        selectedConceptTitle: 'Steam & Stillness',
      },
      productPackshot: null,
    });

    expect(params.userDirection).toBe(direction);
    expect(params.creativeBrief).toBe(lockedBrief);
    expect(params.userDirection).not.toBe(params.creativeBrief);
  });

  it('uses Direction as creativeBrief when research was not applied', () => {
    const direction = 'Bold product hero with fast cuts';
    const params = buildAdCreatorLaunchParams({
      formValues: baseForm,
      direction,
      researchSeed: null,
      productPackshot: {
        base64: 'pack',
        mimeType: 'image/jpeg',
        name: 'hero.jpg',
      },
    });

    expect(params.userDirection).toBe(direction);
    expect(params.creativeBrief).toBe(direction);
    expect(params.skipResearch).toBeUndefined();
  });

  it('sets skipResearch when hero + facts are present (even with URL)', () => {
    const params = buildAdCreatorLaunchParams({
      formValues: baseForm,
      direction: 'User words stay here',
      researchSeed: {
        creativeBrief: 'Locked researcher brief',
        productFacts: ['Fact A'],
        productBase64: 'heroB64',
        productMimeType: 'image/webp',
        productTitle: 'Tea',
      },
      productPackshot: null,
    });

    expect(params.skipResearch).toBe(true);
    expect(params.skipBrandAndTrends).toBe(true);
    expect(params.source).toBe('product_upload');
    expect(params.autoStart).toBe(true);
    expect(params.hubLaunch).toBe(true);
    expect(params.productFacts).toEqual(['Fact A']);
    expect(params.productBase64).toBe('heroB64');
  });

  it('carries product and reference URLs as separate roles', () => {
    const params = buildAdCreatorLaunchParams({
      formValues: {
        ...baseForm,
        productUrl: 'https://kageha.ca/products/matcha-whisk',
        referenceUrl: 'https://www.instagram.com/reel/DK7xyz/',
      },
      direction: 'Recreate this reel for our whisk',
      researchSeed: null,
      productPackshot: null,
    });

    expect(params.productUrl).toBe('https://kageha.ca/products/matcha-whisk');
    expect(params.referenceUrl).toBe('https://www.instagram.com/reel/DK7xyz/');
  });

  it('refuses to launch a social link as the product URL', () => {
    const params = buildAdCreatorLaunchParams({
      formValues: { ...baseForm, productUrl: 'https://www.instagram.com/reel/DK7xyz/' },
      direction: 'Recreate this',
      researchSeed: null,
      productPackshot: null,
    });

    expect(params.productUrl).toBeUndefined();
    expect(params.referenceUrl).toBe('https://www.instagram.com/reel/DK7xyz/');
  });

  it('picks up a product URL typed only in the direction', () => {
    const params = buildAdCreatorLaunchParams({
      formValues: { ...baseForm, productUrl: '' },
      direction: 'Ad for https://kageha.ca/products/matcha-whisk in 15s',
      researchSeed: null,
      productPackshot: null,
    });

    expect(params.productUrl).toBe('https://kageha.ca/products/matcha-whisk');
  });

  it('prefers packshot upload over research hero bytes', () => {
    const params = buildAdCreatorLaunchParams({
      formValues: baseForm,
      direction: 'Direction',
      researchSeed: {
        creativeBrief: 'Brief',
        productFacts: ['F1'],
        productBase64: 'from-research',
        productMimeType: 'image/png',
      },
      productPackshot: {
        base64: 'from-upload',
        mimeType: 'image/jpeg',
        name: 'pack.jpg',
      },
    });

    expect(params.productBase64).toBe('from-upload');
    expect(params.productMimeType).toBe('image/jpeg');
    expect(params.productImageSource).toBe('upload');
    expect(params.skipResearch).toBe(true);
  });
});
