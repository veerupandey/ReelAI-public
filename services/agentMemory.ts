/**
 * Agent Memory Service
 * Persists feedback about what went wrong and what would have been better.
 * Two scopes:
 *   global  → applies to all brands/products (factual rules, technical fixes)
 *   brand   → applies only to a specific brand (tone, style, aesthetic preferences)
 *
 * Memory is injected as constraints into agent prompts before each phase.
 */

import { SHELL_SERVER } from './shellToolService';

export type MemoryScope = 'global' | 'brand';

export type MemoryPhase =
  | 'research'
  | 'plan_scenes'
  | 'generate_images'
  | 'generate_voiceover'
  | 'assemble_video'
  | 'all';

export interface MemoryEntry {
  phase: MemoryPhase;
  what_went_wrong: string;   // e.g. "used walnut in ingredients scene"
  better_approach: string;   // e.g. "only use ingredients listed on the product page"
  example?: string;          // optional concrete example
  ts?: string;               // set by server
}

export interface MemorySummary {
  file: string;
  count: number;
  latest: string | null;
}

/** Write a memory entry (called after user rates a run). */
export const writeMemory = async (
  entry: MemoryEntry,
  scope: MemoryScope,
  brandSlug?: string,
): Promise<void> => {
  await fetch(`${SHELL_SERVER}/memory/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, brandSlug: brandSlug ?? '', entry }),
  });
};

/** Read memory entries relevant to a phase (global + brand merged). */
export const readMemory = async (
  phase: MemoryPhase | '',
  brandSlug?: string,
): Promise<MemoryEntry[]> => {
  try {
    const params = new URLSearchParams({ scope: 'all', phase: phase || '' });
    if (brandSlug) params.set('brand', brandSlug);
    const res = await fetch(`${SHELL_SERVER}/memory/read?${params}`);
    const data = await res.json() as { entries: MemoryEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
};

/** List all memory files with entry counts. */
export const listMemory = async (): Promise<MemorySummary[]> => {
  try {
    const res = await fetch(`${SHELL_SERVER}/memory/list`);
    const data = await res.json() as { summary: MemorySummary[] };
    return data.summary ?? [];
  } catch {
    return [];
  }
};

/** Clear memory for a scope. */
export const clearMemory = async (scope: MemoryScope, brandSlug?: string): Promise<void> => {
  await fetch(`${SHELL_SERVER}/memory/clear`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, brandSlug: brandSlug ?? '' }),
  });
};

/**
 * Format memory entries as a constraint block for injection into LLM prompts.
 * Returns empty string if no entries.
 */
export const formatMemoryForPrompt = (entries: MemoryEntry[]): string => {
  if (entries.length === 0) return '';
  const lines = entries.map((e, i) =>
    `${i + 1}. MISTAKE: "${e.what_went_wrong}" → CORRECT: "${e.better_approach}"${e.example ? ` (e.g. ${e.example})` : ''}`
  );
  return `\nLEARNED RULES FROM PAST RUNS (must follow strictly):\n${lines.join('\n')}\n`;
};
