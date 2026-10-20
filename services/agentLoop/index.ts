/**
 * Agent Loop Runtime — public exports.
 */
export * from './types';
export {
  createGoalCard,
  markGoalPassed,
  markGoalsPassed,
  allRequiredPassed,
  formatGoalCardMarkdown,
  serializeGoalCard,
  parseGoalCard,
  passedCount,
} from './goalCard';
export {
  modelForRole,
  routePlanText,
  routeGeminiText,
  routeGeminiVision,
  structureAnalysisRole,
  MAX_VISION_IMAGES,
  WORKER_MODEL,
  HARD_MULTIMODAL_MODEL,
  CRITIC_MODEL,
} from './modelRouter';
export type { VisionImage } from './modelRouter';
export {
  debateTaskGraph,
  debateScenePlan,
  debateTranscriptMarkdown,
  shouldRunPlannerDebate,
  shouldReviewTaskGraphAfterIngest,
} from './plannerDebate';
export type { DebateImage, DebateOutcome, DebateScene, SceneRevision } from './plannerDebate';
export { evaluateStop, applyProgress, isEscalationReason, nextOpenGoalIds } from './stopRules';
export { verifyAgainstSignals, signalsFromMilestones } from './verifier';
export type { VerifySignals } from './verifier';
export { classifyIntent, isRecreateReferenceIntent } from './intentRouter';
export type { IntentClassification } from './intentRouter';
export { templateTaskGraph, planTaskGraph } from './taskPlanner';
export {
  classifyForgeDraft,
  forgeRequiresApproval,
  forgeToolOnServer,
  hybridForgeTool,
  buildForgedPythonTool,
} from './toolForge';
export {
  consolidateMemoryEntries,
  retrieveMemoryForPhase,
  shouldWriteMemory,
  persistGoalCard,
  loadGoalCard,
  persistLoopState,
  goalCardPromptBlock,
} from './memoryManage';
export {
  bootstrapLoop,
  applyVerifyToState,
  advanceStep,
  markManualGoals,
  shouldEscalate,
  continueAfterEscalate,
  syncGoalCardToSession,
  formatTaskGraphMarkdown,
} from './loopController';
export type { LoopBootstrapResult } from './loopController';
export {
  planRecreatePath,
  recreatePathMarkdown,
  defaultMotionHint,
} from './recreateReferencePath';
export type { RecreatePathPlan, ReferenceIngestStrategy, SceneMotionHint } from './recreateReferencePath';
export {
  resolveReferenceUploadsForRecreate,
  executeRecreateIngest,
} from './recreateIngest';
export type { RecreateIngestAction } from './recreateIngest';
export {
  runStep,
  completeStepById,
  currentStep,
  findStepIndex,
} from './stepRunner';
export type { StepHandler, StepHandlerResult, StepRunResult } from './stepRunner';
export {
  shouldProposeForgeAfterRepair,
  proposeForgeScript,
  forgeAndRegisterRepairTool,
} from './forgeOnFail';
export {
  applyEscalationContinue,
  resolveEffectiveBudget,
} from './stopRules';
