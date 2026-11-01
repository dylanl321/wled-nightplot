import { describe, expect, it } from "vitest";
import {
  convertSize,
  METRES_PER_FOOT,
  addCorner,
  addStringAt,
  closeLoop,
  continueToCorner,
  continueToPoint,
  countLayout,
  emptyTrace,
  formatLength,
  formatPitchCm,
  gapLabel,
  gridScaleLabel,
  isPropLayout,
  lengthLabel,
  moveCorner,
  parseLength,
  parsePitchCm,
  rooflineLayout,
  scaleAboutStart,
  setEdgeLength,
  setEdgeLights,
  setLayoutUnits,
  setPitchM,
  snapPoint,
  snapStepM,
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
  it("moves that run's end along the run and keeps the next run's length", () => {
    const layout = chain([1, 1]);
    const edited = setEdgeLength(layout, "e1", 2);
    expect(edited.scaledAll).toBe(false);
    expect(edited.layout.corners.map((corner) => corner.x)).toEqual([0, 2, 3]);
    expect(edited.layout.run[0]?.lockedLengthM).toBe(2);
    const next = edited.layout.run[1]!;
    const from = edited.layout.corners.find((corner) => corner.id === next.from)!;
    const to = edited.layout.corners.find((corner) => corner.id === next.to)!;
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(1, 5);
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

  it("holds a point to the snap step even when it is far from a grid line", () => {
    const snapped = snapPoint({
      point: { x: 1.2, y: 0.02 },
      anchor: null,
      previousAngle: null,
      corners: [{ id: "c1", x: 0, y: 0 }],
      pitchM: 0.1,
      gridM: 0.3048,
      stepM: 0.3048 / 12,
      snapOff: false,
      force45: false,
    });
    expect(snapped.guide).toBe("grid");
    expect(snapped.x).toBeCloseTo(47 * (0.3048 / 12), 5);
    expect(snapped.y).toBeCloseTo(0.3048 / 12, 5);
  });

  it("keeps axis lock and holds the length to the step", () => {
    const snapped = snapPoint({
      point: { x: 1.3, y: 0.04 },
      anchor: { x: 0, y: 0 },
      previousAngle: null,
      corners: [{ id: "c1", x: 0, y: 0 }],
      pitchM: 0.1,
      gridM: 0.3048,
      stepM: 0.3048 / 12,
      snapOff: false,
      force45: false,
    });
    expect(snapped.guide).toBe("angle");
    expect(snapped.y).toBeCloseTo(0, 5);
    expect(snapped.x).toBeCloseTo(51 * (0.3048 / 12), 5);
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
  it("shows feet and inches, and the same metres the same way", () => {
    expect(lengthLabel(1.2, "ft").whole).toBe("3' 11\"");
    expect(lengthLabel(1.2, "ft").extra).toBeNull();
    expect(lengthLabel(0.4, "ft").whole).toBe("1' 4\"");
    expect(lengthLabel(0.8, "ft").whole).toBe("2' 7\"");
    expect(lengthLabel(2.9, "ft").whole).toBe("9' 6\"");
    expect(lengthLabel(1, "m").whole).toBe("1.00 m");
    expect(lengthLabel(2.5, "m").whole).toBe("2.50 m");
  });

  it("round-trips a feet-and-inches length and a metre length", () => {
    for (const metres of [1.2, 0.4, 0.8, 2.9, 0.1, 1.2192]) {
      const shown = formatLength(metres, "ft");
      const back = parseLength(shown, "ft");
      expect(back).not.toBeNull();
      expect(formatLength(back!, "ft")).toBe(shown);
      expect(Math.abs(back! - metres)).toBeLessThanOrEqual(METRES_PER_INCH / 2 + 1e-9);
    }
    expect(parseLength("3' 11\"", "ft")).toBeCloseTo(47 * (0.3048 / 12), 6);
    expect(parseLength("4", "ft")).toBeCloseTo(1.2192, 6);
    expect(parseLength("1.20", "m")).toBeCloseTo(1.2, 6);
    expect(formatLength(parseLength("1.20", "m")!, "m")).toBe("1.20");
    expect(parseLength("abc", "ft")).toBeNull();
    expect(parseLength("-1", "m")).toBeNull();
    expect(parseLength("0", "m")).toBeNull();
  });
});

const METRES_PER_INCH = 0.3048 / 12;

describe("unit and spacing", () => {
  it("uses a 1 ft grid with an inch step, or a 0.5 m grid with a 5 cm step", () => {
    expect(gridScaleLabel("ft")).toBe("1 square = 1 ft");
    expect(snapStepM("ft")).toBeCloseTo(0.3048 / 12, 8);
    expect(gridScaleLabel("m")).toBe("1 square = 0.5 m");
    expect(snapStepM("m")).toBeCloseTo(0.05, 8);
  });

  it("keeps a saved prop's corners when the unit changes", () => {
    const saved = {
      source: "trace" as const,
      units: "ft" as const,
      pitchM: 0.1,
      startOffsetM: 0,
      corners: [
        { id: "c1", x: 0, y: 0 },
        { id: "c2", x: 1.2, y: 0 },
        { id: "c3", x: 1.2, y: 0.4 },
      ],
      run: [
        { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
        { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
      ],
    };
    expect(isPropLayout(saved)).toBe(true);
    expect(formatLength(1.2, "ft")).toBe("3' 11\"");
    expect(formatLength(0.4, "ft")).toBe("1' 4\"");
    const metric = setLayoutUnits(saved, "m");
    expect(metric.corners).toEqual(saved.corners);
    expect(metric.units).toBe("m");
    expect(formatLength(1.2, metric.units)).toBe("1.20");
    expect(setLayoutUnits(metric, "ft").corners).toEqual(saved.corners);
  });

  it("changes the light count from the spacing, and leaves a typed count in place", () => {
    const layout = continueToPoint(emptyTrace("ft", 0.1), "s1", 1.2, 0, "lit");
    expect(countLayout(layout).total).toBe(12);
    expect(formatPitchCm(layout.pitchM)).toBe("10");
    const wider = setPitchM(layout, parsePitchCm("20")!);
    expect(wider.pitchM).toBeCloseTo(0.2, 6);
    expect(countLayout(wider).total).toBe(6);
    expect(wider.corners).toEqual(layout.corners);
    const typed = setEdgeLights(wider, wider.run[0]!.id, 9);
    expect(countLayout(setPitchM(typed, 0.1)).total).toBe(9);
    expect(parsePitchCm("")).toBeNull();
    expect(parsePitchCm("no")).toBeNull();
    expect(setPitchM(layout, 0)).toBe(layout);
  });
});

describe("convertSize", () => {
  it("converts typed feet to metres to the millimetre and back to the same feet", () => {
    const m = convertSize("3", METRES_PER_FOOT, 3);
    expect(m).toBe("0.914");
    expect(convertSize(m, 1 / METRES_PER_FOOT, 2)).toBe("3");
    expect(convertSize("", 2, 2)).toBe("");
    expect(convertSize("abc", 2, 2)).toBe("abc");
  });
});
