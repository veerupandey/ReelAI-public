import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findProductPageCandidates,
  importProductPageAssetsRich,
  parseProductImportUrls,
} from '../services/productPageImportService';

const textResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

const imageResponse = (): Response =>
  new Response(new Blob(['img'], { type: 'image/png' }), {
    status: 200,
    headers: { 'Content-Type': 'image/png' },
  });

describe('productPageImportService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://r.jina.ai/https://example.com/products/clove-serum') {
        return textResponse([
          'Title: Clove Serum | Example Store',
          '',
          'URL Source: https://example.com/products/clove-serum',
          '',
          'Markdown Content:',
          'A balancing serum for breakout-prone skin.',
        ].join('\n'));
      }

      if (url === 'https://r.jina.ai/https://example.com/' || url === 'https://r.jina.ai/https://example.com') {
        return textResponse([
          'Title: Example Store',
          '',
          'Markdown Content:',
          '[Shop](https://example.com/shop)',
        ].join('\n'));
      }

      if (url === 'https://r.jina.ai/https://example.com/shop') {
        return textResponse([
          'Title: Shop',
          '',
          'Markdown Content:',
          '![Image 1: Other Product](https://cdn.shopify.com/other-product.png?v=1)',
          '![Image 2: Clove Serum](https://cdn.shopify.com/clove-serum-main.png?v=1)',
          '![Image 3: Clove Serum detail](https://cdn.shopify.com/clove-serum-detail.png?v=1)',
          '[### Clove Serum](https://example.com/products/clove-serum)',
          '[### Other Product](https://example.com/products/other-product)',
        ].join('\n'));
      }

      if (url === 'https://r.jina.ai/https://example.com/collections/all') {
        return textResponse('Not found', 404);
      }

      if (url === 'https://cdn.shopify.com/clove-serum-main.png?v=1&width=720') {
        return imageResponse();
      }

      if (url === 'https://cdn.shopify.com/clove-serum-detail.png?v=1&width=720') {
        return imageResponse();
      }

      return textResponse('Not found', 404);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('parseProductImportUrls', () => {
    it('accepts bare domains and multi-URL pastes', () => {
      expect(parseProductImportUrls('kageha.ca')).toEqual(['https://kageha.ca']);
      expect(parseProductImportUrls('kageha.ca, https://example.com/products/a')).toEqual([
        'https://kageha.ca',
        'https://example.com/products/a',
      ]);
      expect(parseProductImportUrls('not a url')).toEqual([]);
    });
  });

  it('falls back to catalog pages when the direct product page has no gallery images', async () => {
    const result = await importProductPageAssetsRich('https://example.com/products/clove-serum', 'Example Store', {
      analyzeAssets: false,
    });

    expect(result.productTitle).toBe('Clove Serum');
    expect(result.imageCount).toBe(2);
    expect(result.assets).toHaveLength(2);
    expect(new Set(result.assets.map((asset) => asset.sourceUrl))).toEqual(new Set([
      'https://cdn.shopify.com/clove-serum-main.png?v=1&width=720',
      'https://cdn.shopify.com/clove-serum-detail.png?v=1&width=720',
    ]));
    expect(result.warnings).toContain(
      'Imported 2 product images from the brand catalog because the direct product page gallery was not exposed in the fetched page content.',
    );
  });

  it('searches additional catalog pages when resolving a product from the saved brand site', async () => {
    const candidates = await findProductPageCandidates(
      'https://example.com',
      'Create an ad for clove serum',
      'Example Store',
    );

    expect(candidates[0]).toEqual({
      productUrl: 'https://example.com/products/clove-serum',
      productTitle: 'clove serum',
      confidence: expect.any(Number),
    });
  });

  it('enriches store homepage imports from linked product pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://r.jina.ai/https://brand.example/' || url === 'https://r.jina.ai/https://brand.example') {
        return textResponse([
          'Title: Best Matcha Brand | Brand',
          '',
          'Markdown Content:',
          '![Hero](https://cdn.shopify.com/hero.png?v=1)',
          '[Signature Ceremonial](https://brand.example/products/signature-ceremonial)',
          '[Classic Ceremonial](/products/classic-ceremonial)',
        ].join('\n'));
      }

      if (url === 'https://r.jina.ai/https://brand.example/products/signature-ceremonial') {
        return textResponse([
          'Title: Signature Ceremonial | Brand',
          '',
          'Markdown Content:',
          '![Signature tin](https://cdn.shopify.com/signature-tin.png?v=1)',
          '![Signature bowl](https://cdn.shopify.com/signature-bowl.png?v=1)',
        ].join('\n'));
      }

      if (url === 'https://r.jina.ai/https://brand.example/products/classic-ceremonial') {
        return textResponse([
          'Title: Classic Ceremonial | Brand',
          '',
          'Markdown Content:',
          '![Classic tin](https://cdn.shopify.com/classic-tin.png?v=1)',
        ].join('\n'));
      }

      if (url.includes('cdn.shopify.com/') && url.includes('width=720')) {
        return imageResponse();
      }

      return textResponse('Not found', 404);
    }));

    const result = await importProductPageAssetsRich('https://brand.example', 'Brand', {
      analyzeAssets: false,
    });

    expect(result.assets.length).toBeGreaterThanOrEqual(3);
    expect(result.assets.some((asset) => asset.sourceUrl?.includes('signature-tin'))).toBe(true);
    expect(result.assets.some((asset) => asset.sourceUrl?.includes('classic-tin'))).toBe(true);
    expect(result.warnings.some((warning) => /product-page galleries/i.test(warning))).toBe(true);
    // Product-page shots should outrank the homepage hero filler.
    expect(result.assets[0]?.sourceUrl).not.toContain('hero.png');
  });

  it('prefers base64 assets when some downloads fail CORS', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url === 'https://r.jina.ai/https://cors.example/products/tin') {
        return textResponse([
          'Title: Matcha Tin',
          '',
          'Markdown Content:',
          '![Blocked](https://blocked.example/assets/hero.jpg)',
          '![Ok](https://cdn.shopify.com/ok-tin.png?v=1)',
        ].join('\n'));
      }

      if (url === 'https://cdn.shopify.com/ok-tin.png?v=1&width=720') {
        return imageResponse();
      }

      if (url.includes('blocked.example') || url.includes('i.jina.ai')) {
        throw new TypeError('Failed to fetch');
      }

      return textResponse('Not found', 404);
    }));

    const result = await importProductPageAssetsRich('https://cors.example/products/tin', 'Brand', {
      analyzeAssets: false,
    });

    expect(result.assets.length).toBeGreaterThanOrEqual(1);
    expect(result.assets[0]?.base64).toBeTruthy();
    expect(result.assets.some((asset) => !asset.base64)).toBe(true);
    expect(result.warnings.some((warning) => /Downloaded 1 of/i.test(warning))).toBe(true);
  });
});
