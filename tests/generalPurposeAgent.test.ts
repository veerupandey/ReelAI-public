import { describe, expect, it } from 'vitest';
import {
  buildGeneralAgentFallbackPlan,
  buildGeneralAgentPlanFromModelJson,
  GeneralPurposeAgent,
} from '../services/generalPurposeAgent';

describe('GeneralPurposeAgent planning', () => {
  it('normalizes model JSON into capped parallel waves', () => {
    const plan = buildGeneralAgentPlanFromModelJson(
      {
        summary: 'Research then write',
        deliverable: 'Brief',
        workers: [
          { id: 'w1', title: 'A', role: 'researcher', instructions: 'do a', useTools: false },
          { id: 'w2', title: 'B', role: 'analyst', instructions: 'do b', useTools: true },
          { id: 'w3', title: 'C', role: 'writer', instructions: 'do c', useTools: false },
        ],
        phases: [['w1', 'w2', 'w3']],
      },
      'goal',
      2,
    );
    expect(plan.workers).toHaveLength(3);
    expect(plan.phases[0]).toEqual(['w1', 'w2']); // capped by maxWorkers
    expect(plan.workers[1].useTools).toBe(true);
  });

  it('fallback plan fans out research + analysis', () => {
    const plan = buildGeneralAgentFallbackPlan('Launch brief for matcha', 3);
    expect(plan.workers.length).toBeGreaterThanOrEqual(2);
    expect(plan.phases.length).toBeGreaterThanOrEqual(1);
    expect(plan.phases[0].length).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty goals without starting a run', async () => {
    const agent = new GeneralPurposeAgent();
    const events: string[] = [];
    const result = await agent.run(
      { goal: '   ', reviewMode: 'auto' },
      (e) => events.push(e.type),
    );
    expect(result).toBeNull();
    expect(events).toContain('error');
  });
});
