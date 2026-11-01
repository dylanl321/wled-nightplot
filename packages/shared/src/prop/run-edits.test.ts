import { describe, expect, it } from "vitest";
import {
  addStringAt,
  assignStableRunIds,
  clearEdgeLights,
  continueToCorner,
  continueToPoint,
  countLayout,
  deletePoint,
  deleteRun,
  edgeLengthM,
  emptyTrace,
  isPropLayout,
  layoutReview,
  layoutStrings,
  mergeShortRuns,
  moveCorner,
  runsOnSameSpan,
  setEdgeLength,
  setEdgeLights,
  setEdgeName,
  shortRuns,
  splitRun,
  weldCorners,
  type PropLayout,
} from "./layout.ts";
import { pathEdgeIndexRanges, reconcileSections } from "./sections.ts";
import type { PropSection } from "./types.ts";

/** Three 1 m runs along x, as one string, 10 cm spacing: 10 + 10 + 10. */
function three(): PropLayout {
  let layout: PropLayout = {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }],
    run: [],
    strings: [{ id: "s1", startId: "c1", run: [] }],
  };
  layout = continueToPoint(layout, "s1", 1, 0);
  layout = continueToPoint(layout, "s1", 2, 0);
  layout = continueToPoint(layout, "s1", 3, 0);
  return layout;
}

const ids = (layout: PropLayout) => layoutStrings(layout)[0]!.run.map((edge) => edge.id);
const lights = (layout: PropLayout) => countLayout(layout).edges.map((edge) => edge.lights);

describe("typed light count on a run", () => {
  it("overrides the count without moving the drawing", () => {
    const layout = three();
    const [, middle] = ids(layout);
    const next = setEdgeLights(layout, middle!, 14);
    expect(lights(next)).toEqual([10, 14, 10]);
    expect(countLayout(next).total).toBe(34);
    expect(next.corners).toEqual(layout.corners);
    expect(next.run[1]?.lockedLights).toBe(14);
  });

  it("moves the section indexes after it", () => {
    const layout = three();
    const next = setEdgeLights(layout, ids(layout)[1]!, 14);
    expect(pathEdgeIndexRanges(next).map((range) => [range.start, range.stop])).toEqual([[0, 10], [10, 24], [24, 34]]);
  });

  it("a length edit on that run clears the override and counts from the length", () => {
    const layout = setEdgeLights(three(), "e2", 14);
    const edited = setEdgeLength(setEdgeLength(layout, "e1", 1).layout, "e2", 3).layout;
    expect(edited.run[1]?.lockedLights).toBeUndefined();
    expect(lights(edited)).toEqual([10, 30, 10]);
  });

  it("dragging a corner keeps the typed count", () => {
    const layout = setEdgeLights(three(), "e2", 14);
    const moved = moveCorner(layout, "c3", 2.5, 0);
    expect(lights(moved)).toEqual([10, 14, 5]);
  });

  it("clears back to the length, ignores a wire, and refuses a bad count", () => {
    const layout = setEdgeLights(three(), "e2", 14);
    expect(lights(clearEdgeLights(layout, "e2"))).toEqual([10, 10, 10]);
    expect(setEdgeLights(layout, "e1", -1)).toBe(layout);
    expect(setEdgeLights(layout, "e1", 2.5)).toBe(layout);
  });

  it("is a valid stored layout, and a bad stored count is not", () => {
    const layout = setEdgeLights(three(), "e2", 14);
    expect(isPropLayout(layout)).toBe(true);
    const bad = { ...layout, run: layout.run.map((edge) => ({ ...edge, lockedLights: -2 })) };
    expect(isPropLayout(bad)).toBe(false);
  });
});

describe("set a length on a run", () => {
  it("3 m at 10 cm is 30 lights, and later runs keep their own lengths", () => {
    const layout = setEdgeLength(three(), "e1", 1).layout;
    const next = setEdgeLength(layout, "e2", 3).layout;
    expect(lights(next)).toEqual([10, 30, 10]);
    expect(countLayout(next).edges.map((edge) => Math.round(edge.lengthM * 100) / 100)).toEqual([1, 3, 1]);
  });

  it("works on the second string, and keeps strings in step with run", () => {
    let layout = setEdgeLength(three(), "e1", 1).layout;
    layout = addStringAt(layout, 0, 2);
    const second = layoutStrings(layout)[1]!;
    layout = continueToPoint(layout, second.id, 1, 2);
    const edgeId = layoutStrings(layout)[1]!.run[0]!.id;
    const next = setEdgeLength(layout, edgeId, 2).layout;
    const run = layoutStrings(next)[1]!.run[0]!;
    expect(run.lockedLengthM).toBe(2);
    expect(countLayout(next).edges.find((edge) => edge.id === edgeId)?.lights).toBe(20);
    expect(next.run).toEqual(layoutStrings(next)[0]!.run);
  });
});

describe("split, weld, and short runs", () => {
  it("splits a run where you point, and the saved corners of the other runs stay", () => {
    const layout = three();
    const split = splitRun(layout, "e2", 1.5, 0.4);
    expect(split.cornerId).not.toBeNull();
    const runs = layoutStrings(split.layout)[0]!.run;
    expect(runs.map((edge) => edge.id).slice(0, 2)).toEqual(["e1", "e2"]);
    expect(runs[1]?.to).toBe(split.cornerId);
    expect(runs[2]?.from).toBe(split.cornerId);
    expect(runs[2]?.to).toBe("c3");
    expect(edgeLengthM(split.layout, runs[1]!)).toBeCloseTo(0.5, 5);
    expect(edgeLengthM(split.layout, runs[2]!)).toBeCloseTo(0.5, 5);
    expect(countLayout(split.layout).edges.map((edge) => edge.lights)).toEqual([10, 5, 5, 10]);
    expect(isPropLayout(split.layout)).toBe(true);
    expect(split.layout.corners.find((corner) => corner.id === "c1")).toEqual({ id: "c1", x: 0, y: 0 });
    expect(split.layout.corners.find((corner) => corner.id === "c4")).toEqual({ id: "c4", x: 3, y: 0 });
  });

  it("keeps a run's name, count, and dark mark on that run when a point is added", () => {
    let layout = setEdgeLights(setEdgeName(three(), "e2", "top"), "e2", 14);
    layout = setEdgeName(setEdgeLights(layout, "e3", 8), "e3", "far");
    const dark = layoutStrings(layout)[0]!.run.map((edge) => edge.id === "e1" ? { ...edge, kind: "wire" as const } : edge);
    layout = { ...layout, run: dark, strings: [{ id: "s1", startId: "c1", run: dark }] };
    const sections: PropSection[] = [
      { id: "s-top", name: "Top", edgeIds: ["e2"], pinnedRanges: [] },
      { id: "s-far", name: "Far", edgeIds: ["e3"], pinnedRanges: [] },
    ];
    const split = splitRun(layout, "e2", 1.5, 0);
    const runs = layoutStrings(split.layout)[0]!.run;
    expect(runs.map((edge) => edge.id)).toEqual(["e1", "e2", runs[2]!.id, "e3"]);
    expect(runs[2]!.id).not.toBe("e2");
    expect(runs[2]!.id).not.toBe("e3");
    expect(runs[0]).toMatchObject({ id: "e1", kind: "wire" });
    expect(runs[1]).toMatchObject({ id: "e2", name: "top", lockedLights: 14, kind: "lit" });
    expect(runs[2]?.name).toBeUndefined();
    expect(runs[2]?.lockedLights).toBeUndefined();
    expect(runs[2]?.kind).toBe("lit");
    expect(runs[3]).toMatchObject({ id: "e3", name: "far", lockedLights: 8 });
    const fixed = reconcileSections(split.layout, sections, layout);
    expect(fixed.sections.find((section) => section.id === "s-top")?.edgeIds).toEqual(["e2"]);
    expect(fixed.sections.find((section) => section.id === "s-far")?.edgeIds).toEqual(["e3"]);
    expect(fixed.dropped).toEqual([]);
  });

  it("adding a point at the end does not move data onto another run", () => {
    const layout = setEdgeName(setEdgeLights(three(), "e3", 8), "e3", "far");
    const next = continueToPoint(layout, "s1", 4, 0);
    const runs = layoutStrings(next)[0]!.run;
    expect(runs[2]).toMatchObject({ id: "e3", name: "far", lockedLights: 8 });
    expect(runs[3]?.id).not.toBe("e3");
    expect(runs[3]?.name).toBeUndefined();
  });

  it("deletes a corner and merges the two runs, keeping the earlier run's data", () => {
    let layout = setEdgeName(setEdgeLights(three(), "e1", 12), "e1", "near");
    layout = setEdgeName(setEdgeLights(layout, "e2", 9), "e2", "top");
    const merged = deletePoint(layout, "c2");
    const runs = layoutStrings(merged)[0]!.run;
    expect(runs.map((edge) => edge.id)).toEqual(["e1", "e3"]);
    expect(runs[0]).toMatchObject({ id: "e1", from: "c1", to: "c3", name: "near", lockedLights: 12, kind: "lit" });
    expect(runs[0]?.name).not.toBe("top");
    expect(merged.corners.map((corner) => corner.id)).toEqual(["c1", "c3", "c4"]);
    expect(merged.retiredIds).toEqual(expect.arrayContaining(["e2", "c2"]));
    expect(deletePoint(layout, "c1")).toBe(layout);
    expect(isPropLayout(merged)).toBe(true);
  });

  it("leaves a saved drawing alone when every run id is already unique", () => {
    const layout = three();
    expect(assignStableRunIds(layout)).toBe(layout);
  });

  it("gives a repeated run id a new one and leaves the first run's id", () => {
    const layout = three();
    const run = layoutStrings(layout)[0]!.run.map((edge) => edge.id === "e3" ? { ...edge, id: "e2", name: "far" } : edge);
    const duplicated = { ...layout, run, strings: [{ id: "s1", startId: "c1", run }] };
    const stable = assignStableRunIds(duplicated);
    const runs = layoutStrings(stable)[0]!.run;
    expect(runs[1]).toMatchObject({ id: "e2" });
    expect(runs[2]?.id).not.toBe("e2");
    expect(runs[2]?.name).toBe("far");
    expect(isPropLayout(stable)).toBe(true);
  });

  it("welds corners inside the tolerance and leaves a corner outside it", () => {
    const close = moveCorner(three(), "c3", 1.01, 0);
    const welded = weldCorners(close, 0.02);
    expect(welded.corners.map((corner) => corner.id)).toEqual(["c1", "c2", "c4"]);
    expect(layoutStrings(welded)[0]!.run.map((edge) => [edge.from, edge.to])).toEqual([["c1", "c2"], ["c2", "c4"]]);
    expect(isPropLayout(welded)).toBe(true);
    const apart = three();
    expect(weldCorners(apart, 0.02)).toBe(apart);
  });

  it("names a backtrack as the same span, in either direction", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 1, 0);
    layout = continueToCorner(layout, "s1", "c1");
    const spans = runsOnSameSpan(layout);
    expect(spans.get("e1")).toEqual(["e1", "e2"]);
    expect(spans.get("e2")).toEqual(["e1", "e2"]);
  });

  it("warns on a run shorter than the spacing and merges it into one corner", () => {
    const close = moveCorner(three(), "c3", 1.05, 0);
    expect(edgeLengthM(close, layoutStrings(close)[0]!.run[1]!)).toBeCloseTo(0.05, 5);
    expect(countLayout(close).edges[1]?.lights).toBe(1);
    expect(shortRuns(close)).toEqual(["e2"]);
    const merged = mergeShortRuns(close);
    expect(shortRuns(merged)).toEqual([]);
    expect(layoutStrings(merged)[0]!.run.map((edge) => edge.id)).toEqual(["e1", "e3"]);
    expect(merged.corners.map((corner) => corner.id)).toEqual(["c1", "c2", "c4"]);
    expect(isPropLayout(merged)).toBe(true);
  });

  it("grows a vertical run along itself", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 0, 1);
    layout = continueToPoint(layout, "s1", 1, 1);
    const edited = setEdgeLength(layout, "e1", 2).layout;
    expect(edited.corners.find((corner) => corner.id === "c2")).toMatchObject({ x: 0, y: 2 });
    expect(edited.corners.find((corner) => corner.id === "c3")).toMatchObject({ x: 1, y: 2 });
  });
});

describe("names and the check before sections", () => {
  it("stores a position name and still loads a drawing that has none", () => {
    const named = setEdgeName(three(), "e2", "top");
    expect(named.run[1]?.name).toBe("top");
    expect(isPropLayout(named)).toBe(true);
    expect(isPropLayout(three())).toBe(true);
    expect(setEdgeName(named, "e2", "  ").run[1]?.name).toBeUndefined();
  });

  it("warns on an overlap, a short run, and corners that do not meet", () => {
    let layout = continueToPoint(emptyTrace("m", 0.1), "s1", 1, 0);
    layout = continueToCorner(layout, "s1", "c1");
    expect(layoutReview(layout)).toEqual(["1 run lies on top of another."]);
    const close = moveCorner(three(), "c3", 1.03, 0);
    expect(layoutReview(close).some((line) => line.includes("shorter"))).toBe(true);
    expect(layoutReview(close).some((line) => line.includes("does not meet"))).toBe(true);
    expect(layoutReview(three())).toEqual([]);
  });
});

describe("delete a run", () => {
  it("removes the run, keeps later runs, and drops a corner nothing uses", () => {
    const layout = three();
    const next = deleteRun(layout, "e3");
    expect(ids(next)).toEqual(["e1", "e2"]);
    expect(next.corners.map((corner) => corner.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("a middle run leaves the later run in place and counted", () => {
    const next = deleteRun(three(), "e2");
    expect(ids(next)).toEqual(["e1", "e3"]);
    expect(lights(next)).toEqual([10, 10]);
    expect(next.corners).toHaveLength(4);
  });

  it("an unknown run changes nothing", () => {
    const layout = three();
    expect(deleteRun(layout, "nope")).toBe(layout);
  });
});
