import { describe, expect, it } from "vitest";
import type { Look, Prop } from "@nightplot/shared";
import {
  addPoint,
  addSection,
  draftFromProp,
  lightTotal,
  measurementsOf,
  newDraft,
  nextName,
  renameForShape,
  runRows,
  sectionRangeText,
  setCount,
  setLookStyle,
  setPropOn,
  setRunLength,
  setRunLights,
  setSectionLit,
  setSize,
  setUnits,
  startFrom,
  styleFor,
  toggleRunInSection,
  sectionLit,
  propOn,
} from "./model";

const triangle = () => startFrom(newDraft("Triangle 1"), "triangle", "m", 0.1);

describe("yard editor drafts", () => {
  it("starts a triangle at 2 × 2 m with a lit base", () => {
    const d = triangle();
    expect(d.sizes).toEqual({ base: 2, height: 2 });
    expect(runRows(d).map((row) => row.name)).toEqual(["Left side", "Right side", "Base"]);
    expect(measurementsOf(d)).toEqual({ shape: "tree", base: 2, height: 2, closed: true });
  });

  it("spreads a typed total over the runs and keeps it when the size changes", () => {
    let d = setCount(triangle(), 60);
    expect(lightTotal(d.layout)).toBe(60);
    d = setSize(d, "height", 3);
    expect(lightTotal(d.layout)).toBe(60);
  });

  it("makes a square from a 2 × 2 triangle by picking Window", () => {
    const d = startFrom(triangle(), "window", "m", 0.1);
    expect(d.sizes).toEqual({ width: 2, height: 2 });
    expect(runRows(d).map((row) => Math.round(row.lengthM * 100) / 100)).toEqual([2, 2, 2, 2]);
  });

  it("keeps a window square when a side's length is typed", () => {
    let d = startFrom(newDraft("w"), "window", "m", 0.1);
    const side = runRows(d)[1]!.edge.id;
    d = setRunLength(d, side, 1.6);
    expect(d.drawn).toBe(false);
    expect(d.sizes.height).toBe(1.6);
  });

  it("moves a drawn run's far end when its length is typed", () => {
    let d = triangle();
    const left = runRows(d)[0]!.edge.id;
    d = setRunLength(d, left, 1);
    expect(d.drawn).toBe(true);
    expect(runRows(d)[0]!.lengthM).toBeCloseTo(1, 3);
  });

  it("freezes the other runs when one run's lights are typed", () => {
    let d = setCount(startFrom(newDraft("l"), "line", "m", 0.1), 120);
    const run = runRows(d)[0]!.edge.id;
    d = setRunLights(d, run, 100);
    expect(d.count).toBeNull();
    expect(lightTotal(d.layout)).toBe(100);
  });

  it("converts sizes when the unit changes and the drawing stays put", () => {
    const d = setUnits(triangle(), "ft");
    expect(d.sizes.base).toBeCloseTo(6.562, 3);
    expect(d.layout?.corners).toEqual(triangle().layout?.corners);
  });

  it("splits a run and keeps it in its section", () => {
    let d = triangle();
    const made = addSection(d);
    d = made.draft;
    const base = runRows(d)[2]!.edge.id;
    d = toggleRunInSection(d, made.id, base);
    const split = addPoint(d, base, 1, 0);
    expect(split.newEdgeId).not.toBeNull();
    expect(split.draft.sections[0]!.edgeIds).toContain(split.newEdgeId);
  });

  it("names section ranges from 1 and gives WLED's from 0", () => {
    let d = setCount(startFrom(newDraft("Box"), "window", "m", 0.1), 80);
    d = setSize(setSize(d, "width", 2), "height", 2);
    const made = addSection(d);
    d = made.draft;
    const [bottom, right] = runRows(d);
    d = toggleRunInSection(toggleRunInSection(d, made.id, bottom!.edge.id), made.id, right!.edge.id);
    expect(sectionRangeText(d.layout, d.sections, made.id)).toEqual({ human: "1–40", wled: "0–39", empty: false });
  });

  it("names a new prop after its shape and keeps a typed name", () => {
    expect(nextName("triangle", ["Triangle 1"])).toBe("Triangle 2");
    expect(renameForShape("Triangle 1", "window", ["Triangle 1"])).toBe("Window 1");
    expect(renameForShape("Box", "window", [])).toBe("Box");
  });

  it("opens a stored template prop with its sizes", () => {
    const d = triangle();
    const prop: Prop = { id: "p1", label: "T", kind: "tree", elementIds: [], layout: d.layout!, design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: measurementsOf(d), ledCount: 64, edges: [] } };
    const opened = draftFromProp(prop, "m", 0.1);
    expect(opened.shape).toBe("triangle");
    expect(opened.drawn).toBe(false);
    expect(opened.sizes).toEqual({ base: 2, height: 2 });
  });
});

describe("yard editor Looks", () => {
  const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };
  const look: Look = { id: "k", name: "Half", slot: 9, style, overrides: [], propIds: [] };
  const box = { id: "box", sections: [{ id: "top", name: "Top", edgeIds: [], pinnedRanges: [], color: "#e05a4f" }] };

  it("switches a prop on and colours one section", () => {
    let k = setPropOn(look, ["box"], "box", true);
    expect(propOn(k, "box")).toBe(true);
    k = setLookStyle(k, box, "top", { color: "#ff0000" });
    expect(styleFor(k, box, "top").color).toBe("#ff0000");
    expect(styleFor(k, box).color).toBe("#ffa000");
  });

  it("uses the section's own colour until the Look names it", () => {
    expect(styleFor(look, box, "top").color).toBe("#e05a4f");
  });

  it("turns a section off and on again", () => {
    let k = setSectionLit(look, box, "top", false);
    expect(sectionLit(k, "box", "top")).toBe(false);
    k = setSectionLit(k, box, "top", true);
    expect(sectionLit(k, "box", "top")).toBe(true);
  });

  it("treats a Look with no list as every prop on", () => {
    const old: Look = { ...look, propIds: undefined };
    expect(propOn(old, "box")).toBe(true);
    expect(setPropOn(old, ["box", "roof"], "box", false).propIds).toEqual(["roof"]);
  });
});
