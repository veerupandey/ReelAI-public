/**
 * Research-aware Instagram caption generation grounded on the final image.
 * Reuses brand/trend/product context when present; optional web research only when thin.
 * When the active asset belongs to a variation set, writes ONE caption for the full carousel.
 */
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type {
  BrandKnowledge,
  CaptionTone,
  CreativeConcept,
  ProductTruth,
  SocialPostDraft,
  StudioAsset,
  StudioCaptionPack,
  TrendResearchResult,
} from './types';
import { STUDIO_FLASH_MODEL, STUDIO_RESEARCH_MODEL } from './studioModels';

const CAPTION_MODEL = STUDIO_FLASH_MODEL;
const CAPTION_RESEARCH_MODEL = STUDIO_RESEARCH_MODEL;
const MAX_CAPTION_LENGTH = 2200;
const MAX_HASHTAGS = 12;
/** Gemini 3 thinking models spend output budget on thoughts; 1024 truncates viral JSON. */
const CAPTION_MAX_OUTPUT_TOKENS = 4096;

export const CAPTION_TONE_PRESETS: Record<
  CaptionTone,
  { label: string; hint: string; maxChars: number; hashtagCount: string }
> = {
  short: {
    label: 'Short',
    hint:
      '1–2 punchy sentences. Minimal emoji. Strong hook, light CTA. Hashtags: tight Instagram mix — 1 brand + 2–4 niche/discovery tags (research-backed when search is on).',
    maxChars: 280,
    hashtagCount: '3–5',
  },
  story: {
    label: 'Story',
    hint:
      'Warm narrative voice in 3–5 short paragraphs. Soft CTA near the end. Hashtags: Instagram-native stack — brand/product + community niche + 1–2 timely topic tags from research.',
    maxChars: 900,
    hashtagCount: '5–8',
  },
  promo: {
    label: 'Promo',
    hint:
      'Conversion-focused. Lead with benefit, clear CTA, urgency without spammy hype. Hashtags: shopper-intent + category niche + timely seasonal/trending tags when relevant.',
    maxChars: 500,
    hashtagCount: '5–8',
  },
  viral: {
    label: 'Viral',
    hint:
      'Hook-first Instagram Reels/carousel energy: scroll-stopping open, social proof or timely cultural angle, soft CTA. Hashtags: 2–3 brand/product, 3–5 niche community, 3–5 currently trending topic tags from live research — never #fyp #viral spam.',
    maxChars: 700,
    hashtagCount: '8–12',
  },
};

export interface CaptionProgress {
  stage: 'researching' | 'writing' | 'done';
  message: string;
}

export interface GenerateCaptionInput {
  asset: StudioAsset;
  /**
   * Ordered slides for a carousel caption.
   * Prefer Instagram post-queue selection order (not generation order).
   * When present with 2+ slides, caption is written for the carousel as a whole.
   */
  siblingAssets?: StudioAsset[];
  /** When true, siblingAssets order is treated as the post-queue selection order. */
  postQueueOrdered?: boolean;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  selectedConcept?: CreativeConcept;
  socialPostDraft?: SocialPostDraft;
  /** Force web research even when brand context exists */
  forceWebResearch?: boolean;
  tone?: CaptionTone;
  /** Previous caption pack — used when revising */
  previousCaption?: Pick<StudioCaptionPack, 'caption' | 'hashtags' | 'callToAction' | 'researchSummary'>;
  /** User instruction to revise an existing caption (edit/retry direction) */
  reviseInstruction?: string;
  onProgress?: (progress: CaptionProgress) => void;
}

/** Ordered carousel slides for an asset that belongs to a variation set. */
export function getCaptionCarouselSlides(
  assets: StudioAsset[],
  active: StudioAsset,
): StudioAsset[] {
  if (!active.variationSetId) return [active];
  return assets
    .filter((asset) => asset.variationSetId === active.variationSetId)
    .sort(
      (left, right) =>
        (left.variationIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.variationIndex ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * Resolve slides from Instagram post-queue selection order (click order).
 * Does NOT use generation / variationIndex order.
 */
export function getPostQueueSlides(
  assets: StudioAsset[],
  postQueueIds: string[],
): StudioAsset[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return postQueueIds
    .map((id) => byId.get(id))
    .filter((asset): asset is StudioAsset => Boolean(asset));
}

/** Format caption + hashtags for Instagram paste */
export function formatCaptionForClipboard(pack: Pick<StudioCaptionPack, 'caption' | 'hashtags'>): string {
  const caption = pack.caption.trim();
  const tags = pack.hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .filter(Boolean)
    .join(' ');
  if (!tags) return caption;
  return `${caption}\n\n${tags}`;
}

function getGeminiApiKey(): string {
  const viteKey =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY
      : undefined;
  const windowKey =
    typeof window !== 'undefined'
      ? (window as any).ENV?.VITE_GEMINI_API_KEY ||
        (window as any).ENV?.VITE_API_KEY ||
        (window as any).ENV?.GEMINI_API_KEY
      : undefined;
  const definedKey =
    typeof process !== 'undefined'
      ? process.env.GEMINI_API_KEY || process.env.API_KEY
      : undefined;
  const raw = String(viteKey || windowKey || definedKey || '').trim();
  // Env values sometimes include trailing comments ("AIza… # from console.cloud…").
  const googleKey = raw.match(/AIza[0-9A-Za-z_-]{20,}/);
  return googleKey?.[0] || raw.split(/\s+/)[0] || '';
}

function accepted<T>(values: Array<{ value: T; status: string }> | undefined): T[] {
  return values?.filter((item) => item.status !== 'rejected').map((item) => item.value) ?? [];
}

function isUnknownLabel(value?: string | null): boolean {
  return !value || /^(?:unknown(?:\s+product)?|product\s+unknown|n\/?a|not\s+available)$/i.test(value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Remove transport metadata and known asset labels before context reaches Gemini. */
export function sanitizeCaptionContext(
  value?: string | null,
  forbiddenLabels: string[] = [],
): string | undefined {
  if (!value) return undefined;
  let clean = value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[\w()+,\- ]+\.(?:jpe?g|png|gif|webp|heic|avif|bmp|svg)\b/gi, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{19,}\b/gi, ' ');
  for (const label of forbiddenLabels.filter(Boolean)) {
    clean = clean.replace(new RegExp(escapeRegExp(label), 'gi'), ' ');
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean && !isUnknownLabel(clean) && !isFilenameLikeLabel(clean) ? clean : undefined;
}

function unescapeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/** Best-effort recovery when thinking models hit MAX_TOKENS mid-JSON. */
function parsePartialCaptionJson(text: string): Record<string, unknown> {
  const captionMatch = text.match(/"caption"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!captionMatch?.[1]) return {};
  const caption = unescapeJsonString(captionMatch[1]).trim();
  if (!caption) return {};

  const hashtags: string[] = [];
  const hashtagBlock = text.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
  if (hashtagBlock?.[1]) {
    for (const match of hashtagBlock[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      const tag = unescapeJsonString(match[1]).trim();
      if (tag) hashtags.push(tag);
    }
  }

  const field = (name: string): string | undefined => {
    const match = text.match(new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    return match?.[1] ? unescapeJsonString(match[1]).trim() || undefined : undefined;
  };

  return {
    caption,
    hashtags,
    callToAction: field('callToAction'),
    altText: field('altText'),
    researchSummary: field('researchSummary'),
  };
}

function parseGeminiResponse(response: GenerateContentResponse): any {
  try {
    const text = response.text || '{}';
    const clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(clean);
    } catch {
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(clean.slice(start, end + 1));
        } catch {
          // fall through to partial recovery
        }
      }
      return parsePartialCaptionJson(clean);
    }
  } catch {
    return {};
  }
}

export function shouldUseCaptionWebResearch(input: {
  brandKnowledge?: BrandKnowledge;
  forceWebResearch?: boolean;
  tone?: CaptionTone;
}): boolean {
  if (input.forceWebResearch) return true;
  if (input.tone === 'viral') return true;
  return !input.brandKnowledge;
}

function resolveCarouselMeta(input: Pick<GenerateCaptionInput, 'asset' | 'siblingAssets' | 'postQueueOrdered'>): {
  slides: StudioAsset[];
  slideCount: number;
  variationSetId?: string;
  postQueueIds?: string[];
  isCarousel: boolean;
} {
  // Post-queue selection order: keep array order as-is (do not sort by variationIndex).
  if (input.postQueueOrdered && input.siblingAssets && input.siblingAssets.length > 0) {
    const slides = [...input.siblingAssets];
    const slideCount = slides.length;
    return {
      slides,
      slideCount,
      postQueueIds: slides.map((s) => s.id),
      variationSetId: undefined,
      isCarousel: slideCount >= 2,
    };
  }

  const fromSiblings =
    input.siblingAssets && input.siblingAssets.length > 0
      ? [...input.siblingAssets].sort(
          (left, right) =>
            (left.variationIndex ?? Number.MAX_SAFE_INTEGER) -
            (right.variationIndex ?? Number.MAX_SAFE_INTEGER),
        )
      : [];

  const slides =
    fromSiblings.length > 0
      ? fromSiblings.some((slide) => slide.id === input.asset.id)
        ? fromSiblings
        : [...fromSiblings, input.asset].sort(
            (left, right) =>
              (left.variationIndex ?? Number.MAX_SAFE_INTEGER) -
              (right.variationIndex ?? Number.MAX_SAFE_INTEGER),
          )
      : [input.asset];

  const variationSetId = input.asset.variationSetId || slides.find((s) => s.variationSetId)?.variationSetId;
  const slideCount = slides.length;
  const isCarousel = Boolean(variationSetId) && slideCount >= 2;

  return { slides, slideCount, variationSetId, isCarousel };
}

function buildCarouselSlideNotes(
  slides: StudioAsset[],
  activeId: string,
): string {
  return slides
    .map((slide, index) => {
      const active = slide.id === activeId ? ' (active / primary grounding image)' : '';
      return `Slide ${index + 1}${active}: attached visual`;
    })
    .join('\n');
}

export function buildCaptionGrounding(
  input: Omit<GenerateCaptionInput, 'asset' | 'onProgress'> & {
    assetPromptHint?: string;
    carouselNotes?: string;
    slideCount?: number;
  },
): string {
  const brand = input.brandKnowledge;
  const concept = input.selectedConcept;
  const truth = input.productTruth;
  const draft = input.socialPostDraft;
  const trends = input.trendResearch?.insights.slice(0, 4) ?? [];
  const forbiddenLabels = (input.siblingAssets ?? []).flatMap((asset) => [
    asset.id,
    ...(isFilenameLikeLabel(asset.name) ? [asset.name] : []),
  ]);
  const clean = (value?: string | null) =>
    sanitizeCaptionContext(value, forbiddenLabels);
  const cleanValues = (values: string[]) =>
    values.map((value) => clean(value)).filter((value): value is string => Boolean(value));

  const productLabel = resolveCaptionProductLabel({
    productTruth: truth,
    brandKnowledge: brand,
  });

  return [
    clean(brand?.brandName.value) && `Brand: ${clean(brand?.brandName.value)}`,
    cleanValues(accepted(brand?.toneAttributes)).length > 0 &&
      `Brand tone: ${cleanValues(accepted(brand?.toneAttributes)).join(', ')}`,
    cleanValues(accepted(brand?.approvedLanguage)).length > 0 &&
      `Approved language: ${cleanValues(accepted(brand?.approvedLanguage)).join('; ')}`,
    cleanValues(accepted(brand?.prohibitedLanguage)).length > 0 &&
      `Never use or imply: ${cleanValues(accepted(brand?.prohibitedLanguage)).join('; ')}`,
    clean(productLabel) && `Product: ${clean(productLabel)}`,
    cleanValues(truth?.verifiedFacts ?? []).length > 0 &&
      `Verified product facts: ${cleanValues(truth?.verifiedFacts ?? []).join('; ')}`,
    clean(concept?.title) &&
      clean(concept?.oneLineIdea) &&
      `Concept: ${clean(concept?.title)} — ${clean(concept?.oneLineIdea)}`,
    clean(concept?.hook) && `Hook: ${clean(concept?.hook)}`,
    cleanValues(trends.map((insight) => `${insight.title} — ${insight.description}`)).length > 0 &&
      `Trend cues: ${cleanValues(trends.map((insight) => `${insight.title} — ${insight.description}`)).join('; ')}`,
    clean(draft?.copy.headline) && `Existing headline: ${clean(draft?.copy.headline)}`,
    clean(draft?.copy.caption) && `Existing caption draft: ${clean(draft?.copy.caption)}`,
    clean(draft?.objective) && `Objective: ${clean(draft?.objective)}`,
    input.slideCount &&
      input.slideCount >= 2 &&
      `Carousel: ${input.slideCount}-slide Instagram carousel — write ONE caption for the full set`,
    input.carouselNotes && `Carousel slides (ordered):\n${input.carouselNotes}`,
    clean(input.assetPromptHint) && `Image generation prompt: ${clean(input.assetPromptHint)}`,
    'Never mention file names, asset IDs, or technical upload labels in caption/hashtags/alt text.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function isFilenameLikeLabel(value?: string | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/\.(jpe?g|png|gif|webp|heic|avif|bmp|svg)$/i.test(trimmed)) return true;
  if (/^[a-f0-9-]{8,}$/i.test(trimmed)) return true;
  // Upload-style slugs: editorial-uji-roasted-matcha (lots of hyphens, no spaces)
  if (/^[a-z0-9]+(?:-[a-z0-9]+){2,}\.(?:jpe?g|png|gif|webp)$/i.test(trimmed)) return true;
  if (/^[a-z0-9]+(?:-[a-z0-9]+){3,}$/i.test(trimmed) && !/\s/.test(trimmed)) return true;
  return false;
}

/**
 * Human-readable product label for captions — never a raw asset filename.
 */
export function resolveCaptionProductLabel(input: {
  productTruth?: ProductTruth;
  brandKnowledge?: BrandKnowledge;
  asset?: StudioAsset;
}): string | undefined {
  const candidates = [
    input.productTruth?.productName,
    input.brandKnowledge?.approvedLanguage?.[0]?.value,
    input.brandKnowledge?.brandName?.value,
  ];
  for (const candidate of candidates) {
    if (candidate && !isUnknownLabel(candidate) && !isFilenameLikeLabel(candidate)) {
      return candidate.trim();
    }
  }
  // Last resort: pull a short phrase from a verified fact that isn't a filename
  const fact = input.productTruth?.verifiedFacts
    ?.filter((item) => /^product name:/i.test(item))
    ?.map((item) => item.replace(/^product name:\s*/i, '').trim())
    .find(
      (item) =>
        !isUnknownLabel(item) &&
        !isFilenameLikeLabel(item),
    );
  if (fact) {
    return fact;
  }
  return undefined;
}

const BANNED_HASHTAGS = new Set([
  'instagram',
  'instagood',
  'photooftheday',
  'viral',
  'fyp',
  'foryou',
  'explorepage',
  'reels',
]);

function hashtagEvidenceText(input: GenerateCaptionInput): string {
  return [
    input.brandKnowledge?.brandName.value,
    ...accepted(input.brandKnowledge?.toneAttributes),
    ...accepted(input.brandKnowledge?.approvedLanguage),
    resolveCaptionProductLabel(input),
    ...(input.productTruth?.verifiedFacts ?? []),
    input.selectedConcept?.title,
    input.selectedConcept?.oneLineIdea,
    input.selectedConcept?.hook,
    ...(input.trendResearch?.insights ?? []).flatMap((insight) => [
      insight.title,
      insight.description,
    ]),
    input.socialPostDraft?.copy.headline,
    input.socialPostDraft?.copy.caption,
    ...(input.socialPostDraft?.copy.hashtags ?? []),
    ...resolveCarouselMeta(input).slides.map((asset) => asset.generationPrompt),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function isEvidenceBasedHashtag(tag: string, evidenceText: string): boolean {
  const normalized = normalizeHashtag(tag).toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedEvidence = evidenceText.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return Boolean(normalized && normalizedEvidence.includes(normalized));
}

export function isJunkHashtag(tag: string): boolean {
  const normalized = normalizeHashtag(tag).toLowerCase();
  if (!normalized || normalized.length < 2) return true;
  if (BANNED_HASHTAGS.has(normalized)) return true;
  if (isFilenameLikeLabel(normalized)) return true;
  if (/\.(jpe?g|png|gif|webp)$/i.test(normalized)) return true;
  return false;
}

export function buildFallbackCaptionPack(
  input: GenerateCaptionInput,
  cause?: unknown,
): StudioCaptionPack {
  const brandName =
    (input.brandKnowledge?.brandName.value &&
      !isFilenameLikeLabel(input.brandKnowledge.brandName.value) &&
      input.brandKnowledge.brandName.value) ||
    'our brand';
  const product = resolveCaptionProductLabel(input);
  const concept = input.selectedConcept;
  const draft = input.socialPostDraft;
  const carousel = resolveCarouselMeta(input);
  const tone = input.tone || 'story';
  const evidenceText = hashtagEvidenceText(input);

  const caption =
    (draft?.copy.caption?.trim() && !isFilenameLikeLabel(draft.copy.caption)
      ? draft.copy.caption.trim()
      : null) ||
    [
      concept?.hook && !isFilenameLikeLabel(concept.hook)
        ? concept.hook
        : product
          ? `${product} — for the moments that deserve a little more care.`
          : `Something new from ${brandName}.`,
      product && brandName.toLowerCase() !== product.toLowerCase()
        ? `Crafted by ${brandName}.`
        : null,
      carousel.isCarousel
        ? `Swipe through all ${carousel.slideCount} slides.`
        : null,
      draft?.copy.callToAction ||
        (tone === 'viral'
          ? 'Save this and send it to someone who needs a better morning.'
          : 'Save this for later.'),
    ]
      .filter(Boolean)
      .join('\n\n');

  const hashtags = (draft?.copy.hashtags?.length
    ? draft.copy.hashtags
    : [
        brandName.toLowerCase().replace(/[^a-z0-9]+/gi, ''),
        ...(product
          ? [product.toLowerCase().replace(/[^a-z0-9]+/gi, '').slice(0, 24)]
          : []),
      ]
  )
    .map(normalizeHashtag)
    .filter((tag) => !isJunkHashtag(tag))
    .filter((tag) => isEvidenceBasedHashtag(tag, evidenceText))
    .slice(0, MAX_HASHTAGS);

  return {
    caption: caption.slice(0, MAX_CAPTION_LENGTH),
    hashtags,
    callToAction: draft?.copy.callToAction,
    altText: describeAltFallback(input.asset, brandName, product),
    researchSummary:
      'Caption AI failed — used a brand-safe fallback (not live research). Tap Regenerate to retry.',
    sourceAssetId: input.asset.id,
    variationSetId: carousel.isCarousel ? carousel.variationSetId : undefined,
    postQueueIds: carousel.postQueueIds,
    slideCount: carousel.isCarousel ? carousel.slideCount : undefined,
    generatedAt: new Date().toISOString(),
    usedWebResearch: false,
    tone: input.tone,
    generationStatus: 'fallback',
    generationError:
      cause instanceof Error
        ? cause.message
        : 'Caption generation was unavailable; a deterministic fallback was used.',
  };
}

function describeAltFallback(
  asset: StudioAsset,
  brandName: string,
  product?: string,
): string {
  if (product) return `${product} image for ${brandName}`;
  if (asset.name && !isFilenameLikeLabel(asset.name)) return `${asset.name} — ${brandName}`;
  return `${brandName} Instagram image`;
}

function normalizeHashtag(tag: string): string {
  // Instagram hashtags are conventionally lowercase; normalize case here so
  // every downstream path (stored pack, clipboard, IG post) emits lowercase.
  return tag.replace(/^#+/, '').trim().replace(/\s+/g, '').toLowerCase();
}

export function sanitizeCaptionPack(
  raw: Partial<StudioCaptionPack>,
  meta: Pick<
    StudioCaptionPack,
    | 'sourceAssetId'
    | 'usedWebResearch'
    | 'researchSummary'
    | 'tone'
    | 'variationSetId'
    | 'slideCount'
    | 'postQueueIds'
  > & { hashtagEvidence?: string; forbiddenLabels?: string[] },
): StudioCaptionPack {
  const tone = meta.tone || raw.tone;
  const maxChars = tone ? CAPTION_TONE_PRESETS[tone].maxChars : MAX_CAPTION_LENGTH;
  const caption = (raw.caption || '').trim().slice(0, maxChars);
  if (!caption) {
    throw new Error('Caption model returned an empty caption');
  }
  const generatedText = [caption, raw.callToAction, raw.altText].filter(Boolean).join(' ');
  if (
    /\.(?:jpe?g|png|gif|webp|heic|avif)\b/i.test(generatedText) ||
    meta.forbiddenLabels?.some(
      (label) => label && generatedText.toLowerCase().includes(label.toLowerCase()),
    )
  ) {
    throw new Error('Caption model exposed an asset filename or ID');
  }
  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : [])
    .map(normalizeHashtag)
    .filter((tag) => !isJunkHashtag(tag))
    // Web/viral research introduces timely tags that are not in studio evidence text.
    .filter(
      (tag) =>
        meta.usedWebResearch ||
        !meta.hashtagEvidence ||
        isEvidenceBasedHashtag(tag, meta.hashtagEvidence),
    )
    .slice(0, MAX_HASHTAGS);

  return {
    caption,
    hashtags,
    callToAction: raw.callToAction?.trim() || undefined,
    altText: raw.altText?.trim() || undefined,
    researchSummary: meta.researchSummary || raw.researchSummary,
    sourceAssetId: meta.sourceAssetId,
    variationSetId: meta.variationSetId,
    postQueueIds: meta.postQueueIds,
    slideCount: meta.slideCount,
    generatedAt: new Date().toISOString(),
    usedWebResearch: meta.usedWebResearch,
    tone,
    generationStatus: 'ok',
  };
}

type GeminiImagePart = { inlineData: { mimeType: string; data: string } };
const CAPTION_IMAGE_MAX_DIMENSION = 1280;
const CAPTION_IMAGE_JPEG_QUALITY = 0.82;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBlob(data: string, mimeType: string): Blob | undefined {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  } catch {
    return undefined;
  }
}

async function optimizeCaptionImage(
  blob: Blob,
  fallbackMimeType: string,
): Promise<GeminiImagePart> {
  const rawPart = async (): Promise<GeminiImagePart> => ({
    inlineData: {
      mimeType: blob.type || fallbackMimeType,
      data: arrayBufferToBase64(await blob.arrayBuffer()),
    },
  });

  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return rawPart();
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(
      1,
      CAPTION_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return rawPart();

    // JPEG keeps multi-slide caption requests comfortably below Gemini's inline payload limit.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const optimized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CAPTION_IMAGE_JPEG_QUALITY),
    );
    if (!optimized) return rawPart();
    return {
      inlineData: {
        mimeType: 'image/jpeg',
        data: arrayBufferToBase64(await optimized.arrayBuffer()),
      },
    };
  } catch {
    return rawPart();
  } finally {
    bitmap?.close();
  }
}

async function studioAssetToGeminiPart(asset: StudioAsset): Promise<GeminiImagePart> {
  const dataUrl = asset.base64?.match(/^data:([^;,]+);base64,(.+)$/s);
  if (dataUrl) {
    const blob = base64ToBlob(dataUrl[2], dataUrl[1]);
    if (blob) return optimizeCaptionImage(blob, dataUrl[1]);
    return { inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } };
  }
  if (asset.base64 && !/^(?:https?:|blob:)/i.test(asset.base64)) {
    const blob = base64ToBlob(asset.base64, asset.mimeType);
    if (blob) return optimizeCaptionImage(blob, asset.mimeType);
    return { inlineData: { mimeType: asset.mimeType, data: asset.base64 } };
  }

  const sourceUrl = asset.base64 || asset.previewUrl;
  if (!sourceUrl) throw new Error('A selected slide has no image data');
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not load a selected slide (${response.status})`);
  const mimeType = response.headers.get('content-type')?.split(';')[0] || asset.mimeType;
  return optimizeCaptionImage(await response.blob(), mimeType);
}

/**
 * Generate an Instagram caption pack grounded on the final image + session context.
 * For variation sets or post-queue selection order, produces ONE caption for the full carousel.
 */
export async function generateStudioCaption(
  input: GenerateCaptionInput,
): Promise<StudioCaptionPack> {
  const tone = input.tone || 'story';
  const useWebResearch = shouldUseCaptionWebResearch({
    brandKnowledge: input.brandKnowledge,
    forceWebResearch: input.forceWebResearch,
    tone,
  });
  const carousel = resolveCarouselMeta(input);
  const carouselNotes = carousel.isCarousel
    ? buildCarouselSlideNotes(carousel.slides, input.asset.id)
    : undefined;

  const grounding = buildCaptionGrounding({
    brandKnowledge: input.brandKnowledge,
    trendResearch: input.trendResearch,
    productTruth: input.productTruth,
    selectedConcept: input.selectedConcept,
    socialPostDraft: input.socialPostDraft,
    forceWebResearch: input.forceWebResearch,
    siblingAssets: carousel.slides,
    assetPromptHint: input.asset.generationPrompt,
    carouselNotes,
    slideCount: carousel.isCarousel ? carousel.slideCount : undefined,
  });

  if (useWebResearch) {
    input.onProgress?.({
      stage: 'researching',
      message:
        tone === 'viral'
          ? 'Researching trending Instagram topics & hashtags…'
          : 'Researching topic hashtags & Instagram discovery tags…',
    });
  } else {
    input.onProgress?.({
      stage: 'writing',
      message: carousel.isCarousel
        ? `Writing caption for ${carousel.slideCount}-slide set…`
        : 'Writing caption from brand context + image…',
    });
  }

  try {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      throw new Error(
        'Gemini API key is not configured. Set VITE_GEMINI_API_KEY or VITE_API_KEY and restart the app.',
      );
    }
    const ai = new GoogleGenAI({ apiKey });
    const brandName =
      sanitizeCaptionContext(input.brandKnowledge?.brandName.value) ?? 'the brand';
    const tonePreset = CAPTION_TONE_PRESETS[tone];

    const carouselBlock = carousel.isCarousel
      ? `
This is an Instagram CAROUSEL with ${carousel.slideCount} slides in the USER'S SELECTED POST ORDER (selection order, not generation order).
Write ONE caption for the entire carousel (not one caption per slide).
All ${carousel.slideCount} slides are ATTACHED in exact swipe order. Ground the caption on every image and use them for carousel flow / narrative arc:
${carouselNotes}
`
      : '';

    const viralBlock =
      tone === 'viral'
        ? `
VIRAL STRATEGY (required):
- Open with a scroll-stopping hook in the first line (Instagram feed/Reels style — short lines, optional 1–2 emoji max in the hook).
- Use web search for CURRENT timely cultural/seasonal angles relevant to this product/image (e.g. wellness rituals, seasonal drinks, sleep trends) — only if they fit naturally; do not force irrelevant trends.
- researchSummary must name the timely angle AND 2–3 specific trending hashtags/topics you found via search.
`
        : '';

    const hashtagStrategyBlock = `
HASHTAG STRATEGY — Instagram-native + research-driven (required):
${useWebResearch ? '- You HAVE web search. Look up what is currently trending / rising for THIS product category and topic (e.g. roasted matcha, hojicha, evening ritual, sleep hygiene). Prefer tags people actually browse on Instagram right now.' : '- Web search is off — use brand/product/niche tags only; do not invent fake "trending" tags.'}
- Build the hashtag set like a strong IG creator (not a spam bot):
  1) 2–3 branded / product tags (#Brand, #ProductLine)
  2) 3–5 niche community / discovery tags for the topic (specific > generic)
  3) ${useWebResearch ? '2–4 timely/trending topic tags grounded in your search results' : '0–2 optional seasonal tags only if obvious from context'}
- Instagram style: CamelCase or natural compound words (e.g. RoastedMatcha, EveningRitual). No spaces. No # in the JSON strings.
- AVOID mega-spam and empty bait: instagood, photooftheday, viral, fyp, explorepage, reels, love, beautiful, insta, followme.
- AVOID inventing tags with zero topical fit. Every tag must help discovery for this post.
- Return exactly ${tonePreset.hashtagCount} tags in the hashtags array.
`;

    const reviseBlock =
      input.reviseInstruction?.trim() && input.previousCaption
        ? `
REVISION REQUEST (required):
Previous caption:
"""
${sanitizeCaptionContext(input.previousCaption.caption) || 'Prior caption unavailable'}
"""
Previous hashtags: ${(input.previousCaption.hashtags || []).filter((tag) => !isJunkHashtag(tag)).map((t) => `#${t.replace(/^#/, '')}`).join(' ')}
${sanitizeCaptionContext(input.previousCaption.researchSummary) ? `Previous strategy: ${sanitizeCaptionContext(input.previousCaption.researchSummary)}` : ''}
User revise direction: ${sanitizeCaptionContext(input.reviseInstruction) || 'Improve the prior caption'}
Rewrite the caption + hashtags to follow the revise direction while staying grounded on the image and brand.
`
        : '';

    const prompt = `You are an Instagram copywriter for ${brandName}.
Write a post-ready caption pack grounded on every ATTACHED image.
Captions are for the merchant to copy-paste into Instagram — they do NOT require Instagram API tokens.
Write in native Instagram voice: short lines, swipe cues for carousels, soft CTA — not blog prose.
${carouselBlock}${viralBlock}${hashtagStrategyBlock}${reviseBlock}
GROUNDING — prefer this over inventing claims:
${grounding || 'No prior brand research — use careful visual reading of the image and light web research if tools are available.'}

Tone preset: ${tonePreset.label}
${tonePreset.hint}
- Caption max ${tonePreset.maxChars} characters
- Hashtags: ${tonePreset.hashtagCount} (follow HASHTAG STRATEGY above)

Rules:
- Match brand voice when available; never invent medical/performance claims
- Do not expose internal planning language (brand fit, rationale, visual direction, etc.)
- NEVER put file names (e.g. anything ending in .jpg/.png), asset IDs, or upload slugs in caption, hashtags, or alt text
- Prefer the real product/brand name from grounding; if product name looks like a filename, use the brand name instead
- Alt text: short accessibility description of the attached image set
- researchSummary: 1–2 short sentences — ${useWebResearch ? 'name the trending topics/hashtags you found via search and how you mixed brand vs niche vs trending tags' : 'say which brand/product context grounded the tags (no fake trend claims)'}
- Hashtags must be real topical words/phrases (no filenames, no #instagram #viral #fyp spam)
${carousel.isCarousel ? '- Optionally nod to swiping / the full set without listing every slide' : ''}

Return JSON only:
{
  "caption": "...",
  "hashtags": ["tag1", "tag2"],
  "callToAction": "optional short CTA phrase",
  "altText": "...",
  "researchSummary": "..."
}`;

    const imageParts = await Promise.all(carousel.slides.map(studioAssetToGeminiPart));
    const parts: Array<{ text: string } | GeminiImagePart> = [
      ...imageParts,
      { text: prompt },
    ];

    const generate = async (withSearch: boolean, includeImages = true) =>
      ai.models.generateContent({
        model: withSearch ? CAPTION_RESEARCH_MODEL : CAPTION_MODEL,
        tools: withSearch ? [{ googleSearch: {} }] : undefined,
        contents: { parts: includeImages ? parts : [{ text: prompt }] },
        config: {
          // Grounded search rejects responseMimeType on some models — ask for JSON in the prompt.
          ...(withSearch ? {} : { responseMimeType: 'application/json' }),
          maxOutputTokens: CAPTION_MAX_OUTPUT_TOKENS,
        },
      } as any);

    input.onProgress?.({
      stage: 'writing',
      message: input.reviseInstruction?.trim()
        ? 'Revising caption…'
        : useWebResearch
          ? `Writing ${tonePreset.label.toLowerCase()} caption with research…`
          : carousel.isCarousel
            ? `Writing ${tonePreset.label.toLowerCase()} caption for ${carousel.slideCount}-slide set…`
            : `Writing ${tonePreset.label.toLowerCase()} caption from image + brand context…`,
    });

    let response: GenerateContentResponse;
    let usedWebResearch = useWebResearch;
    try {
      response = await generate(useWebResearch);
    } catch (researchError) {
      try {
        // Research/tools can fail — still produce a usable caption without search.
        if (!useWebResearch) throw researchError;
        console.warn('[captionService] Caption web research failed; retrying without search:', researchError);
        input.onProgress?.({
          stage: 'writing',
          message: 'Trend research unavailable — writing caption from image + brand context…',
        });
        response = await generate(false);
        usedWebResearch = false;
      } catch (imageRequestError) {
        // Large carousels or unsupported image encodings can reject an otherwise valid request.
        // The prompt still contains sanitized brand, product, concept, and per-slide context.
        console.warn(
          '[captionService] Caption image request failed; retrying from studio context:',
          imageRequestError,
        );
        input.onProgress?.({
          stage: 'writing',
          message: 'Image analysis unavailable — writing from verified studio context…',
        });
        response = await generate(false, false);
        usedWebResearch = false;
      }
    }

    let parsed = parseGeminiResponse(response);
    if (!parsed?.caption || typeof parsed.caption !== 'string' || !parsed.caption.trim()) {
      if (usedWebResearch) {
        // Grounded answers often wrap/omit JSON — retry once without tools for clean JSON.
        console.warn('[captionService] Empty caption after grounded call; retrying without search');
        input.onProgress?.({
          stage: 'writing',
          message: 'Rewriting caption from image + brand context…',
        });
        response = await generate(false);
        usedWebResearch = false;
        parsed = parseGeminiResponse(response);
      }
      if (!parsed?.caption || typeof parsed.caption !== 'string' || !parsed.caption.trim()) {
        throw new Error('Caption model returned empty or unparseable JSON');
      }
    }

    const pack = sanitizeCaptionPack(parsed, {
      sourceAssetId: input.asset.id,
      variationSetId: carousel.isCarousel ? carousel.variationSetId : undefined,
      postQueueIds: carousel.postQueueIds,
      slideCount: carousel.isCarousel ? carousel.slideCount : undefined,
      usedWebResearch,
      tone,
      hashtagEvidence: hashtagEvidenceText(input),
      forbiddenLabels: carousel.slides.flatMap((asset) => [
        asset.id,
        ...(isFilenameLikeLabel(asset.name) ? [asset.name] : []),
      ]),
      researchSummary:
        (typeof parsed.researchSummary === 'string' && parsed.researchSummary.trim()) ||
        (usedWebResearch
          ? tone === 'viral'
            ? 'Used timely trend research plus the final image for viral strategy.'
            : 'Used light web research plus the final image.'
          : useWebResearch
            ? 'Trend research unavailable — caption grounded on image + studio brand/product context.'
            : carousel.isCarousel
              ? `Used existing studio context plus the active image (${carousel.slideCount}-slide set).`
              : 'Used existing studio brand/product context plus the final image.'),
    });

    input.onProgress?.({ stage: 'done', message: 'Caption ready' });
    return pack;
  } catch (error) {
    console.warn('[captionService] Caption generation failed:', error);
    input.onProgress?.({ stage: 'done', message: 'Using fallback caption' });
    return buildFallbackCaptionPack({
      ...input,
      tone,
    }, error);
  }
}
