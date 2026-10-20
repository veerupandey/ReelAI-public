/**
 * Text LLM preferences for main planner + main agent.
 * Image generation stays on Gemini Flash Image (nano banana) separately.
 *
 * Transports:
 * - openai_compatible — chat/completions (GLM 5.3 Flash / z.ai, SiliconFlow, OpenAI, Codex, custom)
 * - gemini — Google GenAI SDK
 */

export type PlannerModelId =
  | 'glm_53_flash'
  | 'kimi_k3'
  | 'openai'
  | 'codex'
  | 'gemini_pro'
  /** @deprecated mapped to openai_compatible glm path */
  | 'anthropic';

/** Where the browser stores / resolves an API key. */
export type LlmKeySlot = 'zai' | 'siliconflow' | 'openai' | 'gemini';

/** Wire protocol used by the shell /llm/chat proxy. */
export type LlmTransport = 'openai_compatible' | 'gemini';

export const DEFAULT_PLANNER_MODEL: PlannerModelId = 'gemini_pro';
export const FALLBACK_PLANNER_MODEL: PlannerModelId = 'gemini_pro';

export const PLANNER_MODEL_IDS: readonly PlannerModelId[] = [
  'glm_53_flash',
  'kimi_k3',
  'openai',
  'codex',
  'gemini_pro',
] as const;

const LEGACY_ALIASES: Record<string, PlannerModelId> = {
  anthropic: 'openai', // dropped as first-class; nearest chat option
  glm_52: 'glm_53_flash', // renamed default when GLM 5.3 Flash replaced GLM 5.2
};

export function isPlannerModelId(value: unknown): value is PlannerModelId {
  return typeof value === 'string' && (PLANNER_MODEL_IDS as readonly string[]).includes(value);
}

export function coercePlannerModelId(
  raw: unknown,
  fallback: PlannerModelId = DEFAULT_PLANNER_MODEL,
): PlannerModelId {
  if (typeof raw !== 'string') return fallback;
  if (isPlannerModelId(raw)) return raw;
  return LEGACY_ALIASES[raw] || fallback;
}
