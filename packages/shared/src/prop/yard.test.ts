import { describe, expect, it } from "vitest";
import type { PropLayout } from "./layout.ts";
import { dragOnGround, layoutLightPoints, placeYardLight, toggleYardMount, turnYardPoint, yardCamera, yardLightPositions, yardPointForStore, yardPose } from "./space.ts";
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
    expect(isProp({ ...legacy, yard: { x: 1, y: 2, depth: 4, facing: 90, mount: "flat", heightM: 0.4 } })).toBe(true);
    expect(isProp({ ...legacy, yard: { x: 1, y: 2, mount: "sideways" } })).toBe(false);
    expect(isProp({ ...legacy, yard: { x: 1, y: 2, facing: 4000 } })).toBe(false);
  });

  it("an older point stays exactly x and y", () => {
    const raw = JSON.parse('{"id":"p1","label":"Roof","kind":"roofline","elementIds":["x"],"lightId":"l1","yard":{"x":1,"y":2}}');
    expect(isProp(raw)).toBe(true);
    expect(raw.yard).toEqual({ x: 1, y: 2 });
    expect(Object.keys(raw.yard)).toEqual(["x", "y"]);
    expect(yardPose(raw.yard)).toEqual({ x: 1, y: 2, depth: 0, facing: 0, mount: "upright", heightM: 0 });
  });
});

describe("yard lights", () => {
  const line: PropLayout = {
    source: "template",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
    run: [{ id: "e1", from: "a", to: "b", kind: "lit" }],
  };

  it("spaces lights along a run and leaves the far corner for the next run", () => {
    const points = layoutLightPoints(line);
    expect(points).toHaveLength(10);
    expect(points[0]).toMatchObject({ index: 0, x: 0, y: 0 });
    expect(points[9]).toMatchObject({ index: 9, x: 0.9, y: 0 });
  });

  it("puts an older yard on the front wall, standing up", () => {
    const lights = yardLightPositions([{ id: "roof", layout: line, yard: { x: 2, y: 3 } }]);
    expect(lights[0]).toMatchObject({ propId: "roof", x: 2, y: 3, z: 0 });
    expect(lights[9]).toMatchObject({ x: 2.9, y: 3, z: 0 });
  });

  it("turns an upright prop about the vertical, and lays a flat one on the ground", () => {
    expect(placeYardLight({ x: 1, y: 0.5 }, yardPose({ x: 4, y: 2, facing: 90 }))).toEqual({ x: 4, y: 2.5, z: 1 });
    expect(placeYardLight({ x: 1, y: 2 }, yardPose({ x: 2, y: 9, depth: 3, mount: "flat", heightM: 0.2 }))).toEqual({ x: 3, y: 0.2, z: 5 });
  });

  it("a hidden run takes indexes and is not drawn", () => {
    const layout: PropLayout = {
      ...line,
      corners: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0.2, y: 0 }, { id: "c", x: 0.4, y: 0 }],
      run: [
        { id: "e1", from: "a", to: "b", kind: "lit" },
        { id: "e2", from: "b", to: "c", kind: "hidden", hiddenCount: 2 },
        { id: "e3", from: "b", to: "c", kind: "lit" },
      ],
    };
    const points = layoutLightPoints(layout);
    expect(points.map((point) => point.index)).toEqual([0, 1, 4, 5]);
    expect(points.every((point) => point.edgeId !== "e2")).toBe(true);
  });

  it("depth does not move the flat drawing, and a later move keeps it", () => {
    const rows = yardPlacements([{ id: "p", layout: line, yard: { x: 1, y: 2, depth: 5, mount: "flat" } }]);
    expect(rows[0]!.box).toEqual({ minX: 1, minY: 2, maxX: 2, maxY: 2.1 });
    expect(yardPointForStore({ x: 6, y: 2 }, { x: 1, y: 2, depth: 5, facing: 15, mount: "flat", heightM: 0.4 })).toEqual({
      x: 6,
      y: 2,
      depth: 5,
      facing: 15,
      mount: "flat",
      heightM: 0.4,
    });
    expect(yardPointForStore({ x: 1, y: 2, depth: 0, facing: 0, mount: "upright", heightM: 0 })).toEqual({ x: 1, y: 2 });
  });

  it("opens at eye height on the street, and can look down or at one prop", () => {
    const lights = [
      { propId: "roof", x: 0, y: 3, z: 0 },
      { propId: "roof", x: 4, y: 3, z: 0 },
      { propId: "tree", x: 8, y: 0, z: 2 },
    ];
    const street = yardCamera({ view: "street", lights, propId: null });
    expect(street.position.y).toBe(1.6);
    expect(street.position.z).toBeLessThan(0);
    expect(street.position.y).toBeGreaterThan(0);
    const overhead = yardCamera({ view: "overhead", lights, propId: null });
    expect(overhead.position.y).toBeGreaterThan(overhead.target.y);
    expect(overhead.target.y).toBe(0);
    const prop = yardCamera({ view: "prop", lights, propId: "tree" });
    expect(prop.target.x).toBe(8);
    expect(prop.position.y).toBeGreaterThanOrEqual(1.6);
  });

  it("moves on the ground, turns, and lays flat without dropping the rest", () => {
    const point = { x: 1, y: 2, depth: 3, facing: 10 };
    expect(dragOnGround({ point, from: { x: 0, z: 0 }, to: { x: 0.54, z: -1.02 } })).toEqual({ x: 1.5, y: 2, depth: 2, facing: 10 });
    expect(turnYardPoint(point)).toEqual({ x: 1, y: 2, depth: 3, facing: 55 });
    expect(turnYardPoint({ x: 1, y: 2, facing: 330 })).toEqual({ x: 1, y: 2, facing: 15 });
    expect(toggleYardMount(point).mount).toBe("flat");
    expect(toggleYardMount({ ...point, mount: "flat" }).mount).toBeUndefined();
  });
});
