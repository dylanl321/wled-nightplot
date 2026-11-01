import { describe, expect, it } from "vitest";
import type { PropLayout } from "./layout.ts";
import { isProp } from "./types.ts";
import { layoutBox, yardBounds, yardPlacements } from "./yard.ts";

function box(w: number, h: number, x0 = 0, y0 = 0): PropLayout {
  return {
    source: "template",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "a", x: x0, y: y0 }, { id: "b", x: x0 + w, y: y0 }, { id: "c", x: x0 + w, y: y0 + h }],
    run: [{ id: "e1", from: "a", to: "b", kind: "lit" }, { id: "e2", from: "b", to: "c", kind: "lit" }],
  };
}

describe("yard placement", () => {
  it("gives props without a point their own slot in a row, a metre apart", () => {
    const rows = yardPlacements([
      { id: "p1", layout: box(4, 1) },
      { id: "p2", layout: box(2, 3) },
      { id: "p3", layout: box(1, 1, -5, -2) },
    ]);
    expect(rows.map((row) => row.at)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 13, y: 2 }]);
    expect(rows.every((row) => row.defaulted)).toBe(true);
    expect(rows[2]!.box).toEqual({ minX: 8, minY: 0, maxX: 9, maxY: 1 });
  });

  it("keeps a saved point, and puts new props to the right of the placed ones", () => {
    const rows = yardPlacements([
      { id: "new", layout: box(1, 1) },
      { id: "placed", layout: box(2, 2), yard: { x: 10, y: 4 } },
    ]);
    expect(rows[1]).toMatchObject({ propId: "placed", at: { x: 10, y: 4 }, defaulted: false });
    expect(rows[0]!.at).toEqual({ x: 13, y: 0 });
    expect(yardBounds(rows)).toEqual({ minX: 10, minY: 0, maxX: 14, maxY: 6 });
  });

  it("a prop with no drawing still takes room", () => {
    expect(layoutBox(undefined)).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(yardBounds([])).toBeNull();
  });
});

describe("stored yard point", () => {
  const legacy = { id: "p1", label: "Roof", kind: "roofline", elementIds: ["x"], lightId: "l1" };

  it("an older prop without a point still reads", () => {
    expect(isProp(legacy)).toBe(true);
  });

  it("a finite point is valid and anything else is not", () => {
    expect(isProp({ ...legacy, yard: { x: 1.5, y: -2 } })).toBe(true);
    expect(isProp({ ...legacy, yard: { x: Number.NaN, y: 0 } })).toBe(false);
    expect(isProp({ ...legacy, yard: { x: "1", y: 0 } })).toBe(false);
    expect(isProp({ ...legacy, yard: [1, 2] })).toBe(false);
  });
});
