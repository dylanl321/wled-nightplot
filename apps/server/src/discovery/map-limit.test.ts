import { describe, expect, it } from "vitest";
import { FIND_PROBE_CONCURRENCY, mapLimit } from "./map-limit.ts";

describe("mapLimit", () => {
  it("documents Find’s default bound of four", () => {
    expect(FIND_PROBE_CONCURRENCY).toBe(4);
  });

  it("returns an empty list without calling the mapper", async () => {
    let calls = 0;
    await expect(mapLimit([], 4, async () => {
      calls += 1;
      return 0;
    })).resolves.toEqual([]);
    expect(calls).toBe(0);
  });

  it("keeps input order when later items finish first", async () => {
    const order: number[] = [];
    const out = await mapLimit([10, 20, 30], 3, async (item, index) => {
      await new Promise((resolve) => setTimeout(resolve, (3 - index) * 15));
      order.push(item);
      return item * 2;
    });
    expect(out).toEqual([20, 40, 60]);
    expect(order).toEqual([30, 20, 10]);
  });

  it("never runs more than `limit` mappers at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen: number[] = [];

    const out = await mapLimit(
      [0, 1, 2, 3, 4, 5, 6, 7],
      3,
      async (item) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        seen.push(item);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return item;
      },
    );

    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(seen).toHaveLength(8);
    expect(maxInFlight).toBe(3);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("with limit 1 is sequential", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit(["a", "b", "c"], 1, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBe(1);
  });

  it("rejects on the first mapper error and leaves later items unstarted", async () => {
    const started: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3], 2, async (item) => {
        started.push(item);
        if (item === 1) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 30));
        return item;
      }),
    ).rejects.toThrow("boom");
    expect(started).not.toContain(3);
  });

  it("refuses a non-positive limit", async () => {
    await expect(mapLimit([1], 0, async (n) => n)).rejects.toThrow(/>= 1/);
    await expect(mapLimit([1], 1.5, async (n) => n)).rejects.toThrow(/>= 1/);
  });
});
