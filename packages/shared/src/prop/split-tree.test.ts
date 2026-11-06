import { describe, expect, it } from "vitest";
import { compilePropDesign } from "./design.ts";
import { countLayout, layoutStrings } from "./layout.ts";
import { defaultSections, pathEdgeIndexRanges, reconcileSections } from "./sections.ts";
import { groupSplitTreeSections, splitTreeCoverage, splitTreeLayout, splitTreeTrunks, type SplitTreeSpec } from "./split-tree.ts";
import { isProp, type SplitTreeString } from "./types.ts";

const y: SplitTreeSpec = { units: "m", height: 2, split: 1, spacing: 2, trunks: 2, levels: 1 };

function string(partial: Partial<SplitTreeString> & Pick<SplitTreeString, "id" | "trunkIds">): SplitTreeString {
  return { ledProductId: null, pitchMm: 100, ledCount: null, ...partial };
}

function litRuns(spec: SplitTreeSpec & { pitchM?: number }) {
  const layout = splitTreeLayout({ pitchM: 0.1, ...spec })!;
  return layoutStrings(layout).flatMap((row) => row.run.filter((edge) => edge.kind === "lit").map((edge) => ({ ...edge, stringId: row.id })));
}

describe("split tree", () => {
  it("builds a trunk that splits into two", () => {
    const trunks = splitTreeTrunks(y)!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.1"]);
    const layout = splitTreeLayout({ ...y, pitchM: 0.1 })!;
    const base = layout.corners.find((corner) => corner.id === "c-base")!;
    const fork = layout.corners.find((corner) => corner.id === "c-t0")!;
    const left = layout.corners.find((corner) => corner.id === "c-t0.0")!;
    const right = layout.corners.find((corner) => corner.id === "c-t0.1")!;
    expect(base).toMatchObject({ x: 0, y: 0 });
    expect(fork).toMatchObject({ x: 0, y: 1 });
    expect(left.y).toBeCloseTo(2);
    expect(right.y).toBeCloseTo(2);
    expect(right.x - left.x).toBeCloseTo(2);
    const root = layoutStrings(layout).flatMap((row) => row.run).find((edge) => edge.id === "e-t0")!;
    expect(root.wrapLengthM).toBeCloseTo(1);
    expect(root.kind).toBe("lit");
  });

  it("builds a 3-trunk tree with even tip spacing", () => {
    const trunks = splitTreeTrunks({ ...y, trunks: 3 })!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.1", "t0.2"]);
    expect(trunks[2]!.x1 - trunks[1]!.x1).toBeCloseTo(2);
    expect(trunks[3]!.x1 - trunks[2]!.x1).toBeCloseTo(2);
    const layout = splitTreeLayout({ ...y, trunks: 3, pitchM: 0.1 })!;
    expect(layoutStrings(layout).flatMap((row) => row.run).filter((edge) => edge.kind === "lit")).toHaveLength(4);
  });

  it("nests a second fork when asked", () => {
    const trunks = splitTreeTrunks({ ...y, trunks: 4, levels: 2 })!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.0.0", "t0.0.1", "t0.1", "t0.1.0", "t0.1.1"]);
    expect(trunks.find((trunk) => trunk.id === "t0.0")!.to).toBeCloseTo(1.5);
    const uneven = splitTreeTrunks({ ...y, trunks: 3, levels: 2 })!;
    expect(uneven.some((trunk) => trunk.id === "t0.0.0")).toBe(true);
    expect(uneven.filter((trunk) => trunk.to === 2)).toHaveLength(3);
  });

  it("keeps string assignments when spacing or split height changes", () => {
    const strings = [
      string({ id: "s1", ledProductId: "porch", trunkIds: ["t0"], ledCount: 10 }),
      string({ id: "s2", trunkIds: ["t0.0"], ledCount: 20 }),
    ];
    const first = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const sections = defaultSections(first);
    const moved = splitTreeLayout({ ...y, pitchM: 0.1, spacing: 4, split: 0.5, strings })!;
    expect(layoutStrings(moved).map((row) => row.id)).toEqual(expect.arrayContaining(["s1", "s2"]));
    const ids = layoutStrings(moved).flatMap((row) => row.run).map((edge) => edge.id);
    expect(ids).toEqual(expect.arrayContaining(["e-t0", "e-t0.0"]));
    const kept = groupSplitTreeSections(moved, reconcileSections(moved, sections, first).sections);
    expect(kept.find((section) => section.edgeIds.includes("e-t0"))?.edgeIds).toContain("e-t0");
    expect(kept.find((section) => section.edgeIds.includes("e-t0.0"))?.edgeIds).toContain("e-t0.0");
    const wider = splitTreeLayout({ ...y, pitchM: 0.1, trunks: 3, strings })!;
    expect(layoutStrings(wider).some((row) => row.id === "s1")).toBe(true);
    expect(layoutStrings(wider).some((row) => row.id === "s2")).toBe(true);
  });

  it("assigns two strings to two trunks with their own run counts and indexes", () => {
    const strings = [
      string({ id: "s1", trunkIds: ["t0"], ledCount: 10 }),
      string({ id: "s2", trunkIds: ["t0.0"], ledCount: 20, pitchMm: 100 }),
    ];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const runs = litRuns({ ...y, strings });
    const root = runs.find((edge) => edge.id === "e-t0")!;
    const left = runs.find((edge) => edge.id === "e-t0.0")!;
    expect(root.stringId).toBe("s1");
    expect(left.stringId).toBe("s2");
    expect(countLayout(layout).edges.find((edge) => edge.id === "e-t0")!.lights).toBe(10);
    expect(countLayout(layout).edges.find((edge) => edge.id === "e-t0.0")!.lights).toBe(14);
    const ranges = pathEdgeIndexRanges(layout);
    expect(ranges.find((range) => range.edgeId === "e-t0")).toMatchObject({ stringId: "s1", start: 0, stop: 10 });
    expect(ranges.find((range) => range.edgeId === "e-t0.0")).toMatchObject({ stringId: "s2", start: 0, stop: 14 });
    const cover = splitTreeCoverage({ ...y, strings })!;
    expect(cover.cover.find((row) => row.trunkId === "t0")!.openM).toBeCloseTo(0);
    expect(cover.cover.find((row) => row.trunkId === "t0.0")!.strings[0]!.remainingM).toBeCloseTo(0.6);
  });

  it("puts two strings end to end on one trunk", () => {
    const strings = [
      string({ id: "s1", trunkIds: ["t0"], ledCount: 4 }),
      string({ id: "s2", trunkIds: ["t0"], ledCount: 6 }),
    ];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const ranges = pathEdgeIndexRanges(layout);
    expect(ranges.find((range) => range.edgeId === "e-t0")).toMatchObject({ stringId: "s1", start: 0, stop: 4 });
    expect(ranges.find((range) => range.edgeId === "e-t0-2")).toMatchObject({ stringId: "s2", start: 0, stop: 6 });
    expect(layoutStrings(layout).find((row) => row.id === "s1")!.run.some((edge) => edge.kind === "wire")).toBe(false);
  });

  it("draws a dark jump when one string hops between trunks that do not meet", () => {
    const strings = [string({ id: "s1", trunkIds: ["t0.0", "t0.1"], ledCount: 100 })];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const run = layoutStrings(layout).find((row) => row.id === "s1")!.run;
    expect(run.map((edge) => edge.kind)).toEqual(["lit", "wire", "lit"]);
    const ranges = pathEdgeIndexRanges(layout).filter((range) => range.stringId === "s1" && range.lights > 0);
    expect(ranges[1]!.start).toBe(ranges[0]!.stop);
    expect(splitTreeCoverage({ ...y, strings })!.hops).toEqual([
      { stringId: "s1", fromId: "t0.0", toId: "t0.1", dark: true },
    ]);
  });

  it("does not draw a dark jump when a string continues from the trunk into a branch", () => {
    const strings = [string({ id: "s1", trunkIds: ["t0", "t0.0"], ledCount: 100 })];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const run = layoutStrings(layout).find((row) => row.id === "s1")!.run;
    expect(run.every((edge) => edge.kind === "lit")).toBe(true);
    expect(splitTreeCoverage({ ...y, strings })!.hops[0]!.dark).toBe(false);
  });

  it("saves as a prop", () => {
    const compiled = compilePropDesign({
      kind: "split-tree",
      unit: "ft",
      pitchMm: 100,
      ledProductId: null,
      measurements: { shape: "split-tree", height: 8, split: 4, spacing: 4, trunks: 2, levels: 1 },
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(isProp({ id: "p1", label: "Front tree", kind: "split-tree", elementIds: [], design: compiled.design, layout: compiled.layout, sections: compiled.sections })).toBe(true);
    const bad = { ...compiled.design, measurements: { shape: "split-tree" as const, height: 8, split: 8, spacing: 4, trunks: 2, levels: 1 as const } };
    expect(isProp({ id: "p2", label: "Bad", kind: "split-tree", elementIds: [], design: bad })).toBe(false);
  });
});
