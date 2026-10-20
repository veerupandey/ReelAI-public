import { describe, expect, it } from 'vitest';
import { TaskRunMemory } from '../../services/taskRunMemory';

describe('TaskRunMemory', () => {
  it('remembers feedback and surfaces standing Live Motion preference', () => {
    const mem = new TaskRunMemory();
    mem.remember('research', 'brief', 'Matcha latte ad for IG Reels');
    mem.rememberFeedback('plan_scenes', 'consider live motion on all scenes');
    mem.rememberAction('plan_scenes', 'Enabled Wan Live Motion on 3 scenes', ['live_motion']);

    expect(mem.preferences.preferLiveMotion).toBe(true);
    const prompt = mem.formatForPrompt();
    expect(prompt).toContain('USE Live Motion');
    expect(prompt).toContain('consider live motion');
    expect(prompt).toContain('[DID/plan_scenes]');
  });

  it('overrides Live Motion when user asks for Ken Burns', () => {
    const mem = new TaskRunMemory();
    mem.rememberFeedback('plan_scenes', 'use live motion');
    expect(mem.preferences.preferLiveMotion).toBe(true);
    mem.rememberFeedback('deliver', 'no live motion — ken burns only');
    expect(mem.preferences.preferLiveMotion).toBe(false);
    expect(mem.formatForPrompt()).toContain('Ken Burns stills');
  });

  it('keeps VO preference and remembers voice/vibe hints', () => {
    const mem = new TaskRunMemory();
    mem.rememberFeedback('deliver', 'video is fine, regen audio Gen Z hyper female');
    expect(mem.preferences.keepVoiceoverUnlessAsked).toBe(true);
    expect(mem.preferences.vibe).toBe('gen_z_bright');
    mem.preferences.voice = 'Leda';
    const prompt = mem.formatForPrompt();
    expect(prompt).toContain('voice = Leda');
    expect(prompt).toContain('keep existing VO');
  });

  it('clear resets entries and preferences', () => {
    const mem = new TaskRunMemory();
    mem.rememberFeedback('plan_scenes', 'use live motion');
    mem.clear();
    expect(mem.toJSON().entries).toHaveLength(0);
    expect(mem.preferences.preferLiveMotion).toBeUndefined();
    expect(mem.preferences.keepVoiceoverUnlessAsked).toBe(true);
    expect(mem.formatForPrompt()).toBe('');
  });
});
