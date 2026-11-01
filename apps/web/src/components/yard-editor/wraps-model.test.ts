import { describe, expect, it } from "vitest";
import { isProp, type Prop } from "@nightplot/shared";
import {
  draftFromProp,
  guideFor,
  kindOfShape,
  lightTotal,
  measurementsOf,
  newDraft,
  runRows,
  setCount,
  setSize,
  setSpacing,
  setUnits,
  setZigzagDirection,
  shapeOfProp,
  startFrom,
} from "./model";

const post = () => startFrom(newDraft("Post wrap 1"), "spiral", "ft", 0.1);

describe("spiral and zigzag drafts", () => {
  it("starts a post wrap as an 8 ft 4×4 wrapped every 4 in", () => {
    const d = post();
    expect(d.sizes.height).toBe(8);
    expect(d.sizes.around! * 12).toBeCloseTo(14, 6);
    expect(d.sizes.gap! * 12).toBeCloseTo(4, 6);
    // 24 turns of √(14² + 4²) in = 29.1 ft of string, 89 lights at 10 cm.
    expect(lightTotal(d.layout)).toBe(89);
    expect(runRows(d)).toHaveLength(48);
    expect(runRows(d)[0]!.name).toBe("Wrap 1 front");
    expect(kindOfShape(d.shape!)).toBe("spiral");
  });

  it("moves the wraps, not the lights, when a count is typed", () => {
    const d = setCount(post(), 100);
    expect(lightTotal(d.layout)).toBe(100);
    expect(d.layout!.pitchM).toBe(0.1);
    expect(d.count).toBeNull();
    expect(d.sizes.gap! * 12).toBeLessThan(4);
    // A count no post can take leaves the draft alone.
    expect(setCount(post(), 5)).toEqual(post());
  });

  it("recounts a spiral when the spacing changes", () => {
    const d = setSpacing(post(), 4 * 0.0254);
    expect(lightTotal(d.layout)).toBe(87);
  });

  it("marks the light at each foot on a spiral tree", () => {
    const d = startFrom(newDraft("Spiral tree 1"), "spiralTree", "ft", 0.1);
    const g = guideFor(d, 20)!;
    expect(g.heights.map((h) => Math.round(h.heightM / 0.3048))).toEqual([1, 2, 3, 4, 5]);
    expect(g.counts[0]!.number).toBe(20);
  });

  it("keeps passes a whole count when the unit changes", () => {
    const d = setUnits(startFrom(newDraft("Zigzag 1"), "zigzag", "ft", 0.1), "m");
    expect(d.sizes.passes).toBe(8);
    expect(d.sizes.width).toBeCloseTo(1.219, 3);
  });

  it("turns a zigzag side to side and back", () => {
    let d = startFrom(newDraft("Zigzag 1"), "zigzag", "ft", 0.1);
    d = setZigzagDirection(d, true);
    expect(measurementsOf(d)).toMatchObject({ shape: "zigzag", direction: "horizontal", passes: 8 });
    expect(d.layout!.corners[1]!.x).toBeCloseTo(4 * 0.3048, 6);
    d = setZigzagDirection(d, false);
    expect(d.layout!.corners[1]!.y).toBeCloseTo(3 * 0.3048, 6);
    d = setSize(d, "passes", 6);
    expect(runRows(d)).toHaveLength(6);
  });

  it("reopens a saved spiral tree as a spiral tree with its sizes", () => {
    const d = startFrom(newDraft("Spiral tree 1"), "spiralTree", "ft", 0.1);
    const prop: Prop = {
      id: "p1", label: "Spiral tree 1", kind: "spiral", elementIds: [], layout: d.layout!, sections: d.sections,
      design: { unit: "ft", pitchMm: 100, ledProductId: null, measurements: measurementsOf(d), ledCount: lightTotal(d.layout), edges: [] },
    };
    expect(isProp(prop)).toBe(true);
    expect(shapeOfProp(prop)).toBe("spiralTree");
    const back = draftFromProp(prop, "ft", 0.1);
    expect(back.drawn).toBe(false);
    expect(back.sizes.aroundTop).toBe(0);
  });
});
