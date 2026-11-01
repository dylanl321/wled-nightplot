import { describe, expect, it } from "vitest";
import { compilePropDesign } from "./design.ts";
import { countLayout, layoutFromMeasurements, METRES_PER_FOOT, METRES_PER_INCH, setEdgeLength, setPitchM, splitRun, stringLights } from "./layout.ts";
import { isProp } from "./types.ts";
import { installGuide, spiralGapForLights, spiralLengthM, spiralTurns } from "./wraps.ts";

const inch = 1 / 12;
/** A 4×4 post is 3.5 in on a side, so 14 in around. */
const porch = { height: 8, around: 14 * inch, gap: 4 * inch };

describe("spiral", () => {
  it("measures a wrapped post the way a tape would: turns × √(around² + gap²)", () => {
    const around = 14 * METRES_PER_INCH;
    const gap = 4 * METRES_PER_INCH;
    const input = { heightM: 8 * METRES_PER_FOOT, aroundM: around, aroundTopM: around, gapM: gap };
    expect(spiralTurns(input)).toBeCloseTo(24, 9);
    expect(spiralLengthM(input)).toBeCloseTo(24 * Math.hypot(around, gap), 2);
  });

  it("counts the real string on a porch post, not the drawing", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 4 * 0.0254, shape: "spiral", params: porch })!;
    // 24 turns of 14.56 in is 349.4 in of string; at 4 in a light that is 87.
    expect(countLayout(layout).total).toBe(87);
    expect(layout.run).toHaveLength(48);
    expect(layout.run[0]!.name).toBe("Wrap 1 front");
    expect(layout.run[1]!.name).toBe("Wrap 1 back");
    // Drawn front-on: as wide as the post (14 in ÷ π), and 8 ft tall.
    const xs = layout.corners.map((corner) => corner.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo((14 * METRES_PER_INCH) / Math.PI, 3);
    expect(Math.max(...layout.corners.map((corner) => corner.y))).toBeCloseTo(8 * METRES_PER_FOOT, 6);
  });

  it("does not gain a light per half turn from rounding", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 4 * 0.0254, shape: "spiral", params: porch })!;
    const perRun = countLayout(layout).edges.map((edge) => edge.lights);
    // Each half turn is 1.8 lights. Rounding each one alone would give 2 × 48 = 96.
    expect(perRun.some((count) => count === 1)).toBe(true);
    expect(perRun.reduce((a, b) => a + b, 0)).toBe(87);
  });

  it("recounts when the light spacing changes", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 4 * 0.0254, shape: "spiral", params: porch })!;
    const total = countLayout(layout).edges.reduce((sum, edge) => sum + edge.lengthM, 0);
    const wider = setPitchM(layout, 0.1);
    expect(countLayout(wider).total).toBe(Math.round(total / 0.1));
  });

  it("tapers to a point on a cone tree, with more light low down", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "spiral", params: { height: 6, around: Math.PI * 3, aroundTop: 0, gap: 0.5 } })!;
    const guide = installGuide(layout, { everyHeightM: METRES_PER_FOOT });
    expect(guide.heights.map((row) => Math.round(row.heightM / METRES_PER_FOOT))).toEqual([1, 2, 3, 4, 5]);
    const numbers = guide.heights.map((row) => row.number);
    // The first foot of a 3 ft wide tree takes more light than the last.
    expect(numbers[0]!).toBeGreaterThan(numbers[4]! - numbers[3]!);
    const top = layout.corners[layout.corners.length - 1]!;
    expect(top.x).toBeCloseTo((Math.PI * 3 * METRES_PER_FOOT) / (2 * Math.PI), 6);
  });

  it("finds the wrap spacing that uses up a whole string", () => {
    const input = { heightM: 8 * METRES_PER_FOOT, aroundM: 14 * METRES_PER_INCH, aroundTopM: 14 * METRES_PER_INCH };
    const gap = spiralGapForLights(input, 100, 0.1)!;
    expect(gap).toBeGreaterThan(0);
    const layout = layoutFromMeasurements({
      units: "ft",
      pitchM: 0.1,
      shape: "spiral",
      params: { height: 8, around: 14 * inch, gap: gap / METRES_PER_FOOT },
    })!;
    expect(countLayout(layout).total).toBe(100);
    // Too few lights for half a turn, or so many it would need hundreds of turns.
    expect(spiralGapForLights(input, 2, 0.1)).toBeNull();
    expect(spiralGapForLights(input, 100000, 0.1)).toBeNull();
  });

  it("typing a run's length changes the wrap, not the drawing", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "spiral", params: porch })!;
    const edit = setEdgeLength(layout, "e1", 1);
    expect(edit.layout.corners).toEqual(layout.corners);
    expect(countLayout(edit.layout).edges[0]!.lengthM).toBe(1);
  });

  it("keeps the wrap length when a run is split", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "spiral", params: porch })!;
    const before = countLayout(layout).edges.reduce((sum, edge) => sum + edge.lengthM, 0);
    const from = layout.corners[0]!;
    const to = layout.corners[1]!;
    const split = splitRun(layout, "e1", (from.x + to.x) / 2, (from.y + to.y) / 2);
    const after = countLayout(split.layout).edges.reduce((sum, edge) => sum + edge.lengthM, 0);
    expect(after).toBeCloseTo(before, 9);
  });

  it("saves as a prop", () => {
    const compiled = compilePropDesign({
      kind: "spiral",
      unit: "ft",
      pitchMm: 100,
      ledProductId: null,
      measurements: { shape: "spiral", height: 8, around: 14 * inch, gap: 4 * inch },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.sections).toHaveLength(1);
    expect(compiled.sections[0]!.name).toBe("Spiral");
    expect(compiled.design.ledCount).toBe(countLayout(compiled.layout).total);
    expect(isProp({ id: "p1", label: "Porch post", kind: "spiral", elementIds: [], design: compiled.design, layout: compiled.layout, sections: compiled.sections })).toBe(true);
  });

  it("refuses a spiral with no gap or more than 200 turns", () => {
    expect(layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "spiral", params: { height: 8, around: 1, gap: 0 } })).toBeNull();
    expect(layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "spiral", params: { height: 80, around: 1, gap: 0.1 } })).toBeNull();
  });
});

describe("zigzag", () => {
  it("folds up and down across a bush", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "zigzag", params: { width: 4, height: 3, passes: 8 } })!;
    expect(layout.run.map((edge) => edge.name)).toEqual(["Pass 1", "Pass 2", "Pass 3", "Pass 4", "Pass 5", "Pass 6", "Pass 7", "Pass 8"]);
    expect(layout.corners[1]!.y).toBeCloseTo(3 * METRES_PER_FOOT, 6);
    expect(layout.corners[2]!.y).toBe(0);
    expect(layout.corners[8]!.x).toBeCloseTo(4 * METRES_PER_FOOT, 6);
    // Each pass is √(0.5² + 3²) ft = 0.927 m: 9 lights at 10 cm.
    expect(countLayout(layout).edges.map((edge) => edge.lights)).toEqual([9, 9, 9, 9, 9, 9, 9, 9]);
  });

  it("goes side to side when horizontal", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "zigzag", params: { width: 4, height: 3, passes: 4, horizontal: 1 } })!;
    expect(layout.corners.map((corner) => Math.round(corner.x / METRES_PER_FOOT))).toEqual([0, 4, 0, 4, 0]);
    expect(layout.corners.map((corner) => corner.y / METRES_PER_FOOT)).toEqual([0, 0.75, 1.5, 2.25, 3].map((v) => expect.closeTo(v, 6)));
  });

  it("marks every 20th light and where each pass starts", () => {
    const layout = layoutFromMeasurements({ units: "ft", pitchM: 0.1, shape: "zigzag", params: { width: 4, height: 3, passes: 8 } })!;
    const guide = installGuide(layout, { everyLights: 20 });
    expect(guide.counts.map((row) => row.number)).toEqual([20, 40, 60]);
    expect(guide.counts[0]!.edgeId).toBe("e3");
    expect(guide.turns.map((row) => [row.runName, row.number])).toEqual([
      ["Pass 2", 10], ["Pass 3", 19], ["Pass 4", 28], ["Pass 5", 37], ["Pass 6", 46], ["Pass 7", 55], ["Pass 8", 64],
    ]);
    // The even spread matches the drawing's own lights.
    const placed = installGuide(layout, { everyLights: 20 }, stringLights(layout));
    const key = (rows: { number: number; edgeId: string; x: number; y: number }[]) => rows.map((row) => [row.number, row.edgeId, Math.round(row.x * 1e6), Math.round(row.y * 1e6)]);
    expect(key(placed.counts)).toEqual(key(guide.counts));
    expect(key(placed.turns)).toEqual(key(guide.turns));
  });

  it("saves as a prop and checks its measurements", () => {
    const compiled = compilePropDesign({
      kind: "zigzag",
      unit: "ft",
      pitchMm: 100,
      ledProductId: null,
      measurements: { shape: "zigzag", width: 4, height: 3, passes: 8, direction: "vertical" },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.design.ledCount).toBe(72);
    expect(isProp({ id: "p2", label: "Front bush", kind: "zigzag", elementIds: [], design: compiled.design, layout: compiled.layout })).toBe(true);
    const bad = { ...compiled.design, measurements: { shape: "zigzag", width: 4, height: 3, passes: 0, direction: "vertical" } };
    expect(isProp({ id: "p3", label: "Bad", kind: "zigzag", elementIds: [], design: bad })).toBe(false);
  });
});
