/**
 * Social Art Director Service
 *
 * Evaluates locked image composition, brand aesthetics, product truth,
 * concept, trend evidence, and optional user direction to produce a
 * validated SocialArtDirectionPlan that controls text/layout decisions.
 */

import type {
  SocialArtDirectionPlan,
  TextDecision,
  CTAPlacement,
  BrandKnowledge,
  ProductTruth,
  CreativeConcept,
  TrendResearchResult,
  SocialObjective,
} from './types';
import type { SocialPostInput } from './socialPostDirectorService';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { STUDIO_FLASH_MODEL } from './studioModels';

const ART_DIRECTOR_MODEL = STUDIO_FLASH_MODEL;

/**
 * Internal planning language patterns that must never appear in customer-facing copy.
 */
const INTERNAL_LANGUAGE_PATTERNS: RegExp[] = [
  /\bleans into\b/i,
  /\bbrand fit\b/i,
  /\btone by\b/i,
  /\bvisual direction\b/i,
  /\bselected concept\b/i,
  /\brationale\b/i,
  /\bobjective alignment\b/i,
  /\bconcept explores\b/i,
  /\bresearch indicates\b/i,
];

/**
 * Conversion CTA patterns that are inappropriate for education/awareness objectives.
 */
const CONVERSION_CTA_PATTERNS: RegExp[] = [
  /\bshop now\b/i,
  /\bbuy now\b/i,
  /\badd to cart\b/i,
  /\bget yours\b/i,
  /\border now\b/i,
  /\bpurchase\b/i,
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a SocialArtDirectionPlan against brand rules, internal language,
 * unsupported claims, and objective-text conflicts.
 *
 * On any validation failure, falls back to text-free plan.
 */
export function validateSocialArtDirectionPlan(
  plan: SocialArtDirectionPlan,
  input: SocialPostInput,
): SocialArtDirectionPlan {
  const warnings: string[] = [...plan.warnings];
  let failed = false;

  // Collect all visible text content for checks
  const allVisibleText = plan.visibleText.map(entry => entry.content);

  // 1. Prohibited language check
  if (input.brandKnowledge?.prohibitedLanguage?.length) {
    const prohibited = input.brandKnowledge.prohibitedLanguage
      .filter(item => item.status !== 'rejected')
      .map(item => item.value);

    for (const text of allVisibleText) {
      for (const phrase of prohibited) {
        if (text.toLowerCase().includes(phrase.toLowerCase())) {
          warnings.push(`Prohibited brand language detected: "${phrase}"`);
          failed = true;
        }
      }
    }
  }

  // 2. Internal planning language check
  for (const text of allVisibleText) {
    for (const pattern of INTERNAL_LANGUAGE_PATTERNS) {
      if (pattern.test(text)) {
        warnings.push(`Internal planning language detected: "${text.match(pattern)?.[0]}"`);
        failed = true;
      }
    }
  }

  // 3. Unsupported claims check — cross-reference against productTruth.verifiedFacts
  if (input.productTruth?.verifiedFacts?.length && allVisibleText.length > 0) {
    const verifiedFacts = input.productTruth.verifiedFacts;
    for (const text of allVisibleText) {
      // Only check text entries that make product claims (contain numbers, percentages, or specific product terms)
      const looksLikeClaim = /\d+%?|clinically|proven|guaranteed|certified|award|#1|best|first|only|patented/i.test(text);
      if (looksLikeClaim) {
        const isSupported = verifiedFacts.some(fact =>
          text.toLowerCase().includes(fact.toLowerCase()) ||
          fact.toLowerCase().includes(text.toLowerCase())
        );
        if (!isSupported) {
          warnings.push(`Unsupported claim in visible text: "${text}"`);
          failed = true;
        }
      }
    }
  }

  // 4. Objective-text conflict check — reject conversion CTAs for education/awareness
  if (input.objective === 'education' || input.objective === 'awareness') {
    for (const text of allVisibleText) {
      for (const pattern of CONVERSION_CTA_PATTERNS) {
        if (pattern.test(text)) {
          warnings.push(`Conversion CTA "${text.match(pattern)?.[0]}" conflicts with ${input.objective} objective`);
          failed = true;
        }
      }
    }
  }

  // 5. Text-free fallback on any validation failure
  if (failed) {
    return {
      ...plan,
      textDecision: 'none' as TextDecision,
      visibleText: [],
      ctaPlacement: 'caption_only' as CTAPlacement,
      warnings,
    };
  }

  return { ...plan, warnings };
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Builds the art-director prompt from all available creative context inputs.
 */
export function buildSocialArtDirectorPrompt(input: SocialPostInput): string {
  const sections: string[] = [];

  sections.push('You are an expert social media art director. Analyze the provided context and produce a structured art-direction plan.');
  sections.push('');

  // Variation seed — push the model to explore a fresh creative angle each run
  // rather than converging on the same safe composition every time.
  const creativeAngles = [
    'bold and graphic with strong negative space',
    'warm and editorial, lifestyle-driven',
    'minimal and premium, gallery-like',
    'dynamic and energetic with motion cues',
    'intimate macro detail that highlights texture',
    'striking color-blocked composition',
    'atmospheric and moody with dramatic lighting',
    'clean and airy with a high-key palette',
  ];
  const angle = creativeAngles[Math.floor(Math.random() * creativeAngles.length)];
  sections.push('=== CREATIVE VARIATION DIRECTIVE ===');
  sections.push(`For THIS generation, explore a distinctly different creative angle: ${angle}.`);
  sections.push('Do not default to the most obvious composition — bring a fresh visual interpretation while staying on-brand and respecting product truth.');
  sections.push(`(variation token: ${Math.random().toString(36).slice(2, 10)})`);
  sections.push('');

  // Primary creative guidance: user direction
  if (input.userDirection) {
    sections.push('=== USER CREATIVE DIRECTION (PRIMARY GUIDANCE) ===');
    sections.push(input.userDirection);
    sections.push('');
  }

  // Locked image analysis
  sections.push('=== LOCKED IMAGE ANALYSIS ===');
  sections.push('Evaluate the hero image for:');
  sections.push('- Negative space available for text placement');
  sections.push('- Composition (rule of thirds, focal points, visual flow)');
  sections.push('- Lighting conditions and contrast zones');
  if (input.heroAssetId) {
    sections.push(`Hero asset ID: ${input.heroAssetId}`);
  }
  sections.push('');

  // Brand aesthetic
  if (input.brandKnowledge) {
    sections.push('=== BRAND AESTHETIC ===');
    const brand = input.brandKnowledge;
    const accepted = <T extends { status: string; value: unknown }>(items: T[] | undefined) =>
      items?.filter(item => item.status !== 'rejected').map(item => item.value) ?? [];

    const visualPrinciples = accepted(brand.visualPrinciples);
    if (visualPrinciples.length > 0) {
      sections.push(`Visual principles: ${visualPrinciples.join('; ')}`);
    }

    const imageStylePrefs: string[] = [];
    const lighting = accepted(brand.imageStyle?.lighting);
    if (lighting.length) imageStylePrefs.push(`Lighting: ${lighting.join(', ')}`);
    const composition = accepted(brand.imageStyle?.composition);
    if (composition.length) imageStylePrefs.push(`Composition: ${composition.join(', ')}`);
    const backgrounds = accepted(brand.imageStyle?.backgrounds);
    if (backgrounds.length) imageStylePrefs.push(`Backgrounds: ${backgrounds.join(', ')}`);
    if (imageStylePrefs.length > 0) {
      sections.push(`Image style preferences: ${imageStylePrefs.join('; ')}`);
    }

    // Text-free indicators: look for visual principles indicating minimal/text-free
    const textFreeIndicators = visualPrinciples.filter(p =>
      /minimal|text.?free|clean|simple|let.*(image|product|photo).*speak|imagery.?first/i.test(p as string)
    );
    if (textFreeIndicators.length > 0) {
      sections.push(`Text-free indicators: ${textFreeIndicators.join('; ')}`);
    }
    sections.push('');
  }

  // Product truth
  if (input.productTruth) {
    sections.push('=== PRODUCT TRUTH ===');
    sections.push(`Product: ${input.productTruth.productName}`);
    if (input.productTruth.verifiedFacts.length > 0) {
      sections.push(`Verified facts (ONLY these may be claimed): ${input.productTruth.verifiedFacts.join('; ')}`);
    }
    if (input.productTruth.preservationRules.length > 0) {
      sections.push(`Preservation rules: ${input.productTruth.preservationRules.join('; ')}`);
    }
    sections.push('');
  }

  // Concept
  if (input.selectedConcept) {
    sections.push('=== CONCEPT ===');
    sections.push(`Visual direction: ${input.selectedConcept.visualDirection}`);
    if (input.selectedConcept.hook) {
      sections.push(`Hook: ${input.selectedConcept.hook}`);
    }
    sections.push(`One-line idea: ${input.selectedConcept.oneLineIdea}`);
    sections.push('');
  }

  // Trend evidence — concept-relevant insights only
  if (input.trendResearch?.insights?.length && input.selectedConcept) {
    const relevantInsights = input.trendResearch.insights.filter(
      insight =>
        !input.selectedConcept!.sourceTrendInsightIds.length ||
        input.selectedConcept!.sourceTrendInsightIds.includes(insight.id)
    );
    if (relevantInsights.length > 0) {
      sections.push('=== TREND EVIDENCE (concept-relevant only) ===');
      for (const insight of relevantInsights) {
        sections.push(`- ${insight.title}: ${insight.description}`);
      }
      sections.push('');
    }
  }

  // Text decision guidance
  sections.push('=== TEXT DECISION GUIDANCE ===');
  sections.push('Social media posts typically benefit from a strong headline that stops the scroll.');
  sections.push('DEFAULT to including a headline (textDecision: "headline") unless there is a strong reason not to.');
  sections.push('');
  sections.push('Choose text-free (textDecision: "none") ONLY when:');
  sections.push('- User direction explicitly requests "no text" or "text-free"');
  sections.push('- The locked image is an intricate composition where ANY text would reduce impact');
  sections.push('');
  sections.push('Choose headline + supporting (textDecision: "headline_supporting") when:');
  sections.push('- The objective is education and there is a verified fact to communicate');
  sections.push('- The image has generous negative space that can accommodate two text elements');
  sections.push('');
  sections.push('HEADLINE SOURCING — CRITICAL (the headline MUST be derived from the research above, not invented):');
  sections.push('- PREFER the concept hook verbatim or lightly tightened, if one is provided above.');
  sections.push('- OTHERWISE derive it from a verified product fact, a brand approved-language phrase, or a concept-relevant trend insight.');
  sections.push('- It must reference something concrete about THIS product/brand (e.g. an ingredient, origin, ritual, benefit, or sensory detail from the research) — not a generic abstract phrase.');
  sections.push('- BAD (generic, could apply to any brand): "A New Perspective on Ritual", "Discover Something New", "Elevate Your Day".');
  sections.push('- GOOD (specific, research-grounded): uses the actual product name, origin, ingredient, or the concept hook.');
  sections.push('- Max ~6 words. Do NOT use the concept TITLE, internal planning language, or unverified claims.');
  sections.push('- In your rationale, state which research element the headline was derived from.');
  sections.push('');

  // Platform context
  sections.push(`=== PLATFORM ===`);
  sections.push(`Platform: ${input.platform.replace('_', ' ')}`);
  sections.push(`Objective: ${input.objective}`);
  sections.push('');

  // Output format
  sections.push('=== OUTPUT FORMAT ===');
  sections.push('Return a JSON object with this exact structure:');
  sections.push(JSON.stringify({
    visualStrategy: 'Description of overall visual approach',
    rationale: 'Why this approach works for brand/product/platform',
    composition: 'Specific composition guidance for generation',
    lockedImageTreatment: 'How to treat the locked hero image',
    textDecision: 'none | headline | headline_supporting',
    visibleText: [
      { content: 'Exact text string', role: 'headline | supporting | cta', placement: 'Where on image', maxChars: 60 },
    ],
    typography: { headingFont: 'Font suggestion', bodyFont: 'Font suggestion' },
    ctaPlacement: 'none | caption_only | on_image',
    confidence: 0.85,
    warnings: [],
  }, null, 2));

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Calls Gemini to produce an art-direction plan, validates it, and returns
 * the validated plan. Falls back to a deterministic text-free plan on failure.
 */
export async function directSocialPost(
  input: SocialPostInput,
): Promise<SocialArtDirectionPlan> {
  try {
    const apiKey = getArtDirectorApiKey();
    if (!apiKey) {
      return buildDeterministicFallback(input);
    }

    const ai = new GoogleGenAI({ apiKey });
    const prompt = buildSocialArtDirectorPrompt(input);

    const response = await ai.models.generateContent({
      model: ART_DIRECTOR_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 2048,
      },
    } as any);

    const text = response.text || '{}';
    const clean = text.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Construct a valid plan from the parsed response
    const plan: SocialArtDirectionPlan = {
      visualStrategy: parsed.visualStrategy || 'Let the product image speak for itself',
      rationale: parsed.rationale || 'Text-free approach preserves image impact',
      composition: parsed.composition || 'Hero image centered with natural focal point',
      lockedImageTreatment: parsed.lockedImageTreatment || 'Preserve original composition and lighting',
      textDecision: validateTextDecision(parsed.textDecision),
      visibleText: Array.isArray(parsed.visibleText)
        ? parsed.visibleText.map((entry: any) => ({
            content: String(entry.content || ''),
            role: validateTextRole(entry.role),
            placement: String(entry.placement || 'center'),
            maxChars: Number(entry.maxChars) || 60,
          }))
        : [],
      typography: {
        headingFont: parsed.typography?.headingFont || 'system-ui',
        bodyFont: parsed.typography?.bodyFont || 'system-ui',
      },
      ctaPlacement: validateCtaPlacement(parsed.ctaPlacement),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };

    // Validate the plan
    return validateSocialArtDirectionPlan(plan, input);
  } catch (error) {
    console.warn('[socialArtDirectorService] Art direction failed, using deterministic fallback:', error);
    return buildDeterministicFallback(input);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArtDirectorApiKey(): string {
  // Match the same key retrieval pattern as other AIImageStudio services
  const viteKey = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env.VITE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY)
    : undefined;
  const windowKey = typeof window !== 'undefined'
    ? ((window as any).ENV?.VITE_API_KEY || (window as any).ENV?.VITE_GEMINI_API_KEY || (window as any).ENV?.GEMINI_API_KEY)
    : undefined;
  return viteKey || windowKey || '';
}

function validateTextDecision(value: unknown): TextDecision {
  if (value === 'none' || value === 'headline' || value === 'headline_supporting') {
    return value;
  }
  return 'none';
}

function validateTextRole(value: unknown): 'headline' | 'supporting' | 'cta' {
  if (value === 'headline' || value === 'supporting' || value === 'cta') {
    return value;
  }
  return 'headline';
}

function validateCtaPlacement(value: unknown): CTAPlacement {
  if (value === 'none' || value === 'caption_only' || value === 'on_image') {
    return value;
  }
  return 'caption_only';
}

/**
 * Deterministic fallback: returns a valid text-free plan with basic
 * composition guidance. Never throws.
 */
function buildDeterministicFallback(input: SocialPostInput): SocialArtDirectionPlan {
  const brandName = input.brandKnowledge?.brandName?.value ?? 'Brand';
  const concept = input.selectedConcept;

  // If user explicitly says "no text", respect that
  const userWantsNoText = input.userDirection && /\bno\s*text\b|text.?free/i.test(input.userDirection);

  if (userWantsNoText) {
    return {
      visualStrategy: `Text-free ${brandName} visual — product imagery speaks for itself`,
      rationale: 'User requested no text on image',
      composition: 'Hero image as primary focal point with natural composition preserved',
      lockedImageTreatment: 'Preserve original composition, lighting, and product appearance',
      textDecision: 'none',
      visibleText: [],
      typography: { headingFont: 'system-ui', bodyFont: 'system-ui' },
      ctaPlacement: 'caption_only',
      confidence: 0.8,
      warnings: ['Art direction used deterministic fallback — AI service unavailable'],
    };
  }

  // Default: include a headline for scroll-stopping impact.
  // Source the headline from research, in priority order: concept hook →
  // brand approved language → verified product fact → concept idea → product name.
  const accepted = <T extends { status: string; value: unknown }>(items: T[] | undefined) =>
    items?.filter(item => item.status !== 'rejected').map(item => item.value as string) ?? [];

  const approvedPhrases = accepted(input.brandKnowledge?.approvedLanguage);
  const verifiedFact = input.productTruth?.verifiedFacts?.[0];

  let headline: string;
  let headlineSource: string;
  if (concept?.hook) {
    headline = concept.hook;
    headlineSource = 'concept hook';
  } else if (approvedPhrases[0]) {
    headline = approvedPhrases[0];
    headlineSource = 'brand approved language';
  } else if (verifiedFact) {
    headline = verifiedFact;
    headlineSource = 'verified product fact';
  } else if (concept?.oneLineIdea) {
    headline = concept.oneLineIdea.split(/[.—]/).filter(Boolean)[0]?.trim() ?? concept.oneLineIdea;
    headlineSource = 'concept idea';
  } else {
    headline = input.productTruth?.productName ?? brandName;
    headlineSource = 'product name';
  }
  // Trim to a tight headline length
  headline = headline.slice(0, 48).trim();

  return {
    visualStrategy: `${brandName} social post with research-grounded headline overlay on product imagery`,
    rationale: `Headline derived from ${headlineSource}; fallback used because AI art direction was unavailable`,
    composition: 'Product image with clear negative space zone for headline text at top or center',
    lockedImageTreatment: 'Preserve product appearance; ensure contrast zone for text legibility',
    textDecision: 'headline',
    visibleText: [
      { content: headline, role: 'headline' as const, placement: 'top-center', maxChars: 48 },
    ],
    typography: {
      headingFont: input.brandKnowledge?.fonts
        ?.find(f => f.status !== 'rejected' && (f.value.role === 'display' || f.value.role === 'heading'))
        ?.value.family ?? 'system-ui',
      bodyFont: 'system-ui',
    },
    ctaPlacement: 'caption_only',
    confidence: 0.6,
    warnings: ['Art direction used deterministic fallback — AI service unavailable'],
  };
}
