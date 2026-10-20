import type { BrandAsset, ExecutionMode, ImportedProduct } from '../types/brand';
import { analyzeProductAssets } from './geminiService';

// ── Product Knowledge Cache ──────────────────────────────────────────────────
// Stores extracted product page text (ingredients, benefits, claims, usage) per
// normalized product URL so downstream consumers (storyboard planner, stable
// campaign service) can access real product knowledge instead of only image
// descriptions.
interface ProductKnowledge {
  signalSummary: string;
  facts: string[];
  productTitle: string;
  extractedAt: number;
}

const _productKnowledgeCache = new Map<string, ProductKnowledge>();

export const getProductKnowledge = (productUrl: string): ProductKnowledge | undefined => {
  return _productKnowledgeCache.get(normalizeUrlForKey(productUrl));
};

export const getAllProductKnowledge = (): ReadonlyMap<string, ProductKnowledge> => _productKnowledgeCache;

export const mergeProductKnowledge = (primaryUrl: string, otherUrls: string[]): void => {
  const primaryKey = normalizeUrlForKey(primaryUrl);
  const primary = _productKnowledgeCache.get(primaryKey);
  if (!primary) return;

  const mergedFacts = new Set(primary.facts);
  let mergedSummary = primary.signalSummary;

  for (const url of otherUrls) {
    const key = normalizeUrlForKey(url);
    if (key === primaryKey) continue;
    const entry = _productKnowledgeCache.get(key);
    if (!entry) continue;
    entry.facts.forEach((f) => mergedFacts.add(f));
    if (entry.signalSummary && !mergedSummary.includes(entry.signalSummary)) {
      mergedSummary = `${mergedSummary}\n\n--- From ${url} ---\n${entry.signalSummary}`;
    }
  }

  _productKnowledgeCache.set(primaryKey, {
    ...primary,
    facts: Array.from(mergedFacts),
    signalSummary: mergedSummary,
  });
};

const cacheProductKnowledge = (productUrl: string, title: string, signalSummary: string, facts: string[]): void => {
  const key = normalizeUrlForKey(productUrl);
  if (!key || (!signalSummary && facts.length === 0)) return;
  _productKnowledgeCache.set(key, {
    signalSummary,
    facts,
    productTitle: title,
    extractedAt: Date.now(),
  });
};

const IMAGE_MARKDOWN_REGEX = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const BARE_IMAGE_URL_REGEX = /(?:^|\s)((?:https?:\/\/[^\s)]+|\/[^\s)]+)\.(?:png|jpe?g|webp|avif)(?:\?[^\s)]*)?)/gi;
const OG_IMAGE_REGEX = /og:image[^"]*"(https?:\/\/[^"]+)"/gi;
const META_IMAGE_REGEX = /(?:image|thumbnail|photo)["'\s:]+\s*(https?:\/\/[^\s"'<>]+)/gi;
const PRODUCT_LINK_REGEX =
  /\[[^\]]*\]\((https?:\/\/[^)\s]+\/(?:products|product|shop|item|p|dp|catalog)\/[^)\s]+|\/(?:products|product|shop|item|p|dp|catalog)\/[^)\s]+)\)|\b(https?:\/\/[^\s)]+\/(?:products|product|shop|item|p|dp|catalog)\/[^\s)]+)\b/g;
const MAX_IMPORTED_ASSETS = 20;
const MAX_LINKED_PRODUCT_PAGES = 6;
const SHOPIFY_IMAGE_WIDTH = 720;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;
const CATALOG_DISCOVERY_PATHS = ['/', '/shop', '/collections/all'];
const IMAGE_CDN_HOSTNAMES = [
  'cdn.shopify.com',
  'images.unsplash.com',
  'res.cloudinary.com',
  'i.imgur.com',
  'img.cdn',
  'media.graphassets.com',
  'assets.website-files.com',
  'images.squarespace-cdn.com',
  'images.bigcommerce.com',
  'images.ctfassets.net',
];
const GENERIC_PAGE_TOKENS = new Set(['http', 'https', 'www', 'products', 'product', 'collections', 'shop', 'ca', 'com', 'org', 'net', 'io']);
const PRODUCT_HINT_STOPWORDS = new Set([
  'create', 'make', 'generate', 'an', 'a', 'the', 'for', 'with', 'using', 'use', 'brand', 'agency',
  'video', 'ad', 'advertisement', 'advertising', 'tiktok', 'reel', 'reels', 'short', 'shorts',
  'instagram', 'youtube', 'please', 'need', 'want', 'seconds', 'second', 'sec', '30s', '15s', '45s', '60s',
  'campaign', 'viral', 'hook', 'ugc', 'style', 'and', 'from', 'to', 'of',
  'already', 'added', 'base', 'url', 'website', 'site', 'just', 'say',
]);

export interface ProductImportResult {
  assets: BrandAsset[];
  productTitle: string;
  warnings: string[];
  pageReachable: boolean;
  imageCount: number;
}

const normalizeUrl = (input: string): string => {
  if (!input) return '';
  return input.startsWith('http') ? input : `https://${input}`;
};

const resolveAgainstPage = (rawUrl: string, pageUrl: string): string => {
  const cleaned = (rawUrl || '').trim().replace(/[).,]+$/, '');
  if (!cleaned) return '';
  try {
    return new URL(cleaned, normalizeUrl(pageUrl) || undefined).toString();
  } catch {
    return cleaned.startsWith('http') ? cleaned : '';
  }
};

const toImportedProductId = (productUrl: string): string =>
  `imported_product_${normalizeUrlForKey(productUrl).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}`;

const getSiteRootUrl = (input: string): string => {
  try {
    const parsed = new URL(normalizeUrl(input));
    return `${parsed.origin}/`;
  } catch {
    return normalizeUrl(input);
  }
};

const normalizeUrlForKey = (input: string): string => {
  try {
    const parsed = new URL(normalizeUrl(input));
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return normalizeUrl(input).replace(/\/$/, '');
  }
};

/**
 * Parse one or more product/store URLs from a freeform paste.
 * Accepts bare domains (`kageha.ca`), full https URLs, and comma/space-separated lists.
 */
export const parseProductImportUrls = (input: string): string[] => {
  const trimmed = (input || '').trim();
  if (!trimmed) return [];

  const tokens = trimmed.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const embedded = token.match(/https?:\/\/[^\s,]+/i)?.[0];
    const candidate = (embedded || token).replace(/[).,]+$/, '');
    try {
      const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(candidate)
        ? candidate
        : `https://${candidate}`;
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (!parsed.hostname || !parsed.hostname.includes('.')) continue;
      const key = normalizeUrlForKey(parsed.toString());
      if (!key || seen.has(key)) continue;
      seen.add(key);
      urls.push(key);
    } catch {
      // Skip malformed tokens
    }
  }

  return urls;
};

const buildCatalogDiscoveryUrls = (input: string): string[] => {
  try {
    const root = new URL(getSiteRootUrl(input));
    const urls = new Set<string>();
    CATALOG_DISCOVERY_PATHS.forEach((path) => {
      urls.add(new URL(path, root.origin).toString());
    });
    return Array.from(urls);
  } catch {
    return [getSiteRootUrl(input)];
  }
};

const buildJinaProxyUrl = (url: string): string => {
  const normalized = normalizeUrl(url);
  return `https://r.jina.ai/${normalized}`;
};

const buildJinaImageProxyUrl = (imageUrl: string): string =>
  `https://i.jina.ai/${imageUrl}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  url: string,
  opts?: { retries?: number; label?: string },
): Promise<Response> => {
  const maxRetries = opts?.retries ?? MAX_RETRIES;
  const label = opts?.label ?? 'fetch';
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) return response;

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${label}: HTTP ${response.status}`);
        if (attempt < maxRetries) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
      }

      throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
    } catch (error: any) {
      lastError = error;
      if (error?.name === 'AbortError') {
        lastError = new Error(`${label}: Request timed out`);
      }
      if (attempt < maxRetries) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  throw lastError || new Error(`${label}: All ${maxRetries + 1} attempts failed`);
};

export const fetchProductPageMarkdown = async (pageUrl: string): Promise<string> => {
  const normalizedUrl = normalizeUrl(pageUrl);
  if (!normalizedUrl) return '';

  try {
    const response = await fetchWithRetry(buildJinaProxyUrl(normalizedUrl), {
      label: 'product-page-markdown',
    });
    return await response.text();
  } catch (error) {
    console.warn('[productPageImportService] Failed to fetch product page markdown', normalizedUrl, error);
    return '';
  }
};

export const extractProductPageSignalSummary = (markdown: string): { productTitle: string; signalSummary: string } => {
  const productTitle = extractProductTitle(markdown) || '';
  const lines = (markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const nonImageLines = lines.filter((line) => !line.startsWith('!['));

  const keyBullets = nonImageLines
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 10)
    .filter((line) => !/\b(read more|learn more|subscribe|shipping|returns|privacy|terms)\b/i.test(line))
    .slice(0, 18);

  const keywordLines = nonImageLines
    .filter((line) => !/^[-*]\s+/.test(line))
    .filter((line) => line.length >= 18 && line.length <= 160)
    .filter((line) => /(benefit|benefits|ingredient|ingredients|how to use|directions|clinically|dermatologist|free from|fragrance|sulfate|paraben|ph|barrier|sensitive)/i.test(line))
    .slice(0, 18);

  const titleLine = productTitle ? `Product title: ${productTitle}` : undefined;
  const bulletBlock = keyBullets.length ? `Key bullets:\n- ${keyBullets.join('\n- ')}` : undefined;
  const keywordBlock = keywordLines.length ? `Key copy lines:\n- ${keywordLines.join('\n- ')}` : undefined;

  return {
    productTitle,
    signalSummary: [titleLine, keywordBlock, bulletBlock].filter(Boolean).join('\n\n'),
  };
};

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const isRenderableImage = (url: string): boolean => {
  if (/\.(png|jpe?g|webp|avif|svg)(?:\?|$)/i.test(url)) return true;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (IMAGE_CDN_HOSTNAMES.some((cdn) => hostname.includes(cdn))) return true;
  } catch { /* ignore parse errors */ }

  if (/\/images?\//i.test(url) && !/\.(css|js|json|html|xml|pdf|zip|mp4|mp3)(?:\?|$)/i.test(url)) return true;

  return false;
};

const optimizeImageUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes('cdn.shopify.com') && !url.searchParams.has('width')) {
      url.searchParams.set('width', String(SHOPIFY_IMAGE_WIDTH));
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const inferMimeTypeFromUrl = (rawUrl: string): string => {
  const normalized = rawUrl.toLowerCase();
  if (normalized.includes('.png') || /[?&]format=png\b/.test(normalized)) return 'image/png';
  if (normalized.includes('.webp') || /[?&]format=webp\b/.test(normalized)) return 'image/webp';
  if (normalized.includes('.avif') || /[?&]format=avif\b/.test(normalized)) return 'image/avif';
  if (normalized.includes('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
};

const normalizeImageUrlForKey = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes('cdn.shopify.com')) {
      url.searchParams.delete('width');
      url.searchParams.delete('height');
      url.searchParams.delete('crop');
      url.searchParams.delete('format');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

const sanitizeDescription = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/^image \d+:\s*/i, '').trim();

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractProductTitle = (markdown: string): string => {
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]) {
    return h1Match[1].split('|')[0].trim();
  }

  const titleMatch = markdown.match(/^Title:\s+(.+)$/m);
  if (titleMatch?.[1]) {
    return titleMatch[1].split('|')[0].trim();
  }

  return '';
};

const tokenizeProductTitle = (productTitle: string): string[] =>
  normalizeText(productTitle)
    .split(' ')
    .filter((token) => token.length > 2 && !GENERIC_PAGE_TOKENS.has(token));

const extractProductHintTokens = (prompt: string, brandName?: string): string[] => {
  const normalizedBrandName = normalizeText(brandName || '');
  const cleanedPrompt = normalizedBrandName
    ? normalizeText(prompt).replace(new RegExp(`\\b${normalizedBrandName.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ')
    : normalizeText(prompt);

  return cleanedPrompt
    .split(' ')
    .filter((token) => token.length > 2 && !PRODUCT_HINT_STOPWORDS.has(token) && !GENERIC_PAGE_TOKENS.has(token));
};

const scoreProductCandidate = (candidate: string, hintTokens: string[]): number => {
  if (!candidate || hintTokens.length === 0) return 0;
  const normalizedCandidate = normalizeText(candidate);
  const candidateTokens = normalizedCandidate.split(' ').filter(Boolean);

  let score = 0;

  for (const token of hintTokens) {
    if (candidateTokens.includes(token)) {
      score += 30;
      continue;
    }
    if (normalizedCandidate.includes(token)) {
      score += 18;
      continue;
    }
    if (token.length > 3 && candidateTokens.some((candidateToken) =>
      candidateToken.startsWith(token.slice(0, 3)) || token.startsWith(candidateToken.slice(0, 3)),
    )) {
      score += 10;
    }
  }

  if (normalizedCandidate.includes(hintTokens.join(' '))) {
    score += 40;
  }

  return score;
};

const PRODUCT_PATH_SEGMENT = /\/(?:products|product|shop|item|p|dp|catalog)\//i;

const extractHomepageProductLinks = (markdown: string, pageUrl?: string): string[] => {
  const urls = new Set<string>();
  for (const match of markdown.matchAll(PRODUCT_LINK_REGEX)) {
    const raw = (match[1] || match[2] || '').replace(/[).,]+$/, '');
    const resolved = pageUrl ? resolveAgainstPage(raw, pageUrl) : (raw.startsWith('http') ? raw : '');
    if (resolved && PRODUCT_PATH_SEGMENT.test(resolved)) {
      urls.add(resolved);
    }
  }
  return Array.from(urls);
};

export const titleFromProductUrl = (url: string): string => {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return slug
      .split(/[-_]+/)
      .filter(Boolean)
      .join(' ');
  } catch {
    return url;
  }
};

const countTokenMatches = (haystack: string, tokens: string[]): number =>
  tokens.filter((token) => haystack.includes(token)).length;

const scoreImageCandidate = (
  altText: string,
  url: string,
  brandName: string | undefined,
  pageUrl: string,
  productTitle: string,
): number => {
  const normalizedAlt = altText.toLowerCase();
  const normalizedUrl = url.toLowerCase();
  const pageTokens = pageUrl
    .toLowerCase()
    .split(/[/?#._-]+/)
    .filter(Boolean);
  const brandTokens = (brandName || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const productTokens = tokenizeProductTitle(productTitle);

  let score = 0;

  if (normalizedUrl.includes('cdn.shopify.com')) score += 50;
  if (normalizedAlt.includes('thumbnail')) score += 20;
  if (normalizedAlt.includes('product')) score += 15;
  if (normalizedAlt.includes('bottle')) score += 10;
  if (normalizedAlt.includes('detail')) score += 8;

  const productMatchCount = countTokenMatches(`${normalizedAlt} ${normalizedUrl}`, productTokens);
  if (productMatchCount > 0) {
    score += productMatchCount * 35;
  }

  if (productTitle && normalizedAlt.includes(productTitle.toLowerCase())) {
    score += 60;
  }

  if (pageTokens.some((token) => token.length > 2 && (normalizedAlt.includes(token) || normalizedUrl.includes(token)))) {
    score += 25;
  }

  if (brandTokens.some((token) => token.length > 2 && (normalizedAlt.includes(token) || normalizedUrl.includes(token)))) {
    score += 10;
  }

  if (
    productTokens.length > 0 &&
    productMatchCount === 0 &&
    /(serum|cleanser|balm|soap|soak|mist|oil|cream|mask|wash|toner|lotion|lip|dropper)/i.test(normalizedAlt)
  ) {
    score -= 80;
  }

  if (/(logo|icon|instagram|tiktok|browse all|home|banner)/i.test(normalizedAlt)) {
    score -= 100;
  }

  return score;
};

const collectImageCandidatesFromMarkdown = (
  markdown: string,
  pageUrl: string,
  brandName: string | undefined,
  productTitle: string,
  productTokens: string[],
  seen: Set<string>,
): Array<{ altText: string; imageUrl: string; score: number; matchCount: number }> => {
  const candidates: Array<{ altText: string; imageUrl: string; score: number; matchCount: number }> = [];

  const addCandidate = (altText: string, rawUrl: string, bonus: number = 0) => {
    const resolvedUrl = resolveAgainstPage(rawUrl, pageUrl);
    const imageUrl = optimizeImageUrl(resolvedUrl);
    const imageKey = normalizeImageUrlForKey(imageUrl);
    if (!imageUrl || !isRenderableImage(imageUrl) || seen.has(imageKey)) return;
    seen.add(imageKey);

    const score = scoreImageCandidate(altText, imageUrl, brandName, pageUrl, productTitle) + bonus;
    if (score <= 0) return;
    const matchCount = countTokenMatches(`${altText.toLowerCase()} ${imageUrl.toLowerCase()}`, productTokens);
    candidates.push({ altText, imageUrl, score, matchCount });
  };

  for (const match of markdown.matchAll(IMAGE_MARKDOWN_REGEX)) {
    addCandidate(sanitizeDescription(match[1] || ''), match[2] || '', 10);
  }

  for (const match of markdown.matchAll(BARE_IMAGE_URL_REGEX)) {
    addCandidate('', match[1] || '');
  }

  for (const match of markdown.matchAll(OG_IMAGE_REGEX)) {
    addCandidate('og:image', match[1] || '', 30);
  }

  for (const match of markdown.matchAll(META_IMAGE_REGEX)) {
    addCandidate('meta-image', match[1] || '', 15);
  }

  return candidates;
};

const selectPreferredImageCandidates = (
  candidates: Array<{ altText: string; imageUrl: string; score: number; matchCount: number }>,
  productTitle: string,
): Array<{ altText: string; imageUrl: string; score: number; matchCount: number }> => {
  if (candidates.length === 0) return [];

  const normalizedProductTitle = normalizeText(productTitle);
  const productTokens = tokenizeProductTitle(productTitle);
  const preferredCandidates = productTokens.length > 0
    ? candidates.filter((candidate) => {
        const candidateText = normalizeText(`${candidate.altText} ${candidate.imageUrl}`);
        const minRequiredMatches = Math.min(2, productTokens.length);
        return (
          (normalizedProductTitle && candidateText.includes(normalizedProductTitle)) ||
          candidate.matchCount >= minRequiredMatches
        );
      })
    : candidates;

  return (preferredCandidates.length > 0 ? preferredCandidates : candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IMPORTED_ASSETS);
};

const extractProductImages = (
  markdown: string,
  pageUrl: string,
  brandName?: string,
  productTitleHint?: string,
): Array<{ altText: string; imageUrl: string }> => {
  const productTitle = (productTitleHint || extractProductTitle(markdown)).trim();
  const seen = new Set<string>();
  const productTokens = tokenizeProductTitle(productTitle);

  const candidates = collectImageCandidatesFromMarkdown(
    markdown, pageUrl, brandName, productTitle, productTokens, seen,
  );

  if (candidates.length === 0) return [];

  return selectPreferredImageCandidates(candidates, productTitle)
    .map(({ altText, imageUrl }) => ({ altText, imageUrl }));
};

const extractCatalogFallbackImages = async (
  productUrl: string,
  brandName?: string,
  productTitleHint?: string,
): Promise<Array<{ altText: string; imageUrl: string }>> => {
  const discoveryUrls = buildCatalogDiscoveryUrls(productUrl)
    .map((url) => normalizeUrlForKey(url))
    .filter((url) => url && url !== normalizeUrlForKey(productUrl));
  if (discoveryUrls.length === 0) return [];

  const productTitle = (productTitleHint || titleFromProductUrl(productUrl)).trim();
  if (!productTitle) return [];

  const seen = new Set<string>();
  const productTokens = tokenizeProductTitle(productTitle);
  const rankedCandidates: Array<{ altText: string; imageUrl: string; score: number; matchCount: number }> = [];

  const pages = await Promise.all(discoveryUrls.map(async (discoveryUrl) => ({
    discoveryUrl,
    markdown: await fetchProductPageMarkdown(discoveryUrl),
  })));

  pages.forEach(({ markdown }) => {
    if (!markdown || markdown.trim().length < 50) return;
    rankedCandidates.push(...collectImageCandidatesFromMarkdown(
      markdown,
      productUrl,
      brandName,
      productTitle,
      productTokens,
      seen,
    ));
  });

  return selectPreferredImageCandidates(rankedCandidates, productTitle)
    .map(({ altText, imageUrl }) => ({ altText, imageUrl }));
};

const isLikelyProductPageUrl = (pageUrl: string): boolean => {
  try {
    return PRODUCT_PATH_SEGMENT.test(new URL(pageUrl).pathname);
  } catch {
    return false;
  }
};

const mergeUniqueImageCandidates = (
  ...lists: Array<Array<{ altText: string; imageUrl: string; score?: number }>>
): Array<{ altText: string; imageUrl: string }> => {
  const seen = new Set<string>();
  const merged: Array<{ altText: string; imageUrl: string; score: number }> = [];

  for (const list of lists) {
    for (const item of list) {
      const key = normalizeImageUrlForKey(item.imageUrl);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        altText: item.altText,
        imageUrl: item.imageUrl,
        score: item.score ?? 0,
      });
    }
  }

  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IMPORTED_ASSETS)
    .map(({ altText, imageUrl }) => ({ altText, imageUrl }));
};

/**
 * When the user pastes a store homepage (e.g. kageha.ca), also scrape linked
 * product pages so we pull real gallery shots instead of only homepage heroes.
 */
const extractImagesFromLinkedProductPages = async (
  markdown: string,
  pageUrl: string,
  brandName?: string,
): Promise<Array<{ altText: string; imageUrl: string; score: number }>> => {
  const productLinks = extractHomepageProductLinks(markdown, pageUrl)
    .map((url) => normalizeUrlForKey(url))
    .filter(Boolean)
    .slice(0, MAX_LINKED_PRODUCT_PAGES);

  if (productLinks.length === 0) return [];

  const seen = new Set<string>();
  const ranked: Array<{ altText: string; imageUrl: string; score: number; matchCount: number }> = [];

  const pages = await Promise.all(
    productLinks.map(async (productUrl) => ({
      productUrl,
      markdown: await fetchProductPageMarkdown(productUrl),
    })),
  );

  for (const { productUrl, markdown: productMarkdown } of pages) {
    if (!productMarkdown || productMarkdown.trim().length < 50) continue;
    const productTitle = extractProductTitle(productMarkdown) || titleFromProductUrl(productUrl);
    const productTokens = tokenizeProductTitle(productTitle);
    const candidates = collectImageCandidatesFromMarkdown(
      productMarkdown,
      productUrl,
      brandName,
      productTitle,
      productTokens,
      seen,
    ).map((candidate) => ({
      ...candidate,
      // Prefer dedicated product-page gallery shots over homepage marketing frames.
      score: candidate.score + 20,
    }));
    ranked.push(...candidates);
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IMPORTED_ASSETS)
    .map(({ altText, imageUrl, score }) => ({ altText, imageUrl, score }));
};

const fetchImageDirect = async (imageUrl: string): Promise<{ base64: string; mimeType: string } | null> => {
  try {
    const response = await fetch(imageUrl, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const base64 = await toBase64(blob);
    if (!base64) return null;
    return { base64, mimeType: blob.type || inferMimeTypeFromUrl(imageUrl) };
  } catch {
    return null;
  }
};

const fetchImageViaProxy = async (imageUrl: string): Promise<{ base64: string; mimeType: string } | null> => {
  try {
    const proxyUrl = buildJinaImageProxyUrl(imageUrl);
    const response = await fetch(proxyUrl, { mode: 'cors' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const base64 = await toBase64(blob);
    if (!base64) return null;
    return { base64, mimeType: blob.type || inferMimeTypeFromUrl(imageUrl) };
  } catch {
    return null;
  }
};

const fetchImageAsset = async (
  imageUrl: string,
  description: string,
  originPageUrl: string,
  sourceProductTitle: string,
): Promise<BrandAsset | null> => {
  const assetId = `brand_asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fallbackAsset: BrandAsset = {
    id: assetId,
    type: 'product',
    base64: '',
    mimeType: inferMimeTypeFromUrl(imageUrl),
    description,
    sourceUrl: imageUrl,
    previewUrl: imageUrl,
    originPageUrl,
    sourceProductTitle,
  };

  const directResult = await fetchImageDirect(imageUrl);
  if (directResult) {
    return { ...fallbackAsset, base64: directResult.base64, mimeType: directResult.mimeType };
  }

  const proxyResult = await fetchImageViaProxy(imageUrl);
  if (proxyResult) {
    return { ...fallbackAsset, base64: proxyResult.base64, mimeType: proxyResult.mimeType };
  }

  console.warn('[productPageImportService] All fetch strategies failed for image, keeping previewUrl-only asset', imageUrl);
  return fallbackAsset;
};

export const importProductPageAssetsRich = async (
  pageUrl: string,
  brandName?: string,
  options?: {
    executionMode?: ExecutionMode;
    analyzeAssets?: boolean;
    prefetchedMarkdown?: string;
  },
): Promise<ProductImportResult> => {
  const normalizedUrl = normalizeUrl(pageUrl);
  const emptyResult: ProductImportResult = {
    assets: [],
    productTitle: '',
    warnings: [],
    pageReachable: false,
    imageCount: 0,
  };

  if (!normalizedUrl) {
    emptyResult.warnings.push('Invalid or empty product URL.');
    return emptyResult;
  }

  let markdown = options?.prefetchedMarkdown || '';
  if (!markdown) {
    try {
      const response = await fetchWithRetry(buildJinaProxyUrl(normalizedUrl), {
        label: 'product-page-import',
      });
      markdown = await response.text();
    } catch (error: any) {
      emptyResult.warnings.push(`Could not reach the product page: ${error?.message || 'network error'}`);
      return emptyResult;
    }
  }

  emptyResult.pageReachable = true;

  if (!markdown || markdown.trim().length < 50) {
    emptyResult.warnings.push('The product page returned very little or no content. The page may require JavaScript rendering or may be behind a login.');
    return emptyResult;
  }

  const productTitle = extractProductTitle(markdown) || titleFromProductUrl(normalizedUrl);
  emptyResult.productTitle = productTitle;

  // Cache product page knowledge (ingredients, benefits, claims) for downstream use
  const { signalSummary: pageSummary } = extractProductPageSignalSummary(markdown);
  if (pageSummary) {
    const pageFacts = pageSummary
      .split('\n')
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter((line) => line.length > 0 && !/^Product title:/i.test(line))
      .slice(0, 12);
    cacheProductKnowledge(normalizedUrl, productTitle, pageSummary, pageFacts);
  }

  let productImages = extractProductImages(markdown, normalizedUrl, brandName, productTitle);
  let usedCatalogFallback = false;
  let usedLinkedProducts = false;

  // Store homepages often expose only a few hero frames. Follow product links
  // so Brand Agency / Image Studio can curate real product gallery shots.
  if (!isLikelyProductPageUrl(normalizedUrl) && productImages.length < MAX_IMPORTED_ASSETS) {
    const linkedImages = await extractImagesFromLinkedProductPages(markdown, normalizedUrl, brandName);
    if (linkedImages.length > 0) {
      // Prefer dedicated product-page galleries; keep homepage frames only as fillers.
      const homepageScored = productImages.map((image, index) => ({
        ...image,
        score: Math.max(1, 35 - index),
      }));
      productImages = mergeUniqueImageCandidates(linkedImages, homepageScored);
      usedLinkedProducts = true;
    }
  }

  if (!productImages.length) {
    productImages = await extractCatalogFallbackImages(normalizedUrl, brandName, productTitle);
    usedCatalogFallback = productImages.length > 0;
  }
  emptyResult.imageCount = productImages.length;

  if (usedLinkedProducts) {
    emptyResult.warnings.push(
      `Enriched import with product-page galleries (up to ${MAX_IMPORTED_ASSETS} images). Paste a specific product URL for a tighter set.`,
    );
  }

  if (usedCatalogFallback) {
    emptyResult.warnings.push(
      `Imported ${productImages.length} product image${productImages.length === 1 ? '' : 's'} from the brand catalog because the direct product page gallery was not exposed in the fetched page content.`,
    );
  }

  if (!productImages.length) {
    emptyResult.warnings.push(
      productTitle
        ? `The product page "${productTitle}" was reachable, but no product images were found in the page content. The page may use lazy-loaded images or JavaScript-rendered galleries.`
        : 'The page was reachable but no product images were detected. Try pasting a direct product page URL instead of a category or homepage.',
    );
    return emptyResult;
  }

  const importedAssets = await Promise.all(
    productImages.map(({ altText, imageUrl }) =>
      fetchImageAsset(
        imageUrl,
        altText || productTitle || `${brandName || 'Product'} image`,
        normalizeUrlForKey(normalizedUrl),
        productTitle,
      ),
    ),
  );

  const filteredAssets = importedAssets.filter((asset): asset is BrandAsset => Boolean(asset));
  const assetsWithBase64 = filteredAssets.filter((asset) => Boolean(asset.base64));
  const previewOnlyAssets = filteredAssets.filter((asset) => !asset.base64);
  // Prefer downloadable (base64) assets so the Image Studio can render reliably.
  const preferredAssets = [
    ...assetsWithBase64,
    ...previewOnlyAssets,
  ].slice(0, MAX_IMPORTED_ASSETS);

  if (assetsWithBase64.length === 0 && preferredAssets.length > 0) {
    emptyResult.warnings.push(
      `Found ${preferredAssets.length} product images but could not download any (CORS or access restrictions). The images will be referenced by URL only.`,
    );
  } else if (assetsWithBase64.length < preferredAssets.length) {
    emptyResult.warnings.push(
      `Downloaded ${assetsWithBase64.length} of ${preferredAssets.length} images. Some images were blocked by CORS or access restrictions.`,
    );
  }

  if (!preferredAssets.length || options?.analyzeAssets === false) {
    return { ...emptyResult, assets: preferredAssets };
  }

  try {
    const analyzedAssets = await analyzeProductAssets({
      assets: preferredAssets,
      productTitle,
      brandName,
      executionMode: options?.executionMode || 'balanced',
    });
    return { ...emptyResult, assets: analyzedAssets };
  } catch (error: any) {
    emptyResult.warnings.push(`Asset analysis failed (${error?.message || 'unknown error'}), returning raw imports.`);
    return { ...emptyResult, assets: preferredAssets };
  }
};

export const importProductPageAssets = async (
  pageUrl: string,
  brandName?: string,
  options?: {
    executionMode?: ExecutionMode;
    analyzeAssets?: boolean;
    prefetchedMarkdown?: string;
  },
): Promise<BrandAsset[]> => {
  const result = await importProductPageAssetsRich(pageUrl, brandName, options);
  if (result.warnings.length > 0) {
    console.warn('[productPageImportService] Import warnings:', result.warnings);
  }
  return result.assets;
};

export const importProductUniverse = async (
  pageUrls: string[],
  brandName?: string,
  options?: {
    executionMode?: ExecutionMode;
    analyzeAssets?: boolean;
  },
): Promise<ImportedProduct[]> => {
  const uniqueUrls = Array.from(new Set(pageUrls.map((url) => normalizeUrlForKey(url)).filter(Boolean)));
  const imported = await Promise.all(uniqueUrls.map(async (productUrl) => {
    const markdown = await fetchProductPageMarkdown(productUrl);
    const { productTitle, signalSummary } = extractProductPageSignalSummary(markdown);
    const assets = await importProductPageAssets(productUrl, brandName, {
      ...options,
      prefetchedMarkdown: markdown,
    });
    const facts = signalSummary
      .split('\n')
      .map((line) => line.replace(/^[-*]\s+/, '').trim())
      .filter((line) => line.length > 0 && !/^Product title:/i.test(line))
      .slice(0, 12);

    cacheProductKnowledge(productUrl, productTitle || titleFromProductUrl(productUrl), signalSummary, facts);

    return {
      id: toImportedProductId(productUrl),
      productUrl,
      title: productTitle || titleFromProductUrl(productUrl),
      brandName,
      signalSummary,
      facts,
      assets,
    } satisfies ImportedProduct;
  }));

  return imported.filter((entry) => entry.assets.length > 0 || entry.signalSummary);
};

export const resolveProductPageUrl = async (
  websiteUrl: string,
  prompt: string,
  brandName?: string,
): Promise<string | undefined> => {
  const candidates = await findProductPageCandidates(websiteUrl, prompt, brandName);
  return candidates[0]?.productUrl;
};

export const findProductPageCandidates = async (
  websiteUrl: string,
  prompt: string,
  brandName?: string,
): Promise<Array<{ productUrl: string; productTitle: string; confidence: number }>> => {
  const normalizedWebsite = normalizeUrl(websiteUrl);
  if (!normalizedWebsite) return [];
  const hintTokens = extractProductHintTokens(prompt, brandName);
  if (hintTokens.length === 0) return [];

  try {
    const discoveryUrls = buildCatalogDiscoveryUrls(normalizedWebsite);
    const pages = await Promise.all(discoveryUrls.map(async (discoveryUrl) => ({
      discoveryUrl,
      markdown: await fetchProductPageMarkdown(discoveryUrl),
    })));

    const deduped = new Map<string, { productUrl: string; productTitle: string; confidence: number }>();
    pages.flatMap(({ markdown }) => extractHomepageProductLinks(markdown, normalizedWebsite))
      .map((productUrl) => ({
        productUrl: normalizeUrlForKey(productUrl),
        productTitle: titleFromProductUrl(productUrl),
        confidence: scoreProductCandidate(titleFromProductUrl(productUrl), hintTokens),
      }))
      .filter((candidate) => candidate.confidence > 0)
      .forEach((candidate) => {
        const existing = deduped.get(candidate.productUrl);
        if (!existing || candidate.confidence > existing.confidence) {
          deduped.set(candidate.productUrl, candidate);
        }
      });

    return Array.from(deduped.values()).sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    console.warn('[productPageImportService] Failed to find product page candidates', normalizedWebsite, error);
    return [];
  }
};
