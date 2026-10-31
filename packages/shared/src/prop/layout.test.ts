import { describe, expect, it } from "vitest";
import {
  addCorner,
  closeLoop,
  countLayout,
  emptyTrace,
  gapLabel,
  lengthLabel,
  moveCorner,
  rooflineLayout,
  scaleAboutStart,
  setEdgeLength,
  snapPoint,
  windowLayout,
  type PropLayout,
} from "./layout.ts";

function chain(lengthsM: number[]): PropLayout {
  const corners = [{ id: "c1", x: 0, y: 0 }];
  const run = [];
  let x = 0;
  for (let index = 0; index < lengthsM.length; index += 1) {
    x += lengthsM[index]!;
    const id = `c${index + 2}`;
    corners.push({ id, x, y: 0 });
    run.push({ id: `e${index + 1}`, from: `c${index + 1}`, to: id, kind: "lit" as const });
  }
  return { source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0, corners, run };
}

describe("light count along a run", () => {
  it("counts 122/91/122/91 cm at 10 cm as 13/9/12/9 = 43", () => {
    const counted = countLayout(chain([1.22, 0.91, 1.22, 0.91]));
    expect(counted.edges.map((edge) => edge.lights)).toEqual([13, 9, 12, 9]);
    expect(counted.total).toBe(43);
  });

  it("puts a light that lands on a corner onto the next edge", () => {
    const counted = countLayout(chain([0.2, 0.2]));
    expect(counted.edges.map((edge) => edge.lights)).toEqual([2, 3]);
    expect(counted.total).toBe(5);
  });

  it("restarts counting after a wire and gives the wire no lights", () => {
    const layout = chain([1, 0.5, 1]);
    layout.run[1] = { ...layout.run[1]!, kind: "wire" };
    const counted = countLayout(layout);
    expect(counted.edges.map((edge) => edge.lights)).toEqual([11, 0, 11]);
    expect(counted.total).toBe(22);
  });

  it("consumes hidden lights without drawing them", () => {
    const layout = chain([1, 0.2, 1]);
    layout.run[1] = { ...layout.run[1]!, kind: "hidden", hiddenCount: 2 };
    const counted = countLayout(layout);
    expect(counted.edges.map((edge) => edge.kind === "hidden" ? edge.hidden : edge.lights)).toEqual([10, 2, 11]);
    expect(counted.edges[1]).toMatchObject({ lights: 0, hidden: 2 });
    expect(counted.total).toBe(23);
  });

  it("counts a 40 ft roofline at 10 cm as 122 lights", () => {
    const layout = rooflineLayout({
      lengthM: 40 * 0.3048,
      units: "ft",
      pitchM: 0.1,
      startAtFarEnd: false,
      params: { length: 40 },
    });
    expect(countLayout(layout).total).toBe(122);
  });
});

describe("scaling and typed length", () => {
  it("scales the whole drawing about the start when nothing is locked", () => {
    const layout = windowLayout({
      widthM: 1,
      heightM: 1,
      units: "m",
      pitchM: 0.1,
      startCorner: 0,
      clockwise: false,
      params: { width: 1, height: 1 },
    });
    const edited = setEdgeLength(layout, "e1", 2);
    expect(edited.scaledAll).toBe(true);
    expect(edited.layout.corners.map((corner) => [corner.x, corner.y])).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    expect(edited.layout.run[0]?.lockedLengthM).toBe(2);
  });

  it("lengthens one edge and shifts only the corners after it", () => {
    const layout = chain([1, 1, 1]);
    layout.run[0] = { ...layout.run[0]!, lockedLengthM: 1 };
    const edited = setEdgeLength(layout, "e2", 2);
    expect(edited.scaledAll).toBe(false);
    expect(edited.layout.corners.map((corner) => corner.x)).toEqual([0, 1, 3, 4]);
    expect(edited.layout.run[1]?.lockedLengthM).toBe(2);
    expect(edited.layout.run[0]?.lockedLengthM).toBe(1);
  });

  it("lets the closing edge absorb, and shows a gap when that edge is locked", () => {
    let layout = windowLayout({
      widthM: 1,
      heightM: 1,
      units: "m",
      pitchM: 0.1,
      startCorner: 0,
      clockwise: false,
      params: {},
    });
    layout = { ...layout, run: layout.run.map((edge) => ({ ...edge, lockedLengthM: 1 })) };
    const edited = setEdgeLength(layout, "e1", 1.5);
    expect(edited.gapM).not.toBeNull();
    expect(gapLabel(edited.gapM ?? 0, "ft")).toMatch(/misses by \d+ in/);
    const open = setEdgeLength(
      { ...layout, run: layout.run.map((edge) => edge.id === "e4" ? { ...edge, lockedLengthM: undefined } : edge) },
      "e1",
      1.5,
    );
    expect(open.gapM).toBeNull();
    const closing = open.layout.run[3]!;
    const from = open.layout.corners.find((corner) => corner.id === closing.from)!;
    const to = open.layout.corners.find((corner) => corner.id === closing.to)!;
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(Math.hypot(0.5, 1), 5);
  });

  it("scaleAboutStart leaves the controller end in place", () => {
    const scaled = scaleAboutStart(chain([1, 1]), 2);
    expect(scaled.corners[0]).toMatchObject({ x: 0, y: 0 });
    expect(scaled.corners[2]?.x).toBe(4);
  });
});

describe("snap", () => {
  const corners = [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }];

  it("prefers an existing corner over the grid", () => {
    const snapped = snapPoint({
      point: { x: 1.02, y: 0.02 },
      anchor: { x: 0, y: 0 },
      previousAngle: null,
      corners,
      excludeIds: ["c1"],
      pitchM: 0.1,
      gridM: 0.3048,
      snapOff: false,
      force45: false,
    });
    expect(snapped).toEqual({ x: 1, y: 0, guide: "corner" });
  });

  it("snaps a near-45° point onto the 45° ray", () => {
    const snapped = snapPoint({
      point: { x: 1, y: 0.9 },
      anchor: { x: 0, y: 0 },
      previousAngle: 0,
      corners,
      excludeIds: ["c1"],
      pitchM: 0.1,
      gridM: 1,
      snapOff: false,
      force45: false,
    });
    expect(snapped.guide === "angle" || snapped.guide === "light").toBe(true);
    expect(Math.atan2(snapped.y, snapped.x)).toBeCloseTo(Math.PI / 4, 2);
  });

  it("snaps length to a whole number of lights along the edge", () => {
    const snapped = snapPoint({
      point: { x: 0.97, y: 0 },
      anchor: { x: 0, y: 0 },
      previousAngle: null,
      corners: [{ id: "c1", x: 0, y: 0 }],
      pitchM: 0.1,
      gridM: 1,
      snapOff: false,
      force45: false,
    });
    expect(snapped.guide).toBe("light");
    expect(snapped.x).toBeCloseTo(1, 5);
  });

  it("leaves the point alone when snap is off", () => {
    const snapped = snapPoint({
      point: { x: 0.33, y: 0.12 },
      anchor: { x: 0, y: 0 },
      previousAngle: null,
      corners,
      pitchM: 0.1,
      gridM: 0.3048,
      snapOff: true,
      force45: false,
    });
    expect(snapped).toEqual({ x: 0.33, y: 0.12, guide: null });
  });
});

describe("trace edits", () => {
  it("adds corners and closes back to the controller end", () => {
    let layout = emptyTrace("ft");
    layout = addCorner(layout, 1, 0);
    layout = addCorner(layout, 1, 1);
    layout = addCorner(layout, 0, 1);
    expect(layout.corners).toHaveLength(4);
    layout = closeLoop(layout);
    expect(layout.run).toHaveLength(4);
    expect(layout.run[3]?.to).toBe(layout.corners[0]?.id);
    expect(closeLoop(layout)).toBe(layout);
  });

  it("drops a length lock when that corner is dragged", () => {
    const layout = chain([1]);
    layout.run[0] = { ...layout.run[0]!, lockedLengthM: 1 };
    const moved = moveCorner(layout, "c2", 2, 0);
    expect(moved.run[0]?.lockedLengthM).toBeUndefined();
    expect(moved.corners[1]).toMatchObject({ x: 2, y: 0 });
  });
});

describe("length labels", () => {
  it("shows a whole number of feet and the leftover centimetres", () => {
    const label = lengthLabel(4.25 * 0.3048, "ft");
    expect(label.whole).toBe("4 ft");
    expect(label.extra).toBe("+8 cm");
  });
});
