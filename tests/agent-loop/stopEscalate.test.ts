import { describe, expect, it } from 'vitest';
import { createGoalCard, markGoalsPassed } from '../../services/agentLoop/goalCard';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';
import {
  applyEscalationContinue,
  evaluateStop,
  isEscalationReason,
} from '../../services/agentLoop/stopRules';
import type { LoopRunState } from '../../services/agentLoop/types';

function state(overrides: Partial<LoopRunState> = {}): LoopRunState {
  return {
    goalCard: createGoalCard('recreate', 'recreate_reference_video'),
    taskGraph: templateTaskGraph('recreate_reference_video', 'recreate'),
    stepIndex: 0,
    stepsExecuted: 0,
    spentUsd: 0,
    consecutiveNoProgress: 0,
    ...overrides,
  };
}

describe('stop escalate', () => {
  it('does not escalate on success', () => {
    const card = createGoalCard('g', 'recreate_reference_video');
    const ids = card.items.filter((i) => i.required).map((i) => i.id);
    const s = state({ goalCard: markGoalsPassed(card, ids) });
    const stop = evaluateStop({ state: s });
    expect(stop.reason).toBe('success');
    expect(isEscalationReason(stop.reason)).toBe(false);
  });

  it('escalates on no_progress / budget / max_steps', () => {
    expect(isEscalationReason('no_progress')).toBe(true);
    expect(isEscalationReason('budget')).toBe(true);
    expect(isEscalationReason('max_steps')).toBe(true);
  });

  it('Continue once bumps soft budget and resets no-progress', () => {
    const s = applyEscalationContinue(state({ consecutiveNoProgress: 3 }));
    expect(s.consecutiveNoProgress).toBe(0);
    expect(s.escalationContinues).toBe(1);
    expect(s.softMaxSteps).toBe(28);
    expect(s.softMaxUsd).toBe(20);
  });

  it('second Continue does not bump again', () => {
    let s = applyEscalationContinue(state({ consecutiveNoProgress: 3 }));
    const steps = s.softMaxSteps;
    s = applyEscalationContinue({ ...s, consecutiveNoProgress: 3 });
    expect(s.softMaxSteps).toBe(steps);
    expect(s.escalationContinues).toBe(1);
  });

  it('respects soft max steps after continue', () => {
    const s = applyEscalationContinue(state());
    const stop = evaluateStop({
      state: { ...s, stepsExecuted: 28 },
    });
    expect(stop.stop).toBe(true);
    expect(stop.reason).toBe('max_steps');
  });
});
