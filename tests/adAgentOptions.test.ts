import { describe, expect, it } from 'vitest';
import {
  AD_AGENT_DURATION_MIN,
  AD_AGENT_VOICE_OPTIONS,
  adAgentSceneBounds,
  clampAdAgentDurationSec,
  coerceAdAgentVoice,
  estimateAdAgentSceneCount,
  isAdAgentDurationPreset,
  resolveAdAgentVoiceFromFeedback,
} from '../runtime/adAgentOptions';

describe('adAgentOptions', () => {
  it('clamps custom duration into 5–90s (bumper through long-form)', () => {
    expect(AD_AGENT_DURATION_MIN).toBe(5);
    expect(clampAdAgentDurationSec(20)).toBe(20);
    expect(clampAdAgentDurationSec(5)).toBe(5);
    expect(clampAdAgentDurationSec(3)).toBe(5);
    expect(clampAdAgentDurationSec(120)).toBe(90);
    expect(clampAdAgentDurationSec('45')).toBe(45);
  });

  it('recognizes duration presets including 5s bumper', () => {
    expect(isAdAgentDurationPreset(5)).toBe(true);
    expect(isAdAgentDurationPreset(30)).toBe(true);
    expect(isAdAgentDurationPreset(20)).toBe(false);
  });

  it('estimates scene count from duration without over-packing bumpers', () => {
    expect(estimateAdAgentSceneCount(5)).toBe(1);
    expect(estimateAdAgentSceneCount(8)).toBe(2);
    expect(estimateAdAgentSceneCount(15)).toBe(3);
    expect(estimateAdAgentSceneCount(30)).toBe(5);
    expect(estimateAdAgentSceneCount(90)).toBeGreaterThanOrEqual(5);
    expect(estimateAdAgentSceneCount(90)).toBeLessThanOrEqual(8);
  });

  it('exposes duration-aware scene bounds for native planning', () => {
    expect(adAgentSceneBounds(5)).toEqual({ minScenes: 1, maxScenes: 2 });
    expect(adAgentSceneBounds(15).minScenes).toBeLessThanOrEqual(2);
    expect(adAgentSceneBounds(30)).toEqual({ minScenes: 3, maxScenes: 8 });
  });

  it('exposes an expanded Gemini voice list', () => {
    expect(AD_AGENT_VOICE_OPTIONS.length).toBeGreaterThan(10);
    expect(AD_AGENT_VOICE_OPTIONS.map((v) => v.value)).toEqual(
      expect.arrayContaining(['Kore', 'Puck', 'Aoede', 'Rishi', 'Mira']),
    );
  });

  it('resolves Gen Z hyper female feedback to a lively voice', () => {
    const r = resolveAdAgentVoiceFromFeedback(
      'please regenerate with a gen z hyper loud energy female',
    );
    expect(r.regenAudio).toBe(true);
    expect(r.voice).toBe('Sadachbia');
    expect(r.vibe).toBe('gen_z_bright');
    expect(r.restyleScript).toBe(true);
  });

  it('resolves named voice and ignores visual-only feedback', () => {
    expect(resolveAdAgentVoiceFromFeedback('switch voice to Leda').voice).toBe('Leda');
    expect(resolveAdAgentVoiceFromFeedback('change the model').regenAudio).toBe(false);
    expect(coerceAdAgentVoice('not-a-voice', 'Kore')).toBe('Kore');
  });
});
