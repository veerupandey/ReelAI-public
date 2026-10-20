import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/llm/chatClient', () => ({
  llmChat: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: vi.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'GEMINI_PLAN_OK' }] } }],
      })),
    };
    constructor(_opts: { apiKey: string }) {}
  },
}));

import { llmChat } from '../services/llm/chatClient';
import { planText, resolveDefaultPlannerModel } from '../services/siliconflow/planner';

describe('planText fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_KEY', 'test-gemini-key');
  });

  it('uses GLM 5.3 Flash via OpenAI-compatible when z.ai responds', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: 'GLM_PLAN_OK',
      model: 'glm-5.3-flash',
      provider: 'openai_compatible',
    });

    const result = await planText({ prompt: 'plan scenes', requested: 'glm_53_flash' });
    expect(result.actual).toBe('glm_53_flash');
    expect(result.content).toBe('GLM_PLAN_OK');
    expect(result.fallbackReason).toBeUndefined();
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.3-flash',
      keyEnv: 'zai',
      thinking: { type: 'disabled' },
    }));
  });

  it('enables GLM thinking and returns reasoning for agent/planner', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: 'PLAN_JSON',
      reasoning: 'I will structure scenes hook → proof → CTA.',
      model: 'glm-5.3-flash',
      provider: 'openai_compatible',
    });

    const result = await planText({
      prompt: 'plan scenes',
      requested: 'glm_53_flash',
      enableReasoning: true,
      reasoningEffort: 'high',
    });
    expect(result.content).toBe('PLAN_JSON');
    expect(result.reasoning).toMatch(/hook/);
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      thinking: { type: 'enabled' },
      reasoningEffort: 'high',
      maxTokens: 16384,
    }));
  });

  it('routes SiliconFlow through OpenAI-compatible', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: 'KIMI_PLAN_OK',
      model: 'moonshotai/Kimi-K3',
      provider: 'openai_compatible',
    });

    const result = await planText({ prompt: 'plan scenes', requested: 'kimi_k3' });
    expect(result.actual).toBe('kimi_k3');
    expect(result.content).toBe('KIMI_PLAN_OK');
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.siliconflow.com/v1',
      model: 'moonshotai/Kimi-K3',
      keyEnv: 'siliconflow',
    }));
  });

  it('routes OpenAI and Codex through OpenAI-compatible', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: 'OPENAI_OK',
      model: 'gpt-5.2',
      provider: 'openai_compatible',
    });
    await planText({ prompt: 'x', requested: 'openai' });
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.2',
      keyEnv: 'openai',
    }));

    vi.mocked(llmChat).mockResolvedValue({
      content: 'CODEX_OK',
      model: 'gpt-5.1-codex',
      provider: 'openai_compatible',
    });
    await planText({ prompt: 'x', requested: 'codex' });
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.1-codex',
      keyEnv: 'openai',
    }));
  });

  it('falls back to Gemini when OpenAI-compatible fails', async () => {
    vi.mocked(llmChat).mockRejectedValue(new Error('z.ai 503'));

    const result = await planText({ prompt: 'plan scenes', requested: 'glm_53_flash' });
    expect(result.requested).toBe('glm_53_flash');
    expect(result.actual).toBe('gemini_pro');
    expect(result.content).toBe('GEMINI_PLAN_OK');
    expect(result.fallbackReason).toMatch(/z\.ai 503/);
  });

  it('attaches GLM web search tools when requested', async () => {
    vi.mocked(llmChat).mockResolvedValue({
      content: 'SEARCH_OK',
      model: 'glm-5.3-flash',
      provider: 'openai_compatible',
    });

    await planText({ prompt: 'trends', requested: 'glm_53_flash', webSearch: true, json: true });
    expect(llmChat).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.z.ai/api/coding/paas/v4',
      webSearch: true,
      tools: expect.arrayContaining([
        expect.objectContaining({ type: 'web_search' }),
      ]),
    }));
  });

  it('defaults planner to Gemini Flash', async () => {
    await expect(resolveDefaultPlannerModel()).resolves.toBe('gemini_pro');
  });

  it('maps legacy glm_52 preference to GLM 5.3 Flash', async () => {
    const { coercePlannerModelId } = await import('../services/llm/types');
    expect(coercePlannerModelId('glm_52')).toBe('glm_53_flash');
  });

  it('honors explicit gemini preference', async () => {
    await expect(resolveDefaultPlannerModel('gemini_pro')).resolves.toBe('gemini_pro');
  });

  it('honors stored preferred planner when no explicit preference', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
    const { setStoredPreferredPlannerModel } = await import('../services/llm/apiKeys');
    setStoredPreferredPlannerModel('openai');
    await expect(resolveDefaultPlannerModel()).resolves.toBe('openai');
  });
});
