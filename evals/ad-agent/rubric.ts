import type { AdFormat } from '../../types/brand';

export interface IntelligenceEvalCase {
  id: string;
  prompt: string;
  expectedFormat: AdFormat;
  allowedUses: string[];
  forbiddenUses: string[];
  approvedClaims: string[];
  tags: string[];
}

export interface IntelligenceEvalOutput {
  adFormat: AdFormat;
  claims: string[];
  intendedUse: string;
  citations: string[];
  referencesPerScene: number[];
}

export interface IntelligenceGrade {
  formatAccuracy: number;
  intendedUseAccuracy: number;
  supportedClaimPrecision: number;
  citationCoverage: number;
  referenceLimitAccuracy: number;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const includesAny = (value: string, candidates: string[]) => {
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    if (normalizedValue.includes(normalizedCandidate)) return true;
    const words = normalizedCandidate.split(' ').filter((word) => word.length > 2);
    return words.length > 0 && words.every((word) => normalizedValue.includes(word));
  });
};

export const gradeIntelligenceCase = (
  evalCase: IntelligenceEvalCase,
  output: IntelligenceEvalOutput,
): IntelligenceGrade => {
  const supportedClaims = output.claims.filter((claim) => includesAny(claim, evalCase.approvedClaims));
  return {
    formatAccuracy: output.adFormat === evalCase.expectedFormat ? 1 : 0,
    intendedUseAccuracy: includesAny(output.intendedUse, evalCase.forbiddenUses) ? 0 : 1,
    supportedClaimPrecision: output.claims.length === 0 ? 1 : supportedClaims.length / output.claims.length,
    citationCoverage: output.claims.length === 0 ? 1 : Math.min(1, output.citations.length / output.claims.length),
    referenceLimitAccuracy: output.referencesPerScene.every((count) => count <= 3) ? 1 : 0,
  };
};

export const summarizeIntelligenceGrades = (grades: IntelligenceGrade[]): IntelligenceGrade => {
  const keys: Array<keyof IntelligenceGrade> = ['formatAccuracy', 'intendedUseAccuracy', 'supportedClaimPrecision', 'citationCoverage', 'referenceLimitAccuracy'];
  if (!grades.length) return Object.fromEntries(keys.map((key) => [key, 0])) as unknown as IntelligenceGrade;
  return Object.fromEntries(keys.map((key) => [key, grades.reduce((sum, grade) => sum + grade[key], 0) / grades.length])) as unknown as IntelligenceGrade;
};
