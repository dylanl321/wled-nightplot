/**
 * Find probes this many collected hosts at once.
 * Each probe still uses the ~3 s dead-host timeout from CONFIG-15.
 */
export const FIND_PROBE_CONCURRENCY = 4;

/**
 * All Off probes this many enrolled Lights at once.
 * Each Light still uses the ~3 s dead-host timeout from CONFIG-15.
 * Fail-closed per Light — a refuse or throw does not invent success for the others.
 */
export const ALL_OFF_PROBE_CONCURRENCY = 4;

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

/** Like mapLimit, but every item settles. Later items still run after an earlier throw. */
export async function mapLimitSettled<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  return mapLimit(items, limit, async (item, index) => {
    try {
      return { status: "fulfilled" as const, value: await mapper(item, index) };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  });
}
