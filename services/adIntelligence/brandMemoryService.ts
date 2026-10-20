export type TypedMemoryType = 'immutable_truth' | 'approved_preference' | 'rejected_direction' | 'performance_signal';

export interface TypedMemoryProposal {
  id: string;
  type: TypedMemoryType;
  statement: string;
  source: string;
  explicitlyApproved: boolean;
  evidenceCount: number;
}

export interface TypedMemoryEntry extends TypedMemoryProposal {
  promotedAt: string;
}

export interface TypedBrandMemory {
  brandSlug: string;
  proposals: TypedMemoryProposal[];
  entries: TypedMemoryEntry[];
}

const proposalId = () => `memory_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const createTypedBrandMemory = (brandSlug: string): TypedBrandMemory => ({ brandSlug, proposals: [], entries: [] });

export const proposeMemory = (
  memory: TypedBrandMemory,
  input: { type: TypedMemoryType; statement: string; source: string; explicitlyApproved?: boolean },
): TypedMemoryProposal => {
  const matching = memory.proposals.filter((proposal) => proposal.type === input.type && proposal.statement === input.statement);
  matching.forEach((proposal) => { proposal.evidenceCount += 1; });
  const proposal: TypedMemoryProposal = {
    id: proposalId(),
    type: input.type,
    statement: input.statement,
    source: input.source,
    explicitlyApproved: input.explicitlyApproved || false,
    evidenceCount: matching.length + 1,
  };
  memory.proposals.push(proposal);
  return proposal;
};

export const promoteMemoryProposal = (memory: TypedBrandMemory, proposalIdToPromote: string): TypedMemoryEntry => {
  const proposal = memory.proposals.find((item) => item.id === proposalIdToPromote);
  if (!proposal) throw new Error('Memory proposal not found.');
  const repeatedEvidence = memory.proposals.filter((item) => item.type === proposal.type && item.statement === proposal.statement).length >= 2;
  if (!proposal.explicitlyApproved && !repeatedEvidence) {
    throw new Error('Memory promotion requires explicit approval or repeated evidence.');
  }
  const entry = { ...proposal, promotedAt: new Date().toISOString() };
  memory.entries.push(entry);
  return entry;
};
