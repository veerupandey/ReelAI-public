/**
 * Shared Ad Creator / Agent Console options (duration + Gemini TTS voices + Live Motion I2V).
 */

import {
  formatStudioI2vOptionLabel,
  STUDIO_I2V_MODELS,
} from '../components/AIImageStudio/studioAnimateService';
import { WAN_I2V_MODEL } from '../services/siliconflow/client';

/** Bumper / flash ads (5s) through long-form (90s). */
export const AD_AGENT_DURATION_MIN = 5;
export const AD_AGENT_DURATION_MAX = 90;

export const AD_AGENT_DURATION_PRESETS = [
  { sec: 5, label: 'Bumper' },
  { sec: 15, label: 'Hook' },
  { sec: 30, label: 'Standard' },
  { sec: 45, label: 'Story' },
  { sec: 60, label: 'Long' },
] as const;

/** Clamp launch/form duration into the supported Video Ad range. */
export function clampAdAgentDurationSec(raw: unknown, fallback = 30): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(AD_AGENT_DURATION_MAX, Math.max(AD_AGENT_DURATION_MIN, n));
}

export function isAdAgentDurationPreset(sec: number): boolean {
  return AD_AGENT_DURATION_PRESETS.some((p) => p.sec === sec);
}

/**
 * Duration-aware scene bounds for stitched / Veo video ads.
 * Short bumpers must not be forced into 3+ scenes (clips become too short to assemble).
 */
export function adAgentSceneBounds(durationSec: number): { minScenes: number; maxScenes: number } {
  const d = clampAdAgentDurationSec(durationSec);
  if (d <= 5) return { minScenes: 1, maxScenes: 2 };
  if (d <= 8) return { minScenes: 1, maxScenes: 3 };
  if (d <= 12) return { minScenes: 2, maxScenes: 3 };
  if (d <= 15) return { minScenes: 2, maxScenes: 4 };
  if (d <= 20) return { minScenes: 3, maxScenes: 5 };
  return { minScenes: 3, maxScenes: 8 };
}

/** Rough scene count for planning — respects short-form bumper budgets. */
export function estimateAdAgentSceneCount(durationSec: number): number {
  const d = clampAdAgentDurationSec(durationSec);
  const { minScenes, maxScenes } = adAgentSceneBounds(d);
  if (d <= 5) return 1;
  if (d <= 8) return 2;
  // ~5–6s per scene for mid lengths; ~6s/scene for longer.
  const target = d <= 20 ? Math.round(d / 5) : Math.round(d / 6);
  return Math.max(minScenes, Math.min(maxScenes, target));
}

export type AdAgentVoiceOption = {
  value: string;
  label: string;
  desc: string;
};

/** Gemini prebuilt TTS voices used by Ad Agent voiceover. */
export const AD_AGENT_VOICE_OPTIONS: AdAgentVoiceOption[] = [
  { value: 'Kore', label: 'Kore', desc: 'Firm & clear' },
  { value: 'Despina', label: 'Despina', desc: 'Smooth luxury' },
  { value: 'Aoede', label: 'Aoede', desc: 'Breezy & confident' },
  { value: 'Sulafat', label: 'Sulafat', desc: 'Warm storyteller' },
  { value: 'Zephyr', label: 'Zephyr', desc: 'Bright & airy' },
  { value: 'Leda', label: 'Leda', desc: 'Youthful energy' },
  { value: 'Laomedeia', label: 'Laomedeia', desc: 'Upbeat promo' },
  { value: 'Callirrhoe', label: 'Callirrhoe', desc: 'Easy-going chat' },
  { value: 'Autonoe', label: 'Autonoe', desc: 'Bright & crisp' },
  { value: 'Vindemiatrix', label: 'Vindemiatrix', desc: 'Gentle soft-sell' },
  { value: 'Gacrux', label: 'Gacrux', desc: 'Mature & grounded' },
  { value: 'Puck', label: 'Puck', desc: 'Upbeat & playful' },
  { value: 'Charon', label: 'Charon', desc: 'Informative & deep' },
  { value: 'Fenrir', label: 'Fenrir', desc: 'Excitable & bold' },
  { value: 'Orus', label: 'Orus', desc: 'Firm narrator' },
  { value: 'Achird', label: 'Achird', desc: 'Friendly host' },
  { value: 'Sadaltager', label: 'Sadaltager', desc: 'Knowledgeable guide' },
  { value: 'Iapetus', label: 'Iapetus', desc: 'Clear documentary' },
  { value: 'Schedar', label: 'Schedar', desc: 'Even & steady' },
  { value: 'Sadachbia', label: 'Sadachbia', desc: 'Lively hype' },
  { value: 'Enceladus', label: 'Enceladus', desc: 'Breathy ASMR' },
  { value: 'Algenib', label: 'Algenib', desc: 'Gravelly character' },
  { value: 'Rishi', label: 'Rishi', desc: 'Warm Hinglish' },
  { value: 'Mira', label: 'Mira', desc: 'Lively Hinglish' },
];

const VOICE_IDS = new Set(AD_AGENT_VOICE_OPTIONS.map((v) => v.value));

/** Validate / coerce a TTS voice id against the Ad Agent catalog. */
export function coerceAdAgentVoice(raw: unknown, fallback = 'Kore'): string {
  const id = String(raw || '').trim();
  if (VOICE_IDS.has(id)) return id;
  const byLabel = AD_AGENT_VOICE_OPTIONS.find(
    (v) => v.label.toLowerCase() === id.toLowerCase(),
  );
  return byLabel?.value || fallback;
}

export type AdAgentVoiceResolveResult = {
  voice: string;
  /** Suggested vibe when feedback implies delivery energy. */
  vibe?: 'gen_z_bright' | 'balanced' | 'premium_calm';
  /** True when feedback clearly asks to re-record TTS (new voice / regenerate audio). */
  regenAudio: boolean;
  /** True when feedback wants punchier / Gen Z spoken lines (not just a new TTS timbre). */
  restyleScript: boolean;
};

/**
 * Map free-text feedback like "gen z hyper loud energy female" → Gemini TTS voice (+ vibe).
 * Exact voice names in the feedback win; otherwise keyword heuristics.
 */
export function resolveAdAgentVoiceFromFeedback(
  feedback: string,
  currentVoice = 'Kore',
): AdAgentVoiceResolveResult {
  const f = (feedback || '').toLowerCase();
  const named = AD_AGENT_VOICE_OPTIONS.find((v) => {
    const name = v.value.toLowerCase();
    return new RegExp(`\\b${name}\\b`, 'i').test(f);
  });

  const wantsAudio = /\b(voice|voiceover|vo\b|audio|tts|narrat|speak|speaker|re-?record|re-?generat.*(?:audio|voice|vo)|different voice|new voice)\b/i.test(f)
    || /\b(female|male|woman|girl|guy|man)\b.*\b(voice|energy|loud|hype|calm)?/i.test(f)
    || /\b(gen\s*z|hyper|loud|hype|energetic|upbeat|excitable|breezy|soft|calm|asmr|luxury|premium)\b/i.test(f);

  const restyleScript = /\b(gen\s*z|slang|punchy|rewrit\w*\s+(the\s+)?(script|lines|voiceover|vo)|more energy|hyper|hype)\b/i.test(f);
  const vibe: AdAgentVoiceResolveResult['vibe'] = /\b(gen\s*z|hyper|hype|loud|creator energy)\b/i.test(f)
    ? 'gen_z_bright'
    : /\b(calm|soft|premium|luxury|cinematic|asmr)\b/i.test(f)
      ? 'premium_calm'
      : undefined;

  if (named) {
    return { voice: named.value, vibe, regenAudio: true, restyleScript };
  }

  if (!wantsAudio && !restyleScript) {
    return { voice: coerceAdAgentVoice(currentVoice), regenAudio: false, restyleScript: false };
  }

  const female = /\bfemale\b|\bwoman\b|\bgirl\b|\bshe\b|\bher\b/.test(f);
  const male = /\bmale\b|\bman\b|\bguy\b|\bhe\b|\bhim\b/.test(f);
  const energetic = /\bgen\s*z\b|\bhyper\b|\bloud\b|\bhype\b|\benergetic\b|\bupbeat\b|\bexcitable\b|\bbright\b|\bplayful\b/.test(f);
  const calm = /\bcalm\b|\bsoft\b|\bgentle\b|\bluxury\b|\bpremium\b|\basmr\b|\bwarm\b|\bsmooth\b/.test(f);
  const hinglish = /\bhinglish\b|\bhindi\b|\bindian\b/.test(f);

  let voice = coerceAdAgentVoice(currentVoice);
  if (hinglish) {
    voice = female || !male ? 'Mira' : 'Rishi';
  } else if (energetic && female) {
    voice = 'Sadachbia'; // Lively hype — closest to "hyper loud energy female"
  } else if (energetic && male) {
    voice = 'Fenrir';
  } else if (energetic) {
    voice = female === false && male ? 'Fenrir' : 'Leda';
  } else if (calm && female) {
    voice = /\basmr\b/.test(f) ? 'Enceladus' : 'Despina';
  } else if (calm && male) {
    voice = 'Charon';
  } else if (calm) {
    voice = 'Sulafat';
  } else if (female) {
    voice = 'Aoede';
  } else if (male) {
    voice = 'Orus';
  }

  return {
    voice,
    vibe,
    regenAudio: true,
    restyleScript: restyleScript || Boolean(vibe === 'gen_z_bright'),
  };
}

/** Default Live Motion model for Video Ads (stable SiliconFlow product-hero path). */
export const AD_AGENT_DEFAULT_I2V_MODEL_ID = WAN_I2V_MODEL;

/** All Video Studio I2V models available to the ad agent. */
export const AD_AGENT_I2V_MODEL_OPTIONS = STUDIO_I2V_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
  description: formatStudioI2vOptionLabel(model).replace(`${model.label} · `, ''),
}));

const I2V_MODEL_IDS = new Set(AD_AGENT_I2V_MODEL_OPTIONS.map((m) => m.value));

export function coerceAdAgentI2vModelId(
  raw: unknown,
  fallback = AD_AGENT_DEFAULT_I2V_MODEL_ID,
): string {
  const id = String(raw || '').trim();
  if (I2V_MODEL_IDS.has(id)) return id;
  return fallback;
}
