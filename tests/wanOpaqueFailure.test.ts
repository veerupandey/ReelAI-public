import { describe, expect, it } from 'vitest';
import { isOpaqueWanFailure } from '../services/producers/wanI2vProducer';

describe('isOpaqueWanFailure', () => {
  it('detects empty-reason provider dumps', () => {
    const msg = 'Wan failed (request 6v66kthn4nd8): {"status":"Failed","position":0,"reason":"","results":{"videos":[],"timings":null,"seed":0},"requestId":""}';
    expect(isOpaqueWanFailure(msg)).toBe(true);
  });

  it('detects friendly opaque marker', () => {
    expect(isOpaqueWanFailure(
      'Wan failed (request abc): provider returned Failed with no reason — often overload',
    )).toBe(true);
  });

  it('does not treat clear moderation reasons as opaque-only', () => {
    // Still matches "Failed" patterns if reason empty — but explicit content reasons should not match opaque helper unless empty
    expect(isOpaqueWanFailure('Wan failed (request x): content policy violation: NSFW')).toBe(false);
  });
});
