export interface RegenerationCandidate {
  sceneIndex: number;
  passed: boolean;
  correctionPrompt: string;
}

export interface RegenerationPolicy {
  maxRetriesPerScene: number;
  attemptsByScene: Map<number, number>;
  exhaustedSceneIndexes: number[];
}

export const createRegenerationPolicy = (maxRetriesPerScene = 2): RegenerationPolicy => ({
  maxRetriesPerScene,
  attemptsByScene: new Map(),
  exhaustedSceneIndexes: [],
});

export const selectScenesForRegeneration = (
  policy: RegenerationPolicy,
  candidates: RegenerationCandidate[],
): RegenerationCandidate[] => candidates.filter((candidate) => {
  if (candidate.passed) return false;
  const attempts = policy.attemptsByScene.get(candidate.sceneIndex) || 0;
  if (attempts >= policy.maxRetriesPerScene) {
    if (!policy.exhaustedSceneIndexes.includes(candidate.sceneIndex)) policy.exhaustedSceneIndexes.push(candidate.sceneIndex);
    return false;
  }
  policy.attemptsByScene.set(candidate.sceneIndex, attempts + 1);
  return true;
});
