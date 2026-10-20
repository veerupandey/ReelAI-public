import { describe, expect, it } from 'vitest';
import { shouldProposeForgeAfterRepair } from '../../services/agentLoop/forgeOnFail';

describe('shouldProposeForgeAfterRepair', () => {
  it('does not propose when repair succeeded', () => {
    expect(shouldProposeForgeAfterRepair({
      repairSucceeded: true,
      repairAttempts: 2,
    })).toBe(false);
  });

  it('proposes after 2 failed attempts', () => {
    expect(shouldProposeForgeAfterRepair({
      repairSucceeded: false,
      repairAttempts: 2,
    })).toBe(true);
  });

  it('does not propose after only one attempt', () => {
    expect(shouldProposeForgeAfterRepair({
      repairSucceeded: false,
      repairAttempts: 1,
    })).toBe(false);
  });

  it('does not propose twice for the same goal', () => {
    expect(shouldProposeForgeAfterRepair({
      repairSucceeded: false,
      repairAttempts: 2,
      alreadyForgedThisGoal: true,
    })).toBe(false);
  });
});
