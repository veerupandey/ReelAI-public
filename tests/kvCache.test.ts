import { describe, expect, it } from 'vitest';
import { hashKey, KvCache, mapPool } from '../utils/kvCache';

describe('kvCache', () => {
  it('returns cached values and dedupes inflight work', async () => {
    const cache = new KvCache<number>(8, 60_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 42;
    };

    const [a, b] = await Promise.all([
      cache.getOrSet('k', loader),
      cache.getOrSet('k', loader),
    ]);

    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
    expect(cache.get('k')).toBe(42);
  });

  it('hashKey is stable for identical payloads', () => {
    expect(hashKey(['a', { b: 1 }])).toBe(hashKey(['a', { b: 1 }]));
    expect(hashKey(['a'])).not.toBe(hashKey(['b']));
  });

  it('mapPool preserves order with bounded concurrency', async () => {
    const started: number[] = [];
    const results = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 10));
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(started).toHaveLength(5);
  });
});
