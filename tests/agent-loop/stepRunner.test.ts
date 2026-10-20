import { describe, expect, it } from 'vitest';
import { createGoalCard } from '../../services/agentLoop/goalCard';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';
import {
  completeStepById,
  runStep,
  type StepHandler,
} from '../../services/agentLoop/stepRunner';
import type { LoopRunState } from '../../services/agentLoop/types';

function baseState(): LoopRunState {
  return {
    goalCard: createGoalCard('recreate', 'recreate_reference_video'),
    taskGraph: templateTaskGraph('recreate_reference_video', 'recreate'),
    stepIndex: 0,
    stepsExecuted: 0,
    spentUsd: 0,
    consecutiveNoProgress: 0,
  };
}

describe('stepRunner', () => {
  it('runs ingest then advances stepIndex and goal', async () => {
    const handlers: Record<string, StepHandler> = {
      ingest_ref: async () => ({ ok: true, evidence: 'captured 3 frames' }),
    };
    const { state, newlyPassed, result } = await runStep({
      state: baseState(),
      handlers,
      stepId: 'ingest_ref',
    });
    expect(result.ok).toBe(true);
    expect(newlyPassed).toContain('reference_analyzed');
    expect(state.stepIndex).toBeGreaterThan(0);
    expect(state.goalCard.items.find((i) => i.id === 'reference_analyzed')?.passes).toBe(true);
  });

  it('completeStepById marks advances without handler', () => {
    const { state, newlyPassed } = completeStepById(baseState(), 'stills', 'approved');
    expect(newlyPassed).toContain('stills_approved');
    expect(state.goalCard.items.find((i) => i.id === 'stills_approved')?.passes).toBe(true);
  });

  it('fails cleanly when handler missing', async () => {
    const { result } = await runStep({
      state: baseState(),
      handlers: {},
      stepId: 'ingest_ref',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No handler/);
  });
});
