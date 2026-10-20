import { beforeEach, describe, expect, it } from 'vitest';
import type { BrandAsset } from '../types/brand';
import { findReusableProductAsset } from '../services/productAssetRegistryService';

const createGeneratedAsset = (overrides: Partial<BrandAsset> = {}): BrandAsset => ({
  id: overrides.id || 'asset-generated',
  type: overrides.type || 'generated',
  base64: overrides.base64 || 'ZmFrZQ==',
  mimeType: overrides.mimeType || 'image/png',
  description: overrides.description || 'Hero serum on marble.',
  originPageUrl: overrides.originPageUrl || 'https://brand.com/products/serum',
  generationPrompt: overrides.generationPrompt || 'Hero serum on marble.',
  sourceAssetIds: overrides.sourceAssetIds,
  provenance: overrides.provenance,
  derivedFromAssetId: overrides.derivedFromAssetId,
});

describe('productAssetRegistryService reuse scoring', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => store.get(key) || null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
      configurable: true,
    });
  });

  it('prefers assets with matching source ids and provenance over prompt-only matches', () => {
    const promptOnly = createGeneratedAsset({
      id: 'prompt-only',
      description: 'Hero serum on marble.',
      generationPrompt: 'Hero serum on marble.',
    });
    const provenanceMatch = createGeneratedAsset({
      id: 'provenance-match',
      description: 'Hero serum on marble.',
      generationPrompt: 'Hero serum on marble.',
      sourceAssetIds: ['asset-product'],
      provenance: [
        { assetId: 'asset-product', role: 'product', preserve: ['product_identity'] },
      ],
    });

    const reusable = findReusableProductAsset({
      assets: [promptOnly, provenanceMatch],
      productUrl: 'https://brand.com/products/serum',
      promptText: 'Hero serum on marble.',
      sceneText: 'The hero bottle sits on marble.',
      derivedFromAssetId: 'asset-product',
      sourceAssetIds: ['asset-product', 'external_ref_style'],
      provenance: [
        { assetId: 'asset-product', role: 'product', preserve: ['product_identity'] },
        { assetId: 'external_ref_style', role: 'style_guide', preserve: ['palette'] },
      ],
    });

    expect(reusable?.id).toBe('provenance-match');
  });
});
