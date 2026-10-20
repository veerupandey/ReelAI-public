/**
 * Goal card — falsifiable checklist (passes: false until verified).
 */
import type { GoalCard, GoalItem, GoalItemId, LoopSkillPath } from './types';

const RECREATE_ITEMS: Array<Omit<GoalItem, 'passes'>> = [
  { id: 'reference_analyzed', label: 'Reference video/frames analyzed into beats', required: true },
  { id: 'brand_product_locked', label: 'Brand + product identity locked', required: true },
  { id: 'scenes_planned', label: 'Scenes remapped to our brand (HITL optional)', required: true },
  { id: 'stills_approved', label: 'Scene stills generated and approved', required: true },
  { id: 'motion_done', label: 'Per-scene motion (Ken Burns / I2V / T2V) complete', required: true },
  { id: 'stitched', label: 'Clips stitched with audio/captions', required: true },
  { id: 'critics_pass', label: 'Evidence/brand/platform/visual critics pass', required: true },
  { id: 'delivered', label: 'Deliverable ready for export', required: true },
];

const STANDARD_ITEMS: Array<Omit<GoalItem, 'passes'>> = [
  { id: 'brand_product_locked', label: 'Brand + product identity locked', required: true },
  { id: 'scenes_planned', label: 'Scenes planned for format/platform', required: true },
  { id: 'stills_approved', label: 'Scene stills generated and approved', required: true },
  { id: 'motion_done', label: 'Motion / still export complete', required: true },
  { id: 'stitched', label: 'Final assembly complete', required: false },
  { id: 'critics_pass', label: 'Critics / evidence gates pass', required: true },
  { id: 'delivered', label: 'Deliverable ready', required: true },
];

export function createGoalCard(goal: string, skillPath: LoopSkillPath): GoalCard {
  const templates =
    skillPath === 'recreate_reference_video' ? RECREATE_ITEMS
      : skillPath === 'static_or_carousel'
        ? STANDARD_ITEMS.filter((i) => i.id !== 'motion_done' && i.id !== 'stitched')
        : STANDARD_ITEMS;

  const now = Date.now();
  return {
    goal: goal.trim().slice(0, 2000),
    skillPath,
    items: templates.map((t) => ({ ...t, passes: false })),
    createdAt: now,
    updatedAt: now,
  };
}

export function markGoalPassed(
  card: GoalCard,
  id: GoalItemId,
  evidence?: string,
): GoalCard {
  const items = card.items.map((item) =>
    item.id === id
      ? { ...item, passes: true, evidence: evidence || item.evidence }
      : item,
  );
  return { ...card, items, updatedAt: Date.now() };
}

export function markGoalsPassed(
  card: GoalCard,
  ids: GoalItemId[],
  evidence?: string,
): GoalCard {
  return ids.reduce((c, id) => markGoalPassed(c, id, evidence), card);
}

export function requiredItems(card: GoalCard): GoalItem[] {
  return card.items.filter((i) => i.required);
}

export function allRequiredPassed(card: GoalCard): boolean {
  return requiredItems(card).every((i) => i.passes);
}

export function passedCount(card: GoalCard): { passed: number; required: number } {
  const req = requiredItems(card);
  return { passed: req.filter((i) => i.passes).length, required: req.length };
}

export function formatGoalCardMarkdown(card: GoalCard): string {
  const { passed, required } = passedCount(card);
  const lines = [
    `## Goal card · \`${card.skillPath}\``,
    '',
    `**Goal:** ${card.goal}`,
    `**Progress:** ${passed}/${required} required checks`,
    '',
    ...card.items.map((item) => {
      const box = item.passes ? '[x]' : '[ ]';
      const req = item.required ? '' : ' _(optional)_';
      const ev = item.evidence ? `\n  _${item.evidence}_` : '';
      return `- ${box} **${item.id}** — ${item.label}${req}${ev}`;
    }),
  ];
  return lines.join('\n');
}

/** Deterministic JSON for session persistence. */
export function serializeGoalCard(card: GoalCard): string {
  return JSON.stringify(card, null, 2);
}

export function parseGoalCard(raw: string): GoalCard | null {
  try {
    const parsed = JSON.parse(raw) as GoalCard;
    if (!parsed?.goal || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}
