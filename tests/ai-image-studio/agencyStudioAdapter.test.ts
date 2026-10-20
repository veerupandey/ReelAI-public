import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrandAsset, ProductContext } from '../../types/brand';
import {
  brandAssetToStudioAsset,
  brandAssetsToStudioAssets,
  hydrateBrandAssetBase64,
  hydrateStudioAssetBase64,
  prepareAgencyStudioGenerateRefs,
  sceneRouteToCreativeRoute,
  studioAssetToBrandAsset,
} from '../../components/AIImageStudio/agencyStudioAdapter';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function makeBrandAsset(overrides: Partial<BrandAsset> = {}): BrandAsset {
  return {
    id: 'asset-1',
    type: 'product',
    base64: 'abc123',
    mimeType: 'image/png',
    description: 'Serum bottle',
    semanticDescription: 'Matte glass serum',
    sourceProductTitle: 'Glow Serum',
    verdict: 'use_as_is',
    shotType: 'packshot',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('agencyStudioAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves brand asset ids when mapping to studio assets', () => {
    const brand = makeBrandAsset({ id: 'keep-me' });
    const studio = brandAssetToStudioAsset(brand);
    expect(studio.id).toBe('keep-me');
    expect(studio.source).toBe('upload');
    expect(studio.description).toBe('Matte glass serum');
  });

  it('round-trips studio → brand without changing id', () => {
    const original = makeBrandAsset({ id: 'round-trip' });
    const studio = brandAssetToStudioAsset(original);
    const ctx: Pick<ProductContext, 'productUrl' | 'productTitle'> = {
      productUrl: 'https://example.com/p',
      productTitle: 'Glow Serum',
    };
    const back = studioAssetToBrandAsset(studio, ctx, original);
    expect(back.id).toBe('round-trip');
    expect(back.verdict).toBe('use_as_is');
    expect(back.shotType).toBe('packshot');
    expect(back.originPageUrl).toBe('https://example.com/p');
  });

  it('skips assets without image payload', () => {
    expect(
      brandAssetsToStudioAssets([
        makeBrandAsset({ id: 'ok' }),
        makeBrandAsset({ id: 'empty', base64: '', previewUrl: undefined }),
      ]).map((a) => a.id),
    ).toEqual(['ok']);
  });

  it('keeps remote previewUrl when base64 download failed', () => {
    const studio = brandAssetToStudioAsset(
      makeBrandAsset({
        id: 'preview-only',
        base64: '',
        previewUrl: 'https://cdn.shopify.com/product.jpg',
        sourceUrl: 'https://cdn.shopify.com/product.jpg',
      }),
    );
    expect(studio.base64).toBe('');
    expect(studio.previewUrl).toBe('https://cdn.shopify.com/product.jpg');
  });

  it('includes sourceUrl-only assets in studio mapping', () => {
    const mapped = brandAssetsToStudioAssets([
      makeBrandAsset({
        id: 'src-only',
        base64: '',
        previewUrl: undefined,
        sourceUrl: 'https://cdn.shopify.com/from-source.jpg',
      }),
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].previewUrl).toBe('https://cdn.shopify.com/from-source.jpg');
  });

  it('hydrates data-URL preview into base64 for export', async () => {
    const studio: StudioAsset = {
      id: 'preview-data',
      name: 'Shot',
      description: '',
      base64: '',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      source: 'upload',
      createdAt: '2026-01-01T00:00:00.000Z',
      previewUrl: 'data:image/png;base64,YWJjMTIz',
    };
    const hydrated = await hydrateStudioAssetBase64(studio);
    expect(hydrated.base64).toBe('YWJjMTIz');
  });

  it('hydrates brand assets from data-URL preview without network', async () => {
    const brand = makeBrandAsset({
      id: 'data-preview',
      base64: '',
      previewUrl: 'data:image/png;base64,YWJjMTIz',
    });
    const hydrated = await hydrateBrandAssetBase64(brand);
    expect(hydrated.base64).toBe('YWJjMTIz');
    expect(hydrated.id).toBe('data-preview');
  });

  it('falls back to Jina proxy when direct CORS fetch fails for brand assets', async () => {
    const remote = 'https://cdn.example.com/product.jpg';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === remote) {
        throw new Error('CORS blocked');
      }
      if (url === `https://i.jina.ai/${remote}`) {
        const blob = new Blob(['proxy-bytes'], { type: 'image/jpeg' });
        return new Response(blob, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onloadend: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL(_blob: Blob) {
        this.result = 'data:image/jpeg;base64,cHJveHktYnl0ZXM=';
        this.onloadend?.({} as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    const brand = makeBrandAsset({
      id: 'remote-preview',
      base64: '',
      previewUrl: remote,
    });
    const hydrated = await hydrateBrandAssetBase64(brand);
    expect(hydrated.base64).toBe('cHJveHktYnl0ZXM=');
    expect(fetchMock).toHaveBeenCalledWith(remote, { mode: 'cors' });
    expect(fetchMock).toHaveBeenCalledWith(`https://i.jina.ai/${remote}`, { mode: 'cors' });
  });

  it('prepares continue_sequence as composite and marks newly hydrated base64', async () => {
    const brand = makeBrandAsset({
      id: 'seq-base',
      base64: '',
      previewUrl: 'data:image/png;base64,c2VxYmFzZQ==',
    });
    const prepared = await prepareAgencyStudioGenerateRefs('continue_sequence', brand);
    expect(prepared.mode).toBe('composite');
    expect(prepared.hydrationFailed).toBe(false);
    expect(prepared.didHydrateBase64).toBe(true);
    expect(prepared.references?.[0]?.input.data).toBe('c2VxYmFzZQ==');
    expect(prepared.references?.[0]?.modify).toContain('continue the sequence');
    expect(prepared.hydratedBaseAsset?.base64).toBe('c2VxYmFzZQ==');
    expect(prepared.hydratedReferenceAssets).toHaveLength(1);
  });

  it('attaches all gallery selections as composite references', async () => {
    const primary = makeBrandAsset({ id: 'a1', base64: 'cHJpbWFyeQ==' });
    const secondary = makeBrandAsset({ id: 'a2', base64: 'c2Vjb25kYXJ5' });
    const prepared = await prepareAgencyStudioGenerateRefs(
      'generate_fresh',
      primary,
      [primary, secondary],
    );
    expect(prepared.mode).toBe('composite');
    expect(prepared.references).toHaveLength(2);
    expect(prepared.references?.[0]?.input.data).toBe('cHJpbWFyeQ==');
    expect(prepared.references?.[1]?.input.data).toBe('c2Vjb25kYXJ5');
    expect(prepared.hydratedReferenceAssets.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('prepares upgrade_existing as edit and reports hydration failure for remote-only assets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    const brand = makeBrandAsset({
      id: 'fail-base',
      base64: '',
      previewUrl: 'https://cdn.example.com/missing.jpg',
    });
    const prepared = await prepareAgencyStudioGenerateRefs('upgrade_existing', brand);
    expect(prepared.mode).toBe('generate');
    expect(prepared.hydrationFailed).toBe(true);
    expect(prepared.didHydrateBase64).toBe(false);
    expect(prepared.primaryReference).toBeUndefined();
  });

  it('maps scene routes to creative routes', () => {
    expect(sceneRouteToCreativeRoute('generate_fresh')).toBe('generate_fresh');
    expect(sceneRouteToCreativeRoute('upgrade_existing')).toBe('ai_upgrade');
    expect(sceneRouteToCreativeRoute('composite_product')).toBe('composite');
    expect(sceneRouteToCreativeRoute('continue_sequence')).toBe('composite');
  });

  it('marks generated studio assets as generated brand assets', () => {
    const studio: StudioAsset = {
      id: 'gen-1',
      name: 'Fresh',
      description: 'AI shot',
      base64: 'xyz',
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
      source: 'generated',
      createdAt: '2026-01-02T00:00:00.000Z',
      generationPrompt: 'soft light',
      sourceAssetIds: ['asset-1'],
    };
    const brand = studioAssetToBrandAsset(studio, {
      productUrl: 'https://example.com/p',
      productTitle: 'Glow Serum',
    });
    expect(brand.type).toBe('generated');
    expect(brand.generationPrompt).toBe('soft light');
    expect(brand.derivedFromAssetId).toBe('asset-1');
  });
});
