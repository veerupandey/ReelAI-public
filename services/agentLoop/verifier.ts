/**
 * Separate verifier — maker never grades its own stop condition.
 * Deterministic checks first; optional LLM critic only for soft items.
 */
import { markGoalsPassed } from './goalCard';
import type { GoalCard, GoalItemId, VerifyResult } from './types';

export interface VerifySignals {
  hasReferenceAnalysis?: boolean;
  hasBrandProductLock?: boolean;
  hasScenePlan?: boolean;
  stillsApproved?: boolean;
  motionComplete?: boolean;
  stitched?: boolean;
  criticsPass?: boolean;
  delivered?: boolean;
  /** Extra failure messages from critics / evidence gate */
  failures?: string[];
  /** Actionable fix hints for the act loop */
  actionableFeedback?: string[];
}

const SIGNAL_TO_GOAL: Array<[keyof VerifySignals, GoalItemId]> = [
  ['hasReferenceAnalysis', 'reference_analyzed'],
  ['hasBrandProductLock', 'brand_product_locked'],
  ['hasScenePlan', 'scenes_planned'],
  ['stillsApproved', 'stills_approved'],
  ['motionComplete', 'motion_done'],
  ['stitched', 'stitched'],
  ['criticsPass', 'critics_pass'],
  ['delivered', 'delivered'],
];

/**
 * Apply observed pipeline signals to the goal card.
 * Only flips passes:false → true; never reverts.
 */
export function verifyAgainstSignals(
  card: GoalCard,
  signals: VerifySignals,
): { card: GoalCard; result: VerifyResult } {
  const newlyPassed: GoalItemId[] = [];
  for (const [key, goalId] of SIGNAL_TO_GOAL) {
    if (signals[key] === true) {
      const item = card.items.find((i) => i.id === goalId);
      if (item && !item.passes) newlyPassed.push(goalId);
    }
  }

  const next = newlyPassed.length
    ? markGoalsPassed(card, newlyPassed, 'Verified by harness signals')
    : card;

  const failures = [...(signals.failures || [])];
  const actionableFeedback = [...(signals.actionableFeedback || [])];

  // Soft rule: if critics explicitly failed, do not mark critics_pass
  if (signals.criticsPass === false) {
    const idx = newlyPassed.indexOf('critics_pass');
    if (idx >= 0) newlyPassed.splice(idx, 1);
  }

  const ok = failures.length === 0 && newlyPassed.length >= 0;
  return {
    card: next,
    result: {
      ok,
      newlyPassed,
      failures,
      actionableFeedback,
    },
  };
}

/** Build VerifySignals from AutonomousAgent phase milestones. */
export function signalsFromMilestones(m: {
  referenceAnalyzed?: boolean;
  productLocked?: boolean;
  scenesPlanned?: boolean;
  stillsApproved?: boolean;
  motionDone?: boolean;
  stitched?: boolean;
  criticsOk?: boolean;
  delivered?: boolean;
  criticFailures?: string[];
}): VerifySignals {
  return {
    hasReferenceAnalysis: m.referenceAnalyzed,
    hasBrandProductLock: m.productLocked,
    hasScenePlan: m.scenesPlanned,
    stillsApproved: m.stillsApproved,
    motionComplete: m.motionDone,
    stitched: m.stitched,
    criticsPass: m.criticsOk,
    delivered: m.delivered,
    failures: m.criticFailures,
    actionableFeedback: m.criticFailures,
  };
}
