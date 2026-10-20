/**
 * Deterministic Ad Creator direction parser.
 *
 * Turns the human Direction text into form values so the studio can prefill
 * itself instead of asking the user to re-enter what they already typed.
 * Pure and offline on purpose: it runs on every keystroke (debounced) and must
 * never cost a model call or block typing.
 */

import { clampAdAgentDurationSec } from './adAgentOptions';
import { looksLikeRecreateIntent } from './recreateLanguage';
import { resolvePromptUrlRoles } from '../services/promptUrlRoles';

export type AdDirectionValues = Record<string, string | number | boolean>;

export interface ParsedAdDirection {
  /** Form values the parser is confident about. Never includes untouched keys. */
  values: AdDirectionValues;
  /** 0–1. Above 0.6 the studio keeps the Adjust panel collapsed. */
  confidence: number;
  /** One-line explanations, shown under the Understood chips. */
  reasons: string[];
  /** True when the direction reads as "recreate this reference". */
  isRecreate: boolean;
}

interface Rule {
  key: string;
  value: string | number | boolean;
  re: RegExp;
  reason: string;
}

const FORMAT_RULES: Rule[] = [
  { key: 'adFormat', value: 'carousel', re: /\bcarousels?\b/i, reason: 'Carousel' },
  { key: 'adFormat', value: 'veo3_video', re: /\bveo\s*-?\s*3\b|\bveo3\b/i, reason: 'Veo3 video' },
  {
    key: 'adFormat',
    value: 'static_image',
    re: /\b(static\s+(image|ad|post)|single\s+image|feed\s+post|poster)\b/i,
    reason: 'Static image',
  },
  {
    key: 'adFormat',
    value: 'stitched_video',
    re: /\b(video\s+ad|reels?|tiktoks?|shorts?|video|ad\s+film|spot)\b/i,
    reason: 'Video ad',
  },
];

const PLATFORM_RULES: Rule[] = [
  { key: 'platform', value: 'tiktok', re: /\btiktoks?\b/i, reason: 'TikTok' },
  { key: 'platform', value: 'youtube_shorts', re: /\b(youtube\s+shorts?|yt\s+shorts?|shorts)\b/i, reason: 'YouTube Shorts' },
  { key: 'platform', value: 'instagram_carousel', re: /\b(ig|instagram)\s+carousel\b/i, reason: 'Instagram Carousel' },
  { key: 'platform', value: 'instagram_feed', re: /\b(ig|instagram)\s+feed\b|\bfeed\s+post\b/i, reason: 'Instagram Feed' },
  { key: 'platform', value: 'instagram_reels', re: /\breels?\b|\b(ig|instagram)\b/i, reason: 'Instagram Reels' },
];

const STYLE_RULES: Rule[] = [
  { key: 'style', value: 'ugc_style', re: /\b(ugc|creator[- ]style|unboxing|testimonial|selfie|handheld)\b/i, reason: 'UGC style' },
  { key: 'style', value: 'earthy_organic', re: /\b(earthy|organic|natural|botanical|artisan|handmade)\b/i, reason: 'Earthy & organic' },
  { key: 'style', value: 'high_energy', re: /\b(high[- ]energy|fast\s+cuts?|punchy|hype|energetic|bold)\b/i, reason: 'High energy' },
  { key: 'style', value: 'luxe_minimalist', re: /\b(luxe|luxury|minimal(ist)?|premium|elegant|clean|quiet\s+luxury)\b/i, reason: 'Luxe minimalist' },
];

const VIBE_RULES: Rule[] = [
  { key: 'vibe', value: 'premium_calm', re: /\b(calm|cinematic|slow|serene|quiet\s+luxury|premium|ritual)\b/i, reason: 'Premium calm' },
  { key: 'vibe', value: 'gen_z_bright', re: /\b(gen\s*-?\s*z|bright|punchy|playful|trendy|viral)\b/i, reason: 'Gen Z bright' },
  { key: 'vibe', value: 'balanced', re: /\bbalanced\b/i, reason: 'Balanced' },
];

function firstMatch(text: string, rules: Rule[]): Rule | undefined {
  return rules.find((rule) => rule.re.test(text));
}

function parseDuration(text: string): number | undefined {
  // Accept "5s", "5secs", "5 seconds", and hyphenated "5-second" / "5-sec".
  const explicit = text.match(/\b(\d{1,3})\s*-?\s*(?:s\b|secs?\b|seconds?\b)/i);
  if (explicit) return clampAdAgentDurationSec(Number(explicit[1]));
  if (/\b(one|1)\s*minute\b|\b60s\b/i.test(text)) return clampAdAgentDurationSec(60);
  if (/\bhalf\s+a\s+minute\b/i.test(text)) return clampAdAgentDurationSec(30);
  return undefined;
}

/**
 * Parse Direction text into Ad Creator form values.
 * URLs are split by role so a social reference never lands in the product field.
 */
export function parseAdDirection(input: {
  text: string;
  explicitProductUrl?: string;
  explicitReferenceUrl?: string;
}): ParsedAdDirection {
  const text = (input.text || '').trim();
  const values: AdDirectionValues = {};
  const reasons: string[] = [];

  const roles = resolvePromptUrlRoles({
    prompt: text,
    explicitProductUrl: input.explicitProductUrl,
    explicitReferenceUrl: input.explicitReferenceUrl,
  });
  if (roles.productUrl) values.productUrl = roles.productUrl;
  if (roles.referenceUrl) values.referenceUrl = roles.referenceUrl;

  if (!text) {
    return { values, confidence: 0, reasons, isRecreate: false };
  }

  let signals = 0;

  const format = firstMatch(text, FORMAT_RULES);
  if (format) {
    values.adFormat = format.value;
    reasons.push(format.reason);
    signals += 1;
  }

  const platform = firstMatch(text, PLATFORM_RULES);
  if (platform) {
    values.platform = platform.value;
    reasons.push(platform.reason);
    signals += 1;
  }

  const durationSec = parseDuration(text);
  if (durationSec !== undefined) {
    values.durationSec = durationSec;
    reasons.push(`${durationSec}s`);
    signals += 1;
  }

  const style = firstMatch(text, STYLE_RULES);
  if (style) {
    values.style = style.value;
    reasons.push(style.reason);
    signals += 1;
  }

  const vibe = firstMatch(text, VIBE_RULES);
  if (vibe) {
    values.vibe = vibe.value;
    reasons.push(vibe.reason);
    signals += 1;
  }

  if (/\b(live\s+motion|animate[d]?|motion\s+clips?|i2v|moving\s+shots?)\b/i.test(text)) {
    values.preferLiveMotion = true;
    reasons.push('Live Motion');
    signals += 1;
  }

  if (/\b(no\s+voice\s*-?\s*over|no\s+vo\b|silent|music\s+only|text\s+only)\b/i.test(text)) {
    values.includeVoiceover = false;
    reasons.push('No voiceover');
    signals += 1;
  }

  const isRecreate = looksLikeRecreateIntent(text);
  if (isRecreate) reasons.push('Recreate reference');
  if (roles.productUrl) signals += 1;
  if (roles.referenceUrl) signals += 1;

  const confidence = Math.min(1, Math.round((0.3 + signals * 0.12) * 100) / 100);
  return { values, confidence, reasons, isRecreate };
}

/**
 * Which parsed values may actually be written to the form.
 * Anything the user set by hand is left alone, and no-op writes are dropped so
 * a re-parse cannot churn React state on every keystroke.
 */
export function applyParsedDirection(args: {
  parsed: ParsedAdDirection;
  current: Record<string, string | number | boolean | undefined>;
  touched: Iterable<string>;
}): AdDirectionValues {
  const touched = new Set(args.touched);
  const updates: AdDirectionValues = {};
  for (const [key, value] of Object.entries(args.parsed.values)) {
    if (touched.has(key)) continue;
    if (String(args.current[key] ?? '') === String(value)) continue;
    updates[key] = value;
  }
  return updates;
}

/** One-line summary of what the parser understood, for the studio header. */
export function describeParsedDirection(parsed: ParsedAdDirection): string {
  if (!parsed.reasons.length) return '';
  return parsed.reasons.join(' · ');
}
