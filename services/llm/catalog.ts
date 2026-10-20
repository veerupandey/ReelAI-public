import type { LlmKeySlot, LlmTransport, PlannerModelId } from './types';
import { GEMINI_PLANNER_MODEL } from '../siliconflow/plannerModels';

export interface PlannerModelOption {
  id: Exclude<PlannerModelId, 'anthropic'>;
  label: string;
  description: string;
  transport: LlmTransport;
  /** Provider model id sent to the API. */
  modelId: string;
  /**
   * OpenAI-compatible base URL (no trailing slash), e.g. https://api.z.ai/api/coding/paas/v4
   * Unused for Gemini transport.
   */
  defaultBaseUrl?: string;
  keySlot: LlmKeySlot;
  needsApiKey: boolean;
  apiKeyHint?: string;
  baseUrlHint?: string;
}

/** Official OpenAI chat/completions base. */
export const OPENAI_COMPAT_OPENAI_BASE = 'https://api.openai.com/v1';
/** z.ai Coding Plan OpenAI-compatible endpoint (GLM subscription). */
export const OPENAI_COMPAT_ZAI_BASE = 'https://api.z.ai/api/coding/paas/v4';
/** SiliconFlow OpenAI-compatible. */
export const OPENAI_COMPAT_SILICONFLOW_BASE = 'https://api.siliconflow.com/v1';

/** Z.ai Web Search in Chat tool payload for GLM completions. */
export const GLM_WEB_SEARCH_TOOLS = [
  {
    type: 'web_search',
    web_search: {
      enable: true,
      search_result: true,
      search_engine: 'search-prime',
    },
  },
] as const;

export const PLANNER_MODEL_OPTIONS: readonly PlannerModelOption[] = [
  {
    id: 'glm_53_flash',
    label: 'GLM 5.3 Flash',
    description: 'Coding Plan · z.ai · default',
    transport: 'openai_compatible',
    modelId: 'glm-5.3-flash',
    defaultBaseUrl: OPENAI_COMPAT_ZAI_BASE,
    keySlot: 'zai',
    needsApiKey: true,
    apiKeyHint: 'z.ai Coding Plan API key (or ZAI_API_KEY on shell)',
    baseUrlHint: 'Coding Plan base URL',
  },
  {
    id: 'kimi_k3',
    label: 'SiliconFlow',
    description: 'OpenAI-compatible · Kimi-K3',
    transport: 'openai_compatible',
    modelId: 'moonshotai/Kimi-K3',
    defaultBaseUrl: OPENAI_COMPAT_SILICONFLOW_BASE,
    keySlot: 'siliconflow',
    needsApiKey: true,
    apiKeyHint: 'SiliconFlow API key (or SILICONFLOW_API_KEY on shell)',
    baseUrlHint: 'OpenAI-compatible base URL',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'gpt-5.2',
    transport: 'openai_compatible',
    modelId: 'gpt-5.2',
    defaultBaseUrl: OPENAI_COMPAT_OPENAI_BASE,
    keySlot: 'openai',
    needsApiKey: true,
    apiKeyHint: 'OpenAI API key (or OPENAI_API_KEY on shell)',
    baseUrlHint: 'OpenAI-compatible base URL',
  },
  {
    id: 'codex',
    label: 'Codex',
    description: 'gpt-5.1-codex · OpenAI',
    transport: 'openai_compatible',
    modelId: 'gpt-5.1-codex',
    defaultBaseUrl: OPENAI_COMPAT_OPENAI_BASE,
    keySlot: 'openai',
    needsApiKey: true,
    apiKeyHint: 'OpenAI API key (shared with OpenAI)',
    baseUrlHint: 'OpenAI-compatible base URL',
  },
  {
    id: 'gemini_pro',
    label: 'Gemini 3.8 Flash',
    description: GEMINI_PLANNER_MODEL,
    transport: 'gemini',
    modelId: GEMINI_PLANNER_MODEL,
    keySlot: 'gemini',
    needsApiKey: true,
    apiKeyHint: 'Optional override · otherwise uses app Gemini key',
  },
] as const;

export function getPlannerModelOption(id: PlannerModelId): PlannerModelOption {
  const normalized = id === 'anthropic' ? 'openai' : id;
  return PLANNER_MODEL_OPTIONS.find((o) => o.id === normalized) || PLANNER_MODEL_OPTIONS[0];
}

export function keySlotForPlannerModel(id: PlannerModelId): LlmKeySlot {
  return getPlannerModelOption(id).keySlot;
}
