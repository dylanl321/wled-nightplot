import { describe, expect, it } from "vitest";
import { propShapeChanged } from "./design.ts";
import { continueToPoint, deleteRun, layoutFromMeasurements, layoutStrings, moveCorner, type PropLayout } from "./layout.ts";
import { defaultSections, reconcileSections } from "./sections.ts";

function tree(): PropLayout {
  return layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "tree", params: { height: 2, base: 2 } })!;
}

const measurements = { shape: "tree" as const, height: 2, base: 2 };

describe("sections after a path edit", () => {
  it("drops an edge the path lost and gives each new edge its own section", () => {
    const layout = tree();
    const sections = defaultSections(layout);
    const [first, second] = layoutStrings(layout)[0]!.run;
    const trimmed = deleteRun(layout, second!.id);
    const traced = continueToPoint(continueToPoint(trimmed, "s1", 0, 2), "s1", 2, 2);
    const result = reconcileSections(traced, sections, layout);
    expect(result.dropped).toEqual([second!.id]);
    expect(result.sections[0]!.edgeIds).toEqual([first!.id]);
    expect(result.sections[1]!.edgeIds).toEqual([]);
    expect(result.added).toEqual(["Side 2", "Side 3"]);
    const covered = result.sections.flatMap((section) => section.edgeIds);
    for (const edge of layoutStrings(traced)[0]!.run) expect(covered).toContain(edge.id);
  });

  it("with the old path, leaves an edge that was out of every section on purpose", () => {
    const layout = tree();
    const [first] = layoutStrings(layout)[0]!.run;
    const onlyFirst = [{ id: "a", name: "Left", edgeIds: [first!.id], pinnedRanges: [] }];
    expect(reconcileSections(layout, onlyFirst, layout).added).toEqual([]);
    const traced = continueToPoint(layout, "s1", 0, 3);
    expect(reconcileSections(traced, onlyFirst, layout).added).toEqual(["Side 3"]);
  });

  it("changes nothing when the path keeps its edges", () => {
    const layout = tree();
    const sections = defaultSections(layout);
    const moved = moveCorner(layout, layout.corners[1]!.id, 0.2, 2.2);
    expect(reconcileSections(moved, sections)).toEqual({ sections, added: [], dropped: [] });
  });
});

describe("propShapeChanged", () => {
  it("is false for the template and a moved corner, true once a run is deleted or traced", () => {
    const layout = tree();
    const design = { unit: "m" as const, pitchMm: 100, ledProductId: null, measurements, ledCount: 44, edges: [] };
    expect(propShapeChanged({ kind: "tree", layout, design })).toBe(false);
    expect(propShapeChanged({ kind: "tree", layout: moveCorner(layout, layout.corners[1]!.id, 0.2, 2.2), design })).toBe(false);
    const second = layoutStrings(layout)[0]!.run[1]!;
    expect(propShapeChanged({ kind: "tree", layout: deleteRun(layout, second.id), design })).toBe(true);
    expect(propShapeChanged({ kind: "custom", layout: deleteRun(layout, second.id), design })).toBe(false);
  });
});
