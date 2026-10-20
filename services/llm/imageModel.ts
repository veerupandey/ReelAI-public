/**
 * Image generation model config — mirrors the planner text catalog pattern.
 *
 * Image generation is always Gemini (Flash Image / nano banana). The
 * OpenAI-compatible text endpoints (GLM / SiliconFlow / OpenAI) cannot
 * generate images, so — unlike the planner — there is no transport switch:
 * every option here is consumed by the Google GenAI SDK in geminiService.
 *
 * Default: GA Gemini Nano Banana 2.1.
 * Override precedence: explicit arg → localStorage → VITE_/process env → default.
 */
import type { LlmKeySlot } from './types';

export const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';

/** All image models use the Gemini provider/key slot. */
export const IMAGE_MODEL_KEY_SLOT: LlmKeySlot = 'gemini';

const IMAGE_MODEL_STORAGE = 'reelai.llm.imageModelOverride.v1';

export interface ImageModelOption {
  /** Provider model id sent to the GenAI SDK. */
  id: string;
  label: string;
  description: string;
}

/**
 * Known Gemini image-generation models. The single GA default is listed here;
 * any future model id can be pasted as a free-text override (UI / env).
 * Keeping the catalog honest — do not add ids that are not real on Gemini.
 */
export const IMAGE_MODEL_OPTIONS: readonly ImageModelOption[] = [
  {
    id: DEFAULT_IMAGE_MODEL,
    label: 'Nano Banana 2.1',
    description: 'GA · Gemini Nano Banana 2.1 · default',
  },
] as const;

export function getImageModelOption(id: string): ImageModelOption {
  return IMAGE_MODEL_OPTIONS.find((o) => o.id === id) || {
    id,
    label: id,
    description: 'Custom Gemini image model (override)',
  };
}

export function getStoredImageModelOverride(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return (localStorage.getItem(IMAGE_MODEL_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

export function setStoredImageModelOverride(model: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = (model || '').trim();
    if (trimmed && trimmed !== DEFAULT_IMAGE_MODEL) {
      localStorage.setItem(IMAGE_MODEL_STORAGE, trimmed);
    } else {
      localStorage.removeItem(IMAGE_MODEL_STORAGE);
    }
  } catch {
    // ignore quota / private mode
  }
}

function envImageModel(): string {
  const fromVite = typeof import.meta !== 'undefined'
    && (import.meta.env?.VITE_GEMINI_IMAGE_MODEL || import.meta.env?.GEMINI_IMAGE_MODEL);
  if (fromVite) return String(fromVite).trim();
  if (typeof process !== 'undefined') {
    const fromProcess = (process.env.GEMINI_IMAGE_MODEL || process.env.VITE_GEMINI_IMAGE_MODEL || '').trim();
    if (fromProcess) return fromProcess;
  }
  return '';
}

/**
 * Resolve the image generation model id.
 * Override precedence: explicit arg → localStorage → env → GA default.
 */
export function resolveImageModel(override?: string): string {
  const direct = (override || '').trim();
  if (direct) return direct;
  const stored = getStoredImageModelOverride();
  if (stored) return stored;
  const fromEnv = envImageModel();
  if (fromEnv) return fromEnv;
  return DEFAULT_IMAGE_MODEL;
}

/** True when an id looks like a Gemini image model (not a text/chat model). */
export function isGeminiImageModel(id: string): boolean {
  return /image|nano-banana/i.test(id || '');
}
