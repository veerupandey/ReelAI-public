/**
 * Video treatment layer for Ad Creator research.
 * Converts still-image concepts (Image Studio copilot) into short-form video DNA:
 * hook, beats, motion language, pacing, and platform-native format reference.
 */

import { GoogleGenAI } from '@google/genai';

export type AdAgentVideoVibe = 'gen_z_bright' | 'balanced' | 'premium_calm';

export const VIDEO_VIBE_OPTIONS: Array<{ value: AdAgentVideoVibe; label: string; hint: string }> = [
  { value: 'gen_z_bright', label: 'Gen Z Bright', hint: 'Punchy, creator energy' },
  { value: 'balanced', label: 'Balanced', hint: 'Modern, versatile' },
  { value: 'premium_calm', label: 'Premium Calm', hint: 'Cinematic, luxe' },
];

export interface VideoTreatmentBeat {
  label: string;
  seconds: number;
  energy: 'low' | 'medium' | 'high';
  motion: string;
  description: string;
}

export interface AdAgentVideoTreatment {
  hookSpoken: string;
  hookVisual: string;
  formatReference: string;
  pacing: string;
  toneNotes: string;
  beats: VideoTreatmentBeat[];
}

export interface VideoTreatmentInput {
  campaignGoal: string;
  productTitle: string;
  platform: string;          // agent platform id, e.g. instagram_reels / tiktok
  durationSec: number;
  vibe: AdAgentVideoVibe;
  conceptTitle?: string;
  conceptIdea?: string;
  conceptHook?: string;
  trendTitles?: string[];
  productFacts?: string[];
}

export function isVideoAdFormat(adFormat: string): boolean {
  return adFormat === 'stitched_video' || adFormat === 'veo3_video';
}

/** Short-form platforms default to bright Gen Z energy; everything else balanced. */
export function defaultVibeForPlatform(platform: string): AdAgentVideoVibe {
  if (platform === 'tiktok' || platform === 'instagram_reels' || platform === 'youtube_shorts') {
    return 'gen_z_bright';
  }
  return 'balanced';
}

export function coerceVideoVibe(raw: unknown, fallback: AdAgentVideoVibe = 'balanced'): AdAgentVideoVibe {
  return raw === 'gen_z_bright' || raw === 'balanced' || raw === 'premium_calm' ? raw : fallback;
}

export const VIBE_DIRECTION: Record<AdAgentVideoVibe, string> = {
  gen_z_bright: [
    'Bright Gen Z creator energy: punchy spoken lines (like talking to a friend, not ad copy),',
    'bold saturated color pops, fast cut rhythm (1.5–2.5s per beat), pattern-interrupt hook,',
    'playful text-overlay moments, at least one unexpected/chaotic-fun beat. Never corporate, never beige.',
  ].join(' '),
  balanced: [
    'Modern versatile energy: confident conversational voice, contemporary color grade,',
    'medium cut rhythm (2–3.5s per beat), strong hook, clean momentum from hook to CTA.',
  ].join(' '),
  premium_calm: [
    'Premium cinematic calm: measured voiceover, editorial lighting and shadows,',
    'slower deliberate pacing (3–5s per beat), quiet-luxury restraint, tactile close-ups.',
  ].join(' '),
};

/** Deterministic beat skeleton when the model is unavailable. */
export function fallbackVideoTreatment(input: VideoTreatmentInput): AdAgentVideoTreatment {
  const { durationSec, vibe, productTitle } = input;
  const energyHigh = vibe === 'gen_z_bright';
  const hookSec = Math.min(3, Math.max(1.5, durationSec * 0.12));
  const ctaSec = Math.min(4, Math.max(2, durationSec * 0.15));
  const middle = Math.max(0, durationSec - hookSec - ctaSec);
  const midBeats = Math.max(1, Math.min(4, Math.round(middle / 6)));
  const midSec = middle / midBeats;

  const beats: VideoTreatmentBeat[] = [
    {
      label: 'hook',
      seconds: Math.round(hookSec * 10) / 10,
      energy: 'high',
      motion: energyHigh ? 'snap zoom onto product, hand enters frame fast' : 'slow push-in on product reveal',
      description: input.conceptHook || `Pattern-interrupt open on ${productTitle} — earn the first 1.5 seconds.`,
    },
    ...Array.from({ length: midBeats }, (_, i) => ({
      label: i === midBeats - 1 ? 'payoff' : 'build',
      seconds: Math.round(midSec * 10) / 10,
      energy: (energyHigh ? 'high' : 'medium') as VideoTreatmentBeat['energy'],
      motion: energyHigh ? 'quick cuts, whip transitions, product in motion' : 'smooth motion, tactile close-ups',
      description: input.conceptIdea || `Show ${productTitle} in real use — escalate toward the payoff.`,
    })),
    {
      label: 'cta',
      seconds: Math.round(ctaSec * 10) / 10,
      energy: energyHigh ? 'high' : 'medium',
      motion: 'product hero lock-up, subtle motion hold',
      description: `Product hero with a direct, casual call to action.`,
    },
  ];

  return {
    hookSpoken: input.conceptHook || `Okay wait — you need to see ${productTitle}.`,
    hookVisual: energyHigh
      ? 'Unexpected first frame: mid-action, product already moving, bold color pop'
      : 'Striking product-forward first frame with dramatic light',
    formatReference: energyHigh ? 'Creator POV / fast-cut reveal' : 'Cinematic product montage',
    pacing: energyHigh ? 'Fast: cuts every 1.5–2.5s, escalating to CTA' : 'Measured: 3–5s beats, breathing room',
    toneNotes: VIBE_DIRECTION[vibe],
    beats,
  };
}

export function formatVideoTreatmentBlock(
  treatment: AdAgentVideoTreatment,
  meta: { platform: string; durationSec: number; vibe: AdAgentVideoVibe },
): string {
  const beatLines = treatment.beats.map((b, i) =>
    `${i + 1}. ${b.label.toUpperCase()} (~${b.seconds}s · ${b.energy} energy) — ${b.description} [motion: ${b.motion}]`,
  );
  return [
    `VIDEO TREATMENT (${meta.platform.replace(/_/g, ' ')} · ${meta.durationSec}s · ${meta.vibe.replace(/_/g, ' ')}):`,
    `Hook (first 2s) — spoken: "${treatment.hookSpoken}" · visual: ${treatment.hookVisual}`,
    `Format: ${treatment.formatReference}`,
    `Beats:`,
    ...beatLines,
    `Pacing: ${treatment.pacing}`,
    `Tone: ${treatment.toneNotes}`,
  ].join('\n');
}

/**
 * Generate a short-form video treatment from concept + trends.
 * Falls back to a deterministic skeleton when the model is unavailable.
 */
export async function generateVideoTreatment(input: VideoTreatmentInput): Promise<AdAgentVideoTreatment> {
  const apiKey = import.meta.env.VITE_API_KEY || '';
  if (!apiKey) return fallbackVideoTreatment(input);

  const prompt = `You are a short-form video director planning a ${input.durationSec}s ${input.platform.replace(/_/g, ' ')} ad.

PRODUCT: ${input.productTitle}
CAMPAIGN GOAL: ${input.campaignGoal}
${input.conceptTitle ? `CONCEPT: ${input.conceptTitle} — ${input.conceptIdea || ''}` : ''}
${input.conceptHook ? `CONCEPT HOOK IDEA: ${input.conceptHook}` : ''}
${input.trendTitles?.length ? `CURRENT TRENDS: ${input.trendTitles.join(' · ')}` : ''}
${input.productFacts?.length ? `VERIFIED FACTS (accuracy only):\n${input.productFacts.slice(0, 6).map((f) => `- ${f}`).join('\n')}` : ''}

REQUIRED ENERGY / TONE: ${VIBE_DIRECTION[input.vibe]}

Design this as VIDEO, not as still images with narration:
- The hook must earn the first 1.5 seconds (spoken line + visual pattern interrupt).
- Reference a native short-form format (POV, before/after, whip-cut reveal, GRWM, unboxing, etc).
- Every beat needs motion language (what moves in frame / how we cut).
- Escalate energy toward the payoff; end with a direct casual CTA.
- Never a generic "product rotating on a pedestal" montage.

Return ONLY JSON:
{
  "hookSpoken": "<first spoken line, creator voice>",
  "hookVisual": "<first-frame visual pattern interrupt>",
  "formatReference": "<native format this maps to>",
  "pacing": "<cut rhythm description>",
  "toneNotes": "<voice + energy guidance for VO and edit>",
  "beats": [
    { "label": "hook", "seconds": <number>, "energy": "high|medium|low", "motion": "<what moves / how we cut>", "description": "<beat content>" }
  ]
}
Beats must sum to roughly ${input.durationSec}s with 3-6 beats total.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    const parsed = JSON.parse(response.text || 'null');
    if (
      parsed
      && typeof parsed.hookSpoken === 'string'
      && Array.isArray(parsed.beats)
      && parsed.beats.length >= 2
    ) {
      const fallback = fallbackVideoTreatment(input);
      return {
        hookSpoken: parsed.hookSpoken || fallback.hookSpoken,
        hookVisual: parsed.hookVisual || fallback.hookVisual,
        formatReference: parsed.formatReference || fallback.formatReference,
        pacing: parsed.pacing || fallback.pacing,
        toneNotes: parsed.toneNotes || fallback.toneNotes,
        beats: parsed.beats.slice(0, 6).map((b: any, i: number) => ({
          label: String(b.label || `beat ${i + 1}`),
          seconds: Number.isFinite(Number(b.seconds)) ? Number(b.seconds) : 4,
          energy: b.energy === 'low' || b.energy === 'medium' || b.energy === 'high' ? b.energy : 'medium',
          motion: String(b.motion || 'dynamic product motion'),
          description: String(b.description || ''),
        })),
      };
    }
  } catch {
    // fall through to deterministic skeleton
  }
  return fallbackVideoTreatment(input);
}
