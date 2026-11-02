import { describe, expect, it } from "vitest";
import { DEFAULT_LOOKS, type Look, type LookStyle } from "../look.ts";
import { sectionStyle } from "../look-design.ts";
import { drawnYard } from "../look-drawing.ts";
import { windowLayout, type LayoutEdge, type PropLayout } from "./layout.ts";
import {
  applyPropDesign,
  applySectionDesign,
  directionForMotion,
  propShape,
  sectionShapeLights,
  sectionsFromShape,
  shapeSummary,
  similarProps,
  similarSections,
} from "./shape-design.ts";
import type { Prop } from "./types.ts";

function drawn(corners: [string, number, number][], runs: [string, string, string][]): PropLayout {
  const run: LayoutEdge[] = runs.map(([id, from, to]) => ({ id, from, to, kind: "lit" }));
  return { source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0, corners: corners.map(([id, x, y]) => ({ id, x, y })), run };
}

const WELL = drawn(
  [["c1", 0, 0], ["c2", 1, 0], ["c3", 1, 1], ["c4", 0, 1]],
  [["e1", "c1", "c2"], ["e2", "c2", "c3"], ["e3", "c3", "c4"], ["e4", "c4", "c1"], ["e5", "c1", "c3"], ["e6", "c2", "c4"]],
);

function prop(id: string, layout: PropLayout, sections: Prop["sections"] = []): Prop {
  return { id, label: id, kind: "custom", elementIds: [], layout, sections, design: { unit: "m", pitchMm: 100, ledProductId: null, measurements: { shape: "custom" }, ledCount: 0, edges: [] } };
}

function withSections(p: Prop, plan: "border-inside" | "parts"): Prop {
  return { ...p, sections: sectionsFromShape(p, propShape(p)!, plan) };
}

const look = (): Look => ({ ...DEFAULT_LOOKS[0]!, overrides: [] });
const chase: LookStyle = { fx: 15, pal: 0, sx: 128, ix: 128, bri: 200, color: "#ffa000", color2: "#000000" };

describe("shape design", () => {
  it("sums up the well", () => {
    expect(shapeSummary(propShape(prop("w", WELL))!)).toMatch(/^4 sides · 4 corners · a centre · \d+ of \d+ lights inside · mirrors/);
  });

  it("makes border and inside sections, keeping the X's runs whole", () => {
    const well = withSections(prop("w", WELL), "border-inside");
    expect(well.sections!.map((row) => [row.name, row.edgeIds, row.pinnedRanges.length])).toEqual([
      ["Border", ["e1", "e2", "e3", "e4"], 0],
      ["Inside", ["e5", "e6"], 0],
    ]);
    const yard = drawnYard([well])[0]!;
    expect(yard.sections.map((row) => row.name)).toEqual(["Border", "Inside"]);
  });

  it("makes one section per side and per inside run", () => {
    const well = withSections(prop("w", WELL), "parts");
    expect(well.sections!.map((row) => row.name).sort()).toEqual(["Bottom", "Inside 1", "Inside 2", "Left", "Right", "Top"]);
    expect(well.sections!.every((row) => row.pinnedRanges.length === 0 && row.edgeIds.length === 1)).toBe(true);
  });

  it("works out a direction for each motion", () => {
    const well = withSections(prop("w", WELL), "parts");
    const shape = propShape(well)!;
    const id = (name: string) => well.sections!.find((row) => row.name === name)!.id;
    // A diagonal passes through the centre: toward it is both ends in, out is from the middle.
    expect(directionForMotion(sectionShapeLights(well, shape, id("Inside 1")), "inward").dir).toBe("mirror");
    expect(directionForMotion(sectionShapeLights(well, shape, id("Inside 1")), "outward").dir).toBe("mirror-rev");
    // The bottom is wired left to right (e1 c1→c2), so clockwise (right to left along the bottom) runs from the end.
    expect(directionForMotion(sectionShapeLights(well, shape, id("Bottom")), "clockwise").dir).toBe("rev");
    expect(directionForMotion(sectionShapeLights(well, shape, id("Bottom")), "counter").dir).toBe("fwd");
    // The right side runs c2→c3, upward.
    expect(directionForMotion(sectionShapeLights(well, shape, id("Right")), "up").dir).toBe("fwd");
    expect(directionForMotion(sectionShapeLights(well, shape, id("Right")), "down").dir).toBe("rev");
    const flat = directionForMotion(sectionShapeLights(well, shape, id("Bottom")), "up");
    expect(flat.dir).toBe("fwd");
    expect(flat.note).toMatch(/barely change/);
  });

  it("follows a whole border loop clockwise", () => {
    const well = withSections(prop("w", WELL), "border-inside");
    const shape = propShape(well)!;
    const border = sectionShapeLights(well, shape, well.sections![0]!.id);
    // e1→e2→e3→e4 goes counter-clockwise around the square.
    expect(directionForMotion(border, "counter").dir).toBe("fwd");
    expect(directionForMotion(border, "clockwise").dir).toBe("rev");
  });

  it("finds like sections on this prop and others, and copies a design with its own direction", () => {
    const a = withSections(prop("a", WELL), "parts");
    const b = withSections(prop("b", WELL), "parts");
    const props = [a, b];
    const bottom = a.sections!.find((row) => row.name === "Bottom")!;
    const like = similarSections(props, { propId: "a", sectionId: bottom.id });
    expect(like.filter((row) => row.sameProp).map((row) => row.sectionName).sort()).toEqual(["Left", "Right", "Top"]);
    expect(like.filter((row) => !row.sameProp)).toHaveLength(4);
    const right = a.sections!.find((row) => row.name === "Right")!;
    const next = applySectionDesign(look(), ["a", "b"], props, { ...chase, motion: "clockwise" }, [
      { propId: "a", sectionId: bottom.id },
      { propId: "a", sectionId: right.id },
    ]);
    expect(sectionStyle(next, a, bottom.id)?.dir).toBe("rev");
    // Right runs c2→c3 (up); clockwise on the right side is downward.
    expect(sectionStyle(next, a, right.id)?.dir).toBe("rev");
    expect(sectionStyle(next, a, right.id)?.motion).toBe("clockwise");
  });

  it("copies a whole prop's design onto a prop of the same shape", () => {
    const a = withSections(prop("a", WELL), "parts");
    const b = withSections(prop("b", WELL), "parts");
    const win = withSections(prop("win", windowLayout({ widthM: 1, heightM: 1, units: "m", pitchM: 0.1, startCorner: 0, clockwise: false, params: {} })), "parts");
    const props = [a, b, win];
    const matches = similarProps(props, "a");
    expect(matches.map((row) => row.propId)).toEqual(["b"]);
    const inside = a.sections!.find((row) => row.name === "Inside 1")!;
    const designed = applySectionDesign(look(), ["a", "b", "win"], props, { ...chase, motion: "inward" }, [{ propId: "a", sectionId: inside.id }]);
    const copied = applyPropDesign(designed, ["a", "b", "win"], props, "a", matches);
    const target = b.sections!.find((row) => row.id === matches[0]!.pairs.find((pair) => pair.from === inside.id)!.to)!;
    expect(sectionStyle(copied, b, target.id)?.dir).toBe("mirror");
  });

  it("splits a star's crossing runs into typed ranges", () => {
    const tips = Array.from({ length: 5 }, (_, index) => {
      const angle = Math.PI / 2 + (index * Math.PI * 2) / 5;
      return [`c${index + 1}`, 1 + Math.cos(angle), 1 + Math.sin(angle)] as [string, number, number];
    });
    const order = [0, 2, 4, 1, 3];
    const runs = order.map((from, index) => [`e${index + 1}`, `c${from + 1}`, `c${order[(index + 1) % 5]! + 1}`] as [string, string, string]);
    const star = withSections(prop("s", drawn(tips, runs)), "border-inside");
    const inside = star.sections!.find((row) => row.name === "Inside")!;
    expect(inside.edgeIds).toEqual([]);
    expect(inside.pinnedRanges.length).toBe(5);
    const yard = drawnYard([star])[0]!;
    expect(yard.lights.filter((light) => light.sectionId === inside.id).length).toBeGreaterThan(0);
  });
});
