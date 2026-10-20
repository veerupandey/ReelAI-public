/**
 * Prompt Writer Service — context-aware, research-powered prompt generation.
 *
 * Takes a rough user instruction + studio context (brand knowledge, product truth,
 * trend research, locked reference images) and produces detailed, production-ready
 * image generation prompts for each slide of a carousel or single image.
 *
 * Uses Gemini with Google Search grounding to research the brand website, reference
 * posts, and category trends when web search is enabled.
 */

import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type {
  AspectRatio,
  BrandKnowledge,
  ComposerReference,
  EvidenceSource,
  ProductTruth,
  StudioAsset,
  TrendResearchResult,
} from './types';
import { STUDIO_FLASH_MODEL, STUDIO_RESEARCH_MODEL } from './studioModels';
import { getAspectRatioCompositionGuidance } from './aspectRatioCatalog';

const WRITER_MODEL = STUDIO_FLASH_MODEL;
const WRITER_RESEARCH_MODEL = STUDIO_RESEARCH_MODEL;

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
  const key = viteKey || windowKey || '';
  if (!key) {
    console.warn(
      '[promptWriterService] No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local and restart dev server',
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PromptWriterInput {
  /** The user's rough instruction, e.g. "recreate this carousel for Kageha, change it a bit" */
  userInstruction: string;
  /** Brand knowledge extracted from website research */
  brandKnowledge?: BrandKnowledge;
  /** Locked product truth — preservation rules, verified facts */
  productTruth?: ProductTruth;
  /** Trend research results */
  trendResearch?: TrendResearchResult;
  /** Composer references (locked images with roles) */
  composerReferences: ComposerReference[];
  /** All studio assets (to resolve reference assetIds to image data) */
  assets: StudioAsset[];
  /** Target aspect ratio for the generated images */
  aspectRatio: AspectRatio;
  /** Number of slides: 1 = single image, 2+ = carousel */
  slideCount: number;
  /** Enable web search for brand/category research */
  useWebSearch: boolean;
  /** Brand website URL for research (from brand knowledge sourceUrls or user input) */
  brandUrl?: string;
  /** URL of a reference post to research (e.g. Instagram carousel link) */
  referenceUrl?: string;
  /** Screenshots of a reference post (carousel slides) uploaded directly in the Writer */
  referenceScreenshots?: Array<{ base64: string; mimeType: string }>;
  /** Refinement instruction — when set, refines previous slides instead of generating from scratch */
  refineInstruction?: string;
  /** Previous slides to refine (used with refineInstruction) */
  previousSlides?: PromptWriterSlide[];
}

export interface PromptWriterSlide {
  slideNumber: number;
  title: string;
  prompt: string;
  negativePrompt?: string;
  copy: {
    headline?: string;
    supportingText?: string;
    caption?: string;
  };
  designNotes: string;
  canvaText?: {
    heading?: string;
    subtext?: string;
    bodyText?: string;
    footer?: string;
  };
}

export interface PromptWriterResult {
  slides: PromptWriterSlide[];
  creativeDirection: string;
  brandExecutionSummary?: string;
  referenceAnalysis?: string;
  researchSummary?: string;
  sources: EvidenceSource[];
}

export type PromptWriterProgress = {
  stage: 'researching' | 'analyzing' | 'writing' | 'complete';
  message: string;
  progressPercent: number;
};

export type PromptWriterProgressCallback = (progress: PromptWriterProgress) => void;

/**
 * Keep slide count aligned with reference screenshots unless the user manually
 * overrode the slide control.
 */
export function nextSlideCountAfterScreenshotChange(input: {
  nextScreenshotCount: number;
  prevScreenshotCount: number;
  currentSlideCount: number;
  userLocked: boolean;
}): number {
  const {
    nextScreenshotCount,
    prevScreenshotCount,
    currentSlideCount,
    userLocked,
  } = input;
  if (userLocked) return currentSlideCount;
  if (nextScreenshotCount <= 0) return currentSlideCount;

  const previouslySynced =
    prevScreenshotCount === 0
      ? currentSlideCount === 1
      : currentSlideCount === prevScreenshotCount;

  if (!previouslySynced) return currentSlideCount;
  return Math.min(10, Math.max(1, nextScreenshotCount));
}

/** Full prior slides for refinement — do not truncate prompts. */
export function buildPreviousSlidesRefineBlock(
  previousSlides: PromptWriterSlide[],
  refineInstruction: string,
): string {
  const slidesText = previousSlides
    .map((slide) => {
      const parts = [
        `Slide ${slide.slideNumber}: ${slide.title}`,
        `Prompt:\n${slide.prompt}`,
      ];
      if (slide.negativePrompt) {
        parts.push(`Negative prompt:\n${slide.negativePrompt}`);
      }
      const copyBits = [
        slide.copy?.headline,
        slide.copy?.supportingText,
        slide.copy?.caption,
      ].filter(Boolean);
      if (copyBits.length > 0) {
        parts.push(`Copy:\n${copyBits.join('\n')}`);
      }
      if (slide.designNotes) {
        parts.push(`Design notes:\n${slide.designNotes}`);
      }
      return parts.join('\n');
    })
    .join('\n\n---\n\n');

  return `\n## PREVIOUS SLIDES (to refine)\nPreserve everything that still fits. Apply only the refinement instruction.\n\n${slidesText}\n\n## REFINEMENT INSTRUCTION\n${refineInstruction}\n`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonResponse(response: GenerateContentResponse): any {
  const text = response.text || '';
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown fences
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
    // Try finding JSON object boundaries
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.substring(start, end + 1));
      } catch {}
    }
  }
  return null;
}

function extractSources(response: GenerateContentResponse): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  const grounding = (response as any).candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (grounding?.length) {
    grounding.forEach((chunk: any, idx: number) => {
      if (chunk.web?.uri) {
        sources.push({
          id: `pw-source-${idx}`,
          url: chunk.web.uri,
          label: chunk.web.title || chunk.web.uri,
          capturedAt: new Date().toISOString(),
        });
      }
    });
  }
  return sources;
}

function buildBrandContext(input: PromptWriterInput): string {
  const { brandKnowledge } = input;
  if (!brandKnowledge) return 'No brand knowledge available. Research the brand from the user instruction.';

  const parts: string[] = [];
  if (brandKnowledge.brandName.status !== 'rejected') {
    parts.push(`Brand name: ${brandKnowledge.brandName.value}`);
  }
  const tone = brandKnowledge.toneAttributes.filter((t) => t.status !== 'rejected');
  if (tone.length > 0) parts.push(`Tone: ${tone.map((t) => t.value).join(', ')}`);

  const visual = brandKnowledge.visualPrinciples.filter((p) => p.status !== 'rejected');
  if (visual.length > 0) parts.push(`Visual principles: ${visual.map((p) => p.value).join(', ')}`);

  const colors = brandKnowledge.colors.filter((c) => c.status !== 'rejected');
  if (colors.length > 0) parts.push(`Color palette: ${colors.map((c) => c.value).join(', ')}`);

  const fonts = brandKnowledge.fonts.filter((f) => f.status !== 'rejected');
  if (fonts.length > 0) {
    parts.push(`Typography: ${fonts.map((f) => `${f.value.family} (${f.value.role})`).join(', ')}`);
  }

  const approved = brandKnowledge.approvedLanguage.filter((l) => l.status !== 'rejected');
  if (approved.length > 0) parts.push(`Approved language: ${approved.map((l) => l.value).join('; ')}`);

  const prohibited = brandKnowledge.prohibitedLanguage.filter((l) => l.status !== 'rejected');
  if (prohibited.length > 0) parts.push(`Avoid language: ${prohibited.map((l) => l.value).join('; ')}`);

  const logoRules = brandKnowledge.logoRules.filter((r) => r.status !== 'rejected');
  if (logoRules.length > 0) parts.push(`Logo rules: ${logoRules.map((r) => r.value).join('; ')}`);

  const { imageStyle } = brandKnowledge;
  const lighting = imageStyle.lighting.filter((v) => v.status !== 'rejected');
  if (lighting.length > 0) parts.push(`Lighting: ${lighting.map((v) => v.value).join(', ')}`);
  const composition = imageStyle.composition.filter((v) => v.status !== 'rejected');
  if (composition.length > 0) parts.push(`Composition: ${composition.map((v) => v.value).join(', ')}`);
  const backgrounds = imageStyle.backgrounds.filter((v) => v.status !== 'rejected');
  if (backgrounds.length > 0) parts.push(`Backgrounds: ${backgrounds.map((v) => v.value).join(', ')}`);
  const textures = imageStyle.textures.filter((v) => v.status !== 'rejected');
  if (textures.length > 0) parts.push(`Textures: ${textures.map((v) => v.value).join(', ')}`);

  if (brandKnowledge.sourceUrls.length > 0) {
    parts.push(`Brand website(s): ${brandKnowledge.sourceUrls.join(', ')}`);
  }

  return parts.join('\n');
}

export function buildBrandExecutionContract(input: PromptWriterInput): string {
  const { brandKnowledge } = input;
  const accepted = <T,>(values: Array<{ value: T; status: string }> | undefined): T[] =>
    (values || []).filter((value) => value.status !== 'rejected').map((value) => value.value);

  if (!brandKnowledge) {
    return [
      'No verified brand system is available.',
      'Create a professional, coherent mini design system before writing slides: choose one restrained palette, one typography pairing, one grid, consistent spacing, and a polished commercial finish.',
      'Do not rely on generic "minimal aesthetic" language. Translate the chosen system into exact colors, type hierarchy, layout zones, and image treatment in every slide prompt.',
    ].join('\n');
  }

  const brandName = brandKnowledge.brandName.status !== 'rejected' ? brandKnowledge.brandName.value : 'the brand';
  const colors = accepted(brandKnowledge.colors);
  const fonts = accepted(brandKnowledge.fonts);
  const visualPrinciples = accepted(brandKnowledge.visualPrinciples);
  const tone = accepted(brandKnowledge.toneAttributes);
  const lighting = accepted(brandKnowledge.imageStyle.lighting);
  const composition = accepted(brandKnowledge.imageStyle.composition);
  const backgrounds = accepted(brandKnowledge.imageStyle.backgrounds);
  const textures = accepted(brandKnowledge.imageStyle.textures);
  const logoRules = accepted(brandKnowledge.logoRules);
  const imageTreatment = [
    lighting.length > 0 && `lighting: ${lighting.join(', ')}`,
    composition.length > 0 && `composition: ${composition.join(', ')}`,
    backgrounds.length > 0 && `backgrounds: ${backgrounds.join(', ')}`,
    textures.length > 0 && `textures/materials: ${textures.join(', ')}`,
  ].filter(Boolean).join('; ');

  const headingFont =
    fonts.find((font) => font.role === 'display') ||
    fonts.find((font) => font.role === 'heading') ||
    fonts[0];
  const bodyFont =
    fonts.find((font) => font.role === 'body') ||
    fonts.find((font) => font.role === 'accent') ||
    headingFont;

  const parts = [
    `Brand execution contract for ${brandName}:`,
    colors.length > 0
      ? `- Palette: use only these brand colors as the dominant system: ${colors.join(', ')}. Assign them to background, headline, body text, highlights, dividers, and subtle accents. Do not introduce unrelated neon, random gradient, or competitor colors.`
      : '- Palette: infer a restrained premium palette from the references and keep it consistent across every slide.',
    headingFont
      ? `- Typography hierarchy: use ${headingFont.family} or a visually similar ${headingFont.role} typeface for headlines; use ${bodyFont?.family || headingFont.family} or a visually similar body typeface for supporting copy. Specify font style, weight, case, size relationship, line spacing, and alignment in each prompt.`
      : '- Typography hierarchy: specify a professional font pairing in every prompt: strong display or heading style for headlines, clean readable sans-serif for body copy, consistent weights and line spacing.',
    visualPrinciples.length > 0
      ? `- Visual principles: ${visualPrinciples.join('; ')}. Convert these into concrete layout and image choices, not vague adjectives.`
      : '- Visual principles: use disciplined commercial art direction with clear hierarchy, intentional negative space, and balanced composition.',
    tone.length > 0
      ? `- Brand tone: ${tone.join(', ')}. Copy should sound like this brand and avoid generic creator-template phrasing.`
      : '- Brand tone: keep copy concise, credible, and professional.',
    imageTreatment
      ? `- Image treatment: ${imageTreatment}.`
      : '- Image treatment: define lighting, surface, background, texture, and camera language precisely so the post looks professionally art directed.',
    logoRules.length > 0
      ? `- Logo and brand marks: ${logoRules.join('; ')}. Respect these rules; do not invent marks.`
      : '- Logo and brand marks: do not invent logos or brand marks unless an attached reference clearly supplies them.',
    '- Professional finish: every slide must feel like one campaign system, with a consistent grid, safe margins, text blocks, accent shapes, and image style. Avoid stock-template clutter, mismatched fonts, excessive decorative effects, illegible text, and amateur spacing.',
  ];

  return parts.join('\n');
}

function buildProductTruthContext(input: PromptWriterInput): string {
  const { productTruth } = input;
  if (!productTruth) return 'No product truth locked.';
  const parts: string[] = [`Product: ${productTruth.productName}`];
  if (productTruth.preservationRules.length > 0) {
    parts.push(`Preservation rules: ${productTruth.preservationRules.join(', ')}`);
  }
  if (productTruth.verifiedFacts.length > 0) {
    parts.push(`Verified facts: ${productTruth.verifiedFacts.join('; ')}`);
  }
  if (productTruth.userCorrections.length > 0) {
    parts.push(`User corrections: ${productTruth.userCorrections.join('; ')}`);
  }
  return parts.join('\n');
}

function buildTrendContext(input: PromptWriterInput): string {
  const { trendResearch } = input;
  if (!trendResearch) return 'No trend research available.';
  const parts: string[] = [`Research query: ${trendResearch.query}`];
  for (const insight of trendResearch.insights) {
    parts.push(`- ${insight.title}: ${insight.description} (fit: ${insight.applicability})`);
  }
  return parts.join('\n');
}

function buildReferenceContext(input: PromptWriterInput): { text: string; images: Array<{ base64: string; mimeType: string; label: string }> } {
  const images: Array<{ base64: string; mimeType: string; label: string }> = [];
  const textParts: string[] = [];

  for (const ref of input.composerReferences) {
    const asset = input.assets.find((a) => a.id === ref.assetId);
    if (!asset) continue;
    const label = `Reference ${ref.role}: ${asset.name || 'unnamed'}`;
    textParts.push(`${label}${ref.instructions ? ` — instructions: ${ref.instructions}` : ''}`);
    images.push({
      base64: asset.base64,
      mimeType: asset.mimeType,
      label,
    });
  }

  return {
    text: textParts.length > 0 ? textParts.join('\n') : 'No reference images attached.',
    images,
  };
}

function getAspectRatioGuidance(ratio: string): string {
  return getAspectRatioCompositionGuidance(ratio);
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export async function writePrompts(
  input: PromptWriterInput,
  onProgress?: PromptWriterProgressCallback,
): Promise<PromptWriterResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key configured. Set VITE_GEMINI_API_KEY in .env.local');
  }

  const ai = new GoogleGenAI({ apiKey });
  const { useWebSearch, slideCount, aspectRatio, userInstruction, referenceUrl, referenceScreenshots, refineInstruction, previousSlides } = input;

  const isRefine = !!refineInstruction && !!previousSlides && previousSlides.length > 0;

  // Build context blocks
  const brandContext = buildBrandContext(input);
  const brandExecutionContract = buildBrandExecutionContract(input);
  const productTruthContext = buildProductTruthContext(input);
  const trendContext = buildTrendContext(input);
  const refContext = buildReferenceContext(input);

  const isCarousel = slideCount > 1;
  const formatDesc = isCarousel
    ? `a ${slideCount}-slide Instagram carousel`
    : 'a single Instagram post image';

  // Detect explicit "no text" intent so we suppress text only when the user
  // actually asks for it — otherwise text rendering is ALWAYS the default.
  const userWantsNoText = /\b(?:no\s+text|without\s+text|no\s+words?|without\s+words?|text[-\s]?free|no\s+copy|no\s+headlines?|image\s+only|visual\s+only)\b/i.test(
    userInstruction,
  );
  const textModeDirective = userWantsNoText
    ? `## TEXT MODE: OFF\nThe user explicitly requested NO text on the images. Do NOT include any text rendering instructions in the prompts. The canvaText, copy.headline, copy.supportingText fields should be null. Design each slide as a pure visual — no words, no headlines, no captions on the image.`
    : `## TEXT MODE: ON (DEFAULT)\nText is ALWAYS included by default. Every slide MUST have at least a headline and a footer (slide number / brand name). Most slides should also have supporting text and body copy. Use the brand context, product truth, trend research, and reference screenshots to write compelling on-brand text for each slide. Even if a reference screenshot has no text, you MUST still add text — derive it from the brand voice, product positioning, and research context. The ONLY time you omit text is when the user explicitly says "no text" or "image only" (which they have NOT done here).`;

  const hasRefScreenshots = !!(referenceScreenshots && referenceScreenshots.length > 0);

  onProgress?.({ stage: 'researching', message: 'Researching brand and references...', progressPercent: 20 });

  // Build refinement context if refining — keep full prior prompts (no 400-char truncation)
  const refineBlock = isRefine
    ? buildPreviousSlidesRefineBlock(previousSlides!, refineInstruction!)
    : '';

  // Build reference URL context
  const referenceUrlBlock = referenceUrl
    ? `\n## REFERENCE POST URL\nThe user provided this reference post URL: ${referenceUrl}\n${useWebSearch ? 'Use web search to research the brand/account behind this URL to understand their visual style and content patterns. Note: Instagram blocks direct scraping, so rely on the uploaded screenshots for actual post content analysis.' : 'Analyze the user instruction in the context of this reference.'}\n`
    : '';

  // Build reference screenshots context
  const refScreenshotsBlock = hasRefScreenshots
    ? `\n## REFERENCE POST SCREENSHOTS — CRITICAL ANALYSIS REQUIRED\nThe user uploaded ${referenceScreenshots!.length} screenshot(s) of a reference post (e.g. an Instagram carousel). These are the ACTUAL slides of the reference post. You MUST analyze each screenshot in detail:\n\n### For EACH screenshot, extract and report:\n1. **Exact text on the slide**: Read every word visible on the image — headlines, subheadings, body text, captions, CTAs, page numbers, footers. If there is NO text on the slide, report "no text on this slide".\n2. **Text placement**: Where is each text element positioned? (top center, top left, bottom, overlay on image, split layout, etc.)\n3. **Text styling**: Font weight (bold/light), size relative to slide, color, contrast (white on dark, dark on light, colored accent)\n4. **Visual structure**: Layout type (full-bleed image with text overlay, split image/text, solid color background with centered text, grid, comparison side-by-side)\n5. **Image content**: What is the main visual? Product shot, illustration, lifestyle photo, diagram?\n6. **Color scheme**: Background color, accent colors, text colors\n7. **Slide purpose**: Is this a hook slide, educational/value slide, comparison, tip, CTA, cover?\n\n### Then for your generated slides:\n- REWRITE all text in the target brand's voice — never copy verbatim, but maintain the same meaning and structure.${userWantsNoText ? ' If a screenshot has no text, keep your generated slide text-free as well.' : ' Even if a screenshot has NO text, you MUST still add text to your generated slide — derive appropriate on-brand copy from the brand context, product truth, and research. Do NOT produce text-free slides unless the user explicitly asked for no text.'}\n- The "prompt" field for each slide MUST include the EXACT text to render on the image and WHERE to place it (e.g. "Render the headline '5 Matcha Mistakes You're Making' in bold white text at the top center of the slide, 48px equivalent, on a dark gradient overlay").${userWantsNoText ? ' — ONLY if the reference screenshot for that slide has text.' : ''}\n- The "copy" field should contain the same text in a structured format\n- Match the slide flow: if screenshot 1 is a hook, your slide 1 should be a hook; if screenshot 2 is a comparison, your slide 2 should be a comparison\n- Adapt colors and visual style to the target brand's aesthetic\n`
    : '';

  const systemPrompt = `You are an expert creative director and prompt engineer for AI image generation.

Your job: ${isRefine ? `Refine and improve previously generated prompts based on the user's refinement instruction.` : `Take a user's rough creative instruction and produce detailed, production-ready image generation prompts for ${formatDesc}.`}

The output prompts must be rich enough that an AI image generator can produce premium, brand-aligned, scroll-stopping visuals without any additional context.

## USER INSTRUCTION
${userInstruction}${refineBlock}${referenceUrlBlock}${refScreenshotsBlock}

${textModeDirective}

## BRAND CONTEXT
${brandContext}

## BRAND EXECUTION CONTRACT — MUST APPLY TO EVERY SLIDE
${brandExecutionContract}

## PRODUCT TRUTH (must not be contradicted)
${productTruthContext}

## TREND RESEARCH (advisory — use only when compatible)
${trendContext}

## ATTACHED REFERENCE IMAGES
${refContext.text}
${refContext.images.length > 0 ? `${refContext.images.length} reference image(s) are attached for visual analysis. Analyze their composition, style, colors, and layout to inform your prompts. Provide a clear analysis of what you see in the references and how you will adapt it.` : ''}
${hasRefScreenshots ? `\n${referenceScreenshots!.length} reference post screenshot(s) are also attached. These show the EXISTING post the user wants to recreate. Analyze each screenshot's visual layout, text content, and copywriting structure. Then recreate the same structure adapted to the target brand's voice, colors, and aesthetic.` : ''}

## OUTPUT FORMAT
- Aspect ratio: ${aspectRatio}
- Composition guidance: ${getAspectRatioGuidance(aspectRatio)}
- ${isCarousel ? `Generate exactly ${slideCount} slides. Each slide should be a distinct, self-contained visual that works as part of the carousel set.` : 'Generate exactly 1 slide.'}

## REQUIREMENTS
1. Each prompt must be a complete, standalone image generation prompt — not a brief description.
2. **BRAND EXECUTION IS NOT OPTIONAL**: Every slide prompt must explicitly apply the Brand Execution Contract. Mention the palette, typography hierarchy, layout grid, text-safe zones, lighting/image treatment, and professional finish inside the prompt itself. A strong concept with generic styling is a failed answer.
3. **CANVA-STYLE TEXT LAYOUTS**: Think like a Canva designer creating an Instagram carousel. Each slide should have MULTIPLE text elements placed cleanly — not just one headline. A typical educational carousel slide has:
   - A **headline** at the top (bold, large, attention-grabbing)
   - A **subheading or stat** below the headline (medium size, supporting the claim)
   - **Body text or bullet points** in the main area (small, readable, educational content)
   - A **footer or slide number** at the bottom (small, subtle, e.g. "1/5" or brand name)
   
   Each text element MUST be specified in the prompt with EXACT words, position, size, color, and font style. Example:
   "Render the headline 'MATCHA vs COFFEE' in bold white uppercase at the top center, 48px equivalent. Below it, render the stat '137x more antioxidants' in brand green color (#4a7c59), 36px, centered. In the lower third, render three bullet points: '• Natural energy without crash', '• Rich in L-theanine for calm focus', '• Boosts metabolism' in 20px white text, left-aligned, with a semi-transparent dark background panel behind them. At the bottom right, render '1/5' in 14px light gray."

4. **BRAND TYPOGRAPHY**: Use the brand's actual font families from the brand context. If the brand context lists fonts (e.g. "Inter (heading), DM Sans (body)"), you MUST reference them: "Use Inter or similar bold geometric sans-serif for headlines, DM Sans or similar clean sans-serif for body text." If no specific fonts are listed, specify a style: "Use a bold modern sans-serif (like Montserrat or Inter) for headlines, clean sans-serif for body."

5. **BRAND COLORS IN TEXT**: Use the brand's color palette from the brand context for text elements and accents. If the brand colors include green, use green for stats/highlights. Specify exact hex codes when available: "Use brand green (#4a7c59) for the stat number, white for the headline, light gray (#e5e7eb) for body text."

6. **TEXT CONSISTENCY ACROSS SLIDES**: All slides in a carousel MUST use the same text styling system — same font family, same headline size, same body text size, same color scheme, same text placement zones. Only the content changes. Think of it as a master template with different content per slide.

7. Include: visual composition, lighting, color palette, mood, camera angle, style direction, and DETAILED text rendering instructions${userWantsNoText ? '' : ' — text is ALWAYS included by default'}.
8. Respect the brand's tone, visual principles, color palette, and typography from the brand context.
9. If product truth is locked, ensure the product identity, packaging, and label are preserved in the prompt.
10. If reference images are attached, analyze their style and adapt — do not copy directly. Change the execution enough to feel original.
11. Write copy (headline, supporting text, caption) that fits the brand voice and the slide's purpose. The "copy" field should contain the same text as what's in the prompt.
12. For carousels: maintain visual consistency across slides (same design system, same background tone, same typography family, same text placement zones) while giving each slide a distinct focal point and content.
13. Each prompt should be 200-500 words — detailed and production-ready.
14. Include a "negativePrompt" field with things to explicitly avoid (e.g. "no anime girl, no copied pose, no neon colors, no watermark, no crowded composition, no off-brand colors, no mismatched typography").
15. Include a "designNotes" field with art direction notes (what to change vs. the reference, color specifics, typography, layout grid, text placement notes, and how the slide applies the brand execution contract).
16. Include a "canvaText" field with ALL text elements for that slide: heading, subtext (stats/subheading), bodyText (bullet points or paragraph), footer (slide number or brand name).
17. Include a "referenceAnalysis" field at the top level: For each reference screenshot, report what text you see, what the layout is, and how you will adapt it. Be specific — quote the actual text you read from each screenshot.
${hasRefScreenshots ? `18. **REFERENCE POST RECREATION — THIS IS THE PRIMARY TASK**:
    - You are RECREATING an existing post from ${referenceScreenshots!.length} screenshots. This is not a from-scratch design task.
    - For EACH screenshot, you MUST read the actual text on it (or note "no text") and report it in referenceAnalysis
    - Match the slide count: generate ${referenceScreenshots!.length} slides (one per screenshot) unless the user specifies otherwise
    - Match the slide flow: if screenshot 1 is a hook with a bold question, your slide 1 should be a hook with a bold question (rewritten for the brand)
    - Match the layout structure: if screenshot 1 has text at top + image at bottom, your slide 1 prompt should specify text at top + image at bottom
    - Match the text approach: if a screenshot has text, your slide should have text${userWantsNoText ? '. If a screenshot has NO text, your slide should also have NO text.' : '. Even if a screenshot has NO text, you MUST still add on-brand text — derive it from the brand voice and product context. Never produce text-free slides unless the user explicitly asked for no text.'}
    - REWRITE all text in the target brand's voice — same meaning, same structure, different words
    - The "prompt" field MUST contain the exact text to render and its placement (when the reference has text), adapted from the screenshot
    - The "copy" field MUST contain the headline and supporting text that match what's in the prompt (or null if no text)
    - The "canvaText" field MUST contain the simplified text layout adapted from the reference post's text structure (or null if no text)
    - In referenceAnalysis, for each screenshot write: "Screenshot N: [exact text read from image, or 'no text'] → Adapted as: [your rewritten text, or 'no text needed']"` : ''}

## CRITICAL — HOW PRODUCT REFERENCE IMAGES WORK IN GENERATION
When the user applies your prompt to generate an image, any product reference images they have selected in the studio will be sent to the image generator ALONGSIDE your prompt. The image generator uses these as visual identity references for the product (packaging, colors, label, shape).

Therefore:
- Do NOT describe the product packaging in exhaustive detail in the prompt — the AI will see the reference images.
- DO describe the SCENE, ENVIRONMENT, LIGHTING, MOOD, and COMPOSITION around the product.
- DO describe how the product should appear in the scene (e.g. "the matcha tin sits on a wooden board surrounded by fresh mint leaves and a steaming cup" — not "a cylindrical green tin with gold lettering and a bamboo lid").
- DO describe the creative execution: lighting style, background, props, atmosphere, camera angle.
- **DO include text rendering instructions${userWantsNoText ? ' ONLY when the user has not explicitly requested no text (they have)' : ' — text is ALWAYS included by default'}**${userWantsNoText ? '' : ' — even if a reference screenshot has no text, add text derived from the brand and research context. Specify what text to render, where to place it, what font style, what color, what size.'}.
- The prompt should paint the WORLD around the product AND specify text overlay when appropriate, not re-describe the product itself.

${useWebSearch ? `## WEB RESEARCH
Use web search to:
- Research the brand website (${input.brandUrl || 'from brand context'}) to understand their actual visual identity, product positioning, and brand language
- ${referenceUrl ? `Research the brand/account behind ${referenceUrl} to understand their visual style and content patterns. Note: Instagram blocks direct content scraping, so use web search to find publicly available information about the account's style, not the specific post content. Rely on the uploaded reference screenshots for actual post analysis.` : 'Find current trends for this product category on Instagram'}
- Ensure the creative direction aligns with the real brand aesthetic
Do not copy competitor content — use research to inform original creative direction.` : ''}

Return ONLY this JSON (no markdown fences):
{
  "creativeDirection": "2-3 sentence summary of the overall creative strategy",
  "brandExecutionSummary": "How the prompts apply the brand palette, typography, layout system, image treatment, and professional finish",
  "referenceAnalysis": "For each reference screenshot, report: Screenshot N: [exact text read from image, or 'no text on this slide'] → Adapted as: [your rewritten text or 'no text needed']. Also describe layout, colors, and visual structure. (or null if no references)",
  "researchSummary": "Brief summary of what was researched and how it informed the prompts (or null if no web search)",
  "slides": [
    {
      "slideNumber": 1,
      "title": "Short slide title",
      "prompt": "The full, detailed image generation prompt (200-500 words). If the reference screenshot has text, include explicit text rendering instructions like: 'Render the headline \"[exact text]\" in bold white at the top center on a dark gradient overlay.' If the reference has no text, do NOT add text — match the reference's visual approach. Include visual composition, lighting, colors, mood, and scene description.",
      "negativePrompt": "Things to avoid: no anime girl, no copied pose, no neon colors, etc.",
      "copy": {
        "headline": "The exact headline text that appears in the prompt",
        "supportingText": "The exact supporting text that appears in the prompt, or null",
        "caption": "Instagram caption for this slide or null"
      },
      "designNotes": "Art direction notes — what to change vs reference, brand palette use, typography hierarchy, layout grid, image treatment, text placement notes, and professional finishing details",
      "canvaText": {
        "heading": "Main heading text (same as copy.headline)",
        "subtext": "Subheading or stat text (same as copy.supportingText, or null)",
        "bodyText": "Bullet points or paragraph text for the slide body, or null",
        "footer": "Slide number (e.g. '1/5') or brand name, or null"
      }
    }
  ]
}`;

  // Build parts — images first, then text
  const parts: any[] = [];

  // Add reference images (studio composer references)
  for (const img of refContext.images.slice(0, 6)) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64,
      },
    });
  }

  // Add reference post screenshots (user-uploaded carousel screenshots)
  if (referenceScreenshots) {
    for (const img of referenceScreenshots.slice(0, 10)) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        },
      });
    }
  }

  // Add the text prompt
  parts.push({ text: systemPrompt });

  onProgress?.({ stage: 'analyzing', message: 'Analyzing references and brand context...', progressPercent: 40 });

  const generateContent = async (withSearch: boolean): Promise<GenerateContentResponse> => {
    return ai.models.generateContent({
      model: withSearch ? WRITER_RESEARCH_MODEL : WRITER_MODEL,
      tools: withSearch ? [{ googleSearch: {} }] : undefined,
      contents: { parts },
      config: {
        maxOutputTokens: 8000,
      },
    } as any);
  };

  onProgress?.({
    stage: 'writing',
    message: useWebSearch
      ? 'Writing detailed prompts with live web research...'
      : 'Writing detailed prompts...',
    progressPercent: 60,
  });
  const response = await generateContent(useWebSearch);

  onProgress?.({ stage: 'writing', message: 'Processing results...', progressPercent: 85 });

  const parsed = parseJsonResponse(response);
  if (!parsed || !parsed.slides || !Array.isArray(parsed.slides)) {
    console.error('[promptWriterService] Failed to parse response:', (response.text || '').slice(0, 500));
    throw new Error('Prompt writer returned an invalid response. Please try again.');
  }

  const sources = extractSources(response);

  const slides: PromptWriterSlide[] = parsed.slides
    .filter((s: any) => s && typeof s.prompt === 'string' && s.prompt.trim().length > 0)
    .map((s: any, idx: number) => ({
      slideNumber: s.slideNumber || idx + 1,
      title: String(s.title || `Slide ${idx + 1}`).trim(),
      prompt: String(s.prompt).trim(),
      negativePrompt: s.negativePrompt ? String(s.negativePrompt).trim() : undefined,
      copy: {
        headline: s.copy?.headline || undefined,
        supportingText: s.copy?.supportingText || undefined,
        caption: s.copy?.caption || undefined,
      },
      designNotes: String(s.designNotes || '').trim(),
      canvaText: s.canvaText
        ? {
            heading: s.canvaText.heading || undefined,
            subtext: s.canvaText.subtext || undefined,
            bodyText: s.canvaText.bodyText || undefined,
            footer: s.canvaText.footer || undefined,
          }
        : undefined,
    }))
    .slice(0, slideCount);

  if (slides.length === 0) {
    throw new Error('Prompt writer did not produce any usable prompts. Please try again.');
  }

  onProgress?.({ stage: 'complete', message: 'Prompts ready', progressPercent: 100 });

  return {
    slides,
    creativeDirection: String(parsed.creativeDirection || '').trim(),
    brandExecutionSummary: parsed.brandExecutionSummary ? String(parsed.brandExecutionSummary).trim() : undefined,
    referenceAnalysis: parsed.referenceAnalysis ? String(parsed.referenceAnalysis).trim() : undefined,
    researchSummary: parsed.researchSummary ? String(parsed.researchSummary).trim() : undefined,
    sources,
  };
}

// ---------------------------------------------------------------------------
// Refinement — iterate on previously generated prompts
// ---------------------------------------------------------------------------

export async function refinePrompts(
  input: PromptWriterInput,
  onProgress?: PromptWriterProgressCallback,
): Promise<PromptWriterResult> {
  return writePrompts(input, onProgress);
}
