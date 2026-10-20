import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../services/concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('preserves result order', async () => {
    const results = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await sleep(ms);
      return ms * 2;
    });
    expect(results).toEqual([60, 20, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 8 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(15);
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles empty input and limit clamping', async () => {
    expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([]);
    const results = await mapWithConcurrency([1, 2], 0, async (x) => x + 1);
    expect(results).toEqual([2, 3]);
  });

  it('rejects when a task throws (caller opts into failure tolerance)', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
    ).rejects.toThrow('boom');
  });
});
