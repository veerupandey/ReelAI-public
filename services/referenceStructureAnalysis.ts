/**
 * Analyze captured / uploaded creative reference frames into a beat structure
 * the planner can recreate for the user's brand.
 */
import { GoogleGenAI } from '@google/genai';
import type { CreativeReferenceUpload } from './creativeReferenceDirector';

export interface ReferenceStructureBeat {
  index: number;
  roleHint: string;
  composition: string;
  motionOrPacing: string;
  onScreenTextIntent: string;
  durationHintSec?: number;
}

export interface ReferenceStructureAnalysis {
  beats: ReferenceStructureBeat[];
  overallVibe: string;
  doNotCopy: string[];
  sourceLabel: string;
}

const STRUCTURE_PLANNER_RULES = `- REFERENCE STRUCTURE RECREATE: A reference post/video structure is provided below. Match beat count/order and composition/pacing as closely as practical. Replace product, packaging, talent branding, and claims with OUR brand. Never copy competitor packaging, logos, watermarks, or verbatim on-screen claims.`;

function getApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.VITE_API_KEY || '') : '')
    || ''
  ).trim();
}

function heuristicStructure(uploads: CreativeReferenceUpload[]): ReferenceStructureAnalysis {
  const beats = uploads.slice(0, 8).map((u, i) => ({
    index: i,
    roleHint: i === 0 ? 'hook' : i === uploads.length - 1 ? 'cta' : `beat_${i + 1}`,
    composition: u.note || u.name || 'Match framing and subject placement from this reference frame.',
    motionOrPacing: /reel|video|frame/i.test(`${u.name} ${u.note}`)
      ? 'Keep energetic short-form pacing; cut on motion peaks.'
      : 'Hold composition; soft Ken Burns if still.',
    onScreenTextIntent: 'Do not copy competitor text; write brand-safe equivalent if needed.',
  }));
  return {
    beats,
    overallVibe: 'Match the reference energy and composition language for our brand.',
    doNotCopy: [
      'competitor logos',
      'competitor packaging',
      'verbatim on-screen claims',
      'watermarks',
    ],
    sourceLabel: `${uploads.length} reference frame(s)`,
  };
}

/**
 * Format structure analysis as a creative-brief block for planScenes.
 */
export function formatReferenceStructureBlock(analysis: ReferenceStructureAnalysis): string {
  const beatLines = analysis.beats.map((b) => {
    const dur = typeof b.durationHintSec === 'number' ? ` (~${b.durationHintSec}s)` : '';
    return [
      `### Beat ${b.index + 1}${dur} · ${b.roleHint}`,
      `- Composition: ${b.composition}`,
      `- Motion / pacing: ${b.motionOrPacing}`,
      `- On-screen text intent: ${b.onScreenTextIntent}`,
    ].join('\n');
  });
  return [
    '## REFERENCE STRUCTURE (recreate for OUR brand)',
    `Source: ${analysis.sourceLabel}`,
    `Overall vibe: ${analysis.overallVibe}`,
    analysis.doNotCopy.length
      ? `Do NOT copy: ${analysis.doNotCopy.join('; ')}`
      : 'Do NOT copy competitor identity or verbatim claims.',
    '',
    'Map your scenes/slides to these beats in order:',
    ...beatLines,
  ].join('\n');
}

export function referenceStructurePlannerRules(): string {
  return STRUCTURE_PLANNER_RULES;
}

export interface AnalyzeReferenceStructureOptions {
  /** Gemini model id — Flash for small sets, 3.1 Pro for ≥4 frames. */
  model?: string;
}

/**
 * Multimodal structure analysis of reference frames. Falls back to heuristics on failure.
 */
export async function analyzeReferenceStructure(
  uploads: CreativeReferenceUpload[],
  options?: AnalyzeReferenceStructureOptions,
): Promise<ReferenceStructureAnalysis | null> {
  if (!uploads.length) return null;
  const frames = uploads.slice(0, 8);
  const key = getApiKey();
  if (!key) return heuristicStructure(frames);
  const model = options?.model || 'gemini-3.8-flash';

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      {
        text: `You are a short-form ad director. Analyze these reference frames from a social post/Reel.
Extract a STRUCTURE we can recreate for a DIFFERENT brand (product will be swapped).

Return ONLY JSON:
{
  "overallVibe": "short vibe description",
  "doNotCopy": ["logos", "packaging claims", "..."],
  "beats": [
    {
      "index": 0,
      "roleHint": "hook|problem|ritual|reveal|payoff|cta|...",
      "composition": "framing, subject placement, lighting mood",
      "motionOrPacing": "what should move / cut energy",
      "onScreenTextIntent": "role of text if any — do not quote competitor claims",
      "durationHintSec": 3
    }
  ]
}

Rules:
- One beat per frame in order (or merge near-duplicates).
- Focus on composition, pacing, energy — not copying brand identity.
- If frames look like carousel slides, treat each as a slide beat.`,
      },
    ];
    for (const frame of frames) {
      parts.push({
        inlineData: {
          mimeType: frame.mimeType || 'image/jpeg',
          data: frame.base64.replace(/^data:[^;]+;base64,/, ''),
        },
      });
      parts.push({ text: `Frame: ${frame.name}. Note: ${frame.note || 'none'}` });
    }

    const res = await ai.models.generateContent({
      model,
      contents: [{ parts }],
      config: { responseMimeType: 'application/json', ...(model.startsWith('gemini-3.8-flash') ? {} : { temperature: 0.2 }) },
    });
    const text = (res.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return heuristicStructure(frames);
    const parsed = JSON.parse(match[0]) as Partial<ReferenceStructureAnalysis>;
    const beats = Array.isArray(parsed.beats)
      ? parsed.beats.map((b, i) => ({
        index: typeof b.index === 'number' ? b.index : i,
        roleHint: String(b.roleHint || `beat_${i + 1}`).slice(0, 40),
        composition: String(b.composition || '').slice(0, 280),
        motionOrPacing: String(b.motionOrPacing || '').slice(0, 160),
        onScreenTextIntent: String(b.onScreenTextIntent || '').slice(0, 160),
        durationHintSec: typeof b.durationHintSec === 'number' ? b.durationHintSec : undefined,
      }))
      : [];
    if (!beats.length) return heuristicStructure(frames);
    return {
      beats,
      overallVibe: String(parsed.overallVibe || 'Match reference energy for our brand.').slice(0, 220),
      doNotCopy: Array.isArray(parsed.doNotCopy)
        ? parsed.doNotCopy.map((s) => String(s).slice(0, 80)).slice(0, 12)
        : heuristicStructure(frames).doNotCopy,
      sourceLabel: `${frames.length} reference frame(s)`,
    };
  } catch {
    return heuristicStructure(frames);
  }
}
