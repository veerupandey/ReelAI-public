/**
 * App-wide text generation for Text-to-Reel / Image Studio / Ad Agent text paths.
 * Default: GLM 5.3 Flash (z.ai Coding Plan) with optional Web Search in Chat.
 * Always falls back to Gemini (googleSearch when web research is needed).
 * Image generation stays on Gemini Flash Image elsewhere.
 */
import {
  planText,
  resolveDefaultPlannerModel,
  type LlmReasoningEffort,
  type PlannerModelId,
  type PlanTextResult,
} from '../siliconflow/planner';
import { resolveApiKeyForModel } from './apiKeys';
import { coercePlannerModelId, DEFAULT_PLANNER_MODEL } from './types';

export interface AppTextResult {
  content: string;
  /** GLM chain-of-thought when role=plan (or enableReasoning). */
  reasoning?: string;
  requested: PlannerModelId;
  actual: PlannerModelId;
  modelId: string;
  fallbackReason?: string;
}

export type AppTextRole = 'plan' | 'worker';

/**
 * Generate text via the configured multi-provider preference (default GLM 5.3 Flash).
 * - role `plan`: enables GLM deep thinking for agent/planner quality
 * - role `worker`: keeps thinking disabled for fast app helpers
 */
export async function generateAppText(args: {
  prompt: string;
  preferred?: PlannerModelId;
  apiKey?: string;
  /** Enable web research (GLM web_search tools, or Gemini googleSearch on fallback). */
  webSearch?: boolean;
  /** Ask the model for JSON-only output. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /**
   * `plan` enables GLM reasoning; `worker` keeps it off for speed.
   * Override with enableReasoning when needed.
   */
  role?: AppTextRole;
  /** Force GLM thinking on/off (overrides role default). */
  enableReasoning?: boolean;
  reasoningEffort?: LlmReasoningEffort;
}): Promise<AppTextResult> {
  const preferred = coercePlannerModelId(
    args.preferred ?? (await resolveDefaultPlannerModel()),
    DEFAULT_PLANNER_MODEL,
  );
  const enableReasoning = args.enableReasoning
    ?? (args.role === 'plan');
  const result: PlanTextResult = await planText({
    prompt: args.prompt,
    requested: preferred,
    apiKey: args.apiKey || resolveApiKeyForModel(preferred),
    webSearch: args.webSearch,
    json: args.json,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    enableReasoning,
    reasoningEffort: args.reasoningEffort || (enableReasoning ? 'high' : undefined),
  });
  return {
    content: result.content,
    reasoning: result.reasoning,
    requested: result.requested,
    actual: result.actual,
    modelId: result.modelId,
    fallbackReason: result.fallbackReason,
  };
}
