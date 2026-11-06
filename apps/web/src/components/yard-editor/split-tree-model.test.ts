import { describe, expect, it } from "vitest";
import { countLayout, layoutStrings, pathEdgeIndexRanges, trunkIdFromEdge } from "@nightplot/shared";
import {
  addSplitString,
  draftFromProp,
  forkSplitBranch,
  measurementsOf,
  moveSplitJoint,
  moveSplitMeet,
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

  it("drags the crotch, aims one tip, places the wrap meet, and forks that tip", () => {
    let draft = startFrom(newDraft("Split tree 1"), "splitTree", "ft", 0.1);
    draft = moveSplitJoint(draft, "t0", 1, 3, false);
    expect(draft.sizes.split).toBeCloseTo(3);
    const fork = draft.layout!.corners.find((corner) => corner.id === "c-t0")!;
    expect(fork.x).toBeGreaterThan(0.2);
    const rightBefore = draft.split!.pose!.nodes.find((node) => node.id === "t0.1");
    draft = moveSplitJoint(draft, "t0.0", -5, 7, false);
    expect(draft.split!.pose!.nodes.find((node) => node.id === "t0.1")).toEqual(rightBefore);
    expect(draft.split!.pose!.nodes.find((node) => node.id === "t0.0")).toMatchObject({ x: -5, y: 7 });
    expect(draft.sizes.height).toBeGreaterThan(7);
    draft = setSize(draft, "split", 3.5);
    expect(draft.split!.pose!.nodes.find((node) => node.id === "t0")!.y).toBeCloseTo(3.5);
    const left = draft.split!.pose!.nodes.find((node) => node.id === "t0.0")!;
    expect(left.x).toBeCloseTo(-5);
    draft = moveSplitMeet(draft, "t0", left.x, 3.5);
    expect(draft.split!.pose!.meets.find((meet) => meet.forkId === "t0")).toBeTruthy();
    expect(draft.layout!.corners.find((corner) => corner.id === "c-meet-t0")).toBeTruthy();
    draft = forkSplitBranch(draft, "t0.1");
    expect(draft.split!.pose!.nodes.some((node) => node.id === "t0.1.0")).toBe(true);
    expect(draft.split!.pose!.nodes.some((node) => node.id === "t0.0.0")).toBe(false);
    expect(draft.layout!.bodies?.some((body) => body.id === "t0.1.0")).toBe(true);
    const saved = measurementsOf(draft);
    expect(saved.shape).toBe("split-tree");
    if (saved.shape !== "split-tree") return;
    expect(saved.pose?.nodes.some((node) => node.id === "t0.1.0")).toBe(true);
    const reopened = draftFromProp({
      id: "p1",
      label: "Split tree 1",
      kind: "split-tree",
      elementIds: [],
      layout: draft.layout!,
      sections: draft.sections,
      design: { unit: "ft", pitchMm: 100, ledProductId: null, measurements: saved, ledCount: null, edges: [] },
    }, "ft", 0.1);
    expect(reopened.drawn).toBe(false);
    expect(reopened.split?.pose?.nodes.find((node) => node.id === "t0.0")?.x).toBeCloseTo(-5);
  });
});
