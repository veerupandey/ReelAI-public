/**
 * Step runner — advances TaskGraph steps and reports which goal ids each step advances.
 * Handlers are provided by AutonomousAgent (phase methods).
 */
import { markGoalsPassed } from './goalCard';
import type { GoalItemId, LoopRunState, LoopStep } from './types';

export type StepHandlerResult = {
  ok: boolean;
  evidence?: string;
  /** Override advances from the step definition */
  advances?: GoalItemId[];
  error?: string;
};

export type StepHandler = (step: LoopStep, state: LoopRunState) => Promise<StepHandlerResult>;

export interface StepRunResult {
  state: LoopRunState;
  step: LoopStep;
  result: StepHandlerResult;
  newlyPassed: GoalItemId[];
}

export function currentStep(state: LoopRunState): LoopStep | null {
  return state.taskGraph.steps[state.stepIndex] || null;
}

export function findStepIndex(state: LoopRunState, stepId: string): number {
  return state.taskGraph.steps.findIndex((s) => s.id === stepId);
}

/**
 * Run a single step by id (or current index), apply advances, bump stepIndex.
 */
export async function runStep(args: {
  state: LoopRunState;
  handlers: Record<string, StepHandler>;
  stepId?: string;
}): Promise<StepRunResult> {
  let state = args.state;
  const idx = args.stepId != null
    ? findStepIndex(state, args.stepId)
    : state.stepIndex;
  if (idx < 0 || idx >= state.taskGraph.steps.length) {
    const fake: LoopStep = {
      id: args.stepId || 'unknown',
      title: 'missing',
      tools: [],
      advances: [],
    };
    return {
      state,
      step: fake,
      result: { ok: false, error: `Step not found: ${args.stepId}` },
      newlyPassed: [],
    };
  }

  const step = state.taskGraph.steps[idx];
  state = { ...state, stepIndex: idx };
  const handler = args.handlers[step.id];
  if (!handler) {
    return {
      state,
      step,
      result: { ok: false, error: `No handler for step ${step.id}` },
      newlyPassed: [],
    };
  }

  const result = await handler(step, state);
  const advances = result.advances ?? step.advances;
  const newlyPassed: GoalItemId[] = [];
  if (result.ok && advances.length) {
    for (const id of advances) {
      const item = state.goalCard.items.find((i) => i.id === id);
      if (item && !item.passes) newlyPassed.push(id);
    }
    state = {
      ...state,
      goalCard: markGoalsPassed(state.goalCard, advances, result.evidence),
    };
  }

  // Advance to next step when successful
  if (result.ok) {
    state = {
      ...state,
      stepIndex: Math.min(idx + 1, state.taskGraph.steps.length - 1),
      stepsExecuted: state.stepsExecuted + 1,
    };
  }

  return { state, step, result, newlyPassed };
}

/** Mark a pipeline milestone as completing a named step (without re-running handler). */
export function completeStepById(
  state: LoopRunState,
  stepId: string,
  evidence?: string,
): { state: LoopRunState; newlyPassed: GoalItemId[] } {
  const idx = findStepIndex(state, stepId);
  if (idx < 0) return { state, newlyPassed: [] };
  const step = state.taskGraph.steps[idx];
  const newlyPassed: GoalItemId[] = [];
  for (const id of step.advances) {
    const item = state.goalCard.items.find((i) => i.id === id);
    if (item && !item.passes) newlyPassed.push(id);
  }
  let next: LoopRunState = {
    ...state,
    goalCard: markGoalsPassed(state.goalCard, step.advances, evidence),
    stepIndex: Math.min(idx + 1, state.taskGraph.steps.length - 1),
    stepsExecuted: state.stepsExecuted + 1,
  };
  return { state: next, newlyPassed };
}
