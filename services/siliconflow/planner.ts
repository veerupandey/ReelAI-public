/**
 * Main planner + main-agent text: OpenAI-compatible + Gemini fallback.
 * Default: GLM 5.3 Flash (z.ai Coding Plan). Images stay on Gemini Flash Image.
 */
import { GoogleGenAI } from '@google/genai';
import { GEMINI_PLANNER_MODEL } from './plannerModels';
import { getPlannerModelOption, GLM_WEB_SEARCH_TOOLS } from '../llm/catalog';
import {
  getStoredBaseUrl,
  getStoredModelOverride,
  getStoredPreferredPlannerModel,
  resolveApiKeyForModel,
} from '../llm/apiKeys';
import { llmChat, type LlmReasoningEffort } from '../llm/chatClient';
import {
  coercePlannerModelId,
  DEFAULT_PLANNER_MODEL,
  FALLBACK_PLANNER_MODEL,
  type PlannerModelId,
} from '../llm/types';

export type { PlannerModelId } from '../llm/types';
export { GEMINI_PLANNER_MODEL } from './plannerModels';
export {
  DEFAULT_PLANNER_MODEL,
  FALLBACK_PLANNER_MODEL,
  coercePlannerModelId,
  isPlannerModelId,
} from '../llm/types';
export { PLANNER_MODEL_OPTIONS, getPlannerModelOption } from '../llm/catalog';
export type { LlmReasoningEffort } from '../llm/chatClient';

export interface PlanTextResult {
  content: string;
  /** GLM chain-of-thought when thinking/reasoning was enabled. */
  reasoning?: string;
  requested: PlannerModelId;
  actual: PlannerModelId;
  modelId: string;
  fallbackReason?: string;
}

function getGeminiApiKey(override?: string): string {
  const fromUi = (override || '').trim();
  if (fromUi) return fromUi;
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '') : '')
    || ''
  ).trim();
}

async function geminiProText(
  prompt: string,
  apiKeyOverride?: string,
  opts?: { webSearch?: boolean; json?: boolean; temperature?: number },
): Promise<string> {
  const key = getGeminiApiKey(apiKeyOverride);
  if (!key) throw new Error('Gemini API key not configured for planner fallback');
  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model: GEMINI_PLANNER_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    ...(opts?.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
    config: {
      maxOutputTokens: 8192,
      abortSignal: AbortSignal.timeout(90_000),
      ...(opts?.json ? { responseMimeType: 'application/json' as const } : {}),
    },
  } as any);
  const text = (res.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim() || String(res.text || '').trim();
  if (!text) throw new Error('Gemini planner returned empty content');
  return text;
}

/**
 * Default planner/agent text model: explicit preference → stored UI choice → Gemini Flash.
 */
export async function resolveDefaultPlannerModel(
  preferred?: PlannerModelId,
): Promise<PlannerModelId> {
  if (preferred) return coercePlannerModelId(preferred);
  const stored = getStoredPreferredPlannerModel();
  if (stored) return stored;
  return DEFAULT_PLANNER_MODEL;
}

function keyEnvForSlot(slot: string): 'zai' | 'siliconflow' | 'openai' | undefined {
  if (slot === 'zai' || slot === 'siliconflow' || slot === 'openai') return slot;
  return undefined;
}

async function runProviderText(args: {
  requested: PlannerModelId;
  prompt: string;
  apiKey?: string;
  webSearch?: boolean;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Enable GLM deep thinking for agent/planner work. */
  enableReasoning?: boolean;
  reasoningEffort?: LlmReasoningEffort;
}): Promise<{ content: string; reasoning?: string; modelId: string }> {
  const option = getPlannerModelOption(args.requested);
  const apiKey = resolveApiKeyForModel(args.requested, args.apiKey);

  if (option.transport === 'gemini') {
    const content = await geminiProText(args.prompt, apiKey, {
      webSearch: args.webSearch,
      json: args.json,
      temperature: args.temperature,
    });
    return { content, modelId: option.modelId };
  }

  const baseUrl = getStoredBaseUrl(args.requested) || option.defaultBaseUrl || '';
  const modelId = getStoredModelOverride(args.requested) || option.modelId;
  if (!baseUrl) throw new Error(`No OpenAI-compatible base URL for ${option.label}`);

  // Only z.ai GLM gets native Web Search in Chat tools.
  const useGlmWebSearch = Boolean(args.webSearch && option.keySlot === 'zai');
  const useReasoning = Boolean(args.enableReasoning && option.keySlot === 'zai');
  const systemBits: string[] = [];
  if (args.json) {
    systemBits.push('Respond with valid JSON only. No markdown fences.');
  }
  const messages = [
    ...(systemBits.length
      ? [{ role: 'system' as const, content: systemBits.join(' ') }]
      : []),
    { role: 'user' as const, content: args.prompt },
  ];

  const chat = await llmChat({
    baseUrl,
    model: modelId,
    messages,
    apiKey: apiKey || undefined,
    keyEnv: keyEnvForSlot(option.keySlot),
    temperature: args.temperature ?? 0.4,
    maxTokens: args.maxTokens ?? (useReasoning ? 16384 : 8192),
    webSearch: useGlmWebSearch,
    tools: useGlmWebSearch ? [...GLM_WEB_SEARCH_TOOLS] : undefined,
    thinking: useReasoning ? { type: 'enabled' } : { type: 'disabled' },
    reasoningEffort: useReasoning ? (args.reasoningEffort || 'high') : undefined,
  });
  return {
    content: chat.content,
    reasoning: chat.reasoning,
    modelId: chat.model || modelId,
  };
}

/**
 * Plan / agent text with requested model; always falls back to Gemini Pro on failure
 * (unless Gemini itself was requested).
 */
export async function planText(args: {
  prompt: string;
  requested: PlannerModelId;
  apiKey?: string;
  webSearch?: boolean;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /**
   * Enable GLM deep thinking (reasoning_content). Use for Ad Agent / planner.
   * Fast app text should leave this false/undefined.
   */
  enableReasoning?: boolean;
  reasoningEffort?: LlmReasoningEffort;
}): Promise<PlanTextResult> {
  const requested = coercePlannerModelId(args.requested);

  if (requested === FALLBACK_PLANNER_MODEL) {
    const content = await geminiProText(args.prompt, args.apiKey, {
      webSearch: args.webSearch,
      json: args.json,
      temperature: args.temperature,
    });
    return {
      content,
      requested,
      actual: FALLBACK_PLANNER_MODEL,
      modelId: GEMINI_PLANNER_MODEL,
    };
  }

  try {
    const { content, reasoning, modelId } = await runProviderText({
      requested,
      prompt: args.prompt,
      apiKey: args.apiKey,
      webSearch: args.webSearch,
      json: args.json,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      enableReasoning: args.enableReasoning,
      reasoningEffort: args.reasoningEffort,
    });
    return {
      content,
      reasoning,
      requested,
      actual: requested,
      modelId,
    };
  } catch (err) {
    const fallbackReason = String((err as Error)?.message || err).slice(0, 240);
    const content = await geminiProText(args.prompt, args.apiKey, {
      webSearch: args.webSearch,
      json: args.json,
      temperature: args.temperature,
    });
    return {
      content,
      requested,
      actual: FALLBACK_PLANNER_MODEL,
      modelId: GEMINI_PLANNER_MODEL,
      fallbackReason,
    };
  }
}
