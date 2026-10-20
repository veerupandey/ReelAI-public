/**
 * Agent Loop Runtime — shared types for plan → act → verify → stop.
 */

export type LoopSkillPath =
  | 'standard_stitched_video'
  | 'recreate_reference_video'
  | 'static_or_carousel'
  | 'open_ended_tools';

export type GoalItemId =
  | 'reference_analyzed'
  | 'brand_product_locked'
  | 'scenes_planned'
  | 'stills_approved'
  | 'motion_done'
  | 'stitched'
  | 'critics_pass'
  | 'delivered';

export interface GoalItem {
  id: GoalItemId;
  label: string;
  passes: boolean;
  evidence?: string;
  required: boolean;
}

export interface GoalCard {
  goal: string;
  skillPath: LoopSkillPath;
  items: GoalItem[];
  createdAt: number;
  updatedAt: number;
}

export interface LoopStep {
  id: string;
  title: string;
  /** Tool names preferred for this step */
  tools: string[];
  /** Goal items this step can flip to passes */
  advances: GoalItemId[];
  /** Optional producer hint */
  producer?: 'stills' | 'wan_i2v' | 'veo' | 'ken_burns' | 'ffmpeg_assemble' | 'reference_ingest' | 'structure_analysis';
}

export interface LoopTaskGraph {
  skillPath: LoopSkillPath;
  summary: string;
  steps: LoopStep[];
  stopCriteria: string[];
  estimatedLiveMotionScenes?: number;
  estimatedVeoScenes?: number;
}

export interface StopBudget {
  maxSteps: number;
  maxUsd: number;
  noProgressLimit: number;
}

export type StopReason =
  | 'success'
  | 'max_steps'
  | 'budget'
  | 'no_progress'
  | 'escalated'
  | 'stopped';

export interface VerifyResult {
  ok: boolean;
  newlyPassed: GoalItemId[];
  failures: string[];
  actionableFeedback: string[];
}

export interface LoopRunState {
  goalCard: GoalCard;
  taskGraph: LoopTaskGraph;
  stepIndex: number;
  stepsExecuted: number;
  spentUsd: number;
  consecutiveNoProgress: number;
  stopReason?: StopReason;
  sessionDir?: string;
  brandSlug?: string;
  /** Soft budget after HITL Continue (at most one bump per run). */
  softMaxSteps?: number;
  softMaxUsd?: number;
  /** Number of times user chose Continue on escalate (max 1). */
  escalationContinues?: number;
}

export interface ForgeDraft {
  forgeId: string;
  name: string;
  description: string;
  code: string;
  /** true = needs human approval (network/MCP/external) */
  requiresApproval: boolean;
  reason: string;
}

export type ModelRole =
  | 'plan'
  | 'hard_multimodal'
  | 'worker'
  | 'critic';

export const DEFAULT_STOP_BUDGET: StopBudget = {
  maxSteps: 24,
  maxUsd: 15,
  noProgressLimit: 3,
};
