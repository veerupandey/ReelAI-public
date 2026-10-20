import { describe, expect, it } from 'vitest';
import { hasDuplicateCreativeScenes } from '../../services/autonomousAgent';

describe('scene diversity guard', () => {
  it('detects repeated video scenes', () => {
    expect(hasDuplicateCreativeScenes([
      { imagePrompt: 'Premium product photo', voiceoverText: 'Ceremonial matcha.' },
      { imagePrompt: 'Premium product photo', voiceoverText: 'Ceremonial matcha.' },
    ])).toBe(true);
  });

  it('allows a distinct narrative sequence', () => {
    expect(hasDuplicateCreativeScenes([
      { imagePrompt: 'Macro powder hook', voiceoverText: 'Start with the scoop.' },
      { imagePrompt: 'Overhead whisk ritual', voiceoverText: 'Whisk until soft foam forms.' },
      { imagePrompt: 'Final product packshot', voiceoverText: 'Make it your morning ritual.' },
    ])).toBe(false);
  });

  it('detects repeated carousel headlines even when visuals differ', () => {
    expect(hasDuplicateCreativeScenes([
      { imagePrompt: 'Macro scoop', voiceoverText: '', slideHeadline: 'Discover More' },
      { imagePrompt: 'Pour shot', voiceoverText: '', slideHeadline: 'Discover More' },
    ])).toBe(true);
  });
});
