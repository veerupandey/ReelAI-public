import { describe, expect, it } from 'vitest';
import { AD_AGENT, GENERAL_PURPOSE_AGENT } from '../runtime/agentDefinitions';
import { getAgent, getAllAgents } from '../runtime/agentRegistry';

describe('Agent Hub registry — shippable paths', () => {
  it('registers ad-agent and general-agent with wired runners', () => {
    const agents = getAllAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id).sort()).toEqual(['ad-agent', 'general-agent']);
    expect(getAgent('ad-agent')).toEqual(AD_AGENT);
    expect(getAgent('general-agent')).toEqual(GENERAL_PURPOSE_AGENT);
  });

  it('does not expose stub agents without runners', () => {
    expect(getAgent('brief-agent')).toBeUndefined();
    expect(getAgent('trend-agent')).toBeUndefined();
  });

  it('ad-agent includes HITL reviewMode in the form schema', () => {
    const reviewField = AD_AGENT.uiSchema.find((f) => f.id === 'reviewMode');
    expect(reviewField).toBeDefined();
    expect(reviewField?.type).toBe('toggle');
  });

  it('general-agent exposes goal + fan-out controls', () => {
    expect(GENERAL_PURPOSE_AGENT.requiredTools).toEqual([]);
    expect(GENERAL_PURPOSE_AGENT.uiSchema.find((f) => f.id === 'goal')?.required).toBe(true);
    expect(GENERAL_PURPOSE_AGENT.uiSchema.find((f) => f.id === 'maxWorkers')?.max).toBe(5);
  });

  it('general-agent declares a rich skill set for routing', () => {
    expect(GENERAL_PURPOSE_AGENT.skills).toEqual(
      expect.arrayContaining([
        'research_methodology',
        'competitor_ad_analysis',
        'creative_qa_review',
        'structured_json_delivery',
      ]),
    );
  });
});
