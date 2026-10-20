import { describe, expect, it } from 'vitest';
import { createRegenerationPolicy, selectScenesForRegeneration } from '../../services/adIntelligence/regenerationPolicy';

describe('regenerationPolicy', () => {
  it('regenerates only failed scenes and caps retries', () => {
    const policy = createRegenerationPolicy(2);
    const first = selectScenesForRegeneration(policy, [
      { sceneIndex: 0, passed: false, correctionPrompt: 'fix scene 1' },
      { sceneIndex: 1, passed: true, correctionPrompt: '' },
    ]);
    expect(first.map((item) => item.sceneIndex)).toEqual([0]);

    selectScenesForRegeneration(policy, [{ sceneIndex: 0, passed: false, correctionPrompt: 'fix again' }]);
    const exhausted = selectScenesForRegeneration(policy, [{ sceneIndex: 0, passed: false, correctionPrompt: 'third fix' }]);
    expect(exhausted).toHaveLength(0);
    expect(policy.exhaustedSceneIndexes).toContain(0);
  });
});
