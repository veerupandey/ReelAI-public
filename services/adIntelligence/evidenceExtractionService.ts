import { buildEvidenceGraph, type EvidenceGraph } from './evidenceGraph';

export const extractProductEvidence = (input: {
  productUrl: string;
  productTitle: string;
  facts: string[];
}): EvidenceGraph => buildEvidenceGraph(input);
