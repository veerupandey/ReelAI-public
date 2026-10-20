/**
 * Concept Director Service — Phase 3 Implementation
 *
 * Generates 3-5 distinct creative concept cards from brand knowledge,
 * trend research, and product truth per architecture spec.
 */

import type {
  CreativeConcept,
  BrandKnowledge,
  TrendResearchResult,
  ProductTruth,
  StrategistBrief,
  ComposerReference,
  ComposerReferenceRole,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConceptGenerationInput {
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  strategistBrief?: StrategistBrief;
  userDirection: string;
  availableReferences: ComposerReference[];
  aspectRatio?: string;
  /** How many concepts to generate (default 3-5 decided by the model). */
  conceptCount?: number;
  /** Previously generated concepts that new ideas must NOT repeat. */
  avoidConcepts?: Array<Pick<CreativeConcept, 'title' | 'oneLineIdea' | 'visualDirection'>>;
}

export interface ConceptGenerationResult {
  concepts: CreativeConcept[];
  warnings: string[];
}

export type ConceptGenerationProgress =
  | { stage: 'analyzing'; message: string }
  | { stage: 'generating'; message: string; count: number }
  | { stage: 'validating'; message: string }
  | { stage: 'complete'; message: string };

export type ConceptProgressCallback = (progress: ConceptGenerationProgress) => void;

// ---------------------------------------------------------------------------
// Concept Templates
// ---------------------------------------------------------------------------

interface ConceptTemplate {
  titlePattern: string;
  hookPatterns: string[];
  visualPatterns: string[];
}

const CONCEPT_TEMPLATES: ConceptTemplate[] = [
  {
    titlePattern: 'Product Hero',
    hookPatterns: [
      'See the {product} that everyone\'s talking about',
      'The {product} that changes everything',
      'Finally, a {product} that works',
    ],
    visualPatterns: [
      'Clean product shot with soft shadows',
      'Product centered with subtle gradient background',
      'Macro detail highlighting key feature',
    ],
  },
  {
    titlePattern: 'Lifestyle Moment',
    hookPatterns: [
      'When {moment} meets {product}',
      'Your {moment} just got better',
      'The secret to {desirableOutcome}',
    ],
    visualPatterns: [
      'Natural lifestyle scene with product in use',
      'Candid moment showing product benefit',
      'Aspirational scene with relatable context',
    ],
  },
  {
    titlePattern: 'Trend Forward',
    hookPatterns: [
      'The {trend} way to {benefit}',
      '{Trend} meets {product}',
      'Why {influencerType} are obsessed',
    ],
    visualPatterns: [
      'On-trend aesthetic with product integrated',
      'Current visual style applied to product',
      'Platform-native format with viral potential',
    ],
  },
  {
    titlePattern: 'Proof Point',
    hookPatterns: [
      '{Number} reasons this {product} is different',
      'The science behind {benefit}',
      'What makes us {uniqueAttribute}',
    ],
    visualPatterns: [
      'Infographic-style product breakdown',
      'Before/after or comparison visualization',
      'Detail shot with supporting data elements',
    ],
  },
  {
    titlePattern: 'Brand Story',
    hookPatterns: [
      'Why we started {brand}',
      'The {brand} difference',
      'More than just {productCategory}',
    ],
    visualPatterns: [
      'Brand element with product composition',
      'Values-forward visual with subtle branding',
      'Heritage/craft story in single frame',
    ],
  },
];

// ---------------------------------------------------------------------------
// Context Analysis
// ---------------------------------------------------------------------------

interface AnalysisContext {
  hasBrandKnowledge: boolean;
  hasTrendResearch: boolean;
  hasProductTruth: boolean;
  hasUserDirection: boolean;
  productName?: string;
  brandTone: string[];
  visualPrinciples: string[];
  keyTrends: string[];
  preservationRules: string[];
  generationStrategy: 'brand-led' | 'trend-led' | 'product-led' | 'balanced';
}

function analyzeContext(input: ConceptGenerationInput): AnalysisContext {
  const brandTone = input.brandKnowledge?.toneAttributes.map(t => t.value) ?? [];
  const visualPrinciples = input.brandKnowledge?.visualPrinciples.map(p => p.value) ?? [];
  const keyTrends = input.trendResearch?.insights.slice(0, 3).map(i => i.title) ?? [];
  const preservationRules = input.productTruth?.preservationRules ?? [];

  // Determine generation strategy based on available context
  let generationStrategy: AnalysisContext['generationStrategy'] = 'balanced';
  if (input.brandKnowledge && !input.trendResearch) {
    generationStrategy = 'brand-led';
  } else if (input.trendResearch && !input.brandKnowledge) {
    generationStrategy = 'trend-led';
  } else if (input.productTruth && !input.brandKnowledge && !input.trendResearch) {
    generationStrategy = 'product-led';
  }

  return {
    hasBrandKnowledge: !!input.brandKnowledge,
    hasTrendResearch: !!input.trendResearch,
    hasProductTruth: !!input.productTruth,
    hasUserDirection: input.userDirection.trim().length > 0,
    productName: input.productTruth?.productName ?? input.brandKnowledge?.brandName.value,
    brandTone,
    visualPrinciples,
    keyTrends,
    preservationRules,
    generationStrategy,
  };
}

// ---------------------------------------------------------------------------
// Gemini Integration for AI Concept Generation
// ---------------------------------------------------------------------------

import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

import { STUDIO_FLASH_MODEL } from './studioModels';

const CONCEPT_MODEL = STUDIO_FLASH_MODEL;

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
    console.warn('[conceptDirectorService] No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local and restart dev server');
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
// Concept Generation
// ---------------------------------------------------------------------------

/**
 * Generate concept candidates using Gemini AI.
 * Uses brand knowledge, trend research, and product truth to create unique concepts.
 */
export async function generateConcepts(
  input: ConceptGenerationInput,
  onProgress?: ConceptProgressCallback,
): Promise<ConceptGenerationResult> {
  const warnings: string[] = [];

  // Analyze context
  onProgress?.({ stage: 'analyzing', message: 'Analyzing brand, trends, and product context...' });
  const context = analyzeContext(input);

  // Validate minimum requirements
  if (!context.hasProductTruth && !context.hasBrandKnowledge && !input.userDirection.trim()) {
    warnings.push('Limited context available. Consider adding brand research or product details.');
  }

  onProgress?.({ stage: 'generating', message: 'Generating creative concepts with AI...', count: 0 });

  try {
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });

    // Build context summary for prompt
    const productName = context.productName || 'Product';
    const brandTone = input.brandKnowledge?.toneAttributes
      ?.filter(t => t.status !== 'rejected')
      ?.map(t => t.value)
      ?.join(', ') || '';
    const visualStyle = input.brandKnowledge?.visualPrinciples
      ?.filter(p => p.status !== 'rejected')
      ?.map(p => p.value)
      ?.join(', ') || '';
    const trends = input.trendResearch?.insights
      ?.slice(0, 3)
      ?.map(i => i.title)
      ?.join('; ') || '';
    const preservation = input.productTruth?.preservationRules?.join('; ') || '';
    const brief = input.strategistBrief;
    const requestedCount = input.conceptCount ?? 0;
    const countInstruction = requestedCount > 0 ? `exactly ${requestedCount}` : '3-5';
    const avoidList = (input.avoidConcepts ?? [])
      .map(c => `- "${c.title}": ${c.oneLineIdea} (visual: ${c.visualDirection})`)
      .join('\n');

    const prompt = `
You are a senior creative director at a top advertising agency. Generate ${countInstruction} distinct creative concepts for ${productName}.

CONTEXT:
${input.userDirection ? `User direction: ${input.userDirection}` : ''}
${brief ? `Execution mode: ${brief.executionMode}` : ''}
${brief?.creativeTerritories.length ? `Creative territories to explore (cover different ones):\n${brief.creativeTerritories.map(t => `- ${t}`).join('\n')}` : ''}
${brief?.constraints.length ? `Constraints:\n${brief.constraints.slice(0, 5).map(t => `- ${t}`).join('\n')}` : ''}
${brandTone ? `Brand tone: ${brandTone}` : ''}
${visualStyle ? `Visual principles: ${visualStyle}` : ''}
${trends ? `Current trends to consider: ${trends}` : ''}
${preservation ? `MUST PRESERVE: ${preservation}` : ''}
${input.aspectRatio ? `Target aspect ratio: ${input.aspectRatio} — composition must work for this format` : ''}
${input.availableReferences.length > 0 ? `Reference images attached: ${input.availableReferences.length} image(s) with roles: ${input.availableReferences.map(r => r.role).join(', ')}. The actual product images will be sent alongside the prompt at generation time, so describe the scene AROUND the product — do not re-describe the product itself.` : ''}
${brief?.executionMode === 'recreate' ? 'RECREATE MODE: preserve reference structure/flow; change look, copy, and product treatment so it feels original for this brand.' : ''}
${brief?.executionMode === 'original' ? 'ORIGINAL MODE: invent fresh angles — do not lean on recreating a reference post structure.' : ''}
${avoidList ? `\nALREADY EXPLORED CONCEPTS — DO NOT REPEAT OR LIGHTLY REWORD ANY OF THESE. Your new concepts must use fundamentally different creative angles, visual styles, and hooks:\n${avoidList}\n` : ''}
For each concept provide:
1. Title (distinctive, memorable 3-5 words)
2. One-line creative idea (the hook/concept in 1 sentence)
3. Visual direction — write this as a RICH, DETAILED, READY-TO-GENERATE IMAGE PROMPT of 4-6 sentences. Cover: exact composition and framing, lighting quality and direction, camera angle and distance, surface materials and textures, color palette and atmosphere, product placement and role, background treatment. This text will be sent directly to an image generation model — make it specific enough that a photographer could execute it without asking any questions. Do NOT use placeholder text or vague descriptions like "clean product shot" or "minimal aesthetic". Be vivid and precise.
4. Negative prompt — a comma-separated list of things to AVOID in the generation (common artifacts, style mismatches, unwanted elements). 10-15 items max. Example: "blurry, low quality, distorted, watermark, text overlay, deformed, extra limbs, oversaturated, plastic skin, wrong proportions"
5. Why it fits the brand (rationale, 1-2 sentences)
6. Which trends it leverages (if any, 1 sentence)
7. Product truth notes (what must be shown/preserved, as bullet points)

Return JSON:
{
  "concepts": [
    {
      "title": "Concept Name",
      "oneLineIdea": "The core creative hook in one sentence",
      "visualDirection": "4-6 sentence detailed image prompt covering composition, lighting, camera angle, materials, textures, color palette, atmosphere, product placement, and background treatment. Precise enough to generate without follow-up questions.",
      "negativePrompt": "blurry, low quality, distorted, watermark, text overlay, deformed, oversaturated, plastic skin, wrong proportions",
      "brandFitRationale": "Why this fits the brand in 1-2 sentences",
      "trendFitRationale": "How current trends inspire this in 1 sentence",
      "productTruthNotes": ["Specific element that must be preserved or shown"]
    }
  ]
}

Requirements:
- Each concept must be visually distinct from the others
- All must respect preservation rules
- Concepts should range from safe/brand-appropriate to bold/trend-forward
- visualDirection must be at minimum 4 complete sentences — never a single phrase
- Do not use vague terms like "clean shot", "minimal", "aesthetic" without specific visual detail
- Do not use placeholder text like {moment} - write actual content
- negativePrompt must be practical and focused on real failure modes for this type of image
${avoidList ? '- Push into unexpected territory: new formats, moods, settings, or narrative devices not used in the already-explored concepts' : ''}
`;

    const response = await ai.models.generateContent({
      model: CONCEPT_MODEL,
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    } as any);

    const parsed = parseGeminiResponse(response);

    // Map AI response to CreativeConcept type
    const concepts: CreativeConcept[] = (parsed?.concepts || []).map((c: any, idx: number) => ({
      id: crypto.randomUUID(),
      title: c.title || `Concept ${idx + 1}`,
      oneLineIdea: c.oneLineIdea || c.hook || '',
      visualDirection: c.visualDirection || '',
      negativePrompt: c.negativePrompt?.trim() || undefined,
      hook: c.hook || c.oneLineIdea || '',
      brandFitRationale: c.brandFitRationale || '',
      trendFitRationale: c.trendFitRationale || '',
      productTruthNotes: Array.isArray(c.productTruthNotes) ? c.productTruthNotes : [],
      suggestedReferenceRoles: input.availableReferences.map(ref => ({
        assetId: ref.assetId,
        role: ref.role,
        instructions: ref.instructions,
      })),
      sourceTrendInsightIds: input.trendResearch?.insights?.slice(0, 2).map(i => i.id) || [],
      status: 'candidate',
    }));

    // Validate against Product Truth
    onProgress?.({ stage: 'validating', message: 'Validating concepts against Product Truth...' });

    const validConcepts = concepts.filter(concept => {
      const validation = validateConceptAgainstProductTruth(concept, input.productTruth);
      if (!validation.valid) {
        warnings.push(`Concept "${concept.title}": ${validation.reason}`);
        return false;
      }
      return true;
    });

    // Never wipe the whole set — soft-grounded concepts are still usable with warnings.
    const conceptsToReturn =
      validConcepts.length > 0
        ? validConcepts
        : concepts.length > 0
          ? (warnings.push(
              'No concepts fully matched Product Truth wording — keeping them so you can still choose one.',
            ),
            concepts)
          : [];

    onProgress?.({ stage: 'complete', message: `Generated ${conceptsToReturn.length} valid concepts.` });

    return {
      concepts: conceptsToReturn,
      warnings,
    };
  } catch (error) {
    console.warn('[conceptDirectorService] Gemini generation failed:', error);
    warnings.push(`AI concept generation failed: ${error instanceof Error ? error.message : 'unknown provider error'}. Using context-derived fallback concepts.`);

    // Fallback to template-based generation
    return generateConceptsFromTemplates(input, context, onProgress);
  }
}

// Fallback template-based generation
async function generateConceptsFromTemplates(
  input: ConceptGenerationInput,
  context: AnalysisContext,
  onProgress?: ConceptProgressCallback,
): Promise<ConceptGenerationResult> {
  const warnings: string[] = [];
  const selectedTemplates = selectTemplatesForStrategy(context.generationStrategy);

  const concepts: CreativeConcept[] = [];

  for (let i = 0; i < selectedTemplates.length; i++) {
    const template = selectedTemplates[i];
    onProgress?.({
      stage: 'generating',
      message: `Creating concept ${i + 1} of ${selectedTemplates.length}...`,
      count: i + 1,
    });

    const concept = buildConceptFromTemplate(template, context, input, i);
    concepts.push(concept);
  }

  const validConcepts = concepts.filter(concept => {
    const validation = validateConceptAgainstProductTruth(concept, input.productTruth);
    if (!validation.valid) {
      warnings.push(`Concept "${concept.title}": ${validation.reason}`);
      return false;
    }
    return true;
  });

  const conceptsToReturn =
    validConcepts.length > 0
      ? validConcepts
      : concepts.length > 0
        ? (warnings.push(
            'No concepts fully matched Product Truth wording — keeping them so you can still choose one.',
          ),
          concepts)
        : [];

  return { concepts: conceptsToReturn, warnings };
}

function selectTemplatesForStrategy(
  strategy: AnalysisContext['generationStrategy'],
): ConceptTemplate[] {
  switch (strategy) {
    case 'brand-led':
      // Prioritize brand story and product hero
      return [
        CONCEPT_TEMPLATES[4], // Brand Story
        CONCEPT_TEMPLATES[0], // Product Hero
        CONCEPT_TEMPLATES[1], // Lifestyle Moment
      ];
    case 'trend-led':
      // Prioritize trend forward and proof points
      return [
        CONCEPT_TEMPLATES[2], // Trend Forward
        CONCEPT_TEMPLATES[3], // Proof Point
        CONCEPT_TEMPLATES[0], // Product Hero
      ];
    case 'product-led':
      // Prioritize product hero and proof points
      return [
        CONCEPT_TEMPLATES[0], // Product Hero
        CONCEPT_TEMPLATES[3], // Proof Point
        CONCEPT_TEMPLATES[1], // Lifestyle Moment
      ];
    default:
      // Balanced mix
      return CONCEPT_TEMPLATES.slice(0, 4);
  }
}

function buildConceptFromTemplate(
  template: ConceptTemplate,
  context: AnalysisContext,
  input: ConceptGenerationInput,
  index: number,
): CreativeConcept {
  // Personalize template with context
  const productName = context.productName ?? 'Product';
  const brandName = input.brandKnowledge?.brandName?.value ?? input.productTruth?.productName ?? 'Brand';

  // Select hook based on available trends or brand tone
  let hook = template.hookPatterns[index % template.hookPatterns.length];

  // Extract benefit words from user direction or use defaults
  const userWords = input.userDirection.toLowerCase().split(' ').filter(w => w.length > 3);
  const benefit = userWords[0] ?? 'better results';
  const moment = userWords[1] ?? 'daily routine';
  const desirableOutcome = userWords[2] ?? 'success';
  const influencerType = context.brandTone[0] ? `${context.brandTone[0]} influencers` : 'trendsetters';
  const uniqueAttribute = context.visualPrinciples[0] ?? 'quality';
  const productCategory = productName.toLowerCase().includes('matcha') ? 'tea' :
                          productName.toLowerCase().includes('skincare') ? 'skincare' : 'product';

  hook = hook
    .replace(/\{product\}/g, productName)
    .replace(/\{brand\}/g, brandName)
    .replace(/\{trend\}/g, context.keyTrends[0] ?? 'latest')
    .replace(/\{Trend\}/g, (context.keyTrends[0] ?? 'Latest').replace(/^\w/, c => c.toUpperCase()))
    .replace(/\{moment\}/g, moment)
    .replace(/\{desirableOutcome\}/g, desirableOutcome)
    .replace(/\{benefit\}/g, benefit)
    .replace(/\{influencerType\}/g, influencerType)
    .replace(/\{Number\}/g, '5')
    .replace(/\{uniqueAttribute\}/g, uniqueAttribute)
    .replace(/\{productCategory\}/g, productCategory);

  // Select visual direction
  const visualDirection = template.visualPatterns[index % template.visualPatterns.length];

  // Build brand fit rationale
  let brandFitRationale: string;
  if (context.hasBrandKnowledge && context.brandTone.length > 0) {
    brandFitRationale = `Aligns with brand's ${context.brandTone.join(', ')} tone. ${context.visualPrinciples[0] ?? ''}`;
  } else if (context.hasProductTruth) {
    brandFitRationale = `Focuses on ${productName}'s core identity while maintaining product integrity.`;
  } else {
    brandFitRationale = 'Universal creative approach adaptable to various brand contexts.';
  }

  // Build trend fit rationale
  let trendFitRationale: string | undefined;
  if (context.hasTrendResearch && context.keyTrends.length > 0) {
    trendFitRationale = `Leverages current trend: "${context.keyTrends[0]}". ${context.keyTrends[1] ? `Also incorporates elements of "${context.keyTrends[1]}".` : ''}`;
  }

  // Build product truth notes
  const productTruthNotes: string[] = [];
  if (context.hasProductTruth && context.preservationRules.length > 0) {
    productTruthNotes.push(`Must preserve: ${context.preservationRules.slice(0, 2).join(', ')}`);
  }
  if (input.productTruth?.verifiedFacts.length) {
    productTruthNotes.push(`Key fact to feature: ${input.productTruth.verifiedFacts[0]}`);
  }

  // Suggest reference roles
  const suggestedReferenceRoles: CreativeConcept['suggestedReferenceRoles'] = [];
  for (const ref of input.availableReferences) {
    let role: ComposerReferenceRole = 'include';
    let instructions: string | undefined;

    if (ref.role === 'product') {
      role = 'product';
      instructions = context.preservationRules[0];
    } else if (ref.role === 'style') {
      role = 'style';
      instructions = 'Borrow visual language for this concept';
    }

    suggestedReferenceRoles.push({
      assetId: ref.assetId,
      role,
      instructions,
    });
  }

  // Source trend insights
  const sourceTrendInsightIds: string[] = [];
  if (input.trendResearch && index < input.trendResearch.insights.length) {
    sourceTrendInsightIds.push(input.trendResearch.insights[index].id);
  }

  return {
    id: crypto.randomUUID(),
    title: buildContextDerivedTitle(template, context, input, index),
    oneLineIdea: hook,
    visualDirection,
    negativePrompt: 'blurry, low quality, distorted, watermark, text overlay, deformed, oversaturated, plastic skin, wrong proportions, artificial looking',
    hook,
    brandFitRationale,
    trendFitRationale,
    productTruthNotes,
    suggestedReferenceRoles,
    sourceTrendInsightIds,
    status: 'candidate',
  };
}

function buildContextDerivedTitle(
  template: ConceptTemplate,
  context: AnalysisContext,
  input: ConceptGenerationInput,
  index: number,
): string {
  const productName = context.productName ?? 'Product';
  const trend = input.trendResearch?.insights[index]?.title ?? input.trendResearch?.insights[0]?.title;
  const principle = context.visualPrinciples[index] ?? context.visualPrinciples[0];
  const tone = context.brandTone[index] ?? context.brandTone[0];
  const angle = trend || principle || tone || input.userDirection.split(/\s+/).filter(word => word.length > 4)[index] || 'Distinctive';
  return `${angle}: ${productName}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function significantProductTokens(productName: string): string[] {
  const stop = new Set([
    'best', 'with', 'from', 'that', 'this', 'your', 'into', 'about', 'over', 'under',
    'canada', 'united', 'states', 'official', 'store', 'shop', 'home', 'page',
  ]);
  return productName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !stop.has(token));
}

export function validateConceptAgainstProductTruth(
  concept: CreativeConcept,
  productTruth?: ProductTruth,
): ValidationResult {
  if (!productTruth) return { valid: true };

  // Check if concept contradicts preservation rules
  const conceptText = `${concept.title} ${concept.oneLineIdea} ${concept.visualDirection}`.toLowerCase();

  for (const rule of productTruth.preservationRules) {
    const ruleWords = rule.toLowerCase().split(' ');
    // Check for explicit contradictions
    if (conceptText.includes('change') || conceptText.includes('different') || conceptText.includes('transform')) {
      // If the concept suggests changing something that should be preserved
      const keyTerm = ruleWords.find(w => w.length > 4);
      if (keyTerm && conceptText.includes(keyTerm)) {
        return {
          valid: false,
          reason: `Concept suggests changing "${rule}" which must be preserved`,
        };
      }
    }
  }

  // Soft product-name match: significant tokens (e.g. "matcha") are enough.
  // Full marketing titles like "Best Japanese Matcha in Canada" rarely appear verbatim.
  const productNameLower = productTruth.productName.toLowerCase();
  const nameTokens = significantProductTokens(productTruth.productName);
  const hasNameReference =
    conceptText.includes(productNameLower) ||
    nameTokens.some((token) => conceptText.includes(token));

  if (!hasNameReference && productTruth.verifiedFacts.length > 0) {
    const hasFactReference = productTruth.verifiedFacts.some((fact) => {
      const factTokens = significantProductTokens(fact);
      return factTokens.some((token) => conceptText.includes(token));
    });

    if (!hasFactReference) {
      return {
        valid: false,
        reason: 'Concept does not reference product name or verified facts',
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Concept Selection Helpers
// ---------------------------------------------------------------------------

/**
 * Get a concept by ID from an array.
 */
export function getConceptById(
  concepts: CreativeConcept[],
  id: string,
): CreativeConcept | undefined {
  return concepts.find(c => c.id === id);
}

/**
 * Get selected concept from an array.
 */
export function getSelectedConcept(
  concepts: CreativeConcept[],
): CreativeConcept | undefined {
  return concepts.find(c => c.status === 'selected');
}

/**
 * Get applicable concepts (non-rejected).
 */
export function getApplicableConcepts(
  concepts: CreativeConcept[],
): CreativeConcept[] {
  return concepts.filter(c => c.status !== 'rejected');
}
