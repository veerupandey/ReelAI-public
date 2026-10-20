/**
 * Stop rules — success | max steps | budget | no-progress → escalate.
 */
import { allRequiredPassed, passedCount } from './goalCard';
import {
  DEFAULT_STOP_BUDGET,
  type GoalCard,
  type LoopRunState,
  type StopBudget,
  type StopReason,
} from './types';

export function resolveEffectiveBudget(
  state: LoopRunState,
  budget?: Partial<StopBudget>,
): StopBudget {
  const base: StopBudget = { ...DEFAULT_STOP_BUDGET, ...budget };
  return {
    maxSteps: state.softMaxSteps ?? base.maxSteps,
    maxUsd: state.softMaxUsd ?? base.maxUsd,
    noProgressLimit: base.noProgressLimit,
  };
}

export function evaluateStop(args: {
  state: LoopRunState;
  budget?: Partial<StopBudget>;
  userStopped?: boolean;
}): { stop: boolean; reason?: StopReason; message: string } {
  const budget = resolveEffectiveBudget(args.state, args.budget);
  const { state } = args;

  if (args.userStopped) {
    return { stop: true, reason: 'stopped', message: 'Stopped by user.' };
  }

  if (allRequiredPassed(state.goalCard)) {
    return { stop: true, reason: 'success', message: 'All required goal checks passed.' };
  }

  if (state.stepsExecuted >= budget.maxSteps) {
    return {
      stop: true,
      reason: 'max_steps',
      message: `Hit max steps (${budget.maxSteps}). Escalating to human.`,
    };
  }

  if (state.spentUsd >= budget.maxUsd) {
    return {
      stop: true,
      reason: 'budget',
      message: `Hit spend budget ($${budget.maxUsd.toFixed(2)}). Escalating to human.`,
    };
  }

  if (state.consecutiveNoProgress >= budget.noProgressLimit) {
    return {
      stop: true,
      reason: 'no_progress',
      message: `No goal progress for ${budget.noProgressLimit} rounds. Escalating to human.`,
    };
  }

  const { passed, required } = passedCount(state.goalCard);
  return {
    stop: false,
    message: `Continue — ${passed}/${required} required checks; step ${state.stepsExecuted}/${budget.maxSteps}.`,
  };
}

/** HITL Continue: reset no-progress; one soft budget bump (+4 steps / +$5). */
export function applyEscalationContinue(state: LoopRunState): LoopRunState {
  const continues = state.escalationContinues || 0;
  if (continues >= 1) {
    return {
      ...state,
      consecutiveNoProgress: 0,
      stopReason: undefined,
    };
  }
  const eff = resolveEffectiveBudget(state);
  return {
    ...state,
    consecutiveNoProgress: 0,
    stopReason: undefined,
    escalationContinues: continues + 1,
    softMaxSteps: eff.maxSteps + 4,
    softMaxUsd: eff.maxUsd + 5,
  };
}

export function applyProgress(
  state: LoopRunState,
  newlyPassedCount: number,
  spentDeltaUsd = 0,
): LoopRunState {
  const consecutiveNoProgress = newlyPassedCount > 0
    ? 0
    : state.consecutiveNoProgress + 1;
  return {
    ...state,
    stepsExecuted: state.stepsExecuted + 1,
    spentUsd: state.spentUsd + Math.max(0, spentDeltaUsd),
    consecutiveNoProgress,
  };
}

export function isEscalationReason(reason?: StopReason): boolean {
  return reason === 'max_steps' || reason === 'budget' || reason === 'no_progress';
}

export function nextOpenGoalIds(card: GoalCard): string[] {
  return card.items.filter((i) => i.required && !i.passes).map((i) => i.id);
}
