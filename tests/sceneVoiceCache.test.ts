import { describe, expect, it } from 'vitest';
import { getSceneSpokenText, getSceneVoiceCacheKey } from '../utils/sceneDrafts';
import type { SceneDraft, VoiceOption } from '../types';

const voice: VoiceOption = {
  provider: 'gemini',
  id: 'Puck',
  label: 'Puck',
  locale: 'en-US',
  gender: 'Male',
};

const baseDraft = {
  id: 'scene-1',
  sceneNumber: 1,
  visualDescription: '',
  imagePrompt: '',
  voiceoverText: '',
  onScreenText: '',
  requestedDurationSec: 3,
  resolvedDurationSec: 3,
  captionMode: 'derived' as const,
  generationStatus: { image: 'clean' as const, voice: 'stale' as const, captions: 'clean' as const },
} as SceneDraft;

describe('scene voice cache key', () => {
  it('uses onScreenText when voiceoverText is empty (same as TTS)', () => {
    const draft = { ...baseDraft, voiceoverText: '', onScreenText: 'Hello from captions' };
    expect(getSceneSpokenText(draft)).toBe('Hello from captions');
    expect(getSceneVoiceCacheKey(draft, voice)).toBe(
      getSceneVoiceCacheKey({ ...draft, voiceoverText: 'Hello from captions', onScreenText: 'ignored' }, voice),
    );
  });

  it('prefers voiceoverText over onScreenText', () => {
    const draft = { ...baseDraft, voiceoverText: 'Spoken', onScreenText: 'Shown' };
    expect(getSceneSpokenText(draft)).toBe('Spoken');
  });
});
