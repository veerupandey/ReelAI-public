/**
 * Loop controller — owns goal card, plan, verify, stop rules.
 * Execution of media producers stays in AutonomousAgent; this module
 * decides *what* to do and when to stop / escalate.
 */
import { createGoalCard, formatGoalCardMarkdown, markGoalsPassed } from './goalCard';
import { classifyIntent, type IntentClassification } from './intentRouter';
import { persistGoalCard, persistLoopState } from './memoryManage';
import {
  applyEscalationContinue,
  applyProgress,
  evaluateStop,
  isEscalationReason,
} from './stopRules';
import { planTaskGraph } from './taskPlanner';
import type { DebateImage, DebateOutcome } from './plannerDebate';
import type { PlannerModelId } from '../siliconflow/planner';
import {
  DEFAULT_STOP_BUDGET,
  type GoalCard,
  type GoalItemId,
  type LoopRunState,
  type LoopTaskGraph,
  type StopBudget,
  type StopReason,
  type VerifyResult,
} from './types';
import { verifyAgainstSignals, type VerifySignals } from './verifier';

export interface LoopBootstrapResult {
  intent: IntentClassification;
  goalCard: GoalCard;
  taskGraph: LoopTaskGraph;
  state: LoopRunState;
  planModelId: string;
  usedTemplateOnly: boolean;
  goalCardMarkdown: string;
  taskGraphMarkdown: string;
  /** Gemini Pro's image-aware review of the Kimi draft, when it ran. */
  debate?: DebateOutcome<LoopTaskGraph>;
}

export function formatTaskGraphMarkdown(graph: LoopTaskGraph): string {
  const lines = [
    `## Loop plan · \`${graph.skillPath}\``,
    '',
    graph.summary,
    '',
    '**Stop criteria**',
    ...graph.stopCriteria.map((c) => `- ${c}`),
    '',
    '**Steps**',
    ...graph.steps.map((s, i) =>
      `${i + 1}. **${s.id}** — ${s.title}`
      + (s.producer ? ` · producer=\`${s.producer}\`` : '')
      + (s.tools.length ? `\n   tools: ${s.tools.join(', ')}` : '')
      + (s.advances.length ? `\n   advances: ${s.advances.join(', ')}` : ''),
    ),
  ];
  return lines.join('\n');
}

/**
 * Bootstrap the loop from a user goal: classify → goal card → Kimi plan.
 */
export async function bootstrapLoop(args: {
  prompt: string;
  adFormat?: string;
  referenceUploadCount?: number;
  plannerModel?: PlannerModelId;
  sessionDir?: string;
  brandSlug?: string;
  context?: string;
  budget?: Partial<StopBudget>;
  /** Resolved URL roles from the caller — prevents re-parsing the prompt. */
  productUrl?: string;
  referenceUrl?: string;
  /** Product + reference frames for the Gemini Pro planning review. */
  debateImages?: DebateImage[];
}): Promise<LoopBootstrapResult> {
  const intent = classifyIntent({
    prompt: args.prompt,
    adFormat: args.adFormat,
    referenceUploadCount: args.referenceUploadCount,
    productUrl: args.productUrl,
    referenceUrl: args.referenceUrl,
  });

  const goalCard = createGoalCard(args.prompt, intent.skillPath);
  const planned = await planTaskGraph({
    goal: args.prompt,
    skillPath: intent.skillPath,
    context: args.context,
    plannerModel: args.plannerModel,
    debateImages: args.debateImages,
  });

  const state: LoopRunState = {
    goalCard,
    taskGraph: planned.graph,
    stepIndex: 0,
    stepsExecuted: 0,
    spentUsd: 0,
    consecutiveNoProgress: 0,
    sessionDir: args.sessionDir,
    brandSlug: args.brandSlug,
  };

  if (args.sessionDir) {
    await persistGoalCard(args.sessionDir, goalCard);
    await persistLoopState(args.sessionDir, {
      skillPath: intent.skillPath,
      summary: planned.graph.summary,
      steps: planned.graph.steps.map((s) => s.id),
      brandSlug: args.brandSlug,
    });
  }

  return {
    intent,
    goalCard,
    taskGraph: planned.graph,
    state,
    planModelId: planned.modelId,
    usedTemplateOnly: planned.usedTemplateOnly,
    goalCardMarkdown: formatGoalCardMarkdown(goalCard),
    taskGraphMarkdown: formatTaskGraphMarkdown(planned.graph),
    debate: planned.debate,
  };
}

export function applyVerifyToState(
  state: LoopRunState,
  signals: VerifySignals,
  spentDeltaUsd = 0,
): { state: LoopRunState; result: VerifyResult; stop: ReturnType<typeof evaluateStop> } {
  const { card, result } = verifyAgainstSignals(state.goalCard, signals);
  let next: LoopRunState = {
    ...state,
    goalCard: card,
  };
  next = applyProgress(next, result.newlyPassed.length, spentDeltaUsd);
  const stop = evaluateStop({ state: next, budget: DEFAULT_STOP_BUDGET });
  if (stop.stop) {
    next = { ...next, stopReason: stop.reason };
  }
  return { state: next, result, stop };
}

export function advanceStep(state: LoopRunState): LoopRunState {
  const nextIndex = Math.min(state.stepIndex + 1, Math.max(0, state.taskGraph.steps.length - 1));
  return { ...state, stepIndex: nextIndex };
}

export function markManualGoals(
  state: LoopRunState,
  ids: GoalItemId[],
  evidence?: string,
): LoopRunState {
  return {
    ...state,
    goalCard: markGoalsPassed(state.goalCard, ids, evidence),
  };
}

export function shouldEscalate(reason?: StopReason): boolean {
  return isEscalationReason(reason);
}

export function continueAfterEscalate(state: LoopRunState): LoopRunState {
  return applyEscalationContinue(state);
}

export async function syncGoalCardToSession(state: LoopRunState): Promise<void> {
  if (!state.sessionDir) return;
  await persistGoalCard(state.sessionDir, state.goalCard);
}
