/**
 * Trend Research Service — Phase 3 Implementation
 *
 * Performs grounded trend research with freshness tracking and applicability
 * assessment per architecture spec.
 */

import type {
  TrendResearchResult,
  TrendInsight,
  EvidenceSource,
  SocialPlatform,
  SocialObjective,
  BrandKnowledge,
  ProductTruth,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default validity window for trend research (14 days) */
export const DEFAULT_TREND_EXPIRY_DAYS = 14;

/** Maximum number of insights to return */
const MAX_INSIGHTS = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendResearchInput {
  /** The brand knowledge to base research on */
  brandKnowledge?: BrandKnowledge;
  /** Product context for applicability filtering */
  productTruth?: ProductTruth;
  /** User's creative direction */
  userQuery: string;
  /** Target platform */
  platform?: SocialPlatform;
  /** Campaign objective */
  objective?: SocialObjective;
  /** Maximum age of trends to consider (days) */
  maxAgeDays?: number;
}

export interface ResearchContext {
  brandName: string;
  brandTone: string[];
  visualPrinciples: string[];
  category?: string;
  productKeywords: string[];
}

export type TrendResearchProgress =
  | { stage: 'planning'; message: string }
  | { stage: 'researching'; message: string; sourcesFound: number }
  | { stage: 'analyzing'; message: string; insightsFound: number }
  | { stage: 'assessing'; message: string; applicableCount: number }
  | { stage: 'complete'; message: string };

export type TrendProgressCallback = (progress: TrendResearchProgress) => void;

// ---------------------------------------------------------------------------
// Query Planning
// ---------------------------------------------------------------------------

/**
 * Build research queries from context.
 * Creates multiple targeted queries for comprehensive coverage.
 * Keep each query short so Google Search grounding stays effective.
 */
function compactSearchSeed(userQuery: string, productName?: string): string {
  const product = (productName || '').trim();
  // Prefer a short product-led seed; fall back to a truncated user query.
  if (product) return product.slice(0, 80);
  const cleaned = userQuery
    .replace(/\s+/g, ' ')
    .replace(/LOCKED PRODUCT CONTEXT:[\s\S]*/i, '')
    .trim();
  return cleaned.slice(0, 120) || 'product photography';
}

function buildResearchQueries(input: TrendResearchInput): string[] {
  const queries: string[] = [];
  const year = new Date().getFullYear();
  const month = new Date().toLocaleString('en-US', { month: 'long' });
  const seed = compactSearchSeed(input.userQuery, input.productTruth?.productName);
  const brandName = input.brandKnowledge?.brandName.value;

  // Core recent visual trend query
  queries.push(`${seed} Instagram visual trends ${month} ${year}`);
  queries.push(`${seed} product photography trends ${year}`);

  // Platform-specific query
  if (input.platform) {
    const platformName = input.platform.replace(/_/g, ' ');
    queries.push(`${seed} ${platformName} creative trends ${year}`);
  }

  // Brand / category aesthetic query
  if (brandName && brandName !== 'Brand') {
    queries.push(`${brandName} ${seed} marketing visual trends ${year}`);
  } else if (input.brandKnowledge) {
    const tone = input.brandKnowledge.toneAttributes.map((t) => t.value).slice(0, 2).join(' ');
    if (tone) {
      queries.push(`${seed} ${tone} aesthetic trends ${year}`);
    }
  }

  // Objective-specific query
  if (input.objective) {
    const objectiveTerms: Record<SocialObjective, string> = {
      awareness: 'viral engaging content',
      engagement: 'interactive community content',
      conversion: 'persuasive marketing content',
      education: 'informative tutorial content',
    };
    queries.push(`${seed} ${objectiveTerms[input.objective]} trends ${year}`);
  }

  return [...new Set(queries)].slice(0, 4); // Cap to keep research fast + focused
}

// ---------------------------------------------------------------------------
// Multi-provider text research (GLM 5.3 Flash Coding Plan + Gemini fallback)
// ---------------------------------------------------------------------------

import { generateAppText } from '../../services/llm/appText';

/**
 * Perform grounded web research via GLM Web Search in Chat (default),
 * falling back to Gemini googleSearch through generateAppText.
 */
async function performGroundedResearch(
  query: string,
  context: ResearchContext,
): Promise<{ insights: Partial<TrendInsight>[]; sources: EvidenceSource[] }> {
  try {
    const brandContext = context.brandName !== 'Brand'
      ? `Brand context: ${context.brandName} with ${context.brandTone.join(', ')} tone.`
      : '';

    const now = new Date();
    const monthYear = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const prompt = `
You are a trend research expert with live web search. Research RECENT visual / photography / social-creative trends for: "${query}"

${brandContext}

CRITICAL RECENCY RULES:
- Focus on trends active in the last 3–6 months (as of ${monthYear}).
- Prefer Instagram / TikTok / Pinterest visual trends that are currently rising or peaking.
- Do NOT invent evergreen clichés (e.g. generic "flat lay", "golden hour") unless search evidence shows they are newly resurgent.
- Each insight must sound specific and current (name a motif, color story, composition trick, or cultural moment — not vague adjectives).

Find 2-4 specific, current visual/photography trends. For each trend:
1. Give it a clear, specific title
2. Describe what it looks like (composition, lighting, color, mood)
3. Rate brand fit (High/Medium/Low) based on: ${context.brandTone.join(', ') || 'general appeal'}
4. Note any risks (overused, declining, controversial)
5. Optionally note when it became popular (e.g. "Spring ${now.getFullYear()}")

Return ONLY JSON (no markdown fences, no prose outside JSON):
{
  "insights": [
    {
      "title": "Trend name",
      "description": "Visual description grounded in current search evidence",
      "brandFit": "High/Medium/Low",
      "risk": "Optional risk note",
      "recency": "When this trend rose / why it is current"
    }
  ]
}
`;

    const result = await generateAppText({
      prompt,
      webSearch: true,
      json: true,
      temperature: 0.4,
      maxTokens: 2048,
      role: 'plan',
    });

    const parsed = parseJsonLoose(result.content);
    const insights: Partial<TrendInsight>[] = (parsed?.insights || []).map((insight: any, idx: number) => ({
      id: `insight-${crypto.randomUUID().slice(0, 8)}`,
      title: insight.title || 'Untitled Trend',
      description: [insight.description, insight.recency].filter(Boolean).join(' — ') || '',
      applicability: `Brand fit: ${insight.brandFit || 'Medium'}`,
      risk: insight.risk || 'None noted',
      confidence: insight.brandFit === 'High' ? 0.8 : insight.brandFit === 'Medium' ? 0.6 : 0.4,
      sourceIds: [`source-${idx}`],
    }));

    if (insights.length === 0) {
      throw new Error('Trend research returned no parseable insights from grounded search');
    }

    const sources: EvidenceSource[] = [{
      id: 'source-0',
      label: `${result.actual === 'glm_53_flash' ? 'GLM Search' : 'Gemini Search'}: ${query.slice(0, 40)}...`,
      capturedAt: new Date().toISOString(),
    }];

    return { insights, sources };
  } catch (error) {
    console.warn('[trendResearchService] Research failed:', error);

    // Generate fallback insights based on query keywords
    const keywords = query.toLowerCase().split(' ').filter(w => w.length > 3);
    const category = keywords.find(k => ['skincare', 'beauty', 'makeup'].includes(k)) ? 'skincare' :
                     keywords.find(k => ['matcha', 'tea', 'coffee', 'drink'].includes(k)) ? 'beverage' :
                     keywords.find(k => ['fashion', 'clothing', 'style'].includes(k)) ? 'fashion' : 'product';

    const fallbackInsights: Partial<TrendInsight>[] = [
      {
        id: `fallback-1-${crypto.randomUUID().slice(0, 8)}`,
        title: `${category === 'skincare' ? 'Glow' : category === 'beverage' ? 'Ritual' : 'Lifestyle'} Aesthetic`,
        description: `Clean, ${category === 'skincare' ? 'dewy' : category === 'beverage' ? 'organic' : 'minimal'} visual style with natural lighting and soft shadows. Focus on texture and quality details.`,
        applicability: `Brand fit: High`,
        risk: 'Generic trend - add brand-specific elements',
        confidence: 0.6,
        sourceIds: ['fallback-source'],
      },
      {
        id: `fallback-2-${crypto.randomUUID().slice(0, 8)}`,
        title: 'Flat Lay Product Focus',
        description: 'Overhead product shots on textured surfaces with complementary props. Emphasizes product detail and craftsmanship.',
        applicability: `Brand fit: Medium`,
        risk: 'Common approach - consider unique angles',
        confidence: 0.5,
        sourceIds: ['fallback-source'],
      },
    ];

    return {
      insights: fallbackInsights,
      sources: [{
        id: 'fallback-source',
        label: `Trend analysis: ${query.slice(0, 40)}...`,
        capturedAt: new Date().toISOString(),
      }],
    };
  }
}

function getGeminiApiKey(): string {
  // Kept for any residual Gemini-only callers in this module.
  const viteKey = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY)
    : undefined;
  const windowKey = typeof window !== 'undefined'
    ? ((window as any).ENV?.VITE_GEMINI_API_KEY || (window as any).ENV?.VITE_API_KEY || (window as any).ENV?.GEMINI_API_KEY)
    : undefined;
  const key = viteKey || windowKey || '';
  if (!key) {
    console.warn('[trendResearchService] No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local and restart dev server');
  }
  return key;
}

function parseJsonLoose(text: string): any {
  try {
    const clean = (text || '{}').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(clean);
    } catch {
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(clean.slice(start, end + 1));
      }
      return {};
    }
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Applicability Assessment
// ---------------------------------------------------------------------------

/**
 * Score how applicable a trend is to the brand/product context.
 * Returns 0-1 score with reasoning.
 */
function assessApplicability(
  insight: Partial<TrendInsight>,
  context: ResearchContext,
): { score: number; reasoning: string; risk: string } {
  const brandKeywords = [
    ...context.brandTone,
    ...context.visualPrinciples,
    ...context.productKeywords,
  ].map(k => k.toLowerCase());

  const insightText = `${insight.title} ${insight.description}`.toLowerCase();

  // Check for conflicts with brand values
  const conflicts: string[] = [];

  // Check for alignment opportunities
  const alignments: string[] = [];
  for (const keyword of brandKeywords) {
    if (insightText.includes(keyword.toLowerCase())) {
      alignments.push(keyword);
    }
  }

  // Calculate base score
  let score = 0.5; // Neutral starting point

  // Boost for brand alignment
  if (alignments.length > 0) {
    score += Math.min(0.3, alignments.length * 0.1);
  }

  // Penalty for conflicts
  if (conflicts.length > 0) {
    score -= Math.min(0.4, conflicts.length * 0.2);
  }

  // Clamp to 0-1
  score = Math.max(0, Math.min(1, score));

  // Generate reasoning
  let reasoning: string;
  if (score >= 0.7) {
    reasoning = `Strong brand alignment: ${alignments.slice(0, 3).join(', ')}`;
  } else if (score >= 0.5) {
    reasoning = 'Moderate applicability with some brand synergies';
  } else {
    reasoning = 'Limited brand fit; may require significant adaptation';
  }

  // Risk assessment
  let risk: string;
  if (score < 0.4) {
    risk = 'High risk of appearing inauthentic or off-brand';
  } else if (score > 0.8) {
    risk = 'Low risk; natural brand fit';
  } else {
    risk = 'Moderate risk; careful execution needed';
  }

  return { score, reasoning, risk };
}

/**
 * Filter out trends that conflict with Product Truth.
 */
function checkProductTruthConflicts(
  insight: Partial<TrendInsight>,
  productTruth?: ProductTruth,
): { hasConflict: boolean; conflictReason?: string } {
  if (!productTruth) return { hasConflict: false };

  const insightText = `${insight.title} ${insight.description}`.toLowerCase();

  // Check against preservation rules
  for (const rule of productTruth.preservationRules) {
    // If the trend suggests changing something that must be preserved
    const ruleLower = rule.toLowerCase();
    if (insightText.includes('change') && insightText.includes(ruleLower)) {
      return {
        hasConflict: true,
        conflictReason: `Conflicts with preservation rule: "${rule}"`,
      };
    }
  }

  // Check against verified facts
  for (const fact of productTruth.verifiedFacts) {
    const factLower = fact.toLowerCase();
    // If trend contradicts a verified fact
    const contradictionTerms = ['not', 'never', 'false', 'myth'];
    if (contradictionTerms.some(t => insightText.includes(t)) &&
        insightText.includes(factLower.split(' ')[0])) {
      return {
        hasConflict: true,
        conflictReason: `May contradict verified fact: "${fact}"`,
      };
    }
  }

  return { hasConflict: false };
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

export interface TrendResearchOutput {
  result: TrendResearchResult;
  applicableCount: number;
  rejectedCount: number;
  warnings: string[];
}

/**
 * Main entry point: Research trends for a brand/product context.
 */
export async function researchTrends(
  input: TrendResearchInput,
  onProgress?: TrendProgressCallback,
): Promise<TrendResearchOutput> {
  const warnings: string[] = [];

  // Build research context
  const context: ResearchContext = {
    brandName: input.brandKnowledge?.brandName.value ?? 'Brand',
    brandTone: input.brandKnowledge?.toneAttributes.map(t => t.value) ?? [],
    visualPrinciples: input.brandKnowledge?.visualPrinciples.map(p => p.value) ?? [],
    productKeywords: input.productTruth?.verifiedFacts ?? [],
  };

  // Stage 1: Query planning
  onProgress?.({
    stage: 'planning',
    message: 'Planning research queries...',
  });

  const queries = buildResearchQueries(input);

  // Stage 2: Grounded research
  onProgress?.({
    stage: 'researching',
    message: `Researching ${queries.length} queries...`,
    sourcesFound: 0,
  });

  const allInsights: Partial<TrendInsight>[] = [];
  const allSources: EvidenceSource[] = [];

  for (const query of queries) {
    try {
      const { insights, sources } = await performGroundedResearch(query, context);
      allInsights.push(...insights);
      allSources.push(...sources);

      onProgress?.({
        stage: 'researching',
        message: `Found ${allSources.length} sources...`,
        sourcesFound: allSources.length,
      });
    } catch (err) {
      warnings.push(`Query failed: ${query.slice(0, 50)}...`);
    }
  }

  // Stage 3: Applicability assessment
  onProgress?.({
    stage: 'assessing',
    message: 'Assessing brand and product applicability...',
    applicableCount: 0,
  });

  const scoredInsights: TrendInsight[] = [];
  let rejectedCount = 0;

  for (const partial of allInsights) {
    // Check Product Truth conflicts
    const conflictCheck = checkProductTruthConflicts(partial, input.productTruth);

    if (conflictCheck.hasConflict) {
      rejectedCount++;
      warnings.push(`${partial.title}: ${conflictCheck.conflictReason}`);
      continue;
    }

    // Assess applicability
    const { score, reasoning, risk } = assessApplicability(partial, context);

    // Only include insights with some applicability
    if (score > 0.3) {
      scoredInsights.push({
        id: partial.id ?? crypto.randomUUID(),
        title: partial.title ?? 'Untitled Trend',
        description: partial.description ?? '',
        applicability: reasoning,
        risk,
        confidence: score,
        sourceIds: partial.sourceIds ?? [],
      });
    } else {
      rejectedCount++;
    }
  }

  // Sort by confidence
  scoredInsights.sort((a, b) => b.confidence - a.confidence);

  // Take top insights
  const topInsights = scoredInsights.slice(0, MAX_INSIGHTS);

  // Stage 4: Build result
  onProgress?.({
    stage: 'complete',
    message: `Research complete. Found ${topInsights.length} applicable trends.`,
  });

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + DEFAULT_TREND_EXPIRY_DAYS);

  const result: TrendResearchResult = {
    id: crypto.randomUUID(),
    brandKnowledgeId: input.brandKnowledge?.id,
    query: input.userQuery,
    platform: input.platform,
    objective: input.objective,
    researchedAt: new Date().toISOString(),
    expiresAt: expiryDate.toISOString(),
    sources: allSources,
    insights: topInsights,
  };

  return {
    result,
    applicableCount: topInsights.length,
    rejectedCount,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Expiry Checking
// ---------------------------------------------------------------------------

/**
 * Check if trend research has expired.
 */
export function isTrendResearchExpired(result: TrendResearchResult): boolean {
  return new Date() > new Date(result.expiresAt);
}

/**
 * Get days until expiry.
 */
export function getDaysUntilExpiry(result: TrendResearchResult): number {
  const diff = new Date(result.expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Get freshness status for display.
 */
export function getFreshnessStatus(result: TrendResearchResult): {
  status: 'fresh' | 'stale' | 'expired';
  message: string;
} {
  if (isTrendResearchExpired(result)) {
    return { status: 'expired', message: 'Research has expired' };
  }

  const daysLeft = getDaysUntilExpiry(result);
  if (daysLeft <= 3) {
    return { status: 'stale', message: `Expires in ${daysLeft} days` };
  }

  return { status: 'fresh', message: `Valid for ${daysLeft} more days` };
}
