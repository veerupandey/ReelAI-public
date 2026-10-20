import { describe, expect, it } from 'vitest';
import { normalizePlanDurations } from '../services/geminiService';
import type { ReelPlan } from '../types';
import {
  allocateDurationsToTarget,
  countSpokenWords,
  estimateSpokenDurationSec,
  getSceneVoiceCacheKey,
  getSceneScriptBudget,
  isUsefulSpokenLine,
  maxWordsForSlot,
  sceneNeedsScriptFit,
  SPOKEN_SCENE_MIN_SEC,
  truncateSpokenTextToBudget,
  WORDS_PER_SEC,
} from '../utils/sceneDrafts';

describe('script fit word budget helpers', () => {
  it('computes max words from slot with a useful minimum', () => {
    expect(maxWordsForSlot(4)).toBe(Math.max(6, Math.floor(4 * WORDS_PER_SEC)));
    expect(maxWordsForSlot(4)).toBe(10);
    expect(maxWordsForSlot(1.4)).toBe(6);
  });

  it('estimates spoken duration from word count', () => {
    expect(estimateSpokenDurationSec('one two three')).toBe(1.2);
    expect(countSpokenWords('hello world')).toBe(2);
  });

  it('flags clearly over-budget scenes and leaves short lines ok', () => {
    const longLine = 'This is a long spoken line that clearly exceeds a tiny slot budget for voiceover and keeps going with even more words.';
    const over = getSceneScriptBudget({
      voiceoverText: longLine,
      onScreenText: '',
      requestedDurationSec: 2.8,
    });
    expect(over.needsFit).toBe(true);
    expect(over.status).toBe('over');
    expect(sceneNeedsScriptFit({
      voiceoverText: longLine,
      onScreenText: '',
      requestedDurationSec: 2.8,
    })).toBe(true);

    const ok = getSceneScriptBudget({
      voiceoverText: 'Your skin barrier repairs overnight.',
      onScreenText: '',
      requestedDurationSec: 3,
    });
    expect(ok.needsFit).toBe(false);
    expect(ok.status).toBe('ok');
  });

  it('compresses toward budget without producing useless stubs', () => {
    const source = 'Your skin barrier repairs overnight when you use this serum every night.';
    const truncated = truncateSpokenTextToBudget(source, 8);
    expect(countSpokenWords(truncated)).toBeLessThanOrEqual(10);
    expect(isUsefulSpokenLine(truncated)).toBe(true);
    expect(truncated.toLowerCase()).toContain('skin');
  });

  it('keeps useful original meaning when hard cut would destroy the line', () => {
    const source = 'Stop guessing your skincare. This serum fixes your barrier in seven nights.';
    const result = truncateSpokenTextToBudget(source, 6);
    expect(isUsefulSpokenLine(result)).toBe(true);
    // Prefer first sentence over a glue-word stub.
    expect(result.toLowerCase()).toMatch(/stop guessing|serum|barrier/);
  });

  it('changes only the edited scene cache key', () => {
    const voice = { provider: 'gemini', id: 'Puck' };
    const first = {
      id: 'scene-1',
      voiceoverText: 'Original meaningful spoken line.',
      onScreenText: '',
    };
    const second = {
      id: 'scene-2',
      voiceoverText: 'Unaffected meaningful spoken line.',
      onScreenText: '',
    };
    const originalKeys = [
      getSceneVoiceCacheKey(first as any, voice as any),
      getSceneVoiceCacheKey(second as any, voice as any),
    ];
    const correctedKeys = [
      getSceneVoiceCacheKey({ ...first, voiceoverText: 'Shorter meaningful line.' } as any, voice as any),
      getSceneVoiceCacheKey(second as any, voice as any),
    ];
    expect(correctedKeys[0]).not.toBe(originalKeys[0]);
    expect(correctedKeys[1]).toBe(originalKeys[1]);
  });
});

describe('spoken scene min duration', () => {
  it('keeps allocated scenes at or above spoken floor when requested', () => {
    const allocated = allocateDurationsToTarget(
      [
        { scriptGuidance: 'HOOK', estimatedDuration: 1 },
        { scriptGuidance: 'BODY', estimatedDuration: 1 },
        { scriptGuidance: 'CTA', estimatedDuration: 1 },
      ],
      20,
      { minSec: SPOKEN_SCENE_MIN_SEC },
    );
    expect(allocated.every((value) => value >= SPOKEN_SCENE_MIN_SEC - 0.05)).toBe(true);
  });

  it('normalizePlanDurations uses spoken floor by default', () => {
    const plan: ReelPlan = {
      topic: 'Test',
      vibe: 'fast',
      strategicReasoning: 'test',
      scenes: [
        {
          sceneNumber: 1,
          visualDescription: 'Hook',
          imagePrompt: 'Hook',
          estimatedDuration: 1,
          scriptGuidance: 'HOOK long line that would not fit a 1s slot at all',
        },
        {
          sceneNumber: 2,
          visualDescription: 'Body',
          imagePrompt: 'Body',
          estimatedDuration: 1,
          scriptGuidance: 'BODY proof',
        },
        {
          sceneNumber: 3,
          visualDescription: 'CTA',
          imagePrompt: 'CTA',
          estimatedDuration: 1,
          scriptGuidance: 'CTA takeaway',
        },
      ],
    };

    const normalized = normalizePlanDurations(plan, 20);
    expect(normalized.scenes.every((scene) => scene.estimatedDuration >= SPOKEN_SCENE_MIN_SEC - 0.05)).toBe(true);
    const sum = normalized.scenes.reduce((total, scene) => total + scene.estimatedDuration, 0);
    expect(Math.abs(sum - 20)).toBeLessThan(0.2);
  });

  it('keeps a short requested total when the spoken floor is infeasible', () => {
    const plan: ReelPlan = {
      topic: 'Short reel',
      vibe: 'fast',
      strategicReasoning: 'test',
      scenes: Array.from({ length: 7 }, (_, index) => ({
        sceneNumber: index + 1,
        visualDescription: `Scene ${index + 1}`,
        imagePrompt: `Scene ${index + 1}`,
        scriptGuidance: index === 0 ? 'HOOK: Start here.' : 'BODY: Continue.',
        estimatedDuration: 3,
      })),
    };

    const normalized = normalizePlanDurations(plan, 15);
    const sum = normalized.scenes.reduce((total, scene) => total + scene.estimatedDuration, 0);
    expect(Math.abs(sum - 15)).toBeLessThan(0.15);
  });
});
