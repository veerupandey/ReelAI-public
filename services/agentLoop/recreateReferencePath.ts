/**
 * V1 skill path helpers for "recreate this reference video for my brand".
 * Heavy lifting stays in AutonomousAgent / existing services; this module
 * decides ingest strategy and motion defaults from the loop plan.
 */
import type { CreativeReferenceUpload } from '../creativeReferenceDirector';
import type { LoopTaskGraph } from './types';

export type ReferenceIngestStrategy =
  | 'upload_frames'
  | 'url_screenshot_carousel'
  | 'playwright_mcp'
  | 'ffmpeg_extract'
  | 'none';

export interface RecreatePathPlan {
  ingest: ReferenceIngestStrategy;
  referenceUrl?: string;
  useProForStructure: boolean;
  preferLiveMotionDefault: boolean;
  estimatedI2vScenes: number;
  estimatedVeoScenes: number;
  notes: string[];
}

export function planRecreatePath(args: {
  referenceUrl?: string;
  referenceUploads: CreativeReferenceUpload[];
  taskGraph?: LoopTaskGraph;
}): RecreatePathPlan {
  const notes: string[] = [];
  const uploads = args.referenceUploads || [];
  const url = args.referenceUrl;

  let ingest: ReferenceIngestStrategy = 'none';
  if (uploads.length > 0) {
    ingest = 'upload_frames';
    notes.push(`Using ${uploads.length} uploaded reference frame(s)/clip-derived stills`);
  } else if (url && /\b(instagram\.com|tiktok\.com)\b/i.test(url)) {
    ingest = 'url_screenshot_carousel';
    notes.push('Social URL → screenshot-carousel / Playwright capture');
  } else if (url) {
    ingest = 'playwright_mcp';
    notes.push('Generic URL → Playwright MCP navigate + frames');
  } else {
    notes.push('No reference source — fall back to standard structure planning');
  }

  const estimatedI2vScenes = args.taskGraph?.estimatedLiveMotionScenes ?? 0;
  const estimatedVeoScenes = args.taskGraph?.estimatedVeoScenes ?? 0;
  const preferLiveMotionDefault = estimatedI2vScenes > 0
    || Boolean(args.taskGraph?.steps.some((s) => s.producer === 'wan_i2v'));

  return {
    ingest,
    referenceUrl: url,
    useProForStructure: uploads.length >= 4 || ingest !== 'upload_frames',
    preferLiveMotionDefault,
    estimatedI2vScenes,
    estimatedVeoScenes,
    notes,
  };
}

export function recreatePathMarkdown(plan: RecreatePathPlan): string {
  return [
    '## Recreate-reference path',
    '',
    `- **Ingest:** \`${plan.ingest}\``,
    plan.referenceUrl ? `- **URL:** ${plan.referenceUrl}` : '',
    `- **Structure model:** ${plan.useProForStructure ? 'Gemini 3.1 Pro' : 'Gemini 3.8 Flash'}`,
    `- **Default motion:** ${plan.preferLiveMotionDefault ? 'Live Motion I2V preferred' : 'Ken Burns unless plan says otherwise'}`,
    `- **Est. I2V scenes:** ${plan.estimatedI2vScenes}`,
    `- **Est. Veo scenes:** ${plan.estimatedVeoScenes}`,
    '',
    ...plan.notes.map((n) => `- ${n}`),
  ].filter(Boolean).join('\n');
}

/** Per-scene motion hint from loop producer preference. */
export type SceneMotionHint = 'ken_burns' | 'wan_i2v' | 'veo';

export function defaultMotionHint(path: RecreatePathPlan): SceneMotionHint {
  if (path.estimatedVeoScenes > 0) return 'veo';
  if (path.preferLiveMotionDefault) return 'wan_i2v';
  return 'ken_burns';
}
