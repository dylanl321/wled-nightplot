import { describe, expect, it } from "vitest";
import { countLayout, layoutStrings, pathEdgeIndexRanges, trunkIdFromEdge } from "@nightplot/shared";
import {
  addSplitString,
  draftFromProp,
  measurementsOf,
  newDraft,
  setSize,
  startFrom,
  updateSplitString,
} from "./model";

describe("split tree draft", () => {
  it("starts from a Y and keeps string assignments when the spacing changes", () => {
    let draft = startFrom(newDraft("Split tree 1"), "splitTree", "m", 0.1);
    expect(measurementsOf(draft)).toMatchObject({ shape: "split-tree", height: 2.4, split: 1.2, spacing: 1.2, trunks: 2, levels: 1 });
    const lit = layoutStrings(draft.layout!).flatMap((row) => row.run).filter((edge) => edge.kind === "lit");
    expect(lit.length).toBeGreaterThan(3);
    expect([...new Set(lit.map((edge) => trunkIdFromEdge(edge.id)))].sort()).toEqual(["t0", "t0.0", "t0.1"]);
    draft = addSplitString(draft, "t0");
    draft = addSplitString(draft, "t0.0");
    draft = updateSplitString(draft, "s1", { ledCount: 12, pitchMm: 100 });
    draft = updateSplitString(draft, "s2", { ledCount: 20, pitchMm: 100 });
    const before = draft.split?.strings.map((string) => string.trunkIds);
    draft = setSize(draft, "spacing", 2);
    draft = setSize(draft, "split", 1);
    expect(draft.split?.strings.map((string) => string.trunkIds)).toEqual(before);
    expect(layoutStrings(draft.layout!).some((row) => row.id === "s1")).toBe(true);
    expect(layoutStrings(draft.layout!).some((row) => row.id === "s2")).toBe(true);
    const ranges = pathEdgeIndexRanges(draft.layout!);
    expect(ranges.find((range) => range.stringId === "s1" && range.edgeId === "e-t0")?.stop).toBeGreaterThan(0);
    expect(ranges.find((range) => range.stringId === "s2" && range.edgeId === "e-t0.0")?.start).toBe(0);
    const again = draftFromProp({
      id: "p1",
      label: "Split tree 1",
      kind: "split-tree",
      elementIds: [],
      layout: draft.layout!,
      sections: draft.sections,
      design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: measurementsOf(draft), ledCount: countLayout(draft.layout!).total, edges: [] },
    }, "m", 0.1);
    expect(again.drawn).toBe(false);
    expect(again.split?.strings).toHaveLength(2);
  });
});
