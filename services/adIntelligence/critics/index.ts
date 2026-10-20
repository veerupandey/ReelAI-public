import { gateCreativeScenes, type GateableCreativeScene } from '../evidenceGate';
import type { EvidenceGraph } from '../evidenceGraph';
import type { NativePlannerSpec } from '../planners';

export type CriticType = 'evidence' | 'brand' | 'platform';

export interface CriticReview {
  critic: CriticType;
  passed: boolean;
  score: number;
  findings: string[];
  mandatoryFixes: string[];
}

export interface CriticCouncilInput {
  scenes: Array<GateableCreativeScene & { role: string }>;
  evidenceGraph: EvidenceGraph;
  plannerSpec: NativePlannerSpec;
  brandStyle: string;
  selectedConceptTitle: string;
  stage: 'planning' | 'pre_production';
}

const reviewEvidence = (input: CriticCouncilInput): CriticReview => {
  const gate = gateCreativeScenes(input.scenes, input.evidenceGraph);
  const findings = gate.issues.map((issue) => `${issue.type.replace(/_/g, ' ')} in scene ${issue.sceneIndex + 1}: ${issue.original}`);
  return {
    critic: 'evidence',
    passed: gate.approved,
    score: gate.approved ? 1 : Math.max(0, 1 - gate.issues.length / input.scenes.length),
    findings,
    mandatoryFixes: gate.issues.map((issue) => `Scene ${issue.sceneIndex + 1}: ${issue.correction}`),
  };
};

const reviewBrand = (input: CriticCouncilInput): CriticReview => {
  const combined = input.scenes.map((scene) => `${scene.imagePrompt} ${scene.slideHeadline || ''} ${scene.slideBody || ''}`).join(' ').toLowerCase();
  const styleTerms = input.brandStyle.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
  const styleMatches = styleTerms.filter((term) => combined.includes(term)).length;
  const genericBeautyDrift = /\b(vogue|beauty campaign|dewy skin|radiant skin|glowing skin)\b/.test(combined) &&
    !input.evidenceGraph.nodes.some((node) => /\b(skin|serum|beauty|moisturizer|sunscreen)\b/i.test(node.text));
  const passed = !genericBeautyDrift;
  const findings = genericBeautyDrift ? ['Generic beauty visual language conflicts with the verified product category.'] : [];
  if (!styleMatches && input.brandStyle) findings.push(`Brand style "${input.brandStyle}" is not explicit in the scene direction.`);
  return {
    critic: 'brand',
    passed,
    score: passed ? styleMatches ? 1 : .75 : 0,
    findings,
    mandatoryFixes: genericBeautyDrift ? [`Remove generic beauty imagery and align scenes to ${input.brandStyle || input.selectedConceptTitle}.`] : [],
  };
};

const reviewPlatform = (input: CriticCouncilInput): CriticReview => {
  const combined = input.scenes.map((scene) => `${scene.imagePrompt} ${scene.slideHeadline || ''} ${scene.slideBody || ''}`).join(' ').toLowerCase();
  const findings: string[] = [];
  const mandatoryFixes: string[] = [];
  if (input.scenes.length < input.plannerSpec.minScenes || input.scenes.length > input.plannerSpec.maxScenes) {
    findings.push(`Scene count ${input.scenes.length} is outside ${input.plannerSpec.minScenes}-${input.plannerSpec.maxScenes}.`);
    mandatoryFixes.push(`Use ${input.plannerSpec.minScenes}-${input.plannerSpec.maxScenes} scenes.`);
  }
  if (input.plannerSpec.format === 'carousel') {
    if (!/\b(swipe|swipe to|swipe for|tap|next|see more|keep going|scroll)\b/i.test(combined)) {
      // Soft finding only — AI planners rarely include the literal word "swipe" but the
      // slide structure already implies swipe behaviour. Do NOT block generation for this.
      findings.push('Consider adding an explicit swipe incentive to slide one (e.g. "Swipe to see more →").');
      // NOT added to mandatoryFixes — this is advisory only.
    }
    const lastScene = input.scenes[input.scenes.length - 1];
    if (!lastScene || (lastScene.role !== 'cta' && !/\b(try|shop|discover|learn|start|get|order|buy|grab)\b/i.test(`${lastScene.slideHeadline || ''} ${lastScene.slideBody || ''}`))) {
      findings.push('Carousel lacks a final CTA.');
      mandatoryFixes.push('Add a clear CTA to the final slide.');
    }
  }
  return {
    critic: 'platform',
    passed: mandatoryFixes.length === 0,
    score: mandatoryFixes.length === 0 ? 1 : Math.max(0, 1 - mandatoryFixes.length / input.plannerSpec.requiredElements.length),
    findings,
    mandatoryFixes,
  };
};

export const runCriticCouncil = (input: CriticCouncilInput): {
  passed: boolean;
  reviews: CriticReview[];
  mandatoryFixes: string[];
  averageScore: number;
} => {
  const reviews = [reviewEvidence(input), reviewBrand(input), reviewPlatform(input)];
  const mandatoryFixes = reviews.flatMap((review) => review.mandatoryFixes);
  return {
    passed: reviews.every((review) => review.passed),
    reviews,
    mandatoryFixes,
    averageScore: reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length,
  };
};
