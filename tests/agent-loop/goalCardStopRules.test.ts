import { describe, expect, it } from 'vitest';
import {
  allRequiredPassed,
  createGoalCard,
  markGoalsPassed,
  passedCount,
} from '../../services/agentLoop/goalCard';
import { applyProgress, evaluateStop } from '../../services/agentLoop/stopRules';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';
import { verifyAgainstSignals } from '../../services/agentLoop/verifier';
import type { LoopRunState } from '../../services/agentLoop/types';

function baseState(overrides: Partial<LoopRunState> = {}): LoopRunState {
  const goalCard = createGoalCard('Recreate this reel for my brand', 'recreate_reference_video');
  const taskGraph = templateTaskGraph('recreate_reference_video', 'Recreate this reel');
  return {
    goalCard,
    taskGraph,
    stepIndex: 0,
    stepsExecuted: 0,
    spentUsd: 0,
    consecutiveNoProgress: 0,
    ...overrides,
  };
}

describe('goal card + stop rules', () => {
  it('starts with all passes false', () => {
    const card = createGoalCard('goal', 'recreate_reference_video');
    expect(card.items.every((i) => i.passes === false)).toBe(true);
    expect(allRequiredPassed(card)).toBe(false);
    expect(passedCount(card).passed).toBe(0);
  });

  it('verifier flips goal items from harness signals', () => {
    const card = createGoalCard('goal', 'recreate_reference_video');
    const { card: next, result } = verifyAgainstSignals(card, {
      hasReferenceAnalysis: true,
      hasBrandProductLock: true,
    });
    expect(result.newlyPassed).toContain('reference_analyzed');
    expect(result.newlyPassed).toContain('brand_product_locked');
    expect(next.items.find((i) => i.id === 'reference_analyzed')?.passes).toBe(true);
  });

  it('stops on success when all required items pass', () => {
    let state = baseState();
    const ids = state.goalCard.items.filter((i) => i.required).map((i) => i.id);
    state = {
      ...state,
      goalCard: markGoalsPassed(state.goalCard, ids, 'done'),
    };
    const stop = evaluateStop({ state });
    expect(stop.stop).toBe(true);
    expect(stop.reason).toBe('success');
  });

  it('stops on max steps', () => {
    const state = baseState({ stepsExecuted: 24 });
    const stop = evaluateStop({ state, budget: { maxSteps: 24, maxUsd: 99, noProgressLimit: 5 } });
    expect(stop.stop).toBe(true);
    expect(stop.reason).toBe('max_steps');
  });

  it('stops on budget', () => {
    const state = baseState({ spentUsd: 15 });
    const stop = evaluateStop({ state, budget: { maxSteps: 100, maxUsd: 15, noProgressLimit: 5 } });
    expect(stop.stop).toBe(true);
    expect(stop.reason).toBe('budget');
  });

  it('stops on no progress', () => {
    let state = baseState();
    state = applyProgress(state, 0);
    state = applyProgress(state, 0);
    state = applyProgress(state, 0);
    const stop = evaluateStop({ state, budget: { maxSteps: 100, maxUsd: 99, noProgressLimit: 3 } });
    expect(stop.stop).toBe(true);
    expect(stop.reason).toBe('no_progress');
  });

  it('resets no-progress counter when goals advance', () => {
    let state = baseState({ consecutiveNoProgress: 2 });
    state = applyProgress(state, 1);
    expect(state.consecutiveNoProgress).toBe(0);
  });
});
