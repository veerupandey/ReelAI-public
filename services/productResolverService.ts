import type {
  Brand,
  BrandAsset,
  CampaignBrief,
  ProductContext,
  ProductResolutionCandidate,
  ProductResolutionResult,
  ProductUniverse,
} from '../types/brand';
import { findProductPageCandidates, getProductKnowledge, titleFromProductUrl } from './productPageImportService';

const PRODUCT_HINT_STOPWORDS = new Set([
  'create', 'make', 'generate', 'an', 'a', 'the', 'for', 'with', 'using', 'use', 'brand', 'agency',
  'video', 'ad', 'advertisement', 'advertising', 'tiktok', 'reel', 'reels', 'short', 'shorts',
  'instagram', 'youtube', 'please', 'need', 'want', 'seconds', 'second', 'sec', '30s', '15s', '45s', '60s',
  'campaign', 'viral', 'hook', 'ugc', 'style', 'and', 'from', 'to', 'of',
]);

const normalizeText = (value?: string): string =>
  (value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

export const extractProductUrls = (text: string): string[] => {
  const matches = text.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi) || [];
  return Array.from(new Set(matches.map((value) => value.startsWith('http') ? value : `https://${value}`)));
};

const extractPromptTokens = (prompt: string, brandName?: string): string[] => {
  const normalizedBrandName = normalizeText(brandName);
  const normalizedPrompt = normalizedBrandName
    ? normalizeText(prompt).replace(new RegExp(`\\b${normalizedBrandName.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ')
    : normalizeText(prompt);

  return normalizedPrompt
    .split(' ')
    .filter((token) => token.length > 2 && !PRODUCT_HINT_STOPWORDS.has(token));
};

const scoreCandidate = (candidate: string, promptTokens: string[]): number => {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate || promptTokens.length === 0) return 0;

  let score = 0;
  for (const token of promptTokens) {
    if (normalizedCandidate.includes(token)) {
      score += 25;
      continue;
    }
    if (token.length > 3 && normalizedCandidate.includes(token.slice(0, 3))) {
      score += 8;
    }
  }

  if (normalizedCandidate.includes(promptTokens.join(' '))) {
    score += 35;
  }

  return score;
};

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const buildCandidateTitle = (url: string, existingTitles: string[]): string => {
  const titled = existingTitles.find(Boolean);
  return titled || titleCase(titleFromProductUrl(url));
};

const groupAssetCandidates = (brand: Brand, promptTokens: string[]): ProductResolutionCandidate[] => {
  const groups = new Map<string, { assets: BrandAsset[]; titles: string[]; score: number }>();

  for (const asset of brand.assets) {
    if (asset.type !== 'product' || !asset.originPageUrl) continue;
    const key = normalizeUrlForKey(asset.originPageUrl);
    const title = asset.sourceProductTitle || '';
    const score = Math.max(
      scoreCandidate(title, promptTokens),
      scoreCandidate(asset.description || '', promptTokens),
      scoreCandidate(asset.originPageUrl || '', promptTokens),
    );
    if (score <= 0) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.assets.push(asset);
      if (title) existing.titles.push(title);
      existing.score = Math.max(existing.score, score);
    } else {
      groups.set(key, {
        assets: [asset],
        titles: title ? [title] : [],
        score,
      });
    }
  }

  return Array.from(groups.entries())
    .map(([productUrl, group]) => ({
      productId: productUrl,
      productUrl,
      productTitle: buildCandidateTitle(productUrl, group.titles),
      confidence: group.score,
      source: 'existing_assets' as const,
      assetCount: group.assets.length,
    }))
    .sort((a, b) => b.confidence - a.confidence);
};

const mergeCandidates = (...candidateSets: ProductResolutionCandidate[][]): ProductResolutionCandidate[] => {
  const merged = new Map<string, ProductResolutionCandidate>();

  for (const set of candidateSets) {
    for (const candidate of set) {
      const key = normalizeUrlForKey(candidate.productUrl);
      const existing = merged.get(key);
      if (!existing || candidate.confidence > existing.confidence) {
        merged.set(key, { ...candidate, productUrl: key, productId: key });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
};

export const resolveProductCandidates = async (
  brand: Brand | null,
  prompt: string,
): Promise<ProductResolutionCandidate[]> => {
  const promptTokens = extractPromptTokens(prompt, brand?.name);
  const explicitUrls = extractProductUrls(prompt);

  const explicitCandidates: ProductResolutionCandidate[] = explicitUrls.map((explicitUrl, index) => ({
    productId: normalizeUrlForKey(explicitUrl),
    productUrl: normalizeUrlForKey(explicitUrl),
    productTitle: titleCase(titleFromProductUrl(explicitUrl)),
    confidence: 999 - index,
    source: 'explicit_url',
  }));

  const assetCandidates = brand ? groupAssetCandidates(brand, promptTokens) : [];
  const catalogCandidates = brand?.websiteUrl
    ? (await findProductPageCandidates(brand.websiteUrl, prompt, brand.name)).map((candidate) => ({
        productId: normalizeUrlForKey(candidate.productUrl),
        productUrl: normalizeUrlForKey(candidate.productUrl),
        productTitle: titleCase(candidate.productTitle),
        confidence: candidate.confidence,
        source: 'catalog_search' as const,
      }))
    : [];

  return mergeCandidates(explicitCandidates, assetCandidates, catalogCandidates);
};

export const resolveProductBrief = async (
  brand: Brand | null,
  prompt: string,
): Promise<ProductResolutionResult> => {
  const candidates = await resolveProductCandidates(brand, prompt);
  const explicitUrls = extractProductUrls(prompt);
  if (candidates.length === 0) {
    return {
      status: 'unresolved',
      candidates: [],
      reason: 'No matching product could be resolved from the brief.',
    };
  }

  const [top, second] = candidates;
  if (explicitUrls.length > 1) {
    return {
      status: 'ambiguous',
      selectedCandidate: undefined,
      candidates: candidates.slice(0, Math.max(explicitUrls.length, 5)),
      reason: 'Multiple product URLs were detected. Choose the exact product you want to build this campaign around.',
    };
  }

  if (top.source === 'explicit_url') {
    return {
      status: 'resolved',
      selectedCandidate: top,
      candidates,
    };
  }

  if (second && Math.abs(top.confidence - second.confidence) <= 12 && second.confidence >= 35) {
    return {
      status: 'ambiguous',
      selectedCandidate: undefined,
      candidates: candidates.slice(0, 5),
      reason: 'Multiple products match the brief closely. Choose the exact product before continuing.',
    };
  }

  return {
    status: 'resolved',
    selectedCandidate: top,
    candidates,
  };
};

export const buildLockedProductContext = (
  brand: Brand,
  candidate: ProductResolutionCandidate,
  brief: Pick<CampaignBrief, 'platform' | 'durationSec'>,
): ProductContext => {
  const normalizedUrl = normalizeUrlForKey(candidate.productUrl);
  const productAssets = brand.assets.filter((asset) => normalizeUrlForKey(asset.originPageUrl) === normalizedUrl);

  // Merge real product page knowledge (ingredients, benefits, claims) with asset descriptions
  const knowledge = getProductKnowledge(normalizedUrl);
  const assetDescriptions = productAssets.map((asset) => asset.semanticDescription || asset.description).filter(Boolean);
  const knowledgeFacts = knowledge?.facts || [];
  const productFacts = Array.from(new Set([...knowledgeFacts, ...assetDescriptions]));

  if (knowledge) {
    console.info(`[productResolverService] Knowledge cache HIT for ${normalizedUrl}: ${knowledgeFacts.length} facts, signalSummary ${knowledge.signalSummary ? knowledge.signalSummary.length + ' chars' : 'empty'}`);
  } else {
    console.warn(`[productResolverService] Knowledge cache MISS for ${normalizedUrl} — storyboard will only have asset descriptions, no real product facts.`);
  }

  return {
    productId: candidate.productId,
    productTitle: candidate.productTitle,
    productUrl: normalizedUrl,
    brandName: brand.name,
    productAssets,
    productFacts,
    allowedClaims: brand.brandMemory?.approvedClaims || brand.dna?.valuePropositions || [],
    signalSummary: knowledge?.signalSummary,
    platform: brief.platform,
    durationSec: brief.durationSec || 30,
  };
};

export const buildProductUniverse = (
  brand: Brand,
  candidates: ProductResolutionCandidate[],
  brief: Pick<CampaignBrief, 'platform' | 'durationSec'>,
  primaryProductId?: string,
): ProductUniverse => {
  const seen = new Set<string>();
  const products = candidates
    .filter((candidate) => {
      const key = normalizeUrlForKey(candidate.productUrl);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((candidate) => buildLockedProductContext(brand, candidate, brief))
    .filter((product) => product.productAssets.length > 0);

  const fallbackPrimaryProductId = primaryProductId && products.some((product) => product.productId === primaryProductId)
    ? primaryProductId
    : products[0]?.productId || '';

  return {
    primaryProductId: fallbackPrimaryProductId,
    products,
  };
};
