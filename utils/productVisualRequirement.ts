/**
 * Detects when a slide/scene prompt requires the real product to appear,
 * so generation must use a product image reference instead of inventing one.
 */

const PRODUCT_INDICATORS =
  /\b(packshot|packaging|package|label|logo|bottle|jar|tin|tube|pouch|box|container|serum|dropper|pump|cta|call[- ]to[- ]action|shop(?:pable)?|buy now|hero shot|exact product|featuring the)\b/i;

/** Explicit product-visible phrasing. */
const PRODUCT_NOUN = /\bproduct\b/i;

const LIFESTYLE_ONLY_INDICATORS =
  /\b(lifestyle|environment|mood|texture|abstract|landscape|nature|atmosphere|ambiance|feeling|emotion|no product|without (?:the )?product|product[- ]free)\b/i;

/** True when the creative brief requires the real product to be visible. */
export function requiresProductReference(text: string): boolean {
  const sceneText = text.trim();
  if (!sceneText) return false;

  // Explicit opt-out wins
  if (/\b(no product|without (?:the )?product|product[- ]free)\b/i.test(sceneText)) {
    return false;
  }

  const hasProductKeywords = PRODUCT_INDICATORS.test(sceneText) || PRODUCT_NOUN.test(sceneText);
  const hasLifestyleOnly = LIFESTYLE_ONLY_INDICATORS.test(sceneText);

  if (hasProductKeywords) return true;
  if (hasLifestyleOnly) return false;
  // Default safe: if unclear, require product grounding when brand/pack cues appear
  return /\b(brand|sku|pack)\b/i.test(sceneText);
}

export type CampaignSlideVisualMode = 'use_uploaded' | 'product_composite' | 'generate';

/** Normalize planner output so product-required "generate" slides become product_composite. */
export function normalizeCampaignSlideVisualMode(
  visualMode: string | undefined,
  imagePrompt: string,
  headline = '',
  body = '',
): CampaignSlideVisualMode {
  if (visualMode === 'use_uploaded') return 'use_uploaded';
  if (visualMode === 'product_composite' || visualMode === 'product_locked') return 'product_composite';

  const combined = `${headline} ${body} ${imagePrompt}`;
  if (requiresProductReference(combined)) return 'product_composite';
  return 'generate';
}

export interface ProductImageRef {
  base64: string;
  mimeType: string;
}

export interface SlideImageGenerationPlan {
  mode: 'generate' | 'edit' | 'composite';
  primaryReference?: { data: string; mimeType: string };
  productRule: string;
  error?: string;
}

/**
 * Resolve how to generate a campaign slide image.
 * Product-required slides must receive a real product reference or fail clearly.
 */
export function resolveSlideImageGeneration(input: {
  visualMode: CampaignSlideVisualMode;
  imagePrompt: string;
  headline?: string;
  body?: string;
  productImages: ProductImageRef[];
  preferredIndex?: number | null;
}): SlideImageGenerationPlan {
  const { visualMode, imagePrompt, headline = '', body = '', productImages, preferredIndex } = input;
  const needsProduct =
    visualMode === 'product_composite' ||
    (visualMode === 'generate' && requiresProductReference(`${headline} ${body} ${imagePrompt}`));

  if (!needsProduct) {
    return {
      mode: 'generate',
      productRule:
        '\n\nGENERATE FRESH: Create a distinct supporting visual. Do not invent or insert a product packshot.',
    };
  }

  if (productImages.length === 0) {
    return {
      mode: 'generate',
      productRule: '',
      error:
        'This slide needs the real product in frame, but no product images are available. Upload or import a product photo, then regenerate.',
    };
  }

  const idx =
    preferredIndex != null && preferredIndex >= 0 && preferredIndex < productImages.length
      ? preferredIndex
      : 0;
  const product = productImages[idx];

  return {
    mode: 'composite',
    primaryReference: { data: product.base64, mimeType: product.mimeType || 'image/png' },
    productRule:
      '\n\nPRODUCT COMPOSITE: The attached image is the real product. Preserve its exact packaging, label, logo, colors, and proportions. Place it naturally in the described scene — do not redesign or invent a different product.',
  };
}

/** Upgrade agent visual modes that claim "fresh" while the prompt still needs the product. */
export function coerceAgentVisualMode(
  visualMode: 'product_locked' | 'product_composite' | 'generated_fresh' | undefined,
  imagePrompt: string,
  role = '',
): 'product_locked' | 'product_composite' | 'generated_fresh' {
  const mode = visualMode || 'generated_fresh';
  if (mode !== 'generated_fresh') return mode;
  if (!requiresProductReference(`${role} ${imagePrompt}`)) return 'generated_fresh';
  if (/\b(hero|packshot|cta|exact product|packaging)\b/i.test(`${role} ${imagePrompt}`)) {
    return 'product_locked';
  }
  return 'product_composite';
}
