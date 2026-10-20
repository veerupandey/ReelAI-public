/**
 * Memory manage — consolidate, phase-scoped retrieve, high-signal writes.
 * Persists goal-card progress in the session directory.
 */
import type { MemoryEntry, MemoryPhase } from '../agentMemory';
import {
  formatGoalCardMarkdown,
  parseGoalCard,
  serializeGoalCard,
} from './goalCard';
import type { GoalCard } from './types';

async function callToolLazy(
  name: string,
  args: Record<string, unknown>,
) {
  const { callTool } = await import('../toolRegistry');
  return callTool(name, args);
}

const GOAL_CARD_FILE = 'goal_card.json';
const LOOP_STATE_FILE = 'loop_state.json';

/** Collapse near-duplicate mistake→correction pairs. */
export function consolidateMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    const key = `${entry.phase}|${normalizeKey(entry.what_went_wrong)}|${normalizeKey(entry.better_approach)}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, entry);
      continue;
    }
    // Keep the newer / more detailed example
    if ((entry.example?.length || 0) > (prev.example?.length || 0)) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values());
}

function normalizeKey(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Retrieve only entries for the active phase (+ `all`), capped. */
export function retrieveMemoryForPhase(
  entries: MemoryEntry[],
  phase: MemoryPhase | string,
  limit = 12,
): MemoryEntry[] {
  const consolidated = consolidateMemoryEntries(entries);
  const phaseKey = (phase || 'all').toString();
  const filtered = consolidated.filter(
    (e) => e.phase === 'all' || e.phase === phaseKey || phaseKey === 'all',
  );
  return filtered.slice(-limit);
}

export function shouldWriteMemory(signal: {
  source: 'hitl_edit' | 'critic_fail' | 'regen' | 'user_rating' | 'other';
  text?: string;
}): boolean {
  if (signal.source === 'other') return false;
  if (!signal.text?.trim() && signal.source !== 'user_rating') return false;
  return true;
}

export async function persistGoalCard(
  sessionDir: string,
  card: GoalCard,
): Promise<{ ok: boolean; error?: string }> {
  if (!sessionDir) return { ok: false, error: 'No sessionDir' };
  const code = `
import json, os
path = os.path.join(${JSON.stringify(sessionDir)}, ${JSON.stringify(GOAL_CARD_FILE)})
with open(path, "w", encoding="utf-8") as f:
    f.write(${JSON.stringify(serializeGoalCard(card))})
print(path)
`;
  const result = await callToolLazy('python_exec', { code, sessionDir, filename: 'persist_goal_card.py' });
  return { ok: !result.isError, error: result.isError ? result.content[0]?.text : undefined };
}

export async function loadGoalCard(sessionDir: string): Promise<GoalCard | null> {
  if (!sessionDir) return null;
  const code = `
import os
path = os.path.join(${JSON.stringify(sessionDir)}, ${JSON.stringify(GOAL_CARD_FILE)})
print(open(path, encoding="utf-8").read() if os.path.exists(path) else "")
`;
  const result = await callToolLazy('python_exec', { code, sessionDir, filename: 'load_goal_card.py' });
  if (result.isError) return null;
  const text = result.content.map((c) => c.text || '').join('').trim();
  if (!text) return null;
  return parseGoalCard(text);
}

export async function persistLoopState(
  sessionDir: string,
  state: Record<string, unknown>,
): Promise<void> {
  if (!sessionDir) return;
  const code = `
import json, os
path = os.path.join(${JSON.stringify(sessionDir)}, ${JSON.stringify(LOOP_STATE_FILE)})
with open(path, "w", encoding="utf-8") as f:
    json.dump(${JSON.stringify(state)}, f, indent=2)
print(path)
`;
  await callToolLazy('python_exec', { code, sessionDir, filename: 'persist_loop_state.py' });
}

export function goalCardPromptBlock(card: GoalCard): string {
  return `\n${formatGoalCardMarkdown(card)}\n`;
}
