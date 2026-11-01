import { describe, expect, it } from "vitest";
import { METRES_PER_FOOT } from "./layout.ts";
import { snap, traceAim, type SnapContext } from "./snap.ts";

function ctx(patch: Partial<SnapContext> = {}): SnapContext {
  return {
    units: "m",
    ppm: 100,
    tail: { x: 0, y: 0 },
    points: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }],
    shift: false,
    alt: false,
    enabled: true,
    ...patch,
  };
}

describe("snap", () => {
  it("prefers a nearby point, then an alignment, then an angle, then the grid", () => {
    const onPoint = snap({ x: 1.05, y: 0.02 }, ctx());
    expect(onPoint.point).toEqual({ x: 1, y: 0 });
    expect(onPoint.guides[0]).toMatchObject({ kind: "point", id: "c2" });

    const level = snap({ x: 2, y: 0.05 }, ctx());
    expect(level.point.y).toBe(0);
    expect(level.guides[0]).toMatchObject({ kind: "align", axis: "y", at: 0 });

    const angled = snap({ x: 1, y: 0.9 }, ctx({ points: [{ id: "c1", x: 0, y: 0 }] }));
    expect(angled.guides[0]).toMatchObject({ kind: "angle", degrees: 45 });
    expect(angled.point.x).toBeCloseTo(angled.point.y, 5);

    const grid = snap({ x: 0.3, y: 0.9 }, ctx({ points: [], tail: null }));
    expect(grid.point).toEqual({ x: 0.25, y: 1 });
    expect(grid.guides[0]?.kind).toBe("grid");

    const feet = snap({ x: 0.1, y: 0.1 }, ctx({ units: "ft", points: [], tail: null, ppm: 50 }));
    expect(feet.point.x).toBeCloseTo(0, 5);
    expect(feet.point.y).toBeCloseTo(0, 5);
    expect(METRES_PER_FOOT).toBeGreaterThan(0.25);
  });

  it("Alt and Snap off leave the pointer where it is", () => {
    const raw = { x: 0.33, y: 0.41 };
    expect(snap(raw, ctx({ alt: true })).point).toEqual(raw);
    expect(snap(raw, ctx({ enabled: false })).guides).toEqual([]);
  });

  it("a typed length keeps its distance and still turns toward the pointer", () => {
    const aimed = traceAim({ x: 2, y: 2 }, { x: 0, y: 0 }, { metres: 1, angleDeg: null }, ctx({ points: [], tail: { x: 0, y: 0 } }));
    expect(Math.hypot(aimed.point.x, aimed.point.y)).toBeCloseTo(1, 5);
    const flat = traceAim({ x: 3, y: 0.04 }, { x: 0, y: 0 }, { metres: 2, angleDeg: null }, ctx());
    expect(flat.point.y).toBeCloseTo(0, 5);
    expect(flat.point.x).toBeCloseTo(2, 5);
    expect(flat.guides.some((guide) => guide.kind === "align")).toBe(true);
  });
});
