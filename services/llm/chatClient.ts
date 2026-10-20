/**
 * OpenAI-compatible text chat via agent-shell-server /llm/chat.
 * Used for GLM 5.3 Flash (z.ai Coding Plan), SiliconFlow, OpenAI, Codex, and custom bases.
 */
import { SHELL_SERVER } from '../shellToolService';
import { GLM_WEB_SEARCH_TOOLS } from './catalog';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LlmReasoningEffort =
  | 'max'
  | 'xhigh'
  | 'high'
  | 'medium'
  | 'low'
  | 'minimal'
  | 'none';

export interface LlmChatResult {
  content: string;
  /** GLM chain-of-thought when thinking is enabled (z.ai). */
  reasoning?: string;
  model: string;
  provider: 'openai_compatible';
  providerRequestId?: string;
}

const CHAT_TIMEOUT_MS = 45_000;
const REASONING_CHAT_TIMEOUT_MS = 120_000;

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export async function llmChat(args: {
  /** OpenAI-compatible base, e.g. https://api.z.ai/api/coding/paas/v4 */
  baseUrl: string;
  model: string;
  messages: LlmChatMessage[];
  apiKey?: string;
  /** Hint for shell env fallback: zai | siliconflow | openai */
  keyEnv?: 'zai' | 'siliconflow' | 'openai';
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Forward OpenAI-compatible tools (e.g. Z.ai web_search). */
  tools?: unknown[];
  /** Convenience: attach GLM Web Search in Chat tools when true. */
  webSearch?: boolean;
  /**
   * z.ai thinking control.
   * Defaults to disabled for api.z.ai bases (fast app text).
   * Agent/planner paths pass `{ type: 'enabled' }` for GLM reasoning.
   */
  thinking?: { type: 'enabled' | 'disabled' };
  /** GLM-5.3+ reasoning effort when thinking is enabled. */
  reasoningEffort?: LlmReasoningEffort;
}): Promise<LlmChatResult> {
  const baseUrl = args.baseUrl.replace(/\/$/, '');
  if (!baseUrl) throw new Error('OpenAI-compatible base URL is required');

  const tools = args.tools
    || (args.webSearch ? [...GLM_WEB_SEARCH_TOOLS] : undefined);
  const isZai = /api\.z\.ai/i.test(baseUrl) || args.keyEnv === 'zai';
  const thinking = args.thinking
    || (isZai ? { type: 'disabled' as const } : undefined);
  const thinkingEnabled = thinking?.type === 'enabled';
  const maxTokens = args.maxTokens
    ?? (thinkingEnabled ? 16384 : 4096);
  const timeoutMs = args.timeoutMs
    ?? (thinkingEnabled ? REASONING_CHAT_TIMEOUT_MS : CHAT_TIMEOUT_MS);

  const res = await fetch(`${SHELL_SERVER}/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transport: 'openai_compatible',
      baseUrl,
      model: args.model,
      messages: args.messages,
      apiKey: args.apiKey || undefined,
      keyEnv: args.keyEnv,
      temperature: args.temperature ?? 0.4,
      max_tokens: maxTokens,
      tools,
      webSearch: args.webSearch || undefined,
      thinking,
      reasoning_effort: thinkingEnabled ? (args.reasoningEffort || 'high') : undefined,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await readJson(res)) as {
    error?: string | { message?: string };
    content?: string;
    reasoning?: string;
    model?: string;
    id?: string;
  };
  if (!res.ok) {
    const msg = typeof body.error === 'string'
      ? body.error
      : body.error?.message || `LLM chat failed (${res.status})`;
    throw new Error(msg);
  }
  const content = (body.content || '').trim();
  if (!content) throw new Error('LLM chat returned empty content');
  const reasoning = (body.reasoning || '').trim() || undefined;
  return {
    content,
    reasoning,
    model: body.model || args.model,
    provider: 'openai_compatible',
    providerRequestId: body.id,
  };
}
