/**
 * Skill routing for the Autonomous General Agent.
 *
 * Combines:
 * 1. Contract skills (agents/skills.ts SKILL_REGISTRY) — always available in-bundle
 * 2. Disk skills (skills/<id>/SKILL.md via shell /skills, with Vite bundle fallback)
 */

import type { SkillId } from '../agents/contracts';
import { renderSkillGuidance, SKILL_REGISTRY } from '../agents/skills';
import { formatSkillsForPrompt, loadSkills } from './toolRegistry';

/** Disk skill folder ids under skills/ that the general agent may load. */
export const GENERAL_AGENT_DISK_SKILLS = [
  'product-research',
  'trend-analysis',
  'social-media-strategy',
  'social-media-marketing',
  'ad-copywriting',
  'marketing-copywriting',
  'creative-copywriting',
  'copywriting',
  'creative-review',
  'image-generation',
  'video-assembly',
  'voiceover-production',
  'caption-design',
  'platform-export',
  'static-image-export',
  'carousel-export',
  'veo3-video',
  'campaign-memory',
  'recreate-reference-video',
] as const;

export type GeneralAgentDiskSkillId = (typeof GENERAL_AGENT_DISK_SKILLS)[number];

export interface GeneralAgentSkillPack {
  /** Contract SkillIds injected as guidance bullets. */
  contractSkillIds: SkillId[];
  /** Disk skill folder ids loaded from skills/ (shell or Vite bundle). */
  diskSkillIds: string[];
  /** Ready-to-inject markdown for planner / workers. */
  promptBlock: string;
  /** Short labels for UI / logs. */
  labels: string[];
}

type DiskRule = { re: RegExp; ids: string[]; weight?: number };
type ContractRule = { re: RegExp; ids: SkillId[]; weight?: number };

const DISK_RULES: DiskRule[] = [
  { re: /\b(competitors?|rival|vs\.?|versus)\b/i, ids: ['social-media-marketing', 'trend-analysis', 'ad-copywriting'] },
  { re: /\b(product|sku|packshot|shopify|amazon|pdp|merchandis)\b/i, ids: ['product-research'] },
  { re: /\b(trend|viral|tiktok|reels?|shorts?|instagram|social)\b/i, ids: ['trend-analysis', 'social-media-strategy', 'social-media-marketing'] },
  { re: /\b(copy|headline|caption|script|voiceover|vo\b|tagline)\b/i, ids: ['ad-copywriting', 'marketing-copywriting', 'copywriting', 'creative-copywriting', 'caption-design'] },
  { re: /\b(review|critique|qa|quality|score)\b/i, ids: ['creative-review'] },
  { re: /\b(image|visual|still|packshot|generate.*(image|visual))\b/i, ids: ['image-generation'] },
  { re: /\b(ffmpeg|assemble|ken burns|edit clip|concat|xfade)\b/i, ids: ['video-assembly'], weight: 5 },
  { re: /\b(video|mp4|reel|clip)\b/i, ids: ['video-assembly', 'platform-export', 'voiceover-production', 'caption-design'] },
  { re: /\b(carousel|slides?)\b/i, ids: ['carousel-export', 'ad-copywriting'] },
  { re: /\b(static|feed post|poster)\b/i, ids: ['static-image-export', 'ad-copywriting'] },
  { re: /\b(veo|ai video)\b/i, ids: ['veo3-video'] },
  { re: /\b(recreate|reference (reel|video|ad)|match this)\b/i, ids: ['recreate-reference-video'] },
  { re: /\b(memory|brand dna|brand memory)\b/i, ids: ['campaign-memory'] },
  { re: /\b(export|platform.?spec|safe.?zone)\b/i, ids: ['platform-export'] },
];

const CONTRACT_RULES: ContractRule[] = [
  { re: /\b(competitors?|rival|vs\.?|versus)\b/i, ids: ['competitor_ad_analysis', 'research_methodology'] },
  { re: /\b(product|url|shopify|amazon|pdp)\b/i, ids: ['product_page_import', 'url_signal_extraction', 'research_methodology'] },
  { re: /\b(social|instagram|tiktok|reels?|shorts?)\b/i, ids: ['social_profile_analysis', 'research_methodology'] },
  { re: /\b(storyboard|scene|creative|hook|narrative)\b/i, ids: ['creative_storyboarding', 'imaginative_storytelling'] },
  { re: /\b(review|critique|qa|score)\b/i, ids: ['creative_qa_review'] },
  { re: /\b(brand|dna|identity|palette)\b/i, ids: ['brand_memory_synthesis', 'brand_asset_grounding'] },
  { re: /\b(video|assemble|duration|reel)\b/i, ids: ['duration_fit_planning', 'video_production'] },
  { re: /\b(evidence|claim|fact)\b/i, ids: ['product_evidence_grounding', 'structured_json_delivery'] },
];

const DEFAULT_CONTRACT: SkillId[] = [
  'research_methodology',
  'structured_json_delivery',
  'creative_qa_review',
];

const DEFAULT_DISK = ['product-research', 'trend-analysis', 'creative-review'];

function uniquePreserve<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Rank + select contract SkillIds from a free-text goal. */
export function selectContractSkillsForGoal(
  goal: string,
  opts?: { prefer?: SkillId[]; max?: number },
): SkillId[] {
  const text = (goal || '').trim();
  const scored = new Map<SkillId, number>();
  const bump = (id: SkillId, n: number) => scored.set(id, (scored.get(id) || 0) + n);

  for (const id of opts?.prefer || []) bump(id, 2);
  for (const id of DEFAULT_CONTRACT) bump(id, 1);

  if (text) {
    for (const rule of CONTRACT_RULES) {
      if (!rule.re.test(text)) continue;
      for (const id of rule.ids) bump(id, rule.weight ?? 3);
    }
  }

  const ranked = [...scored.entries()]
    .filter(([id]) => Boolean(SKILL_REGISTRY[id]))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  return uniquePreserve(ranked).slice(0, opts?.max ?? 6);
}

/** Rank + select disk skill folder ids from a free-text goal. */
export function selectDiskSkillsForGoal(
  goal: string,
  opts?: { prefer?: string[]; max?: number; available?: string[] },
): string[] {
  const text = (goal || '').trim();
  const allow = opts?.available ? new Set(opts.available) : null;
  const scored = new Map<string, number>();
  const bump = (id: string, n: number) => {
    if (allow && !allow.has(id)) return;
    scored.set(id, (scored.get(id) || 0) + n);
  };

  for (const id of opts?.prefer || []) bump(id, 2);
  for (const id of DEFAULT_DISK) bump(id, 1);

  if (text) {
    for (const rule of DISK_RULES) {
      if (!rule.re.test(text)) continue;
      for (const id of rule.ids) bump(id, rule.weight ?? 3);
    }
  }

  const ranked = [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  return uniquePreserve(ranked).slice(0, opts?.max ?? 5);
}

/** Pick skills for a worker role + brief (subset of the run pack). */
export function selectSkillsForWorker(args: {
  role: string;
  instructions: string;
  runContractIds: SkillId[];
  runDiskIds: string[];
  explicit?: string[];
}): { contractSkillIds: SkillId[]; diskSkillIds: string[] } {
  const hay = `${args.role} ${args.instructions}`.toLowerCase();
  const contract = selectContractSkillsForGoal(hay, {
    prefer: args.runContractIds,
    max: 4,
  }).filter((id) => args.runContractIds.includes(id) || DEFAULT_CONTRACT.includes(id));

  const diskFromRole = selectDiskSkillsForGoal(hay, {
    prefer: args.runDiskIds,
    available: args.runDiskIds,
    max: 3,
  });

  const explicitDisk = (args.explicit || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((id) => args.runDiskIds.includes(id) || GENERAL_AGENT_DISK_SKILLS.includes(id as GeneralAgentDiskSkillId));

  return {
    contractSkillIds: uniquePreserve([
      ...contract,
      ...((args.explicit || [])
        .map((s) => s.replace(/-/g, '_') as SkillId)
        .filter((id) => Boolean(SKILL_REGISTRY[id]))),
    ]).slice(0, 5),
    diskSkillIds: uniquePreserve([...explicitDisk, ...diskFromRole]).slice(0, 4),
  };
}

async function buildPromptBlock(
  contractSkillIds: SkillId[],
  diskSkillIds: string[],
): Promise<{ promptBlock: string; labels: string[]; resolvedDiskIds: string[] }> {
  const guidance = renderSkillGuidance(contractSkillIds);
  const labels = [
    ...contractSkillIds.map((id) => SKILL_REGISTRY[id]?.name || id),
  ];

  let diskBlock = '';
  let resolvedDiskIds: string[] = [];
  if (diskSkillIds.length) {
    try {
      const available = await loadSkills();
      const availableIds = new Set(available.map((s) => s.id));
      resolvedDiskIds = diskSkillIds.filter((id) => availableIds.has(id));
      if (resolvedDiskIds.length) {
        diskBlock = await formatSkillsForPrompt(resolvedDiskIds);
        for (const id of resolvedDiskIds) {
          const meta = available.find((s) => s.id === id);
          labels.push(meta?.name || id);
        }
      }
    } catch {
      resolvedDiskIds = [];
    }
  }

  const parts = [
    '## Active skills',
    guidance ? `### Contract guidance\n${guidance}` : '',
    diskBlock.trim(),
  ].filter(Boolean);

  return {
    promptBlock: parts.join('\n\n'),
    labels: uniquePreserve(labels),
    resolvedDiskIds,
  };
}

/**
 * Resolve the skill pack for a General Agent run from the goal (+ optional prefs).
 */
export async function resolveGeneralAgentSkills(args: {
  goal: string;
  preferContract?: SkillId[];
  preferDisk?: string[];
  maxContract?: number;
  maxDisk?: number;
}): Promise<GeneralAgentSkillPack> {
  let availableDisk: string[] | undefined;
  try {
    const loaded = await loadSkills();
    availableDisk = loaded.map((s) => s.id);
  } catch {
    availableDisk = undefined;
  }

  const contractSkillIds = selectContractSkillsForGoal(args.goal, {
    prefer: args.preferContract,
    max: args.maxContract ?? 6,
  });
  const diskSkillIds = selectDiskSkillsForGoal(args.goal, {
    prefer: args.preferDisk,
    available: availableDisk,
    max: args.maxDisk ?? 5,
  });

  const { promptBlock, labels, resolvedDiskIds } = await buildPromptBlock(
    contractSkillIds,
    diskSkillIds,
  );

  return {
    contractSkillIds,
    diskSkillIds: resolvedDiskIds.length ? resolvedDiskIds : diskSkillIds,
    promptBlock,
    labels,
  };
}

/** Format a compact skill block for a single worker. */
export async function formatWorkerSkillBlock(args: {
  role: string;
  instructions: string;
  runPack: GeneralAgentSkillPack;
  explicitSkillIds?: string[];
}): Promise<{ promptBlock: string; contractSkillIds: SkillId[]; diskSkillIds: string[] }> {
  const picked = selectSkillsForWorker({
    role: args.role,
    instructions: args.instructions,
    runContractIds: args.runPack.contractSkillIds,
    runDiskIds: args.runPack.diskSkillIds,
    explicit: args.explicitSkillIds,
  });
  const { promptBlock, resolvedDiskIds } = await buildPromptBlock(
    picked.contractSkillIds,
    picked.diskSkillIds,
  );
  return {
    promptBlock,
    contractSkillIds: picked.contractSkillIds,
    diskSkillIds: resolvedDiskIds.length ? resolvedDiskIds : picked.diskSkillIds,
  };
}
