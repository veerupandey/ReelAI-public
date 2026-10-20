/**
 * Scene continuity lock for ad-agent planning + image chaining.
 * Keeps cast/world/script order consistent across beats.
 */

export interface SceneContinuityBible {
  cast: string;
  wardrobe: string;
  locationFamily: string;
  lightingPalette: string;
  doNotChange: string[];
}

export interface PlannerSceneDraft {
  role?: string;
  voiceoverText?: string;
  imagePrompt?: string;
  motionIntent?: string;
  visualMode?: string;
  headline?: string;
  body?: string;
}

export interface ParsedPlannerPayload {
  continuity: SceneContinuityBible;
  scenes: PlannerSceneDraft[];
}

export const SCENE_CONTINUITY_PLANNER_RULES = `
CONTINUITY (MANDATORY — same ad, one world):
- ONE STORY: voiceover 1→N must read as continuous narration. Scene N answers, escalates, or reveals from scene N-1. Never jump to an unrelated tip.
- SCRIPT ORDER: keep beat order (hook → body → payoff → CTA). Do not reshuffle.
- ONE CAST/WORLD: if a person appears, lock the SAME identity (face, age, skin, hair) and wardrobe across every scene. Do not swap models mid-ad. If product-only / hands-only, say so in continuity.cast and stay consistent.
- SHOT CONTINUITY: for scene index > 0, start imagePrompt with "continues from previous shot:" and treat it as the NEXT camera beat (push-in, reveal, insert, reaction) — not a new random location. Continuity is locked by cast/world text (scenes may generate in parallel).
- Keep location family, lighting, and color grade consistent unless the brief explicitly changes them.
- Prefer simple, photographable next beats (insert of whisk in bowl, pour, tin detail) over inventing a new impossible prop stunt.
`.trim();

const DEFAULT_DO_NOT_CHANGE = [
  'face / talent identity',
  'hair',
  'wardrobe vibe',
  'product packaging',
  'location family',
  'lighting palette',
];

export function synthesizeContinuityFromScenes(
  scenes: PlannerSceneDraft[],
): SceneContinuityBible {
  const first = (scenes[0]?.imagePrompt || scenes[0]?.role || 'product-led ad').slice(0, 160);
  return {
    cast: 'product-forward; keep any person/hands identical if they appear',
    wardrobe: 'consistent wardrobe vibe across scenes',
    locationFamily: `same world as opening beat (${first})`,
    lightingPalette: 'consistent natural/product-shoot lighting family',
    doNotChange: [...DEFAULT_DO_NOT_CHANGE],
  };
}

function normalizeContinuity(raw: unknown, scenes: PlannerSceneDraft[]): SceneContinuityBible {
  if (!raw || typeof raw !== 'object') return synthesizeContinuityFromScenes(scenes);
  const c = raw as Record<string, unknown>;
  const doNotChange = Array.isArray(c.doNotChange)
    ? c.doNotChange.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 12)
    : DEFAULT_DO_NOT_CHANGE;
  return {
    cast: String(c.cast || '').trim().slice(0, 220) || synthesizeContinuityFromScenes(scenes).cast,
    wardrobe: String(c.wardrobe || '').trim().slice(0, 160) || 'consistent wardrobe vibe',
    locationFamily: String(c.locationFamily || c.location || '').trim().slice(0, 160)
      || synthesizeContinuityFromScenes(scenes).locationFamily,
    lightingPalette: String(c.lightingPalette || c.lighting || '').trim().slice(0, 160)
      || 'consistent lighting family',
    doNotChange: doNotChange.length ? doNotChange : [...DEFAULT_DO_NOT_CHANGE],
  };
}

/**
 * Parse planner JSON: prefer { continuity, scenes }, accept legacy bare array.
 */
export function parsePlannerPayload(raw: string): ParsedPlannerPayload {
  const text = (raw || '').trim();
  // Object form first
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as {
        continuity?: unknown;
        scenes?: PlannerSceneDraft[];
      };
      if (Array.isArray(parsed.scenes) && parsed.scenes.length) {
        const scenes = parsed.scenes;
        return {
          continuity: normalizeContinuity(parsed.continuity, scenes),
          scenes,
        };
      }
    } catch { /* fall through */ }
  }
  // Legacy array
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const scenes = JSON.parse(arrMatch[0]) as PlannerSceneDraft[];
      if (Array.isArray(scenes) && scenes.length) {
        return {
          continuity: synthesizeContinuityFromScenes(scenes),
          scenes,
        };
      }
    } catch { /* fall through */ }
  }
  return { continuity: synthesizeContinuityFromScenes([]), scenes: [] };
}

export function formatContinuityLockBlock(continuity: SceneContinuityBible): string {
  const avoid = continuity.doNotChange.length
    ? continuity.doNotChange.join('; ')
    : DEFAULT_DO_NOT_CHANGE.join('; ');
  return [
    'CONTINUITY LOCK (do not break across this ad):',
    `- Cast: ${continuity.cast}`,
    `- Wardrobe: ${continuity.wardrobe}`,
    `- Location family: ${continuity.locationFamily}`,
    `- Lighting / palette: ${continuity.lightingPalette}`,
    `- Do not change: ${avoid}`,
  ].join('\n');
}

export function formatContinuityLockMarkdown(continuity: SceneContinuityBible): string {
  return [
    '## Continuity Lock',
    `- **Cast:** ${continuity.cast}`,
    `- **Wardrobe:** ${continuity.wardrobe}`,
    `- **Location:** ${continuity.locationFamily}`,
    `- **Lighting:** ${continuity.lightingPalette}`,
    continuity.doNotChange.length
      ? `- **Do not change:** ${continuity.doNotChange.join(', ')}`
      : '',
  ].filter(Boolean).join('\n');
}

export function continuityImpliesPerson(continuity: SceneContinuityBible | null | undefined): boolean {
  if (!continuity?.cast) return false;
  const c = continuity.cast.toLowerCase();
  if (/\b(product-only|packshot-only|no (person|people|talent|model|face)|hands-only)\b/.test(c)) {
    return /\bhands\b/.test(c); // hands still need identity continuity but not face domain
  }
  return /\b(person|people|woman|man|model|talent|creator|girl|boy|face|she|he|they)\b/.test(c);
}

/**
 * Prepend continuity lock; ensure scene index > 0 starts with continues-from cue.
 */
export function prependContinuityLock(
  imagePrompt: string,
  continuity: SceneContinuityBible,
  sceneIndex: number,
): string {
  const lock = formatContinuityLockBlock(continuity);
  let body = (imagePrompt || '').trim();
  if (sceneIndex > 0 && !/^continues from previous shot:/i.test(body)) {
    body = `continues from previous shot: ${body}`;
  }
  if (/\bCONTINUITY LOCK\b/i.test(body)) return body;
  return `${lock}\n\n${body}`.trim();
}

export function extractImageBase64FromDataUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('data:')) {
    const parts = url.split(',');
    return parts[1] || undefined;
  }
  // Already raw base64-ish
  if (/^[A-Za-z0-9+/=]+$/.test(url.slice(0, 80)) && url.length > 100) return url;
  return undefined;
}
