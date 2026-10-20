/**
 * Planner debate — Kimi K3 drafts, Gemini 3.1 Pro reviews with the actual images.
 *
 * Two bounded debates run per production: one over the internal task graph and
 * one over the scene plan the user approves. Each is a single Pro pass over a
 * single Kimi draft; there is no loop. If Pro is unavailable or answers with
 * junk, the Kimi draft ships unchanged.
 */

import { MAX_VISION_IMAGES, routeGeminiVision, type VisionImage } from './modelRouter';
import type { GoalItemId, LoopStep, LoopTaskGraph } from './types';

export type DebateImage = VisionImage;

const GOAL_IDS: GoalItemId[] = [
  'reference_analyzed',
  'brand_product_locked',
  'scenes_planned',
  'stills_approved',
  'motion_done',
  'stitched',
  'critics_pass',
  'delivered',
];

const PRODUCER_IDS = new Set([
  'stills',
  'wan_i2v',
  'veo',
  'ken_burns',
  'ffmpeg_assemble',
  'reference_ingest',
  'structure_analysis',
]);

export interface DebateOutcome<T> {
  /** Merged result — the Kimi draft when the critique did not apply. */
  merged: T;
  /** True when Pro's revisions changed the draft. */
  applied: boolean;
  /** Short reviewer notes for the debug transcript. */
  notes: string[];
  /** Product-identity risks Pro flagged. */
  risks: string[];
  /** Full transcript for Details. Empty when the debate was skipped. */
  transcript: string;
  modelId?: string;
  skippedReason?: string;
}

/**
 * The debate is only worth its cost when there is something to look at:
 * a product image and at least one reference frame.
 */
export function shouldRunPlannerDebate(images: DebateImage[]): boolean {
  const usable = images.filter((img) => Boolean(img.data));
  const hasProduct = usable.some((img) => /product|packshot|hero/i.test(img.label || ''));
  const hasReference = usable.some((img) => /reference|frame/i.test(img.label || ''));
  return hasProduct && hasReference;
}

/**
 * Whether the task graph still needs a vision review after ingest.
 *
 * The bootstrap review only has images when the user uploaded a packshot and
 * reference frames up front; in the URL-driven flow the frames arrive later, so
 * the review is deferred to here. Either way it runs at most once per run.
 */
export function shouldReviewTaskGraphAfterIngest(args: {
  images: DebateImage[];
  bootstrapDebate?: { skippedReason?: string };
}): boolean {
  if (args.bootstrapDebate && !args.bootstrapDebate.skippedReason) return false;
  return shouldRunPlannerDebate(args.images);
}

function parseJsonBlock(raw: string): any | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function asStringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean).slice(0, limit);
}

/** Keep only revisions that stay inside the loop contract. */
function sanitizeSteps(raw: unknown, fallback: LoopStep[]): LoopStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps: LoopStep[] = [];
  for (const item of raw.slice(0, 12)) {
    const s = item as Record<string, unknown>;
    const id = String(s.id || '').trim();
    const title = String(s.title || '').trim();
    if (!id || !title) continue;
    const advances = asStringList(s.advances, 8).filter((a): a is GoalItemId =>
      (GOAL_IDS as string[]).includes(a),
    );
    const producer = typeof s.producer === 'string' && PRODUCER_IDS.has(s.producer)
      ? (s.producer as LoopStep['producer'])
      : undefined;
    steps.push({
      id,
      title,
      tools: asStringList(s.tools, 6),
      advances,
      producer,
    });
  }
  if (!steps.length) return null;
  // A revision that drops every goal advance is a regression, not a fix.
  if (!steps.some((s) => s.advances.length)) return null;
  const fallbackIds = new Set(fallback.map((s) => s.id));
  return steps.length >= Math.min(3, fallbackIds.size) ? steps : null;
}

/**
 * Pro reviews the Kimi task graph against product + reference frames.
 */
export async function debateTaskGraph(args: {
  graph: LoopTaskGraph;
  goal: string;
  context?: string;
  images: DebateImage[];
}): Promise<DebateOutcome<LoopTaskGraph>> {
  const base: DebateOutcome<LoopTaskGraph> = {
    merged: args.graph,
    applied: false,
    notes: [],
    risks: [],
    transcript: '',
  };
  if (!shouldRunPlannerDebate(args.images)) {
    return { ...base, skippedReason: 'no product + reference images' };
  }

  const prompt = `You are the senior creative director reviewing another planner's production plan.
You can SEE the product and the reference frames below. Judge the plan against them.

GOAL: ${args.goal}
CONTEXT: ${(args.context || '').slice(0, 1500)}

DRAFT PLAN (from the fast planner):
${JSON.stringify({ summary: args.graph.summary, steps: args.graph.steps }, null, 2)}

Return ONLY JSON:
{
  "agree": true|false,
  "notes": ["short reviewer note", ...],
  "productIdentityRisks": ["risk that the wrong thing is treated as the product", ...],
  "summary": "revised one-line summary, or omit to keep",
  "steps": [ { "id": "...", "title": "...", "tools": ["..."], "advances": ["scenes_planned"], "producer": "stills" } ]
}

Rules:
- Only include "steps" when you are actually revising the plan; omit it if you agree.
- advances must use these ids only: ${GOAL_IDS.join(', ')}.
- producer must be one of: ${[...PRODUCER_IDS].join(', ')}.
- Keep 6-10 ordered steps. Prefer stills then image-to-video over pure text-to-video.`;

  try {
    const res = await routeGeminiVision({
      prompt,
      images: args.images.slice(0, MAX_VISION_IMAGES),
      role: 'hard_multimodal',
      json: true,
    });
    const parsed = parseJsonBlock(res.content);
    if (!parsed) return { ...base, transcript: res.content, modelId: res.modelId };

    const notes = asStringList(parsed.notes);
    const risks = asStringList(parsed.productIdentityRisks);
    const revisedSteps = parsed.agree === false ? sanitizeSteps(parsed.steps, args.graph.steps) : null;
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : args.graph.summary;

    return {
      merged: revisedSteps
        ? { ...args.graph, summary, steps: revisedSteps }
        : { ...args.graph, summary },
      applied: Boolean(revisedSteps),
      notes,
      risks,
      transcript: res.content,
      modelId: res.modelId,
    };
  } catch (err: any) {
    return { ...base, skippedReason: err?.message || 'vision review failed' };
  }
}

export interface DebateScene {
  index: number;
  role: string;
  targetDurationSec: number;
  imagePrompt: string;
  voiceoverText: string;
  motionIntent?: string;
}

export interface SceneRevision {
  index: number;
  imagePrompt?: string;
  voiceoverText?: string;
  motionIntent?: string;
  reason?: string;
}

/**
 * Pro reviews the drafted scene beats against product + reference frames.
 * Returns per-scene revisions; the caller decides how to apply them.
 */
export async function debateScenePlan(args: {
  scenes: DebateScene[];
  productTitle: string;
  facts?: string[];
  brief?: string;
  images: DebateImage[];
}): Promise<DebateOutcome<SceneRevision[]>> {
  const base: DebateOutcome<SceneRevision[]> = {
    merged: [],
    applied: false,
    notes: [],
    risks: [],
    transcript: '',
  };
  if (!args.scenes.length) return { ...base, skippedReason: 'no scenes' };
  if (!shouldRunPlannerDebate(args.images)) {
    return { ...base, skippedReason: 'no product + reference images' };
  }

  const prompt = `You are the senior creative director reviewing a drafted scene plan for "${args.productTitle}".
You can SEE the product and the reference frames below. Judge the beats against them.

VERIFIED FACTS: ${(args.facts || []).slice(0, 8).join(' · ') || 'none supplied'}
BRIEF: ${(args.brief || '').slice(0, 1200)}

DRAFT SCENES:
${JSON.stringify(args.scenes, null, 2)}

Return ONLY JSON:
{
  "agree": true|false,
  "notes": ["what works, what does not", ...],
  "productIdentityRisks": ["scene 3 shows a logo, not the product", ...],
  "revisions": [
    { "index": 0, "imagePrompt": "...", "voiceoverText": "...", "motionIntent": "...", "reason": "..." }
  ]
}

Rules:
- Only revise scenes that need it; leave the rest out of "revisions".
- index must match the draft scene index.
- Never invent product claims that are not in the verified facts.
- Flag any scene whose visual would show something other than the real product.`;

  try {
    const res = await routeGeminiVision({
      prompt,
      images: args.images.slice(0, MAX_VISION_IMAGES),
      role: 'hard_multimodal',
      json: true,
    });
    const parsed = parseJsonBlock(res.content);
    if (!parsed) return { ...base, transcript: res.content, modelId: res.modelId };

    const validIndexes = new Set(args.scenes.map((s) => s.index));
    const revisions: SceneRevision[] = (Array.isArray(parsed.revisions) ? parsed.revisions : [])
      .map((item: Record<string, unknown>) => ({
        index: Number(item.index),
        imagePrompt: typeof item.imagePrompt === 'string' ? item.imagePrompt.trim() : undefined,
        voiceoverText: typeof item.voiceoverText === 'string' ? item.voiceoverText.trim() : undefined,
        motionIntent: typeof item.motionIntent === 'string' ? item.motionIntent.trim() : undefined,
        reason: typeof item.reason === 'string' ? item.reason.trim() : undefined,
      }))
      .filter((r: SceneRevision) =>
        Number.isInteger(r.index)
        && validIndexes.has(r.index)
        && Boolean(r.imagePrompt || r.voiceoverText || r.motionIntent),
      )
      .slice(0, args.scenes.length);

    return {
      merged: revisions,
      applied: revisions.length > 0,
      notes: asStringList(parsed.notes),
      risks: asStringList(parsed.productIdentityRisks),
      transcript: res.content,
      modelId: res.modelId,
    };
  } catch (err: any) {
    return { ...base, skippedReason: err?.message || 'vision review failed' };
  }
}

/** Debug-only markdown transcript for the Details pane. */
export function debateTranscriptMarkdown(
  title: string,
  outcome: DebateOutcome<unknown>,
): string {
  return [
    `## ${title}`,
    outcome.skippedReason
      ? `_Skipped: ${outcome.skippedReason}_`
      : `_Reviewer: ${outcome.modelId || 'gemini pro'} · ${outcome.applied ? 'revisions applied' : 'no changes'}_`,
    outcome.notes.length ? ['', '**Notes**', ...outcome.notes.map((n) => `- ${n}`)].join('\n') : '',
    outcome.risks.length ? ['', '**Product identity risks**', ...outcome.risks.map((r) => `- ${r}`)].join('\n') : '',
    outcome.transcript ? ['', '**Raw review**', '```json', outcome.transcript.slice(0, 4000), '```'].join('\n') : '',
  ].filter(Boolean).join('\n');
}
