import type { AdFormat, CampaignPlatform } from '../../types/brand';
import type { EvidenceGraph } from './evidenceGraph';
import type { CreativeConceptTerritory, ConceptScores, ConceptTerritory } from './conceptJudge';

const baseScores = (territory: ConceptTerritory): ConceptScores => ({
  evidenceCorrectness: .95,
  brandDistinctiveness: territory === 'product_led' ? .8 : .75,
  audienceRelevance: territory === 'audience_led' ? .9 : .75,
  platformNativeness: territory === 'culture_led' ? .9 : .75,
  clarity: .85,
  originality: territory === 'culture_led' ? .85 : .75,
  conversionPotential: territory === 'product_led' ? .85 : .8,
  productionFeasibility: .9,
});

export const generateFallbackConceptTerritories = (input: {
  productTitle: string;
  platform: CampaignPlatform;
  format: AdFormat;
  evidenceGraph: EvidenceGraph;
}): CreativeConceptTerritory[] => {
  const evidenceIds = input.evidenceGraph.nodes.filter((node) => node.type !== 'product').map((node) => node.id);
  const primaryFact = input.evidenceGraph.nodes.find((node) => node.type !== 'product')?.text || input.productTitle;
  const intendedUse = input.evidenceGraph.nodes.find((node) => node.type === 'intended_use')?.text || `Show ${input.productTitle} as intended.`;
  return [
    {
      id: 'product_led',
      territory: 'product_led',
      title: 'Proof In The Product',
      proposition: `${input.productTitle} stands apart through verified product truth: ${primaryFact}`,
      hook: `Start with the most distinctive verified product fact.`,
      narrativeDevice: 'Evidence reveal from product detail to intended use.',
      visualDirection: 'Product-led macro details, exact packaging, and credible demonstration.',
      evidenceIds,
      scores: baseScores('product_led'),
      hardFailures: [],
    },
    {
      id: 'audience_led',
      territory: 'audience_led',
      title: 'A Better Everyday Moment',
      proposition: `${input.productTitle} fits a real audience moment through its verified intended use.`,
      hook: `Open on a relatable moment before revealing the product.`,
      narrativeDevice: `Problem or desire to grounded ritual: ${intendedUse}`,
      visualDirection: 'Human-centered lifestyle scene with category-correct product use.',
      evidenceIds,
      scores: baseScores('audience_led'),
      hardFailures: [],
    },
    {
      id: 'culture_led',
      territory: 'culture_led',
      title: `${input.platform.replace(/_/g, ' ')} Native Discovery`,
      proposition: `Make ${input.productTitle} feel native to ${input.platform} without compromising product truth.`,
      hook: `Use a platform-native pattern interrupt grounded in a verified fact.`,
      narrativeDevice: `Native ${input.format} structure that turns discovery into action.`,
      visualDirection: 'Platform-native pacing and framing, with exact product identity preserved.',
      evidenceIds,
      scores: baseScores('culture_led'),
      hardFailures: [],
    },
  ];
};

export const validateConceptDistinctness = (concepts: CreativeConceptTerritory[]): {
  passed: boolean;
  duplicateFields: string[];
} => {
  const fields: Array<keyof Pick<CreativeConceptTerritory, 'territory' | 'proposition' | 'hook' | 'narrativeDevice' | 'visualDirection'>> =
    ['territory', 'proposition', 'hook', 'narrativeDevice', 'visualDirection'];
  const duplicateFields = fields.filter((field) => new Set(concepts.map((concept) => concept[field])).size !== concepts.length);
  return { passed: concepts.length === 3 && duplicateFields.length === 0, duplicateFields };
};
