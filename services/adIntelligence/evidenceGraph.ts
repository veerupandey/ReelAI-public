export type EvidenceNodeType = 'product' | 'product_fact' | 'approved_claim' | 'intended_use' | 'warning';
export type EvidenceEdgeType = 'supports' | 'applies_to' | 'contradicts' | 'derived_from';

export interface EvidenceNode {
  id: string;
  type: EvidenceNodeType;
  text: string;
  sourceUrl: string;
  capturedAt: string;
  confidence: number;
}

export interface EvidenceEdge {
  from: string;
  to: string;
  type: EvidenceEdgeType;
}

export interface EvidenceGraph {
  productNodeId: string;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const intendedUsePattern = /\b(use|apply|serve|drink|eat|take|mix|whisk|brew|wear|spray|wash|clean|light|read|write|feed|brush)\b/i;
const warningPattern = /\b(warning|caution|do not|avoid|not for|keep away|consult)\b/i;

export const buildEvidenceGraph = (input: {
  productUrl: string;
  productTitle: string;
  facts: string[];
}): EvidenceGraph => {
  const capturedAt = new Date().toISOString();
  const productNodeId = 'product-1';
  const productNode: EvidenceNode = {
    id: productNodeId,
    type: 'product',
    text: input.productTitle,
    sourceUrl: input.productUrl,
    capturedAt,
    confidence: 1,
  };
  const nodes: EvidenceNode[] = [productNode];
  const edges: EvidenceEdge[] = [];

  input.facts.forEach((fact, index) => {
    const factId = `product-fact-${index + 1}`;
    const factNode: EvidenceNode = {
      id: factId,
      type: warningPattern.test(fact) ? 'warning' : intendedUsePattern.test(fact) ? 'intended_use' : 'approved_claim',
      text: fact,
      sourceUrl: input.productUrl,
      capturedAt,
      confidence: .95,
    };
    nodes.push(factNode);
    edges.push({ from: factId, to: productNodeId, type: factNode.type === 'warning' ? 'contradicts' : 'supports' });
    if (factNode.type === 'intended_use') edges.push({ from: factId, to: productNodeId, type: 'applies_to' });
  });

  return { productNodeId, nodes, edges };
};

export const findEvidenceSupportingText = (graph: EvidenceGraph, text: string): EvidenceNode[] => {
  const words = normalize(text).split(' ').filter((word) => word.length > 3);
  if (!words.length) return [];
  return graph.nodes.filter((node) => {
    if (node.type === 'product') return false;
    const normalizedNode = normalize(node.text);
    const matches = words.filter((word) => normalizedNode.includes(word)).length;
    return matches / words.length >= .5;
  });
};

export const getIntendedUseEvidence = (graph: EvidenceGraph): EvidenceNode[] =>
  graph.nodes.filter((node) => node.type === 'intended_use');

export const formatEvidenceGraphForPrompt = (graph: EvidenceGraph): string => graph.nodes
  .filter((node) => node.type !== 'product')
  .map((node) => `- [${node.id}] ${node.type.replace(/_/g, ' ')}: ${node.text}`)
  .join('\n');
