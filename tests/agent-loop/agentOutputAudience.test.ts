import { describe, expect, it } from 'vitest';
import {
  isDetailsOnlyPhase,
  resolveOutputAudience,
  shouldShowOutput,
  userPhaseLabel,
} from '../../services/agentOutputAudience';

describe('resolveOutputAudience', () => {
  it('defaults markdown without label to user', () => {
    expect(resolveOutputAudience({ type: 'markdown', label: 'Scene Plan' })).toBe('user');
    expect(resolveOutputAudience({ type: 'image', label: 'Scene 1' })).toBe('user');
  });

  it('classifies terminal as debug', () => {
    expect(resolveOutputAudience({ type: 'terminal', label: 'ffmpeg' })).toBe('debug');
  });

  it('classifies capabilities / goal card / task memory as debug', () => {
    expect(resolveOutputAudience({ label: 'Agent Capabilities' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Agent Loop · Goal Card' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Task Memory' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Continuity Lock' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Intelligence Trace' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Forge script' })).toBe('debug');
    expect(resolveOutputAudience({ label: 'Forge run', type: 'terminal' })).toBe('debug');
  });

  it('keeps custom helper and product page as user', () => {
    expect(resolveOutputAudience({ label: 'Custom helper', audience: 'user' })).toBe('user');
    expect(resolveOutputAudience({ label: 'Product page', type: 'image' })).toBe('user');
    expect(resolveOutputAudience({ label: 'Browse tip' })).toBe('user');
  });

  it('classifies critic / evidence labels as review', () => {
    expect(resolveOutputAudience({ label: 'Planning Critic Council' })).toBe('review');
    expect(resolveOutputAudience({ label: 'Evidence Safety Corrections' })).toBe('review');
    expect(resolveOutputAudience({ label: 'Visual Critic · Round 1' })).toBe('review');
    expect(resolveOutputAudience({ label: 'AI Quality Review' })).toBe('review');
  });

  it('keeps milestone steps in the user feed', () => {
    expect(resolveOutputAudience({ label: 'Step', type: 'markdown' })).toBe('user');
    expect(shouldShowOutput({
      label: 'Step',
      type: 'markdown',
      audience: 'user',
      showDetails: false,
    })).toBe(true);
  });

  it('keeps the planner debate transcript out of the user feed', () => {
    expect(shouldShowOutput({
      label: 'Planner debate',
      type: 'markdown',
      audience: 'debug',
      showDetails: false,
    })).toBe(false);
    expect(shouldShowOutput({
      label: 'Planner debate',
      type: 'markdown',
      audience: 'debug',
      showDetails: true,
    })).toBe(true);
  });

  it('honors explicit audience over label inference', () => {
    expect(resolveOutputAudience({ label: 'Agent Capabilities', audience: 'user' })).toBe('user');
    expect(resolveOutputAudience({ label: 'Scene Plan', audience: 'debug' })).toBe('debug');
  });
});

describe('shouldShowOutput', () => {
  it('always shows user audience', () => {
    expect(shouldShowOutput({
      audience: 'user',
      label: 'Product Research',
      showDetails: false,
    })).toBe(true);
  });

  it('hides debug when Details is off', () => {
    expect(shouldShowOutput({
      label: 'Agent Capabilities',
      type: 'markdown',
      showDetails: false,
    })).toBe(false);
    expect(shouldShowOutput({
      label: 'Agent Capabilities',
      type: 'markdown',
      showDetails: true,
    })).toBe(true);
  });

  it('shows review at approval gate even when Details is off', () => {
    expect(shouldShowOutput({
      label: 'Planning Critic Council',
      showDetails: false,
      approvalPending: false,
    })).toBe(false);
    expect(shouldShowOutput({
      label: 'Planning Critic Council',
      showDetails: false,
      approvalPending: true,
    })).toBe(true);
  });

  it('excludes capabilities from the user feed by default', () => {
    const visible = shouldShowOutput({
      label: 'Agent Capabilities',
      type: 'markdown',
      showDetails: false,
      approvalPending: false,
    });
    expect(visible).toBe(false);
    expect(resolveOutputAudience({ label: 'Agent Capabilities' })).not.toBe('user');
  });
});

describe('phase helpers', () => {
  it('maps phases to plain-English labels', () => {
    expect(userPhaseLabel('research')).toBe('Product');
    expect(userPhaseLabel('assemble_video')).toBe('Finishing');
    expect(userPhaseLabel('plan_loop')).toBe('Planning');
  });

  it('hides forge_tool and plan_loop unless Details', () => {
    expect(isDetailsOnlyPhase('forge_tool')).toBe(true);
    expect(isDetailsOnlyPhase('plan_loop')).toBe(true);
    expect(isDetailsOnlyPhase('research')).toBe(false);
  });
});
