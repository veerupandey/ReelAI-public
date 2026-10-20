/**
 * Audience filtering for Agent Console — user feed vs Details (debug).
 */

export type OutputAudience = 'user' | 'review' | 'debug';

/** Labels that belong in Details only. */
const DEBUG_LABEL_RE =
  /agent capabilities|goal card|task memory|continuity lock|diversity guard|intelligence trace|planner fallback|reference ingest|agent loop|loop escalate|loop stop|loop plan|recreate reference path|playwright|silent video|timing|brand aesthetics|ingredients & claims|story-relevant facts|agency seeded|agency product lock|researcher product lock|hub researcher lock|agency lock|agent reference assignments|agent director|director result|caption style|forge script|forge run|shell repair|decision trace|creative reference analysis/i;

/** Labels shown at gates or when Details is on. */
const REVIEW_LABEL_RE =
  /critic|evidence safety|native plan advisory|visual critic|ai quality review|evidence safety corrections|evidence safety advisory|planning critic|pre-production critic|pre-production advisory|reference structure|creative concept competition/i;

/**
 * Resolve audience for an output. Explicit audience wins; else infer from label/type.
 */
export function resolveOutputAudience(args: {
  audience?: OutputAudience;
  label?: string;
  type?: string;
}): OutputAudience {
  if (args.audience) return args.audience;
  if (args.type === 'terminal') return 'debug';
  const label = args.label || '';
  if (DEBUG_LABEL_RE.test(label)) return 'debug';
  if (REVIEW_LABEL_RE.test(label)) return 'review';
  return 'user';
}

/**
 * Whether an output should appear in the main canvas.
 * - user: always
 * - review: when Details on, or when an approval gate is pending
 * - debug: only when Details on
 */
export function shouldShowOutput(args: {
  audience?: OutputAudience;
  label?: string;
  type?: string;
  showDetails: boolean;
  approvalPending?: boolean;
}): boolean {
  const audience = resolveOutputAudience(args);
  if (audience === 'user') return true;
  if (audience === 'debug') return args.showDetails;
  // review
  return args.showDetails || Boolean(args.approvalPending);
}

/** Plain-English phase labels for the status strip / rail. */
export const USER_PHASE_LABELS: Record<string, string> = {
  plan_loop: 'Planning',
  research: 'Product',
  plan_scenes: 'Storyboard',
  generate_images: 'Visuals',
  generate_voiceover: 'Voice',
  generate_live_motion: 'Motion',
  assemble_video: 'Finishing',
  export_image: 'Export',
  export_carousel: 'Carousel',
  generate_veo3_clips: 'AI video',
  cost_confirmation: 'Cost check',
  deliver: 'Ready',
  forge_tool: 'Tool setup',
  idle: 'Ready',
};

export function userPhaseLabel(phase?: string): string {
  if (!phase) return 'Working';
  return USER_PHASE_LABELS[phase] || phase.replace(/_/g, ' ');
}

/** Phases hidden from the main rail unless Details is on. */
export function isDetailsOnlyPhase(phase: string): boolean {
  return phase === 'forge_tool' || phase === 'plan_loop';
}
