import { describe, expect, it } from 'vitest';
import { resolveVeoClipImageInput } from '../../services/producers/veo3VideoProducer';

describe('resolveVeoClipImageInput', () => {
  it('prefers approved scene stills over packshot for still→animate', () => {
    const result = resolveVeoClipImageInput({
      scene: {
        role: 'hero',
        imagePrompt: 'Hero packshot of Glow Cleanser',
        useProductAsReference: true,
        visualMode: 'product_locked',
        preserveExactAsset: true,
        lockedAssetBase64: 'locked-bytes',
        lockedAssetMimeType: 'image/jpeg',
        imageUrl: 'data:image/png;base64,still-bytes',
      },
      productBase64: 'hero-bytes',
    });

    expect(result.source).toBe('scene_still');
    expect(result.image?.base64).toBe('still-bytes');
    expect(result.missingRequiredProduct).toBe(false);
  });

  it('falls back to Agency locked assets when no still exists yet', () => {
    const result = resolveVeoClipImageInput({
      scene: {
        role: 'hero',
        imagePrompt: 'Hero packshot of Glow Cleanser',
        useProductAsReference: true,
        visualMode: 'product_locked',
        preserveExactAsset: true,
        lockedAssetBase64: 'locked-bytes',
        lockedAssetMimeType: 'image/jpeg',
      },
      productBase64: 'hero-bytes',
    });

    expect(result.source).toBe('locked_asset');
    expect(result.image?.base64).toBe('locked-bytes');
    expect(result.missingRequiredProduct).toBe(false);
  });

  it('uses product packshot for product-required scenes when no locked asset exists', () => {
    const result = resolveVeoClipImageInput({
      scene: {
        role: 'cta',
        imagePrompt: 'Featuring the product bottle on a marble counter',
        useProductAsReference: true,
        visualMode: 'product_composite',
      },
      productBase64: 'data:image/png;base64,hero-bytes',
      productMimeType: 'image/png',
    });

    expect(result.source).toBe('product_reference');
    expect(result.image?.base64).toBe('hero-bytes');
    expect(result.missingRequiredProduct).toBe(false);
  });

  it('blocks when product is required but no image is available', () => {
    const result = resolveVeoClipImageInput({
      scene: {
        role: 'packshot',
        imagePrompt: 'Exact product packaging close-up',
        useProductAsReference: true,
        visualMode: 'product_locked',
      },
      productBase64: null,
    });

    expect(result.source).toBe('none');
    expect(result.image).toBeUndefined();
    expect(result.missingRequiredProduct).toBe(true);
  });

  it('allows text-only lifestyle scenes without a product image', () => {
    const result = resolveVeoClipImageInput({
      scene: {
        role: 'mood',
        imagePrompt: 'Soft lifestyle atmosphere, product-free texture and light',
        useProductAsReference: false,
        visualMode: 'generated_fresh',
      },
      productBase64: null,
    });

    expect(result.missingRequiredProduct).toBe(false);
    expect(result.source).toBe('none');
  });
});
