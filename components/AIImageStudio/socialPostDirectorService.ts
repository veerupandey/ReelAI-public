/**
 * Social Post Director Service — Phase 4 Implementation
 *
 * Builds structured ready-to-post drafts with platform-specific layouts,
 * typography, and copy that respects brand voice per architecture spec.
 */

import type {
  SocialPostDraft,
  BrandKnowledge,
  CreativeConcept,
  ComposerReference,
  ProductTruth,
  AspectRatio,
  SocialPlatform,
  SocialObjective,
  BrandFont,
  StudioAsset,
} from './types';
import { buildVisualLockedProductContext } from './creativeCopilotService';
import { directSocialPost } from './socialArtDirectorService';
import type { SocialArtDirectionPlan } from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface PlatformConfig {
  aspectRatios: AspectRatio[];
  defaultAspectRatio: AspectRatio;
  safeZones: SafeZone[];
  maxCaptionLength: number;
  maxHashtags: number;
  supportsTextOverlay: boolean;
  supportsCarousel: boolean;
}

interface SafeZone {
  name: string;
  x: number;      // percentage from left
  y: number;      // percentage from top
  width: number;  // percentage
  height: number; // percentage
  purpose: string;
}

const PLATFORM_CONFIGS: Record<SocialPlatform, PlatformConfig> = {
  instagram_feed: {
    aspectRatios: ['1:1', '4:5', '16:9'],
    defaultAspectRatio: '1:1',
    safeZones: [
      { name: 'profile_overlay', x: 0, y: 0, width: 100, height: 15, purpose: 'Username and profile pic area' },
      { name: 'caption_safe', x: 0, y: 85, width: 100, height: 15, purpose: 'Caption and engagement buttons' },
      { name: 'main_content', x: 5, y: 20, width: 90, height: 60, purpose: 'Primary visual safe area' },
    ],
    maxCaptionLength: 2200,
    maxHashtags: 30,
    supportsTextOverlay: true,
    supportsCarousel: true,
  },
  instagram_story: {
    aspectRatios: ['9:16'],
    defaultAspectRatio: '9:16',
    safeZones: [
      { name: 'top_ui', x: 0, y: 0, width: 100, height: 12, purpose: 'Story progress bars and UI' },
      { name: 'bottom_interaction', x: 0, y: 85, width: 100, height: 15, purpose: 'Message input and swipe prompts' },
      { name: 'main_safe', x: 10, y: 15, width: 80, height: 68, purpose: 'Main content area' },
    ],
    maxCaptionLength: 0, // No caption, text overlay only
    maxHashtags: 10,
    supportsTextOverlay: true,
    supportsCarousel: false,
  },
  pinterest: {
    aspectRatios: ['1:1', '2:3'],
    defaultAspectRatio: '2:3',
    safeZones: [
      { name: 'title_safe', x: 5, y: 5, width: 90, height: 20, purpose: 'Title text area' },
      { name: 'main_content', x: 5, y: 25, width: 90, height: 65, purpose: 'Product/visual content' },
      { name: 'brand_watermark', x: 85, y: 90, width: 10, height: 8, purpose: 'Subtle brand attribution' },
    ],
    maxCaptionLength: 500,
    maxHashtags: 20,
    supportsTextOverlay: true,
    supportsCarousel: true,
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialPostInput {
  platform: SocialPlatform;
  objective: SocialObjective;
  heroAssetId: string;
  supportingAssetIds: string[];
  brandKnowledge?: BrandKnowledge;
  productTruth?: import('./types').ProductTruth;
  selectedConcept?: CreativeConcept;
  trendResearch?: import('./types').TrendResearchResult;
  availableReferences: ComposerReference[];
  assets?: StudioAsset[];
  aspectRatio?: AspectRatio;
  userDirection?: string;
}

export interface SocialPostResult {
  draft: SocialPostDraft;
  warnings: string[];
  suggestions: string[];
}

export type SocialGenerationProgress =
  | { stage: 'analyzing'; message: string }
  | { stage: 'art_directing'; message: string }
  | { stage: 'planning_layout'; message: string }
  | { stage: 'generating_copy'; message: string }
  | { stage: 'validating_copy'; message: string }
  | { stage: 'selecting_typography'; message: string }
  | { stage: 'finalizing'; message: string }
  | { stage: 'complete'; message: string };

export type SocialProgressCallback = (progress: SocialGenerationProgress) => void;

// ---------------------------------------------------------------------------
// Layout Planning
// ---------------------------------------------------------------------------

interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  safeZoneOverrides?: Partial<SafeZone>[];
  textPlacement: {
    heading?: { x: number; y: number; maxWidth: number };
    body?: { x: number; y: number; maxWidth: number };
    cta?: { x: number; y: number; maxWidth: number };
  };
  logoPlacement?: { x: number; y: number; size: number };
}

const LAYOUT_TEMPLATES: Record<SocialPlatform, LayoutTemplate[]> = {
  instagram_feed: [
    {
      id: 'feed_centered',
      name: 'Centered Product',
      description: 'Product centered with text below',
      textPlacement: {
        heading: { x: 50, y: 75, maxWidth: 80 },
        body: { x: 50, y: 85, maxWidth: 80 },
      },
      logoPlacement: { x: 90, y: 90, size: 8 },
    },
    {
      id: 'feed_hero_text',
      name: 'Hero with Text',
      description: 'Top text overlay, product below',
      textPlacement: {
        heading: { x: 50, y: 15, maxWidth: 80 },
        body: { x: 50, y: 25, maxWidth: 70 },
      },
    },
    {
      id: 'feed_minimal',
      name: 'Minimal',
      description: 'Clean product with subtle branding',
      textPlacement: {},
      logoPlacement: { x: 92, y: 92, size: 5 },
    },
  ],
  instagram_story: [
    {
      id: 'story_center',
      name: 'Center Focus',
      description: 'Product centered with top/bottom text',
      textPlacement: {
        heading: { x: 50, y: 18, maxWidth: 80 },
        body: { x: 50, y: 82, maxWidth: 80 },
        cta: { x: 50, y: 92, maxWidth: 60 },
      },
    },
    {
      id: 'story_stacked',
      name: 'Stacked Content',
      description: 'Text at top, product below',
      textPlacement: {
        heading: { x: 50, y: 20, maxWidth: 80 },
        body: { x: 50, y: 35, maxWidth: 75 },
      },
    },
  ],
  pinterest: [
    {
      id: 'pin_tall',
      name: 'Tall Pin',
      description: 'Vertical layout with top title',
      textPlacement: {
        heading: { x: 50, y: 12, maxWidth: 85 },
      },
      logoPlacement: { x: 88, y: 95, size: 6 },
    },
    {
      id: 'pin_product',
      name: 'Product Focus',
      description: 'Product centered, minimal text',
      textPlacement: {
        heading: { x: 50, y: 8, maxWidth: 90 },
      },
    },
  ],
};

function selectLayoutTemplate(
  platform: SocialPlatform,
  objective: SocialObjective,
  concept?: CreativeConcept,
): LayoutTemplate {
  const templates = LAYOUT_TEMPLATES[platform];

  // Select based on objective and concept
  switch (objective) {
    case 'conversion':
      // Prefer layouts with prominent CTA placement
      return templates.find(t => t.textPlacement.cta) ?? templates[0];
    case 'awareness':
      // Clean layouts with strong visual impact
      return templates.find(t => t.id.includes('minimal') || t.id.includes('hero')) ?? templates[0];
    case 'education':
      // Layouts with room for explanatory text
      return templates.find(t => t.textPlacement.body) ?? templates[0];
    default:
      return templates[0];
  }
}

// ---------------------------------------------------------------------------
// Gemini Integration for Copy Generation
// ---------------------------------------------------------------------------

import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

import { STUDIO_FLASH_MODEL } from './studioModels';

const SOCIAL_MODEL = STUDIO_FLASH_MODEL;

function getGeminiApiKey(): string {
  // Vite exposes env vars via import.meta.env
  const viteKey = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY)
    : undefined;
  const windowKey = typeof window !== 'undefined'
    ? ((window as any).ENV?.VITE_GEMINI_API_KEY || (window as any).ENV?.VITE_API_KEY || (window as any).ENV?.GEMINI_API_KEY)
    : undefined;
  const key = viteKey || windowKey || '';
  if (!key) {
    console.warn('[socialPostDirectorService] No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local and restart dev server');
  }
  return key;
}

function parseGeminiResponse(response: GenerateContentResponse): any {
  try {
    const text = response.text || '{}';
    const clean = text.replace(/```json\s*|\s*```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Copy Generation
// ---------------------------------------------------------------------------

interface GeneratedCopy {
  headline: string;
  supportingText?: string;
  caption: string;
  callToAction?: string;
  hashtags: string[];
}

export function sanitizeSocialCopy(copy: GeneratedCopy, objective: SocialObjective): GeneratedCopy {
  const looksInternal = (text?: string) => !!text && /\b(leans into|brand identity|brand fit|tone by|visual direction|selected concept|rationale|objective alignment|concept explores|research indicates)\b/i.test(text);
  const supportingText = looksInternal(copy.supportingText) ? undefined : copy.supportingText?.trim() || undefined;
  const callToAction = objective === 'conversion' || objective === 'engagement'
    ? copy.callToAction?.trim() || undefined
    : undefined;

  return {
    headline: looksInternal(copy.headline) ? '' : copy.headline.trim(),
    supportingText,
    caption: copy.caption.trim(),
    callToAction,
    hashtags: copy.hashtags,
  };
}

export async function buildSocialPostLockedImageContext(input: SocialPostInput): Promise<string> {
  const lockedIds = new Set([input.heroAssetId, ...input.supportingAssetIds]);
  const productReferences = input.availableReferences.filter(
    reference => lockedIds.has(reference.assetId) && reference.role === 'product',
  );
  return buildVisualLockedProductContext(productReferences, input.assets ?? []);
}

export function buildSocialPostGrounding(input: SocialPostInput, lockedImageContext = ''): string {
  const brand = input.brandKnowledge;
  const concept = input.selectedConcept;
  const truth = input.productTruth;
  const relevantTrends = input.trendResearch?.insights.filter(
    insight => !concept?.sourceTrendInsightIds.length || concept.sourceTrendInsightIds.includes(insight.id),
  ) ?? [];
  const accepted = <T extends { status: string; value: unknown }>(items: T[] | undefined) =>
    items?.filter(item => item.status !== 'rejected').map(item => item.value) ?? [];

  return [
    `Platform: ${input.platform.replace('_', ' ')}`,
    `Objective: ${input.objective}`,
    brand && `Brand: ${brand.brandName.value}`,
    accepted(brand?.toneAttributes).length > 0 && `Brand tone: ${accepted(brand?.toneAttributes).join(', ')}`,
    accepted(brand?.approvedLanguage).length > 0 && `Approved language: ${accepted(brand?.approvedLanguage).join('; ')}`,
    accepted(brand?.prohibitedLanguage).length > 0 && `Never use or imply: ${accepted(brand?.prohibitedLanguage).join('; ')}`,
    accepted(brand?.visualPrinciples).length > 0 && `Visual principles: ${accepted(brand?.visualPrinciples).join('; ')}`,
    accepted(brand?.colors).length > 0 && `Brand palette: ${accepted(brand?.colors).join(', ')}`,
    accepted(brand?.fonts).length > 0 && `Brand typography: ${accepted(brand?.fonts).map(font => `${(font as BrandFont).family} (${(font as BrandFont).role})`).join(', ')}`,
    accepted(brand?.imageStyle.lighting).length > 0 && `Brand lighting: ${accepted(brand?.imageStyle.lighting).join(', ')}`,
    accepted(brand?.imageStyle.composition).length > 0 && `Brand composition: ${accepted(brand?.imageStyle.composition).join(', ')}`,
    accepted(brand?.imageStyle.backgrounds).length > 0 && `Brand backgrounds: ${accepted(brand?.imageStyle.backgrounds).join(', ')}`,
    accepted(brand?.imageStyle.textures).length > 0 && `Brand textures: ${accepted(brand?.imageStyle.textures).join(', ')}`,
    truth && `Product: ${truth.productName}`,
    truth?.verifiedFacts.length && `Verified product facts: ${truth.verifiedFacts.join('; ')}`,
    truth?.preservationRules.length && `Must preserve: ${truth.preservationRules.join('; ')}`,
    concept && `Concept: ${concept.title} — ${concept.oneLineIdea}`,
    concept?.visualDirection && `Visual direction: ${concept.visualDirection}`,
    concept?.hook && `Hook: ${concept.hook}`,
    relevantTrends.length > 0 && `Relevant trend evidence: ${relevantTrends.map(insight => `${insight.title} — ${insight.description}`).join('; ')}`,
    lockedImageContext && `Locked image analysis — use this to plan crop, layout, text placement, lighting, and background:\n${lockedImageContext}`,
  ].filter(Boolean).join('\n');
}

async function generateCopyWithAI(
  input: SocialPostInput,
  maxCaptionLength: number,
  lockedImageContext: string,
): Promise<{ copy: GeneratedCopy; warnings: string[] }> {
  const warnings: string[] = [];

  try {
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    const brandName = input.brandKnowledge?.brandName.value ?? 'Brand';
    const platform = input.platform.replace('_', ' ');
    const grounding = buildSocialPostGrounding(input, lockedImageContext);

    const prompt = `
You are a social media copywriter for ${brandName}. Write a complete ${platform} post.

GROUNDING — FOLLOW THIS, DO NOT INVENT UNSUPPORTED PRODUCT CLAIMS:
${grounding}

Requirements:
- Headline: Attention-grabbing, max 60 chars
- Supporting text: Optional 1-line elaboration
- Caption: Engaging, conversational, includes CTA naturally
- Call-to-action: Only provide button text for conversion or engagement objectives; omit it for education and awareness
- Hashtags: 5-10 specific and relevant; avoid generic engagement-bait hashtags
- For education, teach a concrete verified fact rather than writing generic brand promotion
- Match the approved brand voice and avoid prohibited language
- Never expose internal planning language such as brand fit, rationale, selected concept, visual direction, or tone analysis in customer-facing copy

Platform limits:
- Caption max ${maxCaptionLength} characters
- Platform: ${platform}

Return JSON:
{
  "headline": "Main headline text",
  "supportingText": "Optional elaboration",
  "caption": "Full caption with CTA woven in naturally",
  "callToAction": "Button text",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}
`;

    const response = await ai.models.generateContent({
      model: SOCIAL_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 1024,
      },
    } as any);

    const parsed = parseGeminiResponse(response);

    let caption = parsed?.caption || buildFallbackCaption(input, brandName);
    if (caption.length > maxCaptionLength) {
      caption = caption.slice(0, maxCaptionLength - 3) + '...';
      warnings.push(`Caption truncated to ${maxCaptionLength} characters`);
    }

    const hashtags = Array.isArray(parsed?.hashtags)
      ? parsed.hashtags.slice(0, PLATFORM_CONFIGS[input.platform].maxHashtags)
      : [brandName.toLowerCase().replace(/\s+/g, '')];

    return {
      copy: sanitizeSocialCopy({
        headline: parsed?.headline?.slice(0, 60) || `Discover ${brandName}`,
        supportingText: parsed?.supportingText?.slice(0, 100),
        caption,
        callToAction: parsed?.callToAction || (input.objective === 'conversion' ? 'Shop Now' : undefined),
        hashtags,
      }, input.objective),
      warnings,
    };
  } catch (error) {
    console.warn('[socialPostDirectorService] Gemini copy generation failed:', error);
    warnings.push('AI copy generation unavailable. Using fallback copy.');
    return generateCopyFallback(input, maxCaptionLength);
  }
}

/** Build a contextual fallback caption when Gemini returns empty/invalid response */
function buildFallbackCaption(input: SocialPostInput, brandName: string): string {
  const concept = input.selectedConcept;
  const truth = input.productTruth;

  switch (input.objective) {
    case 'awareness':
      if (concept?.oneLineIdea) return `${concept.oneLineIdea}. ${brandName} — tap to explore.`;
      return `Introducing ${brandName}. Tap to learn more.`;
    case 'engagement':
      if (concept?.hook) return `${concept.hook} Tell us in the comments 👇`;
      return `What's your favorite ${brandName} moment? Let us know in the comments! 👇`;
    case 'conversion':
      if (truth?.verifiedFacts[0]) return `${truth.verifiedFacts[0]}. Link in bio to shop ${brandName}.`;
      return `Experience ${brandName}. Link in bio to shop now.`;
    case 'education':
      if (truth?.verifiedFacts[0]) return `${truth.verifiedFacts[0]}. Save this guide from ${brandName}.`;
      if (concept?.oneLineIdea) return `${concept.oneLineIdea}. Save this for later.`;
      return `Learn what makes ${brandName} different. Save this guide for later.`;
    default:
      if (concept?.oneLineIdea) return `${concept.oneLineIdea}. ${brandName}`;
      return `Discover ${brandName}`;
  }
}

// Fallback copy generation
function generateCopyFallback(
  input: SocialPostInput,
  maxCaptionLength: number,
): { copy: GeneratedCopy; warnings: string[] } {
  const warnings: string[] = [];
  const brandName = input.brandKnowledge?.brandName.value ?? 'Brand';
  const brandTone = input.brandKnowledge?.toneAttributes
    .filter(t => t.status !== 'rejected')
    .map(t => t.value) ?? [];

  let headline: string;
  if (input.selectedConcept?.hook) {
    headline = input.selectedConcept.hook.slice(0, 60);
  } else if (input.selectedConcept?.oneLineIdea) {
    headline = input.selectedConcept.oneLineIdea.slice(0, 60);
  } else {
    headline = `Discover ${brandName}`;
  }

  let caption = buildFallbackCaption(input, brandName);

  if (caption.length > maxCaptionLength) {
    caption = caption.slice(0, maxCaptionLength - 3) + '...';
    warnings.push(`Caption truncated to ${maxCaptionLength} characters`);
  }

  let callToAction: string | undefined;
  if (input.objective === 'conversion') {
    callToAction = 'Shop Now';
  } else if (input.objective === 'engagement') {
    callToAction = 'Comment Below';
  }

  const hashtags: string[] = [];
  if (brandName) {
    hashtags.push(brandName.toLowerCase().replace(/\s+/g, ''));
  }
  for (const tone of brandTone.slice(0, 2)) {
    const toneHash = tone.toLowerCase().replace(/\s+/g, '');
    if (!hashtags.includes(toneHash)) {
      hashtags.push(toneHash);
    }
  }
  if (input.selectedConcept) {
    const conceptWords = input.selectedConcept.title
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(' ')
      .filter(w => w.length > 3)
      .slice(0, 3);
    hashtags.push(...conceptWords);
  }
  if (input.productTruth?.productName) {
    hashtags.push(...input.productTruth.productName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 3));
  }

  const maxHashtags = PLATFORM_CONFIGS[input.platform].maxHashtags;
  const limitedHashtags = hashtags.slice(0, maxHashtags);

  return {
    copy: sanitizeSocialCopy({
      headline,
      caption,
      callToAction,
      hashtags: limitedHashtags,
    }, input.objective),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Typography Selection
// ---------------------------------------------------------------------------

interface TypographySelection {
  headingFont?: BrandFont;
  bodyFont?: BrandFont;
  fallbackFonts: string[];
}

function selectTypography(brandKnowledge?: BrandKnowledge): TypographySelection {
  if (!brandKnowledge?.fonts.length) {
    return {
      fallbackFonts: ['system-ui', '-apple-system', 'sans-serif'],
    };
  }

  // Filter to verified and user-confirmed fonts
  const validFonts = brandKnowledge.fonts.filter(
    f => f.status === 'verified' || f.status === 'user_confirmed'
  );

  // If no verified fonts, use inferred with warning
  const fontsToUse = validFonts.length > 0 ? validFonts : brandKnowledge.fonts.filter(f => f.status !== 'rejected');

  // Select heading font
  const headingFont = fontsToUse.find(f =>
    f.value.role === 'display' || f.value.role === 'heading'
  ) ?? fontsToUse.find(f => f.value.weights.includes(700));

  // Select body font
  const bodyFont = fontsToUse.find(f => f.value.role === 'body') ?? fontsToUse[0];

  return {
    headingFont: headingFont?.value,
    bodyFont: bodyFont?.value,
    fallbackFonts: ['system-ui', '-apple-system', 'sans-serif'],
  };
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

export async function createSocialPostDraft(
  input: SocialPostInput,
  onProgress?: SocialProgressCallback,
): Promise<SocialPostResult> {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  const platformConfig = PLATFORM_CONFIGS[input.platform];

  // Stage 1: Analyze
  onProgress?.({ stage: 'analyzing', message: 'Analyzing brand and concept...' });

  if (!input.brandKnowledge) {
    warnings.push('No brand knowledge available - using generic copy');
  }

  if (!input.selectedConcept) {
    suggestions.push('Select a creative concept for more tailored copy');
  }

  const lockedImageContext = await buildSocialPostLockedImageContext(input);
  if (!lockedImageContext) {
    warnings.push('Locked images could not be visually analyzed - layout will use generic safe zones');
  }

  // Stage 2: Art Direction — evaluate locked image, brand, concept, user direction
  onProgress?.({ stage: 'art_directing', message: 'Art directing visual treatment...' });

  const artDirectionPlan: SocialArtDirectionPlan = await directSocialPost(input);
  warnings.push(...artDirectionPlan.warnings);

  // Stage 3: Plan layout — use art direction plan's composition guidance
  onProgress?.({ stage: 'planning_layout', message: 'Selecting optimal layout...' });

  const layoutTemplate = selectLayoutTemplate(
    input.platform,
    input.objective,
    input.selectedConcept,
  );

  // Stage 4: Generate copy — respect art direction text decision
  onProgress?.({ stage: 'generating_copy', message: 'Writing platform-optimized copy...' });

  let copy: GeneratedCopy;
  let copyWarnings: string[];

  if (artDirectionPlan.textDecision === 'none') {
    // Art direction says no text on image — only generate caption and hashtags
    const fallbackResult = await generateCopyWithAI(input, platformConfig.maxCaptionLength, lockedImageContext);
    copy = {
      headline: '',
      supportingText: undefined,
      caption: fallbackResult.copy.caption,
      callToAction: undefined,
      hashtags: fallbackResult.copy.hashtags,
    };
    copyWarnings = fallbackResult.warnings;
  } else {
    const result = await generateCopyWithAI(input, platformConfig.maxCaptionLength, lockedImageContext);
    copy = result.copy;
    copyWarnings = result.warnings;

    // Sync on-image copy with the art director's validated text so the UI preview
    // and the actual generated image stay consistent.
    const headlineEntry = artDirectionPlan.visibleText.find(v => v.role === 'headline');
    const supportingEntry = artDirectionPlan.visibleText.find(v => v.role === 'supporting');
    if (headlineEntry?.content) {
      copy = {
        ...copy,
        headline: headlineEntry.content,
        supportingText: supportingEntry?.content ?? (artDirectionPlan.textDecision === 'headline' ? undefined : copy.supportingText),
      };
    }
  }
  warnings.push(...copyWarnings);

  // Stage 5: Validate copy against art direction plan
  onProgress?.({ stage: 'validating_copy', message: 'Validating copy against art direction...' });

  // Stage 6: Select typography
  onProgress?.({ stage: 'selecting_typography', message: 'Choosing brand fonts...' });

  const typography = selectTypography(input.brandKnowledge);
  if (!typography.headingFont && input.brandKnowledge?.fonts.length) {
    warnings.push('No verified fonts available - using system defaults');
  }

  // Stage 7: Build generation brief
  onProgress?.({ stage: 'finalizing', message: 'Building generation brief...' });

  const generationBrief = buildGenerationBrief(input, layoutTemplate, copy, lockedImageContext, artDirectionPlan);

  // Stage 8: Finalize
  onProgress?.({ stage: 'complete', message: 'Social post draft ready!' });

  // Build safe zones from platform config
  const safeZones = platformConfig.safeZones.map(z => z.name);

  // Build final draft
  const draft: SocialPostDraft = {
    id: crypto.randomUUID(),
    platform: input.platform,
    objective: input.objective,
    selectedConceptId: input.selectedConcept?.id,
    heroAssetId: input.heroAssetId,
    supportingAssetIds: input.supportingAssetIds,
    aspectRatio: input.aspectRatio ?? platformConfig.defaultAspectRatio,
    layout: {
      templateId: layoutTemplate.id,
      safeZones,
      logoPlacement: layoutTemplate.logoPlacement ?
        `${layoutTemplate.logoPlacement.x},${layoutTemplate.logoPlacement.y}` :
        undefined,
    },
    typography: {
      headingFont: typography.headingFont,
      bodyFont: typography.bodyFont,
    },
    copy: {
      headline: copy.headline,
      supportingText: copy.supportingText,
      caption: copy.caption,
      callToAction: copy.callToAction,
      hashtags: copy.hashtags,
    },
    generationBrief,
    artDirectionPlan,
  };

  return {
    draft,
    warnings,
    suggestions,
  };
}

function buildGenerationBrief(
  input: SocialPostInput,
  layout: LayoutTemplate,
  copy: GeneratedCopy,
  lockedImageContext: string,
  artDirectionPlan?: SocialArtDirectionPlan,
): string {
  const parts: string[] = [];

  parts.push('SOCIAL POST GENERATION BRIEF');
  parts.push(`Platform: ${input.platform.replace('_', ' ')} | Objective: ${input.objective}`);
  parts.push('');

  // Lead with the art director's creative vision — this is the unique creative core
  if (artDirectionPlan) {
    parts.push('CREATIVE DIRECTION (follow this precisely — it is the unique vision for THIS post):');
    parts.push(`Visual Strategy: ${artDirectionPlan.visualStrategy}`);
    parts.push(`Composition: ${artDirectionPlan.composition}`);
    parts.push(`Locked Image Treatment: ${artDirectionPlan.lockedImageTreatment}`);
    if (artDirectionPlan.rationale) {
      parts.push(`Rationale: ${artDirectionPlan.rationale}`);
    }
    parts.push('');
  }

  parts.push('GROUNDING:');
  parts.push(buildSocialPostGrounding(input, lockedImageContext));
  parts.push('');

  // Text decision — use the art direction plan's validated text (consistent with
  // what the generation request enforces as allowedOnImageText)
  if (artDirectionPlan && artDirectionPlan.textDecision === 'none') {
    parts.push('TEXT CONTROL:');
    parts.push('DO NOT render any text on the image. No headlines, supporting text, or CTAs on the visual.');
    parts.push('All messaging is handled via caption and hashtags only.');
    parts.push('');
  } else if (artDirectionPlan && artDirectionPlan.visibleText.length > 0) {
    // Use the plan's validated text strings (these are what the image will actually render)
    parts.push('TEXT TO RENDER ON IMAGE (use these EXACT strings, nothing else):');
    for (const entry of artDirectionPlan.visibleText) {
      parts.push(`- ${entry.role}: "${entry.content}" (placement: ${entry.placement})`);
    }
    parts.push('');
  } else {
    parts.push('COPY TO INCLUDE:');
    parts.push(`Headline: "${copy.headline}"`);
    if (copy.supportingText) {
      parts.push(`Supporting: "${copy.supportingText}"`);
    }
    if (copy.callToAction) {
      parts.push(`CTA: "${copy.callToAction}"`);
    }
    parts.push('');
  }

  if (input.brandKnowledge) {
    const tone = input.brandKnowledge.toneAttributes
      .filter(t => t.status !== 'rejected')
      .map(t => t.value)
      .join(', ');
    if (tone) {
      parts.push(`BRAND VOICE: ${tone}`);
      parts.push('');
    }
  }

  parts.push('TECHNICAL CONSTRAINTS:');
  parts.push('- Any text must be legible at mobile size with high contrast');
  parts.push('- Comply with platform safe zones');
  parts.push('- Preserve the source product appearance, lighting logic, and background unless the creative direction explicitly requires a compatible extension');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface DraftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSocialPostDraft(draft: SocialPostDraft): DraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const config = PLATFORM_CONFIGS[draft.platform];

  // Check required fields
  if (!draft.heroAssetId) {
    errors.push('Hero asset is required');
  }

  if (!draft.copy.headline && !(draft.artDirectionPlan?.textDecision === 'none')) {
    errors.push('Headline is required');
  }

  if (!draft.copy.caption) {
    errors.push('Caption is required');
  }

  // Check length constraints
  if (draft.copy.caption.length > config.maxCaptionLength) {
    errors.push(`Caption exceeds ${config.maxCaptionLength} characters`);
  }

  if (draft.copy.hashtags.length > config.maxHashtags) {
    warnings.push(`Hashtag count (${draft.copy.hashtags.length}) exceeds recommended ${config.maxHashtags}`);
  }

  // Check aspect ratio compatibility
  if (!config.aspectRatios.includes(draft.aspectRatio)) {
    warnings.push(`Aspect ratio ${draft.aspectRatio} not ideal for ${draft.platform}`);
  }

  // Check for text overlay on platforms that don't support it well
  if (!config.supportsTextOverlay && (draft.copy.headline || draft.copy.supportingText)) {
    warnings.push('Text overlay may not display correctly on this platform');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get platform configuration.
 */
export function getPlatformConfig(platform: SocialPlatform): PlatformConfig {
  return PLATFORM_CONFIGS[platform];
}

/**
 * Get available aspect ratios for a platform.
 */
export function getPlatformAspectRatios(platform: SocialPlatform): AspectRatio[] {
  return PLATFORM_CONFIGS[platform].aspectRatios;
}

/**
 * Check if a draft needs review before posting.
 */
export function needsReview(draft: SocialPostDraft): boolean {
  // Check for common issues
  if (!draft.copy.caption.trim()) return true;
  if (draft.copy.hashtags.length === 0) return true;
  if (!draft.selectedConceptId) return true;

  return false;
}

/**
 * Get preview dimensions for a platform/aspect ratio.
 */
export function getPreviewDimensions(
  platform: SocialPlatform,
  aspectRatio: AspectRatio,
): { width: number; height: number } {
  const baseWidth = 400;

  const [w, h] = aspectRatio.split(':').map(Number);
  const height = (baseWidth * h) / w;

  return { width: baseWidth, height: Math.round(height) };
}
