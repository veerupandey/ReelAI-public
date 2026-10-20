import { GoogleGenAI } from '@google/genai';
import { getIntendedUseEvidence, type EvidenceGraph } from './evidenceGraph';

export type VisualFailure =
  | 'missing_image'
  | 'incorrect_intended_use'
  | 'missing_product_grounding'
  | 'too_many_references'
  | 'scene_mismatch'
  | 'product_identity_drift'
  | 'label_integrity';

export interface VisualCriticInput {
  sceneIndex: number;
  imagePrompt: string;
  visualDescription: string;
  hasProductReference: boolean;
  generatedImageBase64?: string;
  evidenceGraph: EvidenceGraph;
  assignedReferenceCount: number;
  productReferenceBase64?: string;
}

export interface VisualCriticReview {
  sceneIndex: number;
  passed: boolean;
  score: number;
  failures: VisualFailure[];
  findings: string[];
  correctionPrompt: string;
}

const incorrectUsePattern = /\b(apply|applying|rub|rubbing|massage|massaging)\b.{0,50}\b(face|skin)\b/i;

export const reviewVisualSceneFallback = (input: VisualCriticInput): VisualCriticReview => {
  const failures: VisualFailure[] = [];
  const findings: string[] = [];
  const intendedUse = getIntendedUseEvidence(input.evidenceGraph)[0]?.text || 'Show the product exactly as intended.';
  const combined = `${input.imagePrompt} ${input.visualDescription}`;
  if (!input.generatedImageBase64) {
    failures.push('missing_image');
    findings.push('No generated image was available.');
  }
  if (incorrectUsePattern.test(combined) && !/\b(apply|skin|face)\b/i.test(intendedUse)) {
    failures.push('incorrect_intended_use');
    findings.push(`Visual direction conflicts with verified intended use: ${intendedUse}`);
  }
  if (input.hasProductReference && !input.productReferenceBase64 && !input.generatedImageBase64) {
    failures.push('missing_product_grounding');
    findings.push('Product scene lacks product identity grounding.');
  }
  if (input.assignedReferenceCount > 2) {
    failures.push('too_many_references');
    findings.push('More than two creative references were assigned alongside product grounding.');
  }
  const correctionPrompt = failures.length
    ? `Regenerate scene ${input.sceneIndex + 1}. Show only this verified intended use: ${intendedUse}. Preserve exact product identity and label. Follow the original scene purpose without unsupported outcomes.`
    : '';
  return {
    sceneIndex: input.sceneIndex,
    passed: failures.length === 0,
    score: Math.max(0, 1 - failures.length * .3),
    failures,
    findings,
    correctionPrompt,
  };
};

export const reviewVisualScene = async (input: VisualCriticInput): Promise<VisualCriticReview> => {
  const fallback = reviewVisualSceneFallback(input);
  if (!input.generatedImageBase64 || !import.meta.env.VITE_API_KEY) return fallback;
  try {
    const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ parts: [
        { text: `Review this generated advertising scene. Scene intent: ${input.imagePrompt}. Visual description: ${input.visualDescription}. Verified intended use: ${getIntendedUseEvidence(input.evidenceGraph).map((node) => node.text).join(' | ')}. Return JSON with passed, score 0-1, failures array, findings array, correctionPrompt. Fail incorrect product use, product identity drift, corrupted labels, or scene mismatch.` },
        { inlineData: { mimeType: 'image/png', data: input.generatedImageBase64 } },
        ...(input.productReferenceBase64 ? [{ inlineData: { mimeType: 'image/png', data: input.productReferenceBase64 } }] : []),
      ] }],
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(response.text || '{}');
    return {
      ...fallback,
      ...parsed,
      sceneIndex: input.sceneIndex,
      failures: [...new Set([...(fallback.failures || []), ...(parsed.failures || [])])] as VisualFailure[],
      findings: [...(fallback.findings || []), ...(parsed.findings || [])],
      passed: fallback.passed && parsed.passed !== false,
    };
  } catch {
    return fallback;
  }
};
