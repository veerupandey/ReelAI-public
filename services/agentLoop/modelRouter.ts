/**
 * Model router — Gemini 3.8 Flash (default) / multi-provider for planning,
 * Gemini 3.1 Pro for hard multimodal, Gemini 3.8 Flash for worker / critic.
 * Image gen stays on Gemini Flash Image (nano banana) outside this router.
 */
import { GoogleGenAI } from '@google/genai';
import {
  planText,
  resolveDefaultPlannerModel,
  type PlannerModelId,
} from '../siliconflow/planner';
import type { ModelRole } from './types';
import { DEFAULT_PLANNER_MODEL } from '../llm/types';

export const WORKER_MODEL = 'gemini-3.8-flash';
export const HARD_MULTIMODAL_MODEL = 'gemini-3.1-pro-preview';
export const CRITIC_MODEL = 'gemini-3.8-flash';

export function modelForRole(role: ModelRole): string {
  switch (role) {
    case 'plan':
      return DEFAULT_PLANNER_MODEL;
    case 'hard_multimodal':
      return HARD_MULTIMODAL_MODEL;
    case 'worker':
      return WORKER_MODEL;
    case 'critic':
      return CRITIC_MODEL;
    default:
      return WORKER_MODEL;
  }
}

function getGeminiApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '') : '')
    || ''
  ).trim();
}

export async function routePlanText(args: {
  prompt: string;
  preferred?: PlannerModelId;
  apiKey?: string;
  /** GLM deep thinking for planner debate / agent plan role. Default on. */
  enableReasoning?: boolean;
}): Promise<{ content: string; reasoning?: string; modelId: string; actual: PlannerModelId }> {
  const requested = await resolveDefaultPlannerModel(args.preferred);
  const result = await planText({
    prompt: args.prompt,
    requested,
    apiKey: args.apiKey,
    enableReasoning: args.enableReasoning ?? true,
    reasoningEffort: 'high',
  });
  return {
    content: result.content,
    reasoning: result.reasoning,
    modelId: result.modelId,
    actual: result.actual,
  };
}

export async function routeGeminiText(args: {
  prompt: string;
  role: Exclude<ModelRole, 'plan'>;
  temperature?: number;
  json?: boolean;
}): Promise<{ content: string; modelId: string }> {
  const key = getGeminiApiKey();
  if (!key) throw new Error('Gemini API key not configured');
  const modelId = modelForRole(args.role);
  const ai = new GoogleGenAI({ apiKey: key });
  const res = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts: [{ text: args.prompt }] }],
    config: {
      ...(modelId.startsWith('gemini-3.8-flash') ? {} : { temperature: args.temperature ?? 0.3 }),
      maxOutputTokens: 4096,
      ...(args.json ? { responseMimeType: 'application/json' as const } : {}),
    },
  });
  const content = (res.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  if (!content) throw new Error(`${modelId} returned empty content`);
  return { content, modelId };
}

/** Max images per vision call — enough context without paying for a gallery. */
export const MAX_VISION_IMAGES = 6;

export interface VisionImage {
  mimeType: string;
  /** Raw base64, no data: prefix. */
  data: string;
  label?: string;
}

/**
 * Text prompt plus images. Used by the planner debate so Gemini Pro can judge
 * a plan against the actual product and reference frames.
 */
export async function routeGeminiVision(args: {
  prompt: string;
  images: VisionImage[];
  role: Exclude<ModelRole, 'plan'>;
  temperature?: number;
  json?: boolean;
}): Promise<{ content: string; modelId: string }> {
  const key = getGeminiApiKey();
  if (!key) throw new Error('Gemini API key not configured');
  const images = args.images.filter((img) => img.data).slice(0, MAX_VISION_IMAGES);
  if (!images.length) throw new Error('routeGeminiVision called without images');
  const modelId = modelForRole(args.role);
  const ai = new GoogleGenAI({ apiKey: key });
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: args.prompt },
  ];
  for (const img of images) {
    if (img.label) parts.push({ text: `Image: ${img.label}` });
    parts.push({
      inlineData: {
        mimeType: img.mimeType || 'image/png',
        data: img.data.startsWith('data:') ? img.data.split(',')[1] : img.data,
      },
    });
  }
  const res = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts }],
    config: {
      ...(modelId.startsWith('gemini-3.8-flash') ? {} : { temperature: args.temperature ?? 0.3 }),
      maxOutputTokens: 4096,
      ...(args.json ? { responseMimeType: 'application/json' as const } : {}),
    },
  });
  const content = (res.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || '')
    .join('')
    .trim();
  if (!content) throw new Error(`${modelId} returned empty content`);
  return { content, modelId };
}

/** Prefer Pro for complex multi-frame structure; Flash otherwise. */
export function structureAnalysisRole(frameCount: number): Exclude<ModelRole, 'plan'> {
  return frameCount >= 4 ? 'hard_multimodal' : 'worker';
}
