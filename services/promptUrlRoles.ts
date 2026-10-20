/**
 * Prompt URL roles — decide which URL is the product and which is the reference.
 *
 * A prompt like "recreate this reel https://instagram.com/p/xyz for
 * https://shop.com/products/abc" contains both. Taking the first URL as the
 * product locks brand identity onto an Instagram profile picture, so roles are
 * resolved once here and passed around as data instead of re-parsed from prose.
 */

/** Hosts whose URLs are creative references, never product identity. */
const SOCIAL_HOST_RE =
  /(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|vimeo\.com|pinterest\.com|twitter\.com|x\.com|threads\.net|snapchat\.com)$/i;

/** Path shapes that mark a product detail page. */
const PDP_PATH_RE = /\/(products?|p|dp|item|itm|shop)\//i;

export interface PromptUrlRoles {
  /** Shop / PDP URL that may be used for product research and identity lock. */
  productUrl?: string;
  /** Social or creative reference URL used for capture and structure analysis. */
  referenceUrl?: string;
  /** URLs that were found but not assigned a role. */
  extraUrls: string[];
  /** Short human-readable notes explaining the split. */
  reasons: string[];
}

export interface ResolvePromptUrlRolesInput {
  prompt?: string;
  /** Form / launch param product URL. Always wins over prose. */
  explicitProductUrl?: string;
  /** Form / launch param reference URL. Always wins over prose. */
  explicitReferenceUrl?: string;
  /** True when a packshot upload can stand in for a product URL. */
  hasPackshot?: boolean;
}

function cleanUrl(raw: string): string {
  return raw.trim().replace(/[),.;'"\]]+$/, '');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** Short host label for user-facing step lines, e.g. "kageha.ca". */
export function urlHostLabel(url?: string): string {
  if (!url) return '';
  if (url.startsWith('upload://')) return 'uploaded packshot';
  return hostOf(url) || url;
}

/** True when the URL points at a social platform (reference-only). */
export function isSocialReferenceUrl(url?: string): boolean {
  if (!url) return false;
  const host = hostOf(url);
  return host ? SOCIAL_HOST_RE.test(host) : false;
}

/** All http(s) URLs in a block of text, de-duplicated in order of appearance. */
export function extractHttpUrls(text?: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const url = cleanUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function scoreProductCandidate(url: string): number {
  let score = 0;
  if (PDP_PATH_RE.test(url)) score += 10;
  if (/\/collections\//i.test(url)) score += 2;
  // Prefer a real page over a bare domain.
  try {
    if (new URL(url).pathname.replace(/\/+$/, '').length > 1) score += 1;
  } catch {
    /* ignore */
  }
  return score;
}

/**
 * Resolve product and reference roles from explicit params plus prompt text.
 * Order of URLs in the prompt never decides the role.
 */
export function resolvePromptUrlRoles(input: ResolvePromptUrlRolesInput): PromptUrlRoles {
  const reasons: string[] = [];
  const explicitProduct = cleanUrl(input.explicitProductUrl || '');
  const explicitReference = cleanUrl(input.explicitReferenceUrl || '');

  let productUrl: string | undefined;
  let referenceUrl: string | undefined;

  if (explicitProduct && !isSocialReferenceUrl(explicitProduct)) {
    productUrl = explicitProduct;
    reasons.push(`Product URL supplied directly (${urlHostLabel(productUrl)})`);
  } else if (explicitProduct) {
    // A social URL in the product field is a mis-fill, not a product.
    referenceUrl = explicitProduct;
    reasons.push(`Ignored social URL in the product field (${urlHostLabel(explicitProduct)}) — treated as reference`);
  }

  if (explicitReference && explicitReference !== productUrl) {
    referenceUrl = explicitReference;
    reasons.push(`Reference URL supplied directly (${urlHostLabel(referenceUrl)})`);
  }

  const found = extractHttpUrls(input.prompt).filter(
    (url) => url !== productUrl && url !== referenceUrl,
  );
  const socialUrls = found.filter(isSocialReferenceUrl);
  const productCandidates = found.filter((url) => !isSocialReferenceUrl(url));

  if (!referenceUrl && socialUrls.length) {
    referenceUrl = socialUrls[0];
    reasons.push(`Reference from ${urlHostLabel(referenceUrl)} (social post)`);
  }

  if (!productUrl && productCandidates.length) {
    const ranked = [...productCandidates].sort(
      (a, b) => scoreProductCandidate(b) - scoreProductCandidate(a),
    );
    productUrl = ranked[0];
    reasons.push(
      PDP_PATH_RE.test(productUrl)
        ? `Product from ${urlHostLabel(productUrl)} (product page)`
        : `Product from ${urlHostLabel(productUrl)}`,
    );
  }

  const assigned = new Set([productUrl, referenceUrl].filter(Boolean) as string[]);
  const extraUrls = found.filter((url) => !assigned.has(url));

  if (!productUrl) {
    reasons.push(
      input.hasPackshot
        ? 'No product URL — using the uploaded packshot for product identity'
        : 'No product URL found',
    );
  }

  return { productUrl, referenceUrl, extraUrls, reasons };
}

/** True when the run cannot establish product identity from any source. */
export function missingProductIdentity(
  roles: PromptUrlRoles,
  opts: { hasPackshot?: boolean } = {},
): boolean {
  return !roles.productUrl && !opts.hasPackshot;
}
