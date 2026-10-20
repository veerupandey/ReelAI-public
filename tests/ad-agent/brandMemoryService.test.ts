import { describe, expect, it } from 'vitest';
import { createTypedBrandMemory, proposeMemory, promoteMemoryProposal } from '../../services/adIntelligence/brandMemoryService';

describe('typed brand memory', () => {
  it('does not promote a single inferred preference into brand truth', () => {
    const memory = createTypedBrandMemory('matcha');
    const proposal = proposeMemory(memory, { type: 'approved_preference', statement: 'Prefer warm wood textures', source: 'user_feedback' });
    expect(() => promoteMemoryProposal(memory, proposal.id)).toThrow(/requires explicit approval or repeated evidence/);
  });

  it('promotes explicitly approved truth and repeated preferences', () => {
    const memory = createTypedBrandMemory('matcha');
    const truth = proposeMemory(memory, { type: 'immutable_truth', statement: 'Product is ceremonial matcha', source: 'product_page', explicitlyApproved: true });
    promoteMemoryProposal(memory, truth.id);
    const preference = proposeMemory(memory, { type: 'approved_preference', statement: 'Prefer warm wood textures', source: 'user_feedback' });
    proposeMemory(memory, { type: 'approved_preference', statement: 'Prefer warm wood textures', source: 'user_feedback' });
    promoteMemoryProposal(memory, preference.id);
    expect(memory.entries).toHaveLength(2);
  });
});
