import { describe, expect, it } from 'vitest';
import {
  consolidateMemoryEntries,
  retrieveMemoryForPhase,
  shouldWriteMemory,
} from '../../services/agentLoop/memoryManage';
import type { MemoryEntry } from '../../services/agentMemory';

const entries: MemoryEntry[] = [
  {
    phase: 'plan_scenes',
    what_went_wrong: 'used walnut',
    better_approach: 'only product-page ingredients',
  },
  {
    phase: 'plan_scenes',
    what_went_wrong: 'Used Walnut',
    better_approach: 'only product-page ingredients',
    example: 'almonds ok if listed',
  },
  {
    phase: 'generate_images',
    what_went_wrong: 'label warped',
    better_approach: 'use product lock prefix',
  },
  {
    phase: 'all',
    what_went_wrong: 'too dark',
    better_approach: 'brighter key light',
  },
];

describe('memory manage', () => {
  it('consolidates near-duplicate entries keeping richer example', () => {
    const out = consolidateMemoryEntries(entries);
    const plan = out.filter((e) => e.phase === 'plan_scenes');
    expect(plan).toHaveLength(1);
    expect(plan[0].example).toMatch(/almonds/);
  });

  it('retrieves phase + all entries capped', () => {
    const out = retrieveMemoryForPhase(entries, 'generate_images', 10);
    expect(out.some((e) => e.phase === 'generate_images')).toBe(true);
    expect(out.some((e) => e.phase === 'all')).toBe(true);
    expect(out.every((e) => e.phase !== 'plan_scenes')).toBe(true);
  });

  it('only writes on high-signal events', () => {
    expect(shouldWriteMemory({ source: 'critic_fail', text: 'product drift' })).toBe(true);
    expect(shouldWriteMemory({ source: 'hitl_edit', text: 'fix VO' })).toBe(true);
    expect(shouldWriteMemory({ source: 'other', text: 'noise' })).toBe(false);
  });
});
