/**
 * Canonical Brand Ad Agency ↔ AI Image Studio asset/context adapters.
 * ID preservation is required so storyboard scene bindings stay valid.
 */

import type { Brand, BrandAsset, ProductContext, SceneRoute } from '../../types/brand';
import type {
  BrandKnowledge,
  CreativeRoute,
  ProductTruth,
  StudioAsset,
} from './types';
import {
  brandAssetsToStudioAssets as carouselBrandAssetsToStudioAssets,
  brandToBrandKnowledge,
  buildProductTruth,
} from '../../services/carouselPromptWriterAdapter';

export { brandToBrandKnowledge, buildProductTruth };

function extractDataUrlBase64(previewUrl?: string): string {
  if (!previewUrl?.startsWith('data:')) return '';
  const comma = previewUrl.indexOf(',');
  return comma >= 0 ? previewUrl.slice(comma + 1) : '';
}

function normalizeMime(mimeType?: string): StudioAsset['mimeType'] {
  if (mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/jpeg') {
    return mimeType;
  }
  return 'image/jpeg';
}

/** Brand → Studio. Preserves BrandAsset.id for storyboard bindings. */
export function brandAssetToStudioAsset(asset: BrandAsset): StudioAsset {
  const base64 = asset.base64 || extractDataUrlBase64(asset.previewUrl);
  const remotePreview =
    asset.previewUrl && !asset.previewUrl.startsWith('data:') ? asset.previewUrl : undefined;
  return {
    id: asset.id,
    name: asset.sourceProductTitle || asset.description?.slice(0, 100) || 'asset',
    description: asset.semanticDescription || asset.description || '',
    base64,
    previewUrl: base64 ? undefined : remotePreview || asset.sourceUrl,
    mimeType: normalizeMime(asset.mimeType),
    width: 1080,
    height: 1080,
    source: asset.type === 'generated' ? 'generated' : asset.sourceUrl ? 'url_import' : 'upload',
    createdAt: asset.createdAt || new Date().toISOString(),
    generationPrompt: asset.generationPrompt,
    sourceAssetIds: asset.sourceAssetIds,
  };
}

function brandAssetHasImagePayload(asset: BrandAsset): boolean {
  return Boolean(asset.base64 || asset.previewUrl || asset.sourceUrl);
}

export function brandAssetsToStudioAssets(assets: BrandAsset[]): StudioAsset[] {
  return assets.filter(brandAssetHasImagePayload).map(brandAssetToStudioAsset);
}

/**
 * Hydrate a studio asset so export/generate callers have raw base64.
 * Tries data-URL preview, direct fetch, then Jina proxy for remote URLs.
 */
export async function hydrateStudioAssetBase64(
  asset: StudioAsset,
): Promise<StudioAsset> {
  if (asset.base64) return asset;

  const src = asset.previewUrl;
  if (!src) return asset;

  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    const data = comma >= 0 ? src.slice(comma + 1) : '';
    return data ? { ...asset, base64: data, previewUrl: undefined } : asset;
  }

  const tryFetch = async (url: string): Promise<StudioAsset | null> => {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(',');
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    if (!data) return null;
    const mime =
      blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/jpeg'
        ? blob.type
        : asset.mimeType;
    return { ...asset, base64: data, mimeType: mime, previewUrl: undefined };
  };

  try {
    const direct = await tryFetch(src);
    if (direct) return direct;
  } catch {
    // fall through to proxy
  }

  try {
    const proxied = await tryFetch(`https://i.jina.ai/${src}`);
    if (proxied) return proxied;
  } catch {
    // leave preview-only
  }

  return asset;
}

/**
 * Hydrate a BrandAsset via the shared studio CORS→Jina path.
 * Returns the original asset when payload cannot be downloaded.
 */
export async function hydrateBrandAssetBase64(asset: BrandAsset): Promise<BrandAsset> {
  if (asset.base64) return asset;

  const fromPreview = extractDataUrlBase64(asset.previewUrl);
  if (fromPreview) {
    return {
      ...asset,
      base64: fromPreview,
      previewUrl: asset.previewUrl || `data:${normalizeMime(asset.mimeType)};base64,${fromPreview}`,
    };
  }

  const studio = brandAssetToStudioAsset(asset);
  const hydrated = await hydrateStudioAssetBase64(studio);
  if (!hydrated.base64) return asset;

  return studioAssetToBrandAsset(
    hydrated,
    {
      productUrl: asset.originPageUrl || '',
      productTitle: asset.sourceProductTitle || '',
    },
    asset,
  );
}

export type AgencyStudioGenerateRefs = {
  mode: 'generate' | 'edit' | 'composite';
  primaryReference?: { data: string; mimeType: string };
  references?: Array<{
    input: { data: string; mimeType: string };
    role: 'product';
    preserve: string[];
    modify: string;
  }>;
  /** Base asset after hydration (may include newly fetched base64). */
  hydratedBaseAsset: BrandAsset | null;
  /** All successfully hydrated reference assets (including base). */
  hydratedReferenceAssets: BrandAsset[];
  /** True when the route required a base image but base64 could not be loaded. */
  hydrationFailed: boolean;
  /** True when base64 was newly fetched (caller should persist). */
  didHydrateBase64: boolean;
};

const COMPOSITE_ROUTES: ReadonlySet<SceneRoute> = new Set([
  'composite_product',
  'use_existing',
  'continue_sequence',
]);

/**
 * Resolve generate mode + reference payloads for Agency Image Studio.
 * Includes continue_sequence (composite) and upgrade_existing (edit).
 * Gallery selections are passed as `referenceAssets` and always attached for
 * composite-style routes — including generate_fresh when the user selected images.
 */
export async function prepareAgencyStudioGenerateRefs(
  route: SceneRoute,
  baseAsset?: BrandAsset | null,
  referenceAssets: BrandAsset[] = [],
): Promise<AgencyStudioGenerateRefs> {
  const orderedRefs: BrandAsset[] = [];
  const seen = new Set<string>();
  const pushRef = (asset?: BrandAsset | null) => {
    if (!asset || seen.has(asset.id)) return;
    seen.add(asset.id);
    orderedRefs.push(asset);
  };

  pushRef(baseAsset);
  for (const asset of referenceAssets) pushRef(asset);

  const promoteFreshToComposite =
    route === 'generate_fresh' && orderedRefs.length > 0;
  const effectiveRoute: SceneRoute = promoteFreshToComposite
    ? 'composite_product'
    : route;

  const needsBase =
    effectiveRoute === 'upgrade_existing' || COMPOSITE_ROUTES.has(effectiveRoute);

  if (!needsBase || orderedRefs.length === 0) {
    return {
      mode: 'generate',
      hydratedBaseAsset: null,
      hydrationFailed: false,
      didHydrateBase64: false,
      hydratedReferenceAssets: [],
    };
  }

  const hydratedList: BrandAsset[] = [];
  let didHydrateBase64 = false;
  for (const asset of orderedRefs) {
    const hadBase64 = Boolean(asset.base64);
    const hydrated = await hydrateBrandAssetBase64(asset);
    if (!hydrated.base64) continue;
    if (!hadBase64) didHydrateBase64 = true;
    hydratedList.push(hydrated);
  }

  if (hydratedList.length === 0) {
    return {
      mode: 'generate',
      hydratedBaseAsset: null,
      hydrationFailed: true,
      didHydrateBase64: false,
      hydratedReferenceAssets: [],
    };
  }

  const primary = hydratedList[0];
  const imgData = {
    data: primary.base64,
    mimeType: primary.mimeType || 'image/jpeg',
  };

  if (effectiveRoute === 'upgrade_existing') {
    return {
      mode: 'edit',
      primaryReference: imgData,
      // Extra gallery picks become supporting references for the edit.
      references: hydratedList.slice(1).map((asset, index) => ({
        input: {
          data: asset.base64,
          mimeType: asset.mimeType || 'image/jpeg',
        },
        role: 'product' as const,
        preserve: ['product identity', 'label', 'packaging', 'proportions', 'brand text'],
        modify: index === 0
          ? 'use as supporting product / style reference while editing the primary image'
          : 'use as an additional supporting reference',
      })),
      hydratedBaseAsset: primary,
      hydrationFailed: false,
      didHydrateBase64,
      hydratedReferenceAssets: hydratedList,
    };
  }

  return {
    mode: 'composite',
    references: hydratedList.map((asset, index) => ({
      input: {
        data: asset.base64,
        mimeType: asset.mimeType || 'image/jpeg',
      },
      role: 'product' as const,
      preserve: ['product identity', 'label', 'packaging', 'proportions', 'brand text'],
      modify:
        effectiveRoute === 'continue_sequence'
          ? index === 0
            ? 'continue the sequence while preserving product identity'
            : 'use as an additional continuity / product reference'
          : index === 0
            ? hydratedList.length > 1
              ? 'primary product to place in the described scene'
              : 'place in the described scene'
            : 'combine with the primary product into one coherent composite scene',
    })),
    hydratedBaseAsset: primary,
    hydrationFailed: false,
    didHydrateBase64,
    hydratedReferenceAssets: hydratedList,
  };
}

/** Prefer agency adapter; keep carousel adapter export for callers that still import it. */
export function brandAssetsToStudioAssetsCompat(assets: BrandAsset[]): StudioAsset[] {
  const mapped = brandAssetsToStudioAssets(assets);
  if (mapped.length > 0) return mapped;
  return carouselBrandAssetsToStudioAssets(assets);
}

export function studioAssetToBrandAsset(
  asset: StudioAsset,
  ctx: Pick<ProductContext, 'productUrl' | 'productTitle'>,
  previous?: BrandAsset,
): BrandAsset {
  return {
    id: asset.id,
    type: asset.source === 'generated' ? 'generated' : previous?.type || 'product',
    base64: asset.base64,
    mimeType: asset.mimeType,
    description: asset.description || asset.name,
    semanticDescription: asset.description || previous?.semanticDescription,
    previewUrl: asset.base64
      ? `data:${asset.mimeType};base64,${asset.base64}`
      : asset.previewUrl || previous?.previewUrl,
    originPageUrl: previous?.originPageUrl || ctx.productUrl,
    sourceProductTitle: previous?.sourceProductTitle || ctx.productTitle,
    generationPrompt: asset.generationPrompt ?? previous?.generationPrompt,
    sourceAssetIds: asset.sourceAssetIds ?? previous?.sourceAssetIds,
    derivedFromAssetId: asset.sourceAssetIds?.[0] ?? previous?.derivedFromAssetId,
    verdict: previous?.verdict,
    verdictReason: previous?.verdictReason,
    shotType: previous?.shotType,
    quality: previous?.quality,
    productKey: previous?.productKey,
    createdAt: asset.createdAt || previous?.createdAt,
  };
}

export function sceneRouteToCreativeRoute(route: SceneRoute): CreativeRoute {
  switch (route) {
    case 'generate_fresh':
      return 'generate_fresh';
    case 'upgrade_existing':
      return 'ai_upgrade';
    case 'composite_product':
    case 'use_existing':
    case 'continue_sequence':
      return 'composite';
    default:
      return 'generate_fresh';
  }
}

export function seedAgencyStudioContext(input: {
  brand: Brand | null;
  lockedProduct: ProductContext;
}): {
  studioAssets: StudioAsset[];
  brandKnowledge: BrandKnowledge | null;
  productTruth: ProductTruth;
} {
  const studioAssets = brandAssetsToStudioAssets(input.lockedProduct.productAssets);
  return {
    studioAssets,
    brandKnowledge: input.brand ? brandToBrandKnowledge(input.brand) : null,
    productTruth: buildProductTruth(
      input.lockedProduct.productTitle,
      input.lockedProduct.productAssets,
    ),
  };
}
