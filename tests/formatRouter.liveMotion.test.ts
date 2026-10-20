import { describe, expect, it } from 'vitest';
import {
  countLiveMotionScenes,
  getProducerForFormat,
  getRequiredToolsForFormat,
  shouldForceManualApproval,
} from '../services/formatRouter';

describe('Live Motion format routing', () => {
  it('counts live_motion scenes', () => {
    expect(countLiveMotionScenes([
      { motionMode: 'still' },
      { motionMode: 'live_motion' },
      {},
    ])).toBe(1);
  });

  it('adds Live Motion phases for stitched_video when requested', () => {
    const producer = getProducerForFormat('stitched_video', { liveMotionSceneCount: 2 });
    expect(producer.requiresWanI2v).toBe(true);
    expect(producer.phases).toContain('generate_live_motion');
    expect(producer.phases).toContain('cost_confirmation');
  });

  it('requires wan_i2v tool and forces manual approval when Live Motion is on', () => {
    expect(getRequiredToolsForFormat('stitched_video', { liveMotionSceneCount: 1 })).toContain('wan_i2v');
    expect(shouldForceManualApproval('stitched_video', { liveMotionSceneCount: 1 })).toBe(true);
    expect(shouldForceManualApproval('stitched_video', { liveMotionSceneCount: 0 })).toBe(false);
  });
});
