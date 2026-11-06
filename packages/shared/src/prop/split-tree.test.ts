import { describe, expect, it } from "vitest";
import { compilePropDesign } from "./design.ts";
import { countLayout, layoutStrings, METRES_PER_FOOT } from "./layout.ts";
import { defaultSections, pathEdgeIndexRanges, reconcileSections } from "./sections.ts";
import { forkPoseNode, movePoseJoint } from "./split-pose.ts";
import { readPropShape } from "./shape.ts";
import { layoutLightPoints, placeYardLight, yardPose } from "./space.ts";
import { defaultSplitPose, groupSplitTreeSections, SPLIT_WALK_ID, splitTreeCoverage, splitTreeLayout, splitTreeTrunks, trunkIdFromEdge, type SplitTreeSpec } from "./split-tree.ts";
import { isProp, type SplitTreeString } from "./types.ts";

const y: SplitTreeSpec = { units: "m", height: 2, split: 1, spacing: 2, trunks: 2, levels: 1 };

function string(partial: Partial<SplitTreeString> & Pick<SplitTreeString, "id" | "trunkIds">): SplitTreeString {
  return { ledProductId: null, pitchMm: 100, ledCount: null, ...partial };
}

function corner(spec: SplitTreeSpec, id: string) {
  const layout = splitTreeLayout({ pitchM: 0.1, ...spec })!;
  return layout.corners.find((row) => row.id === id)!;
}

describe("split tree", () => {
  it("builds a trunk that splits into two, each branch thinner than the trunk", () => {
    const trunks = splitTreeTrunks(y)!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.1"]);
    // 30 cm around at the ground by default.
    expect(trunks[0]!.radius0).toBeCloseTo(0.3 / (2 * Math.PI));
    expect(trunks[1]!.radius0).toBeLessThan(trunks[0]!.radius1);
    expect(trunks[1]!.x1).toBeLessThan(0);
    expect(trunks[2]!.x1).toBeGreaterThan(0);
    // 1 m of trunk at a 15 cm wrap gap.
    expect(trunks[0]!.turns).toBeCloseTo(1 / 0.15);
    expect(trunks[0]!.lengthM).toBeGreaterThan(trunks[0]!.woodM);
    const layout = splitTreeLayout({ ...y, pitchM: 0.1 })!;
    expect(layout.corners.find((row) => row.id === "c-base")).toMatchObject({ x: 0, y: 0 });
    expect(layout.corners.find((row) => row.id === "c-t0")).toMatchObject({ x: 0, y: 1 });
    const left = layout.corners.find((row) => row.id === "c-t0.0")!;
    const right = layout.corners.find((row) => row.id === "c-t0.1")!;
    expect(right.x - left.x).toBeCloseTo(2);
    expect(layout.bodies?.find((row) => row.id === "t0")?.r0).toBeGreaterThan(trunks[0]!.radius0);
  });

  it("coils round the trunk: front lights toward the street, back lights away", () => {
    const layout = splitTreeLayout({ ...y, pitchM: 0.1 })!;
    const coil = layout.corners.filter((row) => /^c-t0-w\d+$/.test(row.id));
    const r = splitTreeTrunks(y)![0]!.radius0;
    expect(Math.max(...coil.map((row) => row.z ?? 0))).toBeCloseTo(r, 2);
    expect(Math.min(...coil.map((row) => row.z ?? 0))).toBeCloseTo(-r, 2);
    // On the drawing the coil stays on the wood.
    for (const row of coil) expect(Math.abs(row.x)).toBeLessThanOrEqual(r + 1e-6);
    // Lights carry that depth, and the yard puts the front ones nearer the road.
    const points = layoutLightPoints(layout);
    expect(points.some((point) => point.z > r * 0.5)).toBe(true);
    expect(points.some((point) => point.z < -r * 0.5)).toBe(true);
    const front = placeYardLight({ x: 0, y: 1, z: 0.1 }, yardPose({ x: 5, y: 0, depth: 3 }));
    expect(front.z).toBeCloseTo(2.9);
  });

  it("wraps more often at a smaller gap, and thicker at a larger around", () => {
    const base = splitTreeTrunks(y)![0]!;
    const tight = splitTreeTrunks({ ...y, gap: 0.05 })![0]!;
    const thick = splitTreeTrunks({ ...y, around: 0.6 })![0]!;
    expect(tight.turns).toBeCloseTo(base.turns * 3);
    expect(tight.lengthM).toBeGreaterThan(base.lengthM * 2);
    expect(thick.radius0).toBeCloseTo(base.radius0 * 2);
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, around: 0.6, gap: 0.05 })!;
    expect(layout.template?.params).toMatchObject({ around: 0.6, gap: 0.05 });
  });

  it("is one string with no strings set: up the trunk, up the left, back down, up the right", () => {
    const layout = splitTreeLayout({ ...y, pitchM: 0.1 })!;
    const strings = layoutStrings(layout);
    expect(strings.map((row) => row.id)).toEqual([SPLIT_WALK_ID]);
    const run = strings[0]!.run;
    const order = run.map((edge) => trunkIdFromEdge(edge.id));
    expect(order[0]).toBe("t0");
    const leftAt = order.indexOf("t0.0");
    const backAt = run.findIndex((edge) => edge.id === "e-t0.0-back");
    const rightAt = order.indexOf("t0.1");
    expect(leftAt).toBeGreaterThan(0);
    expect(backAt).toBeGreaterThan(leftAt);
    expect(rightAt).toBeGreaterThan(backAt);
    expect(run.every((edge) => edge.kind === "lit")).toBe(true);
    // Every run starts where the last one ended.
    for (let index = 1; index < run.length; index += 1) expect(run[index]!.from).toBe(run[index - 1]!.to);
    // Lights follow the real string length, not the flat drawing.
    const total = countLayout(layout).total;
    const string = run.reduce((sum, edge) => sum + (edge.wrapLengthM ?? 0), 0);
    expect(total).toBe(Math.round(string / 0.1));
  });

  it("reads the coil as one path, not a knot of crossings", () => {
    const layout = splitTreeLayout({ ...y, pitchM: 0.1 })!;
    const shape = readPropShape(layout);
    expect(shape.points.filter((point) => point.kind === "junction")).toHaveLength(0);
  });

  it("builds a 3-trunk tree with even tip spacing", () => {
    const trunks = splitTreeTrunks({ ...y, trunks: 3 })!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.1", "t0.2"]);
    expect(trunks[2]!.x1 - trunks[1]!.x1).toBeCloseTo(2);
    expect(trunks[3]!.x1 - trunks[2]!.x1).toBeCloseTo(2);
    const layout = splitTreeLayout({ ...y, trunks: 3, pitchM: 0.1 })!;
    const ids = new Set(layoutStrings(layout).flatMap((row) => row.run).filter((edge) => edge.kind === "lit").map((edge) => trunkIdFromEdge(edge.id)));
    expect([...ids].sort()).toEqual(["t0", "t0.0", "t0.1", "t0.2"]);
  });

  it("nests a second fork when asked", () => {
    const trunks = splitTreeTrunks({ ...y, trunks: 4, levels: 2 })!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.0.0", "t0.0.1", "t0.1", "t0.1.0", "t0.1.1"]);
    expect(trunks.find((trunk) => trunk.id === "t0.0")!.to).toBeCloseTo(1.5);
    const left = trunks.find((trunk) => trunk.id === "t0.0.0")!;
    const right = trunks.find((trunk) => trunk.id === "t0.0.1")!;
    expect(left.x1).toBeLessThan(right.x1);
    expect(left.radius0).toBeLessThan(trunks[0]!.radius0);
    const uneven = splitTreeTrunks({ ...y, trunks: 3, levels: 2 })!;
    expect(uneven.some((trunk) => trunk.id === "t0.0.0")).toBe(true);
    expect(uneven.filter((trunk) => trunk.to === 2)).toHaveLength(3);
    const strings = [string({ id: "s1", trunkIds: ["t0.0.0", "t0.1"], ledCount: 400 })];
    const nested = splitTreeLayout({ ...y, trunks: 4, levels: 2, pitchM: 0.1, strings })!;
    const run = layoutStrings(nested).find((row) => row.id === "s1")!.run;
    const back = run.findIndex((edge) => edge.id === "e-t0.0.0-back");
    const branch = run.findIndex((edge) => edge.id === "e-t0.0-back");
    const up = run.findIndex((edge) => trunkIdFromEdge(edge.id) === "t0.1");
    expect(back).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(back);
    expect(up).toBeGreaterThan(branch);
    expect(run.some((edge) => edge.kind === "wire")).toBe(false);
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
    const ranges = pathEdgeIndexRanges(layout);
    const root = ranges.filter((range) => range.stringId === "s1" && range.lights > 0);
    const left = ranges.filter((range) => range.stringId === "s2" && range.lights > 0);
    expect(root[0]).toMatchObject({ edgeId: "e-t0", start: 0 });
    expect(root.reduce((sum, range) => sum + range.lights, 0)).toBe(10);
    expect(left[0]!.start).toBe(0);
    expect(left.reduce((sum, range) => sum + range.lights, 0)).toBe(20);
    expect(left.every((range) => trunkIdFromEdge(range.edgeId) === "t0.0")).toBe(true);
    const cover = splitTreeCoverage({ ...y, strings })!;
    expect(cover.cover.find((row) => row.trunkId === "t0")!.openM).toBeGreaterThan(0);
    expect(cover.cover.find((row) => row.trunkId === "t0")!.strings[0]!.remainingM).toBeCloseTo(0);
    expect(cover.cover.find((row) => row.trunkId === "t0.0")!.openM).toBeGreaterThan(0);
    expect(countLayout(layout).edges.find((edge) => edge.id === "e-t0")!.lights).toBeGreaterThan(0);
  });

  it("puts two strings end to end on one trunk", () => {
    const strings = [
      string({ id: "s1", trunkIds: ["t0"], ledCount: 4 }),
      string({ id: "s2", trunkIds: ["t0"], ledCount: 6 }),
    ];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const ranges = pathEdgeIndexRanges(layout);
    const first = ranges.filter((range) => range.stringId === "s1" && range.lights > 0);
    const second = ranges.filter((range) => range.stringId === "s2" && range.lights > 0);
    expect(first[0]).toMatchObject({ edgeId: "e-t0", start: 0 });
    expect(first.reduce((sum, range) => sum + range.lights, 0)).toBe(4);
    expect(second.reduce((sum, range) => sum + range.lights, 0)).toBe(6);
    expect(second.every((range) => trunkIdFromEdge(range.edgeId) === "t0")).toBe(true);
    expect(layoutStrings(layout).find((row) => row.id === "s1")!.run.some((edge) => edge.kind === "wire")).toBe(false);
  });

  it("wraps up a branch, runs back down its back, then wraps up the sibling", () => {
    const strings = [string({ id: "s1", trunkIds: ["t0.0", "t0.1"], ledCount: 400 })];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const run = layoutStrings(layout).find((row) => row.id === "s1")!.run;
    const backAt = run.findIndex((edge) => edge.id === "e-t0.0-back");
    expect(backAt).toBeGreaterThan(0);
    expect(run.slice(0, backAt).every((edge) => trunkIdFromEdge(edge.id) === "t0.0")).toBe(true);
    expect(run.slice(backAt + 1).every((edge) => trunkIdFromEdge(edge.id) === "t0.1")).toBe(true);
    expect(run.some((edge) => edge.kind === "wire")).toBe(false);
    const from = layout.corners.find((row) => row.id === run[backAt]!.from)!;
    const to = layout.corners.find((row) => row.id === run[backAt]!.to)!;
    expect(from.y).toBeGreaterThan(to.y + 0.5);
    // It comes down the back of the branch and lands at the fork.
    expect(to).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(1) });
    expect(to.z).toBeLessThan(0);
    expect(splitTreeCoverage({ ...y, strings })!.hops).toEqual([
      { stringId: "s1", fromId: "t0.0", toId: "t0.1", dark: false, back: true },
    ]);
    const ranges = pathEdgeIndexRanges(layout).filter((range) => range.stringId === "s1" && range.lights > 0);
    for (let index = 1; index < ranges.length; index += 1) expect(ranges[index]!.start).toBe(ranges[index - 1]!.stop);
  });

  it("draws a dark jump when two pieces do not meet", () => {
    const strings = [string({ id: "s1", trunkIds: ["t0.0.0", "t0.1.0"], ledCount: 400 })];
    const spec = { ...y, trunks: 4, levels: 2 as const, strings };
    const layout = splitTreeLayout({ ...spec, pitchM: 0.1 })!;
    const run = layoutStrings(layout).find((row) => row.id === "s1")!.run;
    expect(run.map((edge) => edge.kind)).toContain("wire");
    expect(run.some((edge) => edge.id.endsWith("-back"))).toBe(false);
    // The dark jump takes no light numbers: the next branch carries on from the last light.
    const ranges = pathEdgeIndexRanges(layout).filter((range) => range.stringId === "s1");
    for (let index = 1; index < ranges.length; index += 1) expect(ranges[index]!.start).toBe(ranges[index - 1]!.stop);
    expect(splitTreeCoverage(spec)!.hops).toEqual([
      { stringId: "s1", fromId: "t0.0.0", toId: "t0.1.0", dark: true, back: false },
    ]);
  });

  it("does not draw a dark jump when a wrap continues from the trunk into a branch", () => {
    const strings = [string({ id: "s1", trunkIds: ["t0", "t0.0"], ledCount: 400 })];
    const layout = splitTreeLayout({ ...y, pitchM: 0.1, strings })!;
    const run = layoutStrings(layout).find((row) => row.id === "s1")!.run;
    expect(run.every((edge) => edge.kind === "lit")).toBe(true);
    expect(run.some((edge) => edge.name === "Onto Left")).toBe(true);
    expect(splitTreeCoverage({ ...y, strings })!.hops[0]).toEqual({ stringId: "s1", fromId: "t0", toId: "t0.0", dark: false, back: false });
  });

  it("keeps geometry in the prop unit and string spacing in centimetres", () => {
    const feet = splitTreeTrunks({ units: "ft", height: 8, split: 4, spacing: 4, trunks: 2, levels: 1 })!;
    expect(feet[0]!.to).toBeCloseTo(4);
    expect(feet[0]!.riseM).toBeCloseTo(4 * METRES_PER_FOOT);
    expect(feet[1]!.x1).toBeCloseTo(-2);
    expect(feet[0]!.lengthM).toBeGreaterThan(feet[0]!.woodM);
    const metres = splitTreeLayout({
      units: "m",
      height: 8 * METRES_PER_FOOT,
      split: 4 * METRES_PER_FOOT,
      spacing: 4 * METRES_PER_FOOT,
      trunks: 2,
      levels: 1,
      pitchM: 0.1,
    })!;
    const imperial = splitTreeLayout({ units: "ft", height: 8, split: 4, spacing: 4, trunks: 2, levels: 1, pitchM: 0.1 })!;
    const forkM = metres.corners.find((row) => row.id === "c-t0")!;
    const forkF = imperial.corners.find((row) => row.id === "c-t0")!;
    expect(forkF.y).toBeCloseTo(forkM.y);
    const strings = [string({ id: "s1", trunkIds: ["t0"], ledCount: 10, pitchMm: 100 })];
    const cover = splitTreeCoverage({ units: "ft", height: 8, split: 4, spacing: 4, trunks: 2, levels: 1, strings })!;
    const row = cover.cover.find((item) => item.trunkId === "t0")!;
    expect(row.strings[0]!.coveredM).toBeCloseTo(1);
    expect(row.strings[0]!.remainingM).toBeCloseTo(0);
    expect(row.lengthM).toBeGreaterThan(1);
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

  it("moves the crotch without taking the tips with it", () => {
    const pose = defaultSplitPose(y);
    expect(pose).not.toBeNull();
    const moved = movePoseJoint(pose!, "t0", 0.4, 1.3, false);
    expect(moved).not.toBeNull();
    const spec = { ...y, pose: moved! };
    const trunks = splitTreeTrunks(spec)!;
    const fork = trunks.find((trunk) => trunk.id === "t0")!;
    const left = trunks.find((trunk) => trunk.id === "t0.0")!;
    const right = trunks.find((trunk) => trunk.id === "t0.1")!;
    expect(fork.x1).toBeCloseTo(0.4);
    expect(fork.to).toBeCloseTo(1.3);
    expect(left.x1).toBeCloseTo(-1);
    expect(right.x1).toBeCloseTo(1);
    expect(left.x0).toBeCloseTo(0.4);
    expect(right.x0).toBeCloseTo(0.4);
    const layout = splitTreeLayout({ ...spec, pitchM: 0.1 })!;
    expect(layout.corners.find((corner) => corner.id === "c-t0")).toMatchObject({ x: expect.closeTo(0.4), y: expect.closeTo(1.3) });
  });

  it("aims one tip on its own, so the tree is no longer a symmetric Y", () => {
    const pose = defaultSplitPose({ ...y, units: "ft", height: 8, split: 4, spacing: 4 })!;
    const moved = movePoseJoint(pose, "t0.0", -3.5, 7, false)!;
    const trunks = splitTreeTrunks({ units: "ft", height: 8, split: 4, spacing: 4, trunks: 2, levels: 1, pose: moved })!;
    const left = trunks.find((trunk) => trunk.id === "t0.0")!;
    const right = trunks.find((trunk) => trunk.id === "t0.1")!;
    expect(left.x1).toBeCloseTo(-3.5);
    expect(left.to).toBeCloseTo(7);
    expect(right.x1).toBeCloseTo(2);
    expect(right.to).toBeCloseTo(8);
    expect(left.x1).not.toBeCloseTo(-right.x1);
  });

  it("forks one tip and leaves the other branch a single tip", () => {
    const pose = forkPoseNode(defaultSplitPose(y)!, "t0.1");
    expect(pose).not.toBeNull();
    const trunks = splitTreeTrunks({ ...y, pose: pose! })!;
    expect(trunks.map((trunk) => trunk.id)).toEqual(["t0", "t0.0", "t0.1", "t0.1.0", "t0.1.1"]);
    const kept = trunks.find((trunk) => trunk.id === "t0.0")!;
    expect(trunks.some((trunk) => trunk.parentId === "t0.0")).toBe(false);
    expect(kept.x1).toBeLessThan(0);
    const nested = trunks.filter((trunk) => trunk.parentId === "t0.1");
    expect(nested).toHaveLength(2);
    expect(nested[0]!.x1).not.toBeCloseTo(nested[1]!.x1);
  });

});
