/**
 * Task planner — GLM 5.3 Flash (default) / multi-provider emits a TaskGraph; templates
 * provide a deterministic fallback so the loop always has an executable plan.
 */
import { routePlanText } from './modelRouter';
import { debateTaskGraph, type DebateImage, type DebateOutcome } from './plannerDebate';
import type { GoalItemId, LoopSkillPath, LoopStep, LoopTaskGraph } from './types';
import type { PlannerModelId } from '../siliconflow/planner';
import { resolveApiKeyForModel } from '../llm/apiKeys';

function step(
  id: string,
  title: string,
  tools: string[],
  advances: GoalItemId[],
  producer?: LoopStep['producer'],
): LoopStep {
  return { id, title, tools, advances, producer };
}

export function templateTaskGraph(skillPath: LoopSkillPath, goal: string): LoopTaskGraph {
  if (skillPath === 'recreate_reference_video') {
    return {
      skillPath,
      summary: `Recreate reference structure for brand: ${goal.slice(0, 160)}`,
      stopCriteria: [
        'All required goal-card items pass',
        'No unsupported claims',
        'Product identity preserved',
      ],
      steps: [
        step('ingest_ref', 'Ingest reference (URL capture or uploaded frames)', ['shell_exec', 'python_exec', 'playwright__browser_navigate'], ['reference_analyzed'], 'reference_ingest'),
        step('structure', 'Analyze beats / composition / pacing', [], ['reference_analyzed'], 'structure_analysis'),
        step('lock_product', 'Lock brand + product evidence', [], ['brand_product_locked']),
        step('plan_scenes', 'Plan brand-remapped scenes from beats', [], ['scenes_planned']),
        step('stills', 'Generate scene stills', ['image_generation'], ['stills_approved'], 'stills'),
        step('motion', 'Animate per scene (Ken Burns / Wan I2V / Veo)', ['shell_exec', 'wan_i2v'], ['motion_done'], 'wan_i2v'),
        step('assemble', 'Stitch clips + VO + captions', ['shell_exec', 'ffmpeg_concat_xfade', 'ffmpeg_add_audio'], ['stitched'], 'ffmpeg_assemble'),
        step('verify', 'Run critics + evidence checks', [], ['critics_pass']),
        step('deliver', 'Package deliverable', ['platform_export'], ['delivered']),
      ],
      estimatedLiveMotionScenes: 0,
    };
  }

  if (skillPath === 'static_or_carousel') {
    return {
      skillPath,
      summary: `Static/carousel production: ${goal.slice(0, 160)}`,
      stopCriteria: ['Scenes/slides planned', 'Images approved', 'Critics pass'],
      steps: [
        step('lock_product', 'Lock brand + product', [], ['brand_product_locked']),
        step('plan_scenes', 'Plan slides / single frame', [], ['scenes_planned']),
        step('stills', 'Generate images', ['image_generation'], ['stills_approved'], 'stills'),
        step('verify', 'Critics + evidence', [], ['critics_pass']),
        step('deliver', 'Export stills', [], ['delivered']),
      ],
    };
  }

  if (skillPath === 'open_ended_tools') {
    return {
      skillPath,
      summary: `Open-ended tool loop: ${goal.slice(0, 160)}`,
      stopCriteria: ['User goal satisfied via tools', 'No unsafe shell actions'],
      steps: [
        step('discover', 'Discover capabilities', [], []),
        step('act', 'Act with shell/python/ffmpeg/MCP', ['shell_exec', 'python_exec'], []),
        step('verify', 'Verify artifacts', ['shell_exec'], ['critics_pass']),
      ],
    };
  }

  return {
    skillPath: 'standard_stitched_video',
    summary: `Standard stitched video: ${goal.slice(0, 160)}`,
    stopCriteria: ['Scenes planned', 'Stills + motion done', 'Stitched deliverable'],
    steps: [
      step('lock_product', 'Research + lock product', [], ['brand_product_locked']),
      step('plan_scenes', 'Plan scenes', [], ['scenes_planned']),
      step('stills', 'Generate stills', ['image_generation'], ['stills_approved'], 'stills'),
      step('motion', 'Ken Burns / Live Motion', ['shell_exec'], ['motion_done'], 'ken_burns'),
      step('assemble', 'Assemble video', ['ffmpeg_concat_xfade', 'ffmpeg_add_audio'], ['stitched'], 'ffmpeg_assemble'),
      step('verify', 'Critics', [], ['critics_pass']),
      step('deliver', 'Deliver', ['platform_export'], ['delivered']),
    ],
  };
}

function parsePlannerGraph(raw: string, fallback: LoopTaskGraph): LoopTaskGraph {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as Partial<LoopTaskGraph>;
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return fallback;
    const steps: LoopStep[] = parsed.steps.map((s, i) => ({
      id: String(s.id || `step_${i}`),
      title: String(s.title || `Step ${i + 1}`),
      tools: Array.isArray(s.tools) ? s.tools.map(String) : [],
      advances: Array.isArray(s.advances) ? (s.advances as GoalItemId[]) : [],
      producer: s.producer,
    }));
    return {
      skillPath: (parsed.skillPath as LoopSkillPath) || fallback.skillPath,
      summary: String(parsed.summary || fallback.summary),
      steps,
      stopCriteria: Array.isArray(parsed.stopCriteria)
        ? parsed.stopCriteria.map(String)
        : fallback.stopCriteria,
      estimatedLiveMotionScenes: Number(parsed.estimatedLiveMotionScenes || 0) || undefined,
      estimatedVeoScenes: Number(parsed.estimatedVeoScenes || 0) || undefined,
    };
  } catch {
    return fallback;
  }
}

/** Condensed recreate skill rules — kept in-process so planning never depends on the shell. */
const RECREATE_SKILL_RULES = `
RECREATE-REFERENCE RULES:
- Ingest frames (upload / Playwright / screenshot-carousel) before structure analysis.
- Product identity and approved claims override reference aesthetics.
- Never copy competitor packaging, logos, watermarks, or verbatim claims.
- Prefer stills → I2V over pure T2V for product truth.
- Cost gates before paid Live Motion / Veo.
- Goal card must flip all required passes before deliver.
`.trim();

/**
 * Plan with Kimi (or Gemini Pro fallback). Always returns a usable graph.
 */
export async function planTaskGraph(args: {
  goal: string;
  skillPath: LoopSkillPath;
  context?: string;
  plannerModel?: PlannerModelId;
  /** Product + reference frames. When present, Gemini Pro reviews the draft. */
  debateImages?: DebateImage[];
}): Promise<{
  graph: LoopTaskGraph;
  modelId: string;
  usedTemplateOnly: boolean;
  debate?: DebateOutcome<LoopTaskGraph>;
}> {
  const fallback = templateTaskGraph(args.skillPath, args.goal);
  const skillBlock = args.skillPath === 'recreate_reference_video'
    ? `\n${RECREATE_SKILL_RULES}\n`
    : '';
  const prompt = `You are the ReelAI Ad Agent task planner. Return ONLY JSON for a TaskGraph.

GOAL: ${args.goal}
SKILL_PATH: ${args.skillPath}
CONTEXT: ${(args.context || '').slice(0, 2500)}
${skillBlock}
Schema:
{
  "skillPath": "${args.skillPath}",
  "summary": "short",
  "stopCriteria": ["..."],
  "estimatedLiveMotionScenes": 0,
  "estimatedVeoScenes": 0,
  "steps": [
    { "id": "string", "title": "string", "tools": ["shell_exec"], "advances": ["scenes_planned"], "producer": "stills|wan_i2v|veo|ken_burns|ffmpeg_assemble|reference_ingest|structure_analysis" }
  ]
}

Rules:
- Prefer the recreate_reference_video beat flow when skillPath is recreate_reference_video.
- Prefer stills then I2V over pure T2V unless the scene needs generative video.
- Keep steps ordered and minimal (6–10).
- advances must use goal ids: reference_analyzed, brand_product_locked, scenes_planned, stills_approved, motion_done, stitched, critics_pass, delivered.`;

  try {
    const planned = await Promise.race([
      routePlanText({
        prompt,
        preferred: args.plannerModel,
        apiKey: args.plannerModel ? resolveApiKeyForModel(args.plannerModel) : undefined,
      }),
      new Promise<never>((_, reject) => {
        // GLM reasoning can take longer than a fast text call.
        setTimeout(() => reject(new Error('planner timeout')), 120_000);
      }),
    ]);
    const graph = parsePlannerGraph(planned.content, fallback);
    if (!args.debateImages?.length) {
      return { graph, modelId: planned.modelId, usedTemplateOnly: false };
    }
    // Second turn: Pro looks at the product and reference frames before we commit.
    const debate = await debateTaskGraph({
      graph,
      goal: args.goal,
      context: args.context,
      images: args.debateImages,
    });
    return {
      graph: debate.merged,
      modelId: debate.applied ? `${planned.modelId} + ${debate.modelId}` : planned.modelId,
      usedTemplateOnly: false,
      debate,
    };
  } catch {
    return { graph: fallback, modelId: 'template', usedTemplateOnly: true };
  }
}
