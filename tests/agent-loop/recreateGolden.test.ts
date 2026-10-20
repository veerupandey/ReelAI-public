import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../../services/agentLoop/intentRouter';
import { createGoalCard } from '../../services/agentLoop/goalCard';
import { templateTaskGraph } from '../../services/agentLoop/taskPlanner';

const goldenPath = resolve(
  __dirname,
  '../../evals/ad-agent/recreate-reference-golden.json',
);

describe('golden: recreate reference frames', () => {
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
    prompt: string;
    adFormat: string;
    referenceUploadCount: number;
    expectedIntent: string;
    expectedGoalItems: string[];
    expectedPlanProducers: string[];
  };

  it('classifies intent to recreate_reference_video', () => {
    const intent = classifyIntent({
      prompt: golden.prompt,
      adFormat: golden.adFormat,
      referenceUploadCount: golden.referenceUploadCount,
    });
    expect(intent.skillPath).toBe(golden.expectedIntent);
  });

  it('goal card includes all expected checklist items', () => {
    const card = createGoalCard(golden.prompt, 'recreate_reference_video');
    const ids = card.items.map((i) => i.id);
    for (const expected of golden.expectedGoalItems) {
      expect(ids).toContain(expected);
    }
    expect(card.items.every((i) => i.passes === false)).toBe(true);
  });

  it('template task graph covers recreate producers', () => {
    const graph = templateTaskGraph('recreate_reference_video', golden.prompt);
    const producers = new Set(graph.steps.map((s) => s.producer).filter(Boolean));
    for (const p of golden.expectedPlanProducers) {
      expect(producers.has(p as any) || graph.steps.some((s) => s.id.includes(p.split('_')[0]))).toBe(true);
    }
    expect(graph.steps.some((s) => s.producer === 'reference_ingest')).toBe(true);
    expect(graph.steps.some((s) => s.producer === 'structure_analysis')).toBe(true);
    expect(graph.steps.some((s) => s.producer === 'stills')).toBe(true);
  });
});
