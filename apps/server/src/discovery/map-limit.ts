/**
 * Find probes this many collected hosts at once.
 * Each probe still uses the ~3 s dead-host timeout from CONFIG-15.
 */
export const FIND_PROBE_CONCURRENCY = 4;

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapLimit concurrency must be an integer >= 1, got ${String(limit)}`);
  }
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let next = 0;
  let firstError: unknown;

  async function worker() {
    while (firstError === undefined) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index] as T, index);
      } catch (err) {
        firstError = err;
        throw err;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  if (firstError !== undefined) throw firstError;
  return results;
}
