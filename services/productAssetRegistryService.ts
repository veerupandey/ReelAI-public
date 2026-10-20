import type { BrandAsset, ProductAssetRegistryEntry, AssetProvenanceStep } from '../types/brand';

const STORAGE_KEY = 'reelai_product_asset_registry';
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_PROMPT_LENGTH = 400;

const normalizeUrlForKey = (value?: string): string => {
  if (!value) return '';
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
};

const normalizeText = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value?: string): string =>
  normalizeText(value).replace(/\s+/g, '-');

const getRegistryFromStorage = (): ProductAssetRegistryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};

const sanitizePreviewUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  if (value.startsWith('data:') || value.startsWith('blob:')) return undefined;
  return value;
};

const truncate = (value: string | undefined, max: number): string | undefined => {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const dedupeStrings = (values?: string[]): string[] | undefined => {
  const next = Array.from(new Set((values || []).map((value) => value?.trim()).filter(Boolean) as string[]));
  return next.length ? next : undefined;
};

const isSyntheticExternalReference = (value?: string): boolean => Boolean(value?.startsWith('external_ref_'));

const sanitizeProvenance = (
  provenance?: ProductAssetRegistryEntry['provenance'],
): ProductAssetRegistryEntry['provenance'] | undefined => {
  const next = (provenance || [])
    .map((step) => ({
      assetId: step.assetId,
      role: step.role,
      preserve: dedupeStrings(step.preserve),
      modify: truncate(step.modify, 160),
    }))
    .filter((step) => Boolean(step.assetId));

  return next.length ? next : undefined;
};

const compactEntry = (entry: ProductAssetRegistryEntry): ProductAssetRegistryEntry => ({
  ...entry,
  description: truncate(entry.description, MAX_DESCRIPTION_LENGTH) || '',
  previewUrl: sanitizePreviewUrl(entry.previewUrl),
  promptUsed: truncate(entry.promptUsed, MAX_PROMPT_LENGTH),
  sourceAssetIds: dedupeStrings(entry.sourceAssetIds),
  provenance: sanitizeProvenance(entry.provenance),
});

const compactEntries = (entries: ProductAssetRegistryEntry[]): ProductAssetRegistryEntry[] =>
  entries.map(compactEntry);

const saveRegistryToStorage = (entries: ProductAssetRegistryEntry[]) => {
  const compacted = compactEntries(entries);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const sorted = [...compacted]
        .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());

      for (const limit of [150, 100, 50, 20]) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted.slice(0, limit)));
          return;
        } catch (retryError) {
          if (!(retryError instanceof DOMException && retryError.name === 'QuotaExceededError')) {
            console.error('[productAssetRegistryService] Failed to persist trimmed registry', retryError);
            return;
          }
        }
      }

      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted.slice(0, 10)));
      } catch (finalError) {
        console.error('[productAssetRegistryService] Failed to recover from registry quota exhaustion', finalError);
      }
      return;
    }
    console.error('[productAssetRegistryService] Failed to persist registry', error);
  }
};

export const buildProductKey = (brandName?: string, productTitle?: string, productUrl?: string): string => {
  const normalizedUrl = normalizeUrlForKey(productUrl);
  const urlTail = normalizedUrl.split('/').filter(Boolean).pop() || '';
  return [slugify(brandName), slugify(productTitle || urlTail)].filter(Boolean).join('/');
};

export const registerProductAsset = ({
  brandName,
  productUrl,
  productTitle,
  asset,
  promptUsed,
}: {
  brandName: string;
  productUrl: string;
  productTitle: string;
  asset: BrandAsset;
  promptUsed?: string;
}): ProductAssetRegistryEntry => {
  const entries = getRegistryFromStorage();
  const now = new Date().toISOString();
  const normalizedUrl = normalizeUrlForKey(productUrl);
  const productKey = asset.productKey || buildProductKey(brandName, productTitle, normalizedUrl);
  const sourceAssetIds = dedupeStrings(asset.sourceAssetIds || (asset.derivedFromAssetId ? [asset.derivedFromAssetId] : undefined));
  const dedupeKey = asset.sourceUrl || asset.id;
  const index = entries.findIndex((entry) =>
    entry.productKey === productKey &&
    entry.productUrl === normalizedUrl &&
    (entry.sourceUrl ? entry.sourceUrl === asset.sourceUrl : entry.assetId === dedupeKey)
  );

  const nextEntry: ProductAssetRegistryEntry = {
    id: index >= 0 ? entries[index].id : `product_asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    brandName,
    productKey,
    productUrl: normalizedUrl,
    productTitle,
    assetId: asset.id,
    assetType: asset.type,
    description: asset.description,
    sourceUrl: asset.sourceUrl,
    previewUrl: sanitizePreviewUrl(asset.previewUrl),
    promptUsed: promptUsed || asset.generationPrompt,
    derivedFromAssetId: asset.derivedFromAssetId,
    sourceAssetIds,
    provenance: sanitizeProvenance(asset.provenance),
    createdAt: index >= 0 ? entries[index].createdAt : (asset.createdAt || now),
    lastUsedAt: now,
  };

  if (index >= 0) {
    entries[index] = nextEntry;
  } else {
    entries.push(nextEntry);
  }

  saveRegistryToStorage(entries);
  return nextEntry;
};

export const getProductAssetHistory = ({
  brandName,
  productUrl,
  productTitle,
}: {
  brandName?: string;
  productUrl?: string;
  productTitle?: string;
}): ProductAssetRegistryEntry[] => {
  const normalizedUrl = normalizeUrlForKey(productUrl);
  const productKey = buildProductKey(brandName, productTitle, normalizedUrl);
  return getRegistryFromStorage()
    .filter((entry) =>
      entry.productKey === productKey ||
      (normalizedUrl && entry.productUrl === normalizedUrl)
    )
    .sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
};

const scoreReusableAsset = (
  asset: BrandAsset,
  promptText: string,
  sceneText?: string,
  derivedFromAssetId?: string,
  sourceAssetIds?: string[],
  provenance?: AssetProvenanceStep[],
): number => {
  if (asset.type !== 'generated') return -1;

  const normalizedPrompt = normalizeText(promptText);
  const normalizedScene = normalizeText(sceneText);
  const normalizedAssetPrompt = normalizeText(asset.generationPrompt);
  const normalizedDescription = normalizeText(asset.description);

  let score = 0;
  if (normalizedPrompt && normalizedAssetPrompt === normalizedPrompt) score += 120;
  if (normalizedPrompt && normalizedDescription === normalizedPrompt) score += 90;
  if (normalizedPrompt && normalizedAssetPrompt.includes(normalizedPrompt)) score += 50;
  if (normalizedPrompt && normalizedDescription.includes(normalizedPrompt)) score += 40;
  if (normalizedScene && normalizedDescription.includes(normalizedScene)) score += 30;
  if (derivedFromAssetId && asset.derivedFromAssetId === derivedFromAssetId) score += 20;
  if (derivedFromAssetId && asset.sourceAssetIds?.includes(derivedFromAssetId)) score += 20;

  const filteredRequestedSourceIds = (sourceAssetIds || []).filter((assetId) => !isSyntheticExternalReference(assetId));
  const filteredCandidateSourceIds = (asset.sourceAssetIds || []).filter((assetId) => !isSyntheticExternalReference(assetId));
  const sourceOverlapCount = filteredRequestedSourceIds.filter((assetId) => filteredCandidateSourceIds.includes(assetId)).length;
  if (sourceOverlapCount > 0) score += sourceOverlapCount * 26;

  const requestedRoles = new Set((provenance || [])
    .filter((step) => !isSyntheticExternalReference(step.assetId))
    .map((step) => `${step.assetId}:${step.role}`));
  const candidateRoles = new Set((asset.provenance || [])
    .filter((step) => !isSyntheticExternalReference(step.assetId))
    .map((step) => `${step.assetId}:${step.role}`));
  let roleOverlapCount = 0;
  requestedRoles.forEach((key) => {
    if (candidateRoles.has(key)) roleOverlapCount += 1;
  });
  if (roleOverlapCount > 0) score += roleOverlapCount * 18;

  const promptTokens = normalizedPrompt.split(' ').filter((token) => token.length > 3);
  for (const token of promptTokens) {
    if (normalizedAssetPrompt.includes(token)) score += 8;
    if (normalizedDescription.includes(token)) score += 5;
  }

  return score;
};

export const findReusableProductAsset = ({
  assets,
  productUrl,
  promptText,
  sceneText,
  derivedFromAssetId,
  sourceAssetIds,
  provenance,
}: {
  assets: BrandAsset[];
  productUrl: string;
  promptText: string;
  sceneText?: string;
  derivedFromAssetId?: string;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}): BrandAsset | undefined => {
  const normalizedUrl = normalizeUrlForKey(productUrl);
  const ranked = assets
    .filter((asset) => normalizeUrlForKey(asset.originPageUrl) === normalizedUrl)
    .map((asset) => ({
      asset,
      score: scoreReusableAsset(asset, promptText, sceneText, derivedFromAssetId, sourceAssetIds, provenance),
    }))
    .filter((entry) => entry.score >= 85)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.asset;
};

export const summarizeProductAssetHistory = (entries: ProductAssetRegistryEntry[]): string => {
  if (!entries.length) return 'No local product asset history yet.';

  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.assetType] = (acc[entry.assetType] || 0) + 1;
    return acc;
  }, {});

  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`);

  return `${entries.length} local assets tracked for this product: ${parts.join(', ')}.`;
};
