import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/siliconflow/planner', async () => {
  const actual = await vi.importActual<typeof import('../services/siliconflow/planner')>('../services/siliconflow/planner');
  return {
    ...actual,
    planText: vi.fn(),
    resolveDefaultPlannerModel: vi.fn(async (preferred?: string) => preferred || 'glm_53_flash'),
  };
});

import { planText } from '../services/siliconflow/planner';
import { generateAppText } from '../services/llm/appText';
import { OPENAI_COMPAT_ZAI_BASE, GLM_WEB_SEARCH_TOOLS } from '../services/llm/catalog';

describe('generateAppText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to GLM 5.3 Flash and requests web search when asked', async () => {
    vi.mocked(planText).mockResolvedValue({
      content: '{"ok":true}',
      requested: 'glm_53_flash',
      actual: 'glm_53_flash',
      modelId: 'glm-5.3-flash',
    });

    const result = await generateAppText({
      prompt: 'research trends',
      webSearch: true,
      json: true,
    });

    expect(result.actual).toBe('glm_53_flash');
    expect(planText).toHaveBeenCalledWith(expect.objectContaining({
      requested: 'glm_53_flash',
      webSearch: true,
      json: true,
      enableReasoning: false,
    }));
  });

  it('enables reasoning for plan role and surfaces chain-of-thought', async () => {
    vi.mocked(planText).mockResolvedValue({
      content: '{"scenes":[]}',
      reasoning: 'Need a strong hook first.',
      requested: 'glm_53_flash',
      actual: 'glm_53_flash',
      modelId: 'glm-5.3-flash',
    });

    const result = await generateAppText({
      prompt: 'plan reel',
      role: 'plan',
      json: true,
    });

    expect(result.reasoning).toMatch(/hook/);
    expect(planText).toHaveBeenCalledWith(expect.objectContaining({
      enableReasoning: true,
      reasoningEffort: 'high',
    }));
  });

  it('surfaces Gemini fallback from planText', async () => {
    vi.mocked(planText).mockResolvedValue({
      content: 'fallback',
      requested: 'glm_53_flash',
      actual: 'gemini_pro',
      modelId: 'gemini-3.1-pro-preview',
      fallbackReason: 'z.ai 503',
    });

    const result = await generateAppText({ prompt: 'x' });
    expect(result.actual).toBe('gemini_pro');
    expect(result.fallbackReason).toMatch(/503/);
  });
});

describe('coding plan catalog', () => {
  it('points GLM at Coding Plan base and exposes web_search tools', () => {
    expect(OPENAI_COMPAT_ZAI_BASE).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(GLM_WEB_SEARCH_TOOLS[0]).toEqual(expect.objectContaining({
      type: 'web_search',
    }));
  });
});

describe('image generation model lock', () => {
  it('defaults to Flash Image (nano banana) and never a text/chat model', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // Source of truth moved to the config catalog (mirrors the planner pattern).
    const cfg = fs.readFileSync(path.join(process.cwd(), 'services/llm/imageModel.ts'), 'utf8');
    expect(cfg).toMatch(/DEFAULT_IMAGE_MODEL = ["']gemini-nano-banana-2\.1["']/);
    expect(cfg).not.toMatch(/DEFAULT_IMAGE_MODEL\s*=\s*["']glm/i);
    // geminiService must resolve the image model from the catalog — no hardcoded id.
    const svc = fs.readFileSync(path.join(process.cwd(), 'services/geminiService.ts'), 'utf8');
    expect(svc).toMatch(/resolveImageModel/);
    expect(svc).not.toMatch(/=\s*["']gemini-3\.1-flash-image["']/);
  });

  it('resolves the default when no override is set', async () => {
    const { resolveImageModel, DEFAULT_IMAGE_MODEL, isGeminiImageModel } = await import('../services/llm/imageModel');
    expect(resolveImageModel()).toBe(DEFAULT_IMAGE_MODEL);
    expect(DEFAULT_IMAGE_MODEL).toBe('gemini-nano-banana-2.1');
    expect(isGeminiImageModel(DEFAULT_IMAGE_MODEL)).toBe(true);
    expect(isGeminiImageModel('gemini-3.8-flash')).toBe(false);
  });
});
