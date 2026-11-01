import { describe, expect, it } from "vitest";
import {
  addCorner,
  addStringAt,
  closeLoop,
  continueToCorner,
  continueToPoint,
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
  it("gives equal lengths the same count: 122/91/122/91 cm at 10 cm is 12/9/12/9", () => {
    const counted = countLayout(chain([1.22, 0.91, 1.22, 0.91]));
    expect(counted.edges.map((edge) => edge.lights)).toEqual([12, 9, 12, 9]);
    expect(counted.total).toBe(42);
  });

  it("counts each edge from its own length, so a new edge does not change the others", () => {
    const before = countLayout(chain([1.22, 1.22]));
    const after = countLayout(chain([1.22, 1.22, 0.5]));
    expect(before.edges.map((edge) => edge.lights)).toEqual([12, 12]);
    expect(after.edges.slice(0, 2).map((edge) => edge.lights)).toEqual([12, 12]);
    expect(after.edges[2]?.lights).toBe(5);
  });

  it("restarts counting after a wire and gives the wire no lights", () => {
    const layout = chain([1, 0.5, 1]);
    layout.run[1] = { ...layout.run[1]!, kind: "wire" };
    const counted = countLayout(layout);
    expect(counted.edges.map((edge) => edge.lights)).toEqual([10, 0, 10]);
    expect(counted.total).toBe(20);
  });

  it("consumes hidden lights without drawing them", () => {
    const layout = chain([1, 0.2, 1]);
    layout.run[1] = { ...layout.run[1]!, kind: "hidden", hiddenCount: 2 };
    const counted = countLayout(layout);
    expect(counted.edges.map((edge) => edge.kind === "hidden" ? edge.hidden : edge.lights)).toEqual([10, 2, 10]);
    expect(counted.edges[1]).toMatchObject({ lights: 0, hidden: 2 });
    expect(counted.total).toBe(20);
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
  it("scales a traced drawing about the start when nothing is locked yet", () => {
    const layout = chain([1, 1]);
    const edited = setEdgeLength(layout, "e1", 2);
    expect(edited.scaledAll).toBe(true);
    expect(edited.layout.corners.map((corner) => corner.x)).toEqual([0, 2, 4]);
    expect(edited.layout.run[0]?.lockedLengthM).toBe(2);
  });

  it("a template keeps its other sides: only the edited side and the corners after it move", () => {
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
    expect(edited.scaledAll).toBe(false);
    expect(edited.layout.run[0]?.lockedLengthM).toBe(2);
    expect(countLayout(edited.layout).edges.map((edge) => edge.lights).slice(0, 3)).toEqual([20, 10, 10]);
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

describe("strings", () => {
  it("backtracks over an existing edge as a second lit run", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 1, 0, "lit");
    const end = layout.corners[1]!.id;
    const start = layout.corners[0]!.id;
    layout = continueToCorner(layout, "s1", start, "lit");
    expect(layout.run).toHaveLength(2);
    expect(layout.run[1]).toMatchObject({ from: end, to: start, kind: "lit" });
    expect(countLayout(layout).edges.map((edge) => edge.lights)).toEqual([10, 10]);
  });

  it("marks a dark run with no lights and keeps the next run's own count", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 1, 0, "lit");
    layout = continueToPoint(layout, "s1", 1, 1, "wire");
    layout = continueToPoint(layout, "s1", 2, 1, "lit");
    expect(layout.run.map((edge) => edge.kind)).toEqual(["lit", "wire", "lit"]);
    expect(countLayout(layout).edges.map((edge) => edge.lights)).toEqual([10, 0, 10]);
  });

  it("starts a second string at its own wire-in point with its own count", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 1, 0, "lit");
    layout = addStringAt(layout, 0, 2);
    const second = layout.strings?.[1];
    expect(second?.run).toEqual([]);
    expect(second?.startId).not.toBe(layout.strings?.[0]?.startId);
    layout = continueToPoint(layout, second!.id, 1, 2, "lit");
    const counts = countLayout(layout).edges.map((edge) => edge.lights);
    expect(counts).toEqual([10, 10]);
    expect(layout.run).toHaveLength(1);
  });
});

describe("length labels", () => {
  it("shows a whole number of feet and the leftover centimetres", () => {
    const label = lengthLabel(4.25 * 0.3048, "ft");
    expect(label.whole).toBe("4 ft");
    expect(label.extra).toBe("+8 cm");
  });
});
