import { describe, expect, it } from 'vitest';
import { normalizePlanDurations } from '../services/geminiService';
import type { ReelPlan, SceneDraft } from '../types';
import {
  allocateDurationsToTarget,
  assessMeasuredNarrationFeasibility,
  buildMeasuredNarrationCorrectionPlan,
  buildVoiceSlotMeter,
  equalSplitDurations,
  getScenePacingRole,
  isVoiceStretchExtreme,
  parseSceneRole,
  reconcileTimelineToMeasuredVoice,
  resolveVoiceTimelineTargets,
  rippleUnlockedDurationsToTarget,
  sumSceneDurations,
} from '../utils/sceneDrafts';

describe('allocateDurationsToTarget', () => {
  it('sums exactly to the target duration', () => {
    const allocated = allocateDurationsToTarget(
      [
        { scriptGuidance: 'HOOK: open cold', estimatedDuration: 4 },
        { scriptGuidance: 'BODY: proof point', estimatedDuration: 4 },
        { scriptGuidance: 'BODY: context', estimatedDuration: 4 },
        { scriptGuidance: 'CTA: takeaway', estimatedDuration: 4 },
      ],
      30,
    );

    expect(allocated).toHaveLength(4);
    expect(Math.abs(sumSceneDurations(allocated.map((estimatedDuration) => ({ estimatedDuration }))) - 30)).toBeLessThan(0.15);
  });

  it('keeps hook shorter than cta when roles are present', () => {
    const allocated = allocateDurationsToTarget(
      [
        { scriptGuidance: 'HOOK' },
        { scriptGuidance: 'BODY proof' },
        { scriptGuidance: 'BODY message' },
        { scriptGuidance: 'CTA' },
      ],
      30,
    );

    expect(allocated[0]).toBeLessThan(allocated[allocated.length - 1]);
    expect(parseSceneRole('HOOK')).toBe('hook');
    expect(parseSceneRole('CTA takeaway')).toBe('cta');
  });

  it('fits to target within 0.1s while preserving relative shape', () => {
    const scenes = [
      { scriptGuidance: 'HOOK', requestedDurationSec: 3 },
      { scriptGuidance: 'BODY', requestedDurationSec: 8 },
      { scriptGuidance: 'BODY', requestedDurationSec: 10 },
      { scriptGuidance: 'CTA', requestedDurationSec: 6 },
    ];
    const allocated = allocateDurationsToTarget(scenes, 30, { preserveRelative: true });
    const sum = allocated.reduce((total, value) => total + value, 0);

    expect(Math.abs(sum - 30)).toBeLessThanOrEqual(0.1);
    expect(allocated[1]).toBeGreaterThan(allocated[0]);
    expect(allocated[2]).toBeGreaterThan(allocated[0]);
  });

  it('prefers stored pacingRole over misleading script text', () => {
    const allocated = allocateDurationsToTarget(
      [
        { scriptGuidance: 'CTA closing words', pacingRole: 'hook', requestedDurationSec: 4 },
        { scriptGuidance: 'HOOK opener text', pacingRole: 'body', requestedDurationSec: 8 },
        { scriptGuidance: 'BODY mid', pacingRole: 'cta', requestedDurationSec: 6 },
      ],
      30,
    );

    // Stored hook should stay shorter than stored cta despite flipped script labels.
    expect(allocated[0]).toBeLessThan(allocated[2]);
  });
});

describe('getScenePacingRole', () => {
  it('returns stored pacingRole over inferred text', () => {
    expect(getScenePacingRole({
      pacingRole: 'cta',
      voiceoverText: 'HOOK: cold open',
      onScreenText: '',
      visualDescription: '',
    }, 0, 3)).toBe('cta');
  });
});

describe('normalizePlanDurations', () => {
  it('always forces plan scene durations to the target sum', () => {
    const plan: ReelPlan = {
      topic: 'Test',
      vibe: 'urgent',
      strategicReasoning: 'test',
      scenes: [
        {
          sceneNumber: 1,
          visualDescription: 'Hook frame',
          imagePrompt: 'Hook frame',
          estimatedDuration: 4,
          scriptGuidance: 'HOOK',
        },
        {
          sceneNumber: 2,
          visualDescription: 'Body frame',
          imagePrompt: 'Body frame',
          estimatedDuration: 4,
          scriptGuidance: 'BODY',
        },
        {
          sceneNumber: 3,
          visualDescription: 'CTA frame',
          imagePrompt: 'CTA frame',
          estimatedDuration: 4,
          scriptGuidance: 'CTA',
        },
      ],
    };

    const normalized = normalizePlanDurations(plan, 45);
    const sum = normalized.scenes.reduce((total, scene) => total + scene.estimatedDuration, 0);
    expect(Math.abs(sum - 45)).toBeLessThan(0.15);
    expect(normalized.scenes[0].estimatedDuration).toBeLessThan(normalized.scenes[2].estimatedDuration);
  });
});

describe('voice timeline authority', () => {
  it('does not clobber requestedDurationSec with TTS lengths', () => {
    const scenes = [
      { requestedDurationSec: 4, voiceoverText: 'HOOK line', resolvedDurationSec: 4 },
      { requestedDurationSec: 8, voiceoverText: 'BODY line', resolvedDurationSec: 8 },
      { requestedDurationSec: 10, voiceoverText: 'BODY line two', resolvedDurationSec: 10 },
      { requestedDurationSec: 8, voiceoverText: 'CTA line', resolvedDurationSec: 8 },
    ];
    const ttsLengths = [9.2, 11.5, 14.1, 12.0];
    const timelineTargets = resolveVoiceTimelineTargets(scenes, 30);

    expect(timelineTargets).not.toEqual(ttsLengths.map((value) => Number(value.toFixed(1))));
    expect(Math.abs(timelineTargets.reduce((a, b) => a + b, 0) - 30)).toBeLessThan(0.15);

    timelineTargets.forEach((targetSec, index) => {
      expect(isVoiceStretchExtreme(targetSec, ttsLengths[index])).toBe(true);
    });
  });

  it('keeps targets when sum is already near the topic duration', () => {
    const scenes = [
      { requestedDurationSec: 3, voiceoverText: 'HOOK' },
      { requestedDurationSec: 9, voiceoverText: 'BODY' },
      { requestedDurationSec: 10, voiceoverText: 'BODY' },
      { requestedDurationSec: 8, voiceoverText: 'CTA' },
    ];
    const targets = resolveVoiceTimelineTargets(scenes, 30);
    expect(targets).toEqual([3, 9, 10, 8]);
  });
});

describe('reconcileTimelineToMeasuredVoice', () => {
  it('grows a short slot to measured VO and keeps the target total', () => {
    // Mirrors the Clip Studio case: VO 3.6s jammed into a 2.8s slot.
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 2.8 },
      { pacingRole: 'body' as const, requestedDurationSec: 5 },
      { pacingRole: 'body' as const, requestedDurationSec: 5 },
      { pacingRole: 'body' as const, requestedDurationSec: 5 },
      { pacingRole: 'body' as const, requestedDurationSec: 4.2 },
      { pacingRole: 'body' as const, requestedDurationSec: 4 },
      { pacingRole: 'cta' as const, requestedDurationSec: 4 },
    ];
    const voice = [3.6, 4.1, 4.0, 3.8, 3.5, 3.4, 3.2];
    const reconciled = reconcileTimelineToMeasuredVoice(scenes, voice, 30);

    expect(Math.abs(reconciled.reduce((a, b) => a + b, 0) - 30)).toBeLessThanOrEqual(0.15);
    expect(reconciled[0]).toBeGreaterThanOrEqual(3.5);
    expect(isVoiceStretchExtreme(reconciled[0], voice[0])).toBe(false);
  });

  it('preserves a locked slot and reports the voice conflict', () => {
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 3, pacingLocked: true },
      { pacingRole: 'body' as const, requestedDurationSec: 10 },
      { pacingRole: 'cta' as const, requestedDurationSec: 7 },
    ];
    const voice = [5.0, 8.0, 6.0];
    const assessment = assessMeasuredNarrationFeasibility(scenes, voice, 20);

    expect(assessment.reconciledSlots[0]).toBe(3);
    expect(assessment.feasibility).toBe('impossible');
    expect(assessment.constraint).toBe('locked_constraints');
  });

  it('extends beyond an impossible target instead of compressing voice', () => {
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 3 },
      { pacingRole: 'body' as const, requestedDurationSec: 3 },
      { pacingRole: 'cta' as const, requestedDurationSec: 4 },
    ];
    const voice = [4.21, 5.34, 4.11];
    const reconciled = reconcileTimelineToMeasuredVoice(scenes, voice, 10);

    reconciled.forEach((slot, index) => {
      expect(slot).toBeGreaterThanOrEqual(voice[index]);
    });
    expect(reconciled.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  it('does not treat visual slack as a voice quality problem', () => {
    expect(isVoiceStretchExtreme(6, 3)).toBe(false);
    expect(isVoiceStretchExtreme(3, 6)).toBe(true);
  });

  it('returns authoritative minimum, feasibility, exact slots, and offenders', () => {
    const scenes = [
      { sceneNumber: 1, requestedDurationSec: 3, voiceoverText: 'A complete opening line starts the story.' },
      { sceneNumber: 2, requestedDurationSec: 4, voiceoverText: 'This unaffected line already fits its scene.' },
      { sceneNumber: 3, requestedDurationSec: 3, voiceoverText: 'The final call to action closes the story.' },
    ];
    const assessment = assessMeasuredNarrationFeasibility(scenes, [4.2, 3.1, 4.4], 10);

    expect(assessment.feasibility).toBe('impossible');
    expect(assessment.measuredMinimumSec).toBe(11.7);
    expect(assessment.offendingScenes.map((scene) => scene.index)).toEqual([0, 2]);
    assessment.reconciledSlots.forEach((slot, index) => {
      expect(slot).toBeGreaterThanOrEqual([4.2, 3.1, 4.4][index]);
    });
  });

  it('hits the target exactly when measured narration is feasible', () => {
    const assessment = assessMeasuredNarrationFeasibility(
      [
        { requestedDurationSec: 3 },
        { requestedDurationSec: 5 },
        { requestedDurationSec: 4 },
      ],
      [2.7, 4.2, 3.5],
      12,
    );
    expect(assessment.feasibility).toBe('feasible');
    expect(assessment.reconciledSlots.reduce((sum, value) => sum + value, 0)).toBe(12);
  });

  it('does not make a feasible target impossible through per-scene rounding', () => {
    const assessment = assessMeasuredNarrationFeasibility(
      [
        { requestedDurationSec: 3.33 },
        { requestedDurationSec: 3.33 },
        { requestedDurationSec: 3.34 },
      ],
      [3.32, 3.32, 3.32],
      10,
    );
    expect(assessment.feasibility).toBe('feasible');
    expect(assessment.constraint).toBe('none');
    expect(assessment.reconciledSlots.reduce((sum, value) => sum + value, 0)).toBeCloseTo(10, 6);
  });

  it('does not plan script correction for a lock-only conflict', () => {
    const plan = buildMeasuredNarrationCorrectionPlan(
      [
        {
          sceneNumber: 1,
          requestedDurationSec: 3,
          pacingLocked: true,
          voiceoverText: 'This complete locked line intentionally keeps its approved timing.',
        },
        {
          sceneNumber: 2,
          requestedDurationSec: 7,
          voiceoverText: 'This second line fits inside the remaining timeline.',
        },
      ],
      [4, 6],
      10,
    );
    expect(plan).toEqual([]);
  });

  it('plans measured correction only for meaningful offending lines', () => {
    const plan = buildMeasuredNarrationCorrectionPlan(
      [
        {
          sceneNumber: 1,
          requestedDurationSec: 3,
          voiceoverText: 'This complete opening line makes a clear promise to the viewer.',
        },
        {
          sceneNumber: 2,
          requestedDurationSec: 4,
          voiceoverText: 'This useful middle line already fits.',
        },
        {
          sceneNumber: 3,
          requestedDurationSec: 3,
          voiceoverText: 'CTA',
        },
      ],
      [5, 3, 4],
      10,
    );
    expect(plan.map((item) => item.index)).toEqual([0]);
    expect(plan[0].maxWords).toBeLessThan(plan[0].currentWordCount);
  });
});

describe('equalSplitDurations', () => {
  it('splits a target evenly across scenes', () => {
    const splits = equalSplitDurations(5, 30);
    expect(splits).toHaveLength(5);
    expect(Math.abs(splits.reduce((a, b) => a + b, 0) - 30)).toBeLessThan(0.15);
    const spread = Math.max(...splits) - Math.min(...splits);
    expect(spread).toBeLessThanOrEqual(0.2);
  });
});

describe('rippleUnlockedDurationsToTarget', () => {
  it('keeps locked clips fixed while sum hits target', () => {
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 4, pacingLocked: true },
      { pacingRole: 'body' as const, requestedDurationSec: 8, pacingLocked: false },
      { pacingRole: 'body' as const, requestedDurationSec: 10, pacingLocked: false },
      { pacingRole: 'cta' as const, requestedDurationSec: 6, pacingLocked: false },
    ];
    const rippled = rippleUnlockedDurationsToTarget(scenes, 30);
    expect(rippled[0]).toBe(4);
    expect(Math.abs(rippled.reduce((a, b) => a + b, 0) - 30)).toBeLessThanOrEqual(0.1);
  });

  it('edits middle unlocked clip and ripples the rest to target', () => {
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 3, pacingLocked: false },
      { pacingRole: 'body' as const, requestedDurationSec: 8, pacingLocked: false },
      { pacingRole: 'body' as const, requestedDurationSec: 10, pacingLocked: false },
      { pacingRole: 'cta' as const, requestedDurationSec: 9, pacingLocked: false },
    ];
    const rippled = rippleUnlockedDurationsToTarget(scenes, 30, {
      editedIndex: 1,
      nextDuration: 12,
      keepEditedFixed: true,
    });
    expect(rippled[1]).toBe(12);
    expect(Math.abs(rippled.reduce((a, b) => a + b, 0) - 30)).toBeLessThanOrEqual(0.1);
  });

  it('fit-to-target skips locked scenes', () => {
    const scenes = [
      { pacingRole: 'hook' as const, requestedDurationSec: 5, pacingLocked: true },
      { pacingRole: 'body' as const, requestedDurationSec: 5, pacingLocked: false },
      { pacingRole: 'cta' as const, requestedDurationSec: 5, pacingLocked: false },
    ];
    const fitted = rippleUnlockedDurationsToTarget(scenes, 30);
    expect(fitted[0]).toBe(5);
    expect(Math.abs(fitted.reduce((a, b) => a + b, 0) - 30)).toBeLessThanOrEqual(0.1);
    expect(fitted[1] + fitted[2]).toBeCloseTo(25, 0);
  });
});

describe('buildVoiceSlotMeter', () => {
  const baseDraft = (overrides: Partial<SceneDraft> = {}): SceneDraft => ({
    id: 's1',
    sceneNumber: 1,
    visualDescription: '',
    imagePrompt: '',
    voiceoverText: 'HOOK',
    onScreenText: 'HOOK',
    requestedDurationSec: 4,
    resolvedDurationSec: 4,
    imageSource: 'generated',
    captionMode: 'derived',
    generationStatus: { script: 'clean', image: 'clean', voice: 'clean' },
    ...overrides,
  });

  it('marks ok / tight / extreme thresholds', () => {
    expect(buildVoiceSlotMeter(baseDraft({
      voiceAsset: { provider: 'gemini', voiceId: 'Aoede', textHash: 'x', durationSec: 4.2 },
    }), 0, 3).status).toBe('ok');

    expect(buildVoiceSlotMeter(baseDraft({
      requestedDurationSec: 4,
      voiceAsset: { provider: 'gemini', voiceId: 'Aoede', textHash: 'x', durationSec: 5 },
    }), 0, 3).status).toBe('tight');

    expect(buildVoiceSlotMeter(baseDraft({
      requestedDurationSec: 4,
      voiceAsset: { provider: 'gemini', voiceId: 'Aoede', textHash: 'x', durationSec: 9 },
    }), 0, 3).status).toBe('extreme');
  });

  it('marks missing when no voice', () => {
    expect(buildVoiceSlotMeter(baseDraft(), 0, 3).status).toBe('missing');
  });
});
