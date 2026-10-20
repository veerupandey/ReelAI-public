import { gradeIntelligenceCase, summarizeIntelligenceGrades, type IntelligenceEvalCase, type IntelligenceEvalOutput, type IntelligenceGrade } from '../../evals/ad-agent/rubric';

export interface IntelligenceEvalResult {
  caseCount: number;
  metrics: IntelligenceGrade;
  cases: Array<{ id: string; grade: IntelligenceGrade }>;
}

export const runIntelligenceEval = (
  cases: IntelligenceEvalCase[],
  execute: (item: IntelligenceEvalCase) => IntelligenceEvalOutput,
): IntelligenceEvalResult => {
  const results = cases.map((item) => ({ id: item.id, grade: gradeIntelligenceCase(item, execute(item)) }));
  return { caseCount: cases.length, metrics: summarizeIntelligenceGrades(results.map((result) => result.grade)), cases: results };
};
