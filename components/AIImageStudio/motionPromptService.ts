/**
 * AI-assisted motion prompt for Video Studio.
 * Uses Gemini Flash on the still (+ optional Playwright reference frames).
 */
import { GoogleGenAI } from '@google/genai';
import type { StudioAsset } from './types';
import { STUDIO_FLASH_MODEL } from './studioModels';
import { captureCarouselScreenshots, type CapturedScreenshot } from './screenshotService';
import {
  DEFAULT_STUDIO_MOTION_PROMPT,
  resolveStillImagePayload,
} from './studioAnimateService';

const MOTION_MODEL = STUDIO_FLASH_MODEL;

export interface MotionPromptInput {
  asset: StudioAsset;
  /** Free-text creative intent, e.g. "Instagram product ad, gentle hero push-in" */
  intent?: string;
  /** Optional reference post/ad URL — captured via Playwright on the agent shell */
  referenceUrl?: string;
  maxReferenceFrames?: number;
  /** Injected for tests */
  generateContent?: (args: {
    model: string;
    parts: Array<Record<string, unknown>>;
  }) => Promise<string>;
  captureScreenshots?: typeof captureCarouselScreenshots;
}

export interface MotionPromptResult {
  motionPrompt: string;
  negativePrompt: string;
  rationale?: string;
  referenceFrameCount: number;
}

function getGeminiApiKey(): string {
  const viteKey =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY
      : undefined;
  const windowKey =
    typeof window !== 'undefined'
      ? (window as any).ENV?.VITE_GEMINI_API_KEY ||
        (window as any).ENV?.VITE_API_KEY ||
        (window as any).ENV?.GEMINI_API_KEY
      : undefined;
  return viteKey || windowKey || '';
}

function stripDataPrefix(base64: string): string {
  return base64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
}

function buildMotionSystemPrompt(intent: string, hasRefs: boolean): string {
  return [
    'You write image-to-video motion prompts.',
    'The FIRST image is the still to animate. Keep the subject, packaging, logo, and any on-image text readable and unchanged.',
    'Do not invent new brands, claims, logos, or objects. Prefer subtle motion over morphing.',
    'If the intent is "just animate" / subtle / nothing else: write a SHORT motion prompt for gentle camera drift or soft parallax only — no ad story, no dialogue, no dramatic effects.',
    'If the intent is an ad or cinematic brief: match that energy while staying product-safe.',
    hasRefs
      ? 'Additional images are reference frames from a URL — borrow camera energy and pacing only, not branding or copy.'
      : 'No reference frames were provided — invent motion from the still and intent alone.',
    'Return ONLY valid JSON with keys: motionPrompt (string), negativePrompt (string), rationale (short string).',
    `Creative intent: ${intent || 'just subtle animation of this still, nothing else'}`,
  ].join('\n');
}

function parseMotionResponse(text: string): Pick<MotionPromptResult, 'motionPrompt' | 'negativePrompt' | 'rationale'> {
  const trimmed = (text || '').trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      motionPrompt: trimmed || DEFAULT_STUDIO_MOTION_PROMPT,
      negativePrompt:
        'camera shake, morphing product, warped logo, garbled text, watermark, new brands',
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      motionPrompt?: string;
      negativePrompt?: string;
      rationale?: string;
    };
    return {
      motionPrompt: (parsed.motionPrompt || '').trim() || DEFAULT_STUDIO_MOTION_PROMPT,
      negativePrompt:
        (parsed.negativePrompt || '').trim() ||
        'camera shake, morphing product, warped logo, garbled text, watermark, new brands',
      rationale: (parsed.rationale || '').trim() || undefined,
    };
  } catch {
    return {
      motionPrompt: DEFAULT_STUDIO_MOTION_PROMPT,
      negativePrompt:
        'camera shake, morphing product, warped logo, garbled text, watermark, new brands',
    };
  }
}

async function defaultGenerateContent(args: {
  model: string;
  parts: Array<Record<string, unknown>>;
}): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'No Gemini API key found. Set VITE_GEMINI_API_KEY or VITE_API_KEY in .env.local.',
    );
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: args.model,
    contents: { parts: args.parts as any },
    config: {
      responseMimeType: 'application/json',
      ...(args.model.startsWith('gemini-3.8-flash') ? {} : { temperature: 0.4 }),
      maxOutputTokens: 1200,
    },
  } as any);
  const text =
    typeof (response as any).text === 'string'
      ? (response as any).text
      : (response as any).candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text || '')
          .join('') || '';
  return text;
}

/**
 * Build an editable motion prompt from the still, marketer intent, and optional reference URL.
 */
export async function generateMotionPrompt(
  input: MotionPromptInput,
): Promise<MotionPromptResult> {
  const intent = (input.intent || '').trim();
  const capture = input.captureScreenshots || captureCarouselScreenshots;
  const generate = input.generateContent || defaultGenerateContent;

  let referenceFrames: CapturedScreenshot[] = [];
  const referenceUrl = (input.referenceUrl || '').trim();
  if (referenceUrl) {
    const captured = await capture(referenceUrl, input.maxReferenceFrames ?? 3);
    referenceFrames = (captured.screenshots || []).slice(0, input.maxReferenceFrames ?? 3);
  }

  // Empty intent + no refs → cheap default without burning a Gemini call.
  if (!intent && referenceFrames.length === 0) {
    return {
      motionPrompt: DEFAULT_STUDIO_MOTION_PROMPT,
      negativePrompt:
        'camera shake, morphing product, warped logo, garbled text, watermark, new brands',
      referenceFrameCount: 0,
      rationale: 'Default subtle motion (no intent or references provided).',
    };
  }

  const { imageBase64, mimeType } = resolveStillImagePayload(input.asset);
  if (/^https?:\/\//i.test(imageBase64)) {
    throw new Error(
      'Motion prompt AI needs local image bytes. Re-import or regenerate the still, then retry.',
    );
  }

  const parts: Array<Record<string, unknown>> = [
    {
      inlineData: {
        mimeType,
        data: stripDataPrefix(imageBase64),
      },
    },
  ];

  for (const frame of referenceFrames) {
    parts.push({
      inlineData: {
        mimeType: frame.mimeType || 'image/jpeg',
        data: stripDataPrefix(frame.base64),
      },
    });
  }

  parts.push({ text: buildMotionSystemPrompt(intent, referenceFrames.length > 0) });

  const text = await generate({ model: MOTION_MODEL, parts });
  const parsed = parseMotionResponse(text);
  return {
    ...parsed,
    referenceFrameCount: referenceFrames.length,
  };
}
