/**
 * Bounded-concurrency map for scene pipelines.
 * Preserves result order. If `fn` throws, the pool rejects — callers that want
 * per-item failure tolerance should catch inside `fn` and return a failure value.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}
