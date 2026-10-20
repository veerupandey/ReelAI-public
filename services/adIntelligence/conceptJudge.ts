export type ConceptTerritory = 'product_led' | 'audience_led' | 'culture_led';

export interface ConceptScores {
  evidenceCorrectness: number;
  brandDistinctiveness: number;
  audienceRelevance: number;
  platformNativeness: number;
  clarity: number;
  originality: number;
  conversionPotential: number;
  productionFeasibility: number;
}

export interface CreativeConceptTerritory {
  id: string;
  territory: ConceptTerritory;
  title: string;
  proposition: string;
  hook: string;
  narrativeDevice: string;
  visualDirection: string;
  evidenceIds: string[];
  scores: ConceptScores;
  hardFailures: string[];
}

export interface PairwiseComparison {
  a: string;
  b: string;
  winnerId: string;
  reason: string;
}

const averageScore = (concept: CreativeConceptTerritory) => {
  const values = Object.values(concept.scores);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const compare = (a: CreativeConceptTerritory, b: CreativeConceptTerritory): PairwiseComparison => {
  const aValid = a.hardFailures.length === 0;
  const bValid = b.hardFailures.length === 0;
  const winner = aValid !== bValid
    ? aValid ? a : b
    : averageScore(a) >= averageScore(b) ? a : b;
  return {
    a: a.id,
    b: b.id,
    winnerId: winner.id,
    reason: !aValid || !bValid
      ? `${winner.id} wins because hard evidence failures disqualify the alternative.`
      : `${winner.id} has the stronger fixed-rubric score.`,
  };
};

export const judgeConceptsPairwise = (concepts: CreativeConceptTerritory[]): {
  winner: CreativeConceptTerritory;
  comparisons: PairwiseComparison[];
  ranking: CreativeConceptTerritory[];
} => {
  if (!concepts.length) throw new Error('No concepts to judge.');
  const comparisons: PairwiseComparison[] = [];
  const wins = new Map(concepts.map((concept) => [concept.id, 0]));
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length; j++) {
      const result = compare(concepts[i], concepts[j]);
      comparisons.push(result);
      wins.set(result.winnerId, (wins.get(result.winnerId) || 0) + 1);
    }
  }
  const ranking = [...concepts].sort((a, b) =>
    (wins.get(b.id) || 0) - (wins.get(a.id) || 0) ||
    averageScore(b) - averageScore(a)
  );
  return { winner: ranking[0], comparisons, ranking };
};
