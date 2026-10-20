import { findEvidenceSupportingText, getIntendedUseEvidence, type EvidenceGraph } from './evidenceGraph';

export interface GateableCreativeScene {
  index: number;
  imagePrompt: string;
  voiceoverText: string;
  slideHeadline?: string;
  slideBody?: string;
}

export interface EvidenceGateIssue {
  sceneIndex: number;
  type: 'incorrect_use' | 'unsupported_claim';
  original: string;
  correction: string;
}

const riskyClaimPattern = /\b(cures?|treats?|prevents?|heals?|guarantees?|clinically proven|anxiety|depression|cancer|disease|weight loss|glowing skin|radiant skin|dewy skin)\b/i;
const incorrectUsePatterns = [
  /\b(apply|applying|rub|rubbing|massage|massaging)\b.{0,45}\b(face|skin)\b/i,
  /\b(drink|eat|swallow)\b.{0,45}\b(serum|soap|cleaner|moisturizer|sunscreen|perfume|lipstick)\b/i,
];

const replaceUnsupportedSentences = (text: string, graph: EvidenceGraph): { text: string; removed: string[] } => {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const removed: string[] = [];
  const kept = sentences.filter((sentence) => {
    if (!riskyClaimPattern.test(sentence)) return true;
    const supported = findEvidenceSupportingText(graph, sentence).length > 0;
    if (!supported) removed.push(sentence);
    return supported;
  });
  return { text: kept.join(' ').trim(), removed };
};

export const gateCreativeScenes = <T extends GateableCreativeScene>(
  scenes: T[],
  graph: EvidenceGraph,
): { approved: boolean; scenes: T[]; issues: EvidenceGateIssue[] } => {
  const issues: EvidenceGateIssue[] = [];
  const intendedUse = getIntendedUseEvidence(graph)[0]?.text || 'Show the product without depicting an unverified use.';

  const gated = scenes.map((scene) => {
    let imagePrompt = scene.imagePrompt;
    let voiceoverText = scene.voiceoverText;
    let slideHeadline = scene.slideHeadline;
    let slideBody = scene.slideBody;

    if (incorrectUsePatterns.some((pattern) => pattern.test(imagePrompt) || pattern.test(voiceoverText) || pattern.test(slideBody || ''))) {
      const original = `${imagePrompt} ${voiceoverText}`.trim();
      imagePrompt = `Preserve this scene's original composition, lighting, camera direction, and narrative role, but remove the incorrect product use entirely. Show the product used only according to this verified intended use: ${intendedUse}.`;
      voiceoverText = intendedUse;
      if (slideBody) slideBody = intendedUse;
      issues.push({ sceneIndex: scene.index, type: 'incorrect_use', original, correction: intendedUse });
    }

    for (const field of ['voiceoverText', 'slideHeadline', 'slideBody'] as const) {
      const current = field === 'voiceoverText' ? voiceoverText : field === 'slideHeadline' ? slideHeadline : slideBody;
      if (!current) continue;
      const result = replaceUnsupportedSentences(current, graph);
      if (result.removed.length) {
        issues.push({ sceneIndex: scene.index, type: 'unsupported_claim', original: result.removed.join(' '), correction: result.text || intendedUse });
        if (field === 'voiceoverText') voiceoverText = result.text || intendedUse;
        if (field === 'slideHeadline') slideHeadline = result.text || undefined;
        if (field === 'slideBody') slideBody = result.text || intendedUse;
      }
    }

    return { ...scene, imagePrompt, voiceoverText, slideHeadline, slideBody };
  });

  return { approved: issues.length === 0, scenes: gated, issues };
};
