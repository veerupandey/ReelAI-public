/**
 * Strategist Brief — deterministic synthesis of brand, product, and trend research
 * into a readable plan before concept generation. Optional AI polish for wording.
 */
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type {
  BrandKnowledge,
  CreativeExecutionMode,
  ProductTruth,
  SocialObjective,
  SocialPlatform,
  StrategistBrief,
  TrendResearchResult,
} from './types';
import { STUDIO_RESEARCH_MODEL } from './studioModels';

const BRIEF_POLISH_MODEL = STUDIO_RESEARCH_MODEL;
const EXECUTION_MODES: CreativeExecutionMode[] = ['original', 'recreate', 'hybrid'];

export interface StrategistBriefInput {
  campaignGoal: string;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  productTruth?: ProductTruth;
  lockedProductContext?: string;
  platform?: SocialPlatform;
  objective?: SocialObjective;
}

export interface StrategistBriefResult {
  brief: StrategistBrief;
  warnings: string[];
}

export interface PolishStrategistBriefContext {
  brandKnowledge?: BrandKnowledge;
  productTruth?: ProductTruth;
  trendResearch?: TrendResearchResult;
  /** Force Google Search even when the brief already looks grounded */
  forceWebSearch?: boolean;
  /** Allow the model to change executionMode (default: preserve) */
  allowExecutionModeChange?: boolean;
}

/** Fields the polish model is allowed to rewrite. */
export interface StrategistBriefPolishPatch {
  summary?: string;
  creativeTerritories?: string[];
  brandFit?: string;
  productFit?: string;
  executionMode?: CreativeExecutionMode;
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
  return viteKey || windowKey || '';
}

function accepted<T>(values: Array<{ value: T; status: string }> | undefined): T[] {
  return values?.filter((item) => item.status !== 'rejected').map((item) => item.value) ?? [];
}

/** Infer recreate vs original vs hybrid from the campaign goal. */
export function detectExecutionMode(goal: string): CreativeExecutionMode {
  const text = goal.toLowerCase();
  const recreate = /\b(recreate|remake|adapt|reference|carousel|inspired by|based on)\b/.test(text);
  const original = /\b(original|from scratch|fresh|net[- ]?new|new concept)\b/.test(text);
  if (recreate && original) return 'hybrid';
  if (recreate) return 'recreate';
  if (original) return 'original';
  // Locked-image recreate workflows often omit those words — treat product-led goals neutrally as hybrid.
  return 'hybrid';
}

/** Normalize UI / model strings into a CreativeExecutionMode. */
export function normalizeExecutionMode(value: unknown): CreativeExecutionMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase() as CreativeExecutionMode;
  return EXECUTION_MODES.includes(normalized) ? normalized : undefined;
}

/** Parse territory text from comma- or newline-separated UI input. */
export function parseCreativeTerritoriesText(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatCreativeTerritoriesText(territories: string[]): string {
  return territories.join('\n');
}

function extractAudience(goal: string): string | undefined {
  const match = goal.match(
    /\b(?:for|to)\s+((?:busy\s+)?(?:women|men|parents|professionals|founders|creators|customers|shoppers)[^.,;]*)/i,
  );
  return match?.[1]?.trim();
}

/**
 * Build a Strategist Brief from existing structured research — no extra Gemini call.
 */
export function buildStrategistBriefFromResearch(
  input: StrategistBriefInput,
): StrategistBriefResult {
  const warnings: string[] = [];
  const brand = input.brandKnowledge;
  const truth = input.productTruth;
  const trends = input.trendResearch;
  const executionMode = detectExecutionMode(input.campaignGoal);
  const brandName = brand?.brandName.value;
  const productName = truth?.productName;

  if (!brand) warnings.push('No brand research — brief relies on product and goal context.');
  if (!truth) warnings.push('No product truth — preservation priorities may be incomplete.');
  if (!trends?.insights.length) warnings.push('No market insights — trend angles are limited.');

  const tone = accepted(brand?.toneAttributes);
  const visuals = accepted(brand?.visualPrinciples);
  const prohibited = accepted(brand?.prohibitedLanguage);
  const topInsights = [...(trends?.insights ?? [])]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const trendAngles = topInsights.map(
    (insight) => `${insight.title}: ${insight.description}`,
  );
  const preservationPriorities = [
    ...(truth?.preservationRules ?? []),
    ...(truth?.verifiedFacts.slice(0, 3).map((fact) => `Only claim: ${fact}`) ?? []),
  ];

  const creativeTerritories = [
    productName
      ? `Product-hero: lead with ${productName} identity and packaging fidelity`
      : 'Product-hero: lead with recognizable product identity',
    brandName
      ? `Brand-led: lean into ${brandName} tone${tone.length ? ` (${tone.slice(0, 2).join(', ')})` : ''}`
      : 'Brand-led: establish a clear, consistent voice',
    topInsights[0]
      ? `Trend-forward: explore “${topInsights[0].title}” without copying generic templates`
      : 'Trend-forward: use a timely visual format with brand-specific execution',
    executionMode === 'recreate'
      ? 'Recreate: keep reference structure/flow; change look, copy, and product treatment'
      : 'Proof-point: feature one verified product fact as the creative hook',
  ];

  const constraints = [
    ...prohibited.map((item) => `Avoid language: ${item}`),
    ...(truth?.unresolvedQuestions.slice(0, 3) ?? []),
    ...topInsights
      .filter((insight) => insight.risk && insight.risk.toLowerCase() !== 'none noted')
      .map((insight) => `Trend risk — ${insight.title}: ${insight.risk}`),
  ];

  const brandFit = brand
    ? [
        brandName,
        tone.length ? `Tone: ${tone.join(', ')}` : null,
        visuals.length ? `Visuals: ${visuals.slice(0, 3).join('; ')}` : null,
      ]
        .filter(Boolean)
        .join('. ')
    : 'Brand fit not researched yet — keep execution restrained and claim-safe.';

  const productFit = truth
    ? [
        `Product: ${truth.productName}`,
        truth.preservationRules.length
          ? `Preserve: ${truth.preservationRules.slice(0, 3).join('; ')}`
          : null,
        truth.verifiedFacts.length
          ? `Verified: ${truth.verifiedFacts.slice(0, 2).join('; ')}`
          : null,
      ]
        .filter(Boolean)
        .join('. ')
    : input.lockedProductContext
      ? `Locked product imagery analyzed for visual grounding. Formal product truth still incomplete.`
      : 'No locked product truth — concepts may be less product-faithful.';

  const modeLine =
    executionMode === 'recreate'
      ? 'Mode: recreate-with-variation — preserve structure, change execution.'
      : executionMode === 'original'
        ? 'Mode: original brand post — invent a fresh angle.'
        : 'Mode: hybrid — balance brand-new ideas with reference structure when helpful.';

  const summary = [
    input.campaignGoal.trim(),
    modeLine,
    brandName && `Brand: ${brandName}.`,
    productName && `Product: ${productName}.`,
    trendAngles[0] && `Lead trend angle: ${topInsights[0].title}.`,
    preservationPriorities[0] && `Top preservation: ${preservationPriorities[0]}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const brief: StrategistBrief = {
    id: crypto.randomUUID(),
    campaignGoal: input.campaignGoal.trim(),
    audience: extractAudience(input.campaignGoal),
    platform: input.platform,
    objective: input.objective,
    executionMode,
    summary,
    brandFit,
    productFit,
    trendAngles,
    preservationPriorities,
    creativeTerritories,
    constraints,
    openQuestions: truth?.unresolvedQuestions ?? [],
    brandKnowledgeId: brand?.id,
    trendResearchId: trends?.id,
    productTruthId: truth?.id,
    sourceInsightIds: topInsights.map((insight) => insight.id),
    createdAt: new Date().toISOString(),
  };

  return { brief, warnings };
}

/** Compact instruction block for Prompt Writer / concept generation. */
export function formatStrategistBriefForPrompt(brief: StrategistBrief): string {
  return [
    `Strategist brief (${brief.executionMode}):`,
    brief.summary,
    brief.creativeTerritories.length &&
      `Creative territories:\n${brief.creativeTerritories.map((t) => `- ${t}`).join('\n')}`,
    brief.preservationPriorities.length &&
      `Preservation priorities:\n${brief.preservationPriorities.map((t) => `- ${t}`).join('\n')}`,
    brief.constraints.length &&
      `Constraints:\n${brief.constraints.slice(0, 5).map((t) => `- ${t}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Prefer search when market context is thin; skip when the brief is already
 * grounded by brand/product/trend research IDs + angles.
 */
export function shouldUseBriefPolishSearch(
  brief: StrategistBrief,
  context?: PolishStrategistBriefContext,
): boolean {
  if (context?.forceWebSearch) return true;
  const hasLinkedResearch = Boolean(
    brief.brandKnowledgeId ||
      brief.productTruthId ||
      brief.trendResearchId ||
      context?.brandKnowledge ||
      context?.productTruth ||
      context?.trendResearch,
  );
  const hasTrendAngles = brief.trendAngles.length > 0;
  return !(hasLinkedResearch && hasTrendAngles);
}

function parseGeminiResponse(response: GenerateContentResponse): unknown {
  try {
    const text = response.text || '{}';
    const clean = text.replace(/```json\s*|\s*```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {};
  }
}

function asStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length ? items : undefined;
  }
  if (typeof value === 'string') {
    const items = parseCreativeTerritoriesText(value);
    return items.length ? items : undefined;
  }
  return undefined;
}

/** Parse model JSON into a safe polish patch (exported for tests). */
export function parseStrategistBriefPolish(raw: unknown): StrategistBriefPolishPatch {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const patch: StrategistBriefPolishPatch = {};

  if (typeof data.summary === 'string' && data.summary.trim()) {
    patch.summary = data.summary.trim();
  }
  if (typeof data.brandFit === 'string' && data.brandFit.trim()) {
    patch.brandFit = data.brandFit.trim();
  }
  if (typeof data.productFit === 'string' && data.productFit.trim()) {
    patch.productFit = data.productFit.trim();
  }

  const territories = asStringList(data.creativeTerritories);
  if (territories) patch.creativeTerritories = territories;

  const mode = normalizeExecutionMode(data.executionMode);
  if (mode) patch.executionMode = mode;

  return patch;
}

/**
 * Merge a polish patch into a brief while preserving identity fields.
 * By default executionMode, preservationPriorities, and sourceInsightIds stay put.
 */
export function applyStrategistBriefPolish(
  brief: StrategistBrief,
  patch: StrategistBriefPolishPatch,
  options?: { allowExecutionModeChange?: boolean },
): StrategistBrief {
  const next: StrategistBrief = {
    ...brief,
    summary: patch.summary?.trim() || brief.summary,
    brandFit: patch.brandFit?.trim() || brief.brandFit,
    productFit: patch.productFit?.trim() || brief.productFit,
    creativeTerritories:
      patch.creativeTerritories && patch.creativeTerritories.length > 0
        ? patch.creativeTerritories
        : brief.creativeTerritories,
    // Explicitly preserve grounding / identity
    id: brief.id,
    preservationPriorities: brief.preservationPriorities,
    sourceInsightIds: brief.sourceInsightIds,
    brandKnowledgeId: brief.brandKnowledgeId,
    trendResearchId: brief.trendResearchId,
    productTruthId: brief.productTruthId,
    createdAt: brief.createdAt,
    executionMode: brief.executionMode,
  };

  if (options?.allowExecutionModeChange && patch.executionMode) {
    next.executionMode = patch.executionMode;
  }

  const editNote = 'Polished with AI';
  next.userEdits = [...(brief.userEdits ?? []).filter((e) => e !== editNote), editNote];

  return next;
}

/**
 * AI polish for summary + territories + brand/product fit wording.
 * Uses STUDIO_RESEARCH_MODEL. Google Search stays on when market context is needed;
 * never silently falls back without search if tools were requested. Throws on failure.
 */
export async function polishStrategistBrief(
  brief: StrategistBrief,
  context?: PolishStrategistBriefContext,
): Promise<StrategistBrief> {
  const useSearch = shouldUseBriefPolishSearch(brief, context);
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key missing — cannot polish strategist brief.');
  }

  const brand = context?.brandKnowledge;
  const truth = context?.productTruth;
  const trends = context?.trendResearch;
  const allowModeChange = Boolean(context?.allowExecutionModeChange);

  const responseShape = allowModeChange
    ? `{
  "summary": "...",
  "creativeTerritories": ["...", "..."],
  "brandFit": "...",
  "productFit": "...",
  "executionMode": "original" | "recreate" | "hybrid"
}`
    : `{
  "summary": "...",
  "creativeTerritories": ["...", "..."],
  "brandFit": "...",
  "productFit": "..."
}`;

  const prompt = `You are a senior brand strategist polishing a creative brief for social image production.

Rewrite ONLY these fields for clarity and punch — keep the same strategic intent:
- summary (2–4 sentences, readable plan)
- creativeTerritories (3–5 short territory lines)
- brandFit (1–2 sentences)
- productFit (1–2 sentences)
${allowModeChange ? '- executionMode ("original" | "recreate" | "hybrid") if the goal clearly warrants a change' : '- Do NOT change executionMode'}

HARD RULES:
- Preserve product claims — only use verified facts already present
- Do not invent medical/performance claims
- Do not copy generic trend templates
- Keep preservation priorities unchanged (they are not in your output)

Current brief JSON:
${JSON.stringify(
  {
    campaignGoal: brief.campaignGoal,
    audience: brief.audience,
    platform: brief.platform,
    objective: brief.objective,
    executionMode: brief.executionMode,
    summary: brief.summary,
    brandFit: brief.brandFit,
    productFit: brief.productFit,
    trendAngles: brief.trendAngles,
    creativeTerritories: brief.creativeTerritories,
    constraints: brief.constraints.slice(0, 6),
    openQuestions: brief.openQuestions.slice(0, 4),
  },
  null,
  2,
)}

Extra grounding (optional):
Brand: ${brand?.brandName.value ?? 'n/a'}
Product: ${truth?.productName ?? 'n/a'}
Top trends: ${(trends?.insights ?? [])
    .slice(0, 3)
    .map((i) => i.title)
    .join('; ') || brief.trendAngles.slice(0, 2).join('; ') || 'n/a'}

Return JSON only:
${responseShape}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: BRIEF_POLISH_MODEL,
      tools: useSearch ? [{ googleSearch: {} }] : undefined,
      contents: { parts: [{ text: prompt }] },
      config: {
        // Grounded search can reject responseMimeType — ask for JSON in the prompt.
        ...(useSearch ? {} : { responseMimeType: 'application/json' }),
        maxOutputTokens: 2048,
      },
    } as any);

    const parsed = parseGeminiResponse(response);
    const patch = parseStrategistBriefPolish(parsed);
    if (!patch.summary && !patch.creativeTerritories && !patch.brandFit && !patch.productFit) {
      throw new Error('Brief polish returned empty content.');
    }

    return applyStrategistBriefPolish(brief, patch, {
      allowExecutionModeChange: allowModeChange,
    });
  } catch (error) {
    // Never silently drop search — surface failure when tools were requested.
    console.warn('[strategistBriefService] polishStrategistBrief failed:', error);
    throw error instanceof Error
      ? error
      : new Error('Strategist brief polish failed. Please try again.');
  }
}
