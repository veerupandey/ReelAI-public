import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import type {
  BrandComplianceCategory,
  BrandComplianceCheck,
  BrandComplianceReport,
  BrandKnowledge,
  ProductTruth,
  SocialPostDraft,
  StudioAsset,
} from './types';

import { STUDIO_FLASH_MODEL } from './studioModels';

const COMPLIANCE_MODEL = STUDIO_FLASH_MODEL;

const CATEGORY_CONFIG: Array<{
  category: BrandComplianceCategory;
  label: string;
  weight: number;
}> = [
  { category: 'brand_colors', label: 'Brand colors', weight: 0.15 },
  { category: 'visual_style', label: 'Visual style', weight: 0.15 },
  { category: 'product_fidelity', label: 'Product fidelity', weight: 0.25 },
  { category: 'typography', label: 'Typography', weight: 0.1 },
  { category: 'claims', label: 'Claims & language', weight: 0.15 },
  { category: 'logo_treatment', label: 'Logo treatment', weight: 0.1 },
  {
    category: 'instagram_readability',
    label: 'Instagram readability',
    weight: 0.1,
  },
];

export interface BrandComplianceInput {
  asset: StudioAsset;
  brandKnowledge: BrandKnowledge;
  productTruth?: ProductTruth;
  socialPostDraft?: SocialPostDraft;
  referenceAssets?: StudioAsset[];
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

function accepted<T>(
  values: Array<{ value: T; status: string }> | undefined,
): T[] {
  return values
    ?.filter((item) => item.status !== 'rejected')
    .map((item) => item.value) ?? [];
}

export function buildBrandCompliancePrompt(
  input: Omit<BrandComplianceInput, 'asset' | 'referenceAssets'>,
): string {
  const brand = input.brandKnowledge;
  const fonts = accepted(brand.fonts).map((font) => font.family);
  const colors = accepted(brand.colors);
  const visualPrinciples = accepted(brand.visualPrinciples);
  const tone = accepted(brand.toneAttributes);
  const logoRules = accepted(brand.logoRules);
  const approvedLanguage = accepted(brand.approvedLanguage);
  const prohibitedLanguage = accepted(brand.prohibitedLanguage);
  const imageStyle = [
    ...accepted(brand.imageStyle.lighting),
    ...accepted(brand.imageStyle.composition),
    ...accepted(brand.imageStyle.backgrounds),
    ...accepted(brand.imageStyle.textures),
  ];

  return `You are a strict senior brand quality reviewer for Instagram creative.

IMAGE ORDER:
- Image 1 is the generated creative to evaluate.
- Any following images are locked product/reference images. Compare product identity, packaging, label, colors, proportions, and recognizable details against them.

BRAND:
- Name: ${brand.brandName.value}
- Colors: ${colors.join(', ') || 'not specified'}
- Fonts: ${fonts.join(', ') || 'not specified'}
- Visual principles: ${visualPrinciples.join('; ') || 'not specified'}
- Tone: ${tone.join(', ') || 'not specified'}
- Image style: ${imageStyle.join('; ') || 'not specified'}
- Logo rules: ${logoRules.join('; ') || 'not specified'}
- Approved language: ${approvedLanguage.join('; ') || 'not specified'}
- Prohibited language: ${prohibitedLanguage.join('; ') || 'none specified'}

PRODUCT TRUTH:
- Product: ${input.productTruth?.productName || 'not specified'}
- Preservation rules: ${input.productTruth?.preservationRules.join('; ') || 'none specified'}
- Verified facts: ${input.productTruth?.verifiedFacts.join('; ') || 'none specified'}

SOCIAL COPY:
- Headline: ${input.socialPostDraft?.copy.headline || 'not provided'}
- Supporting: ${input.socialPostDraft?.copy.supportingText || 'not provided'}
- Caption: ${input.socialPostDraft?.copy.caption || 'not provided'}

Evaluate exactly these categories:
brand_colors, visual_style, product_fidelity, typography, claims, logo_treatment, instagram_readability.

For each category return a 0-100 score, concise finding grounded in visible evidence, and a concrete correction when score < 80. Do not invent a logo, text, or claim that is not visible. If a criterion has no usable evidence, score 60 and say evidence is insufficient.

Return JSON only:
{
  "summary": "one sentence",
  "checks": [
    {
      "category": "brand_colors",
      "score": 0,
      "finding": "visible evidence",
      "recommendation": "specific correction"
    }
  ]
}`;
}

function clampScore(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function statusForScore(score: number): BrandComplianceCheck['status'] {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
}

function overallStatus(
  score: number,
): BrandComplianceReport['status'] {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
}

export function normalizeComplianceResponse(
  raw: unknown,
  evaluatedAt = new Date().toISOString(),
): BrandComplianceReport {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as {
    summary?: unknown;
    checks?: unknown;
  };
  const rawChecks = Array.isArray(parsed.checks) ? parsed.checks : [];

  const checks = CATEGORY_CONFIG.map(({ category, label }) => {
    const candidate = rawChecks.find(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as { category?: unknown }).category === category,
    ) as
      | {
          score?: unknown;
          finding?: unknown;
          recommendation?: unknown;
        }
      | undefined;
    const score = clampScore(candidate?.score);
    return {
      category,
      label,
      score,
      status: statusForScore(score),
      finding:
        typeof candidate?.finding === 'string' && candidate.finding.trim()
          ? candidate.finding.trim()
          : 'Insufficient evidence to confirm compliance.',
      recommendation:
        typeof candidate?.recommendation === 'string' &&
        candidate.recommendation.trim()
          ? candidate.recommendation.trim()
          : undefined,
    } satisfies BrandComplianceCheck;
  });

  const score = Math.round(
    checks.reduce((sum, check) => {
      const weight =
        CATEGORY_CONFIG.find((config) => config.category === check.category)
          ?.weight ?? 0;
      return sum + check.score * weight;
    }, 0),
  );

  return {
    score,
    status: overallStatus(score),
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : 'Brand compliance review complete.',
    checks,
    evaluatedAt,
    evaluationMode: 'visual_ai',
  };
}

export function buildLimitedComplianceReport(
  reason = 'Visual compliance analysis was unavailable.',
): BrandComplianceReport {
  const checks = CATEGORY_CONFIG.map(({ category, label }) => ({
    category,
    label,
    score: 50,
    status: 'warning' as const,
    finding: 'Not visually verified.',
    recommendation: 'Review this item manually before publishing.',
  }));
  return {
    score: 50,
    status: 'warning',
    summary: `${reason} Manual review is recommended.`,
    checks,
    evaluatedAt: new Date().toISOString(),
    evaluationMode: 'limited',
  };
}

function parseResponse(response: GenerateContentResponse): unknown {
  const text = response.text || '{}';
  const clean = text.replace(/```json\s*|\s*```/g, '').trim();
  return JSON.parse(clean);
}

export async function evaluateBrandCompliance(
  input: BrandComplianceInput,
): Promise<BrandComplianceReport> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return buildLimitedComplianceReport('Gemini API key is unavailable.');
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [
      {
        inlineData: {
          mimeType: input.asset.mimeType,
          data: input.asset.base64,
        },
      },
    ];
    for (const reference of (input.referenceAssets ?? []).slice(0, 3)) {
      parts.push({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.base64,
        },
      });
    }
    parts.push({
      text: buildBrandCompliancePrompt({
        brandKnowledge: input.brandKnowledge,
        productTruth: input.productTruth,
        socialPostDraft: input.socialPostDraft,
      }),
    });

    const response = await ai.models.generateContent({
      model: COMPLIANCE_MODEL,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 3000,
      },
    } as any);

    return normalizeComplianceResponse(parseResponse(response));
  } catch (error) {
    console.warn('[brandComplianceService] Visual review failed:', error);
    return buildLimitedComplianceReport(
      error instanceof Error
        ? `Visual review failed: ${error.message}`
        : 'Visual review failed.',
    );
  }
}
