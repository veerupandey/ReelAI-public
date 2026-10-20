import { describe, expect, it } from 'vitest';
import {
  estimateWanI2vCost,
  resolveLiveMotionModelId,
  DEFAULT_LIVE_MOTION_MODEL_ID,
} from '../services/producers/wanI2vProducer';
import { FAL_SEEDANCE_20_I2V } from '../services/fal/client';
import { WAN_I2V_MODEL } from '../services/siliconflow/client';

describe('Live Motion cost / model resolve', () => {
  it('defaults to Wan 2.2', () => {
    expect(resolveLiveMotionModelId()).toBe(WAN_I2V_MODEL);
    expect(DEFAULT_LIVE_MOTION_MODEL_ID).toBe(WAN_I2V_MODEL);
  });

  it('estimates Wan flat clip cost', () => {
    const est = estimateWanI2vCost(3);
    expect(est.sceneCount).toBe(3);
    expect(est.estimatedUsd).toBe(0.87);
    expect(est.warning).toMatch(/Wan 2\.2/i);
  });

  it('estimates fal per-second cost for Seedance', () => {
    const est = estimateWanI2vCost(2, {
      modelId: FAL_SEEDANCE_20_I2V,
      durationSec: 5,
    });
    expect(est.sceneCount).toBe(2);
    // ~$0.30/s × 5s = $1.50/clip × 2 = $3.00
    expect(est.estimatedUsd).toBe(3);
    expect(est.warning).toMatch(/Seedance/i);
  });
});
