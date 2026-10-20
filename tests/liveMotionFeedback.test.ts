import { describe, expect, it } from 'vitest';
import {
  applyLiveMotionIntent,
  resolveLiveMotionFromFeedback,
} from '../services/producers/wanI2vProducer';

describe('resolveLiveMotionFromFeedback', () => {
  it('detects consider / use live motion', () => {
    const a = resolveLiveMotionFromFeedback('please consider live motion');
    expect(a.matched).toBe(true);
    expect(a.mode).toBe('live_motion');
    expect(a.sceneIndexes).toBeUndefined();

    const b = resolveLiveMotionFromFeedback('use live motion on all scenes', 5);
    expect(b.matched).toBe(true);
    expect(b.mode).toBe('live_motion');
  });

  it('detects scene-specific live motion and ken burns', () => {
    const a = resolveLiveMotionFromFeedback('animate scenes 2-3 with live motion', 5);
    expect(a.matched).toBe(true);
    expect(a.mode).toBe('live_motion');
    expect(a.sceneIndexes).toEqual([1, 2]);

    const b = resolveLiveMotionFromFeedback('ken burns only please');
    expect(b.matched).toBe(true);
    expect(b.mode).toBe('still');
  });

  it('ignores unrelated feedback', () => {
    expect(resolveLiveMotionFromFeedback('change the model').matched).toBe(false);
  });
});

describe('applyLiveMotionIntent', () => {
  it('enables live motion on all or selected scenes', () => {
    const scenes = [
      { index: 0, motionMode: 'still' as const },
      { index: 1, motionMode: 'still' as const },
      { index: 2, motionMode: 'still' as const },
    ];
    const all = applyLiveMotionIntent(scenes, { matched: true, mode: 'live_motion' });
    expect(all.every((s) => s.motionMode === 'live_motion')).toBe(true);

    const some = applyLiveMotionIntent(scenes, {
      matched: true,
      mode: 'live_motion',
      sceneIndexes: [1],
    });
    expect(some[0].motionMode).toBe('still');
    expect(some[1].motionMode).toBe('live_motion');
    expect(some[2].motionMode).toBe('still');
  });
});
