import { describe, expect, it } from "vitest";
import type { Element } from "./lights.ts";
import type { PropLayout } from "./prop/layout.ts";
import type { Prop, PropSection } from "./prop/types.ts";
import {
  buildLookPreset,
  isLookOverride,
  lookSectionNotes,
  lookTargets,
  normalizeLook,
  pinLookProps,
  resolveLookStyle,
  resolveLookTarget,
  type Look,
} from "./look.ts";

const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };

/** Three 1 m lit runs at 10 cm: lights 0–10, 10–20, 20–30 on the path. */
function layout(): PropLayout {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
    { id: "e3", from: "c3", to: "c4", kind: "lit" as const },
  ];
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1, y: 1 }, { id: "c4", x: 0, y: 1 }],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

function prop(sections: PropSection[], elementIds = ["el-a", "el-b"]): Prop {
  return { id: "prop-arch", lightId: "light-1", label: "Arch", kind: "arch", elementIds, layout: layout(), sections };
}

const sections: PropSection[] = [
  { id: "left", name: "Left", edgeIds: ["e1"], pinnedRanges: [], color: "#ff0000" },
  { id: "right", name: "Right", edgeIds: ["e2"], pinnedRanges: [], color: "#0000ff" },
];

/** What Attach wrote for those sections, starting at light 5. */
const attached: Element[] = [
  { id: "el-a", lightId: "light-1", label: "Arch · Left", start: 5, stop: 15 },
  { id: "el-b", lightId: "light-1", label: "Arch · Right", start: 15, stop: 25 },
  { id: "el-spare", lightId: "light-1", label: "Spare", start: 40, stop: 50 },
];

function look(overrides: Look["overrides"] = []): Look {
  return { id: "look-warm", name: "Warm white", slot: 1, style, overrides };
}

describe("a Look on a Prop with sections", () => {
  it("sends one segment per section range, at the Prop's place on the Light", () => {
    const targets = lookTargets({ ledCount: 60, elements: attached, props: [prop(sections)] });
    expect(targets.map((row) => [row.start, row.stop, row.sectionId ?? row.elementId])).toEqual([
      [5, 15, "left"],
      [15, 25, "right"],
      [40, 50, "el-spare"],
    ]);
    expect(lookSectionNotes({ ledCount: 60, elements: attached, props: [prop(sections)] })).toEqual([]);
  });

  it("a section with no override uses the colour stored on the section, in the Look's effect", () => {
    const sparkle = { ...look(), style: { ...style, fx: 17 } };
    const preset = buildLookPreset(sparkle, lookTargets({ ledCount: 60, elements: attached, props: [prop(sections)] }), false);
    const segs = preset.seg as { start: number; fx: number; col: number[][]; on: boolean }[];
    expect(segs[0]).toMatchObject({ start: 5, fx: 17, on: true, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] });
    expect(segs[1]).toMatchObject({ start: 15, fx: 17, col: [[0, 0, 255], [0, 0, 0], [0, 0, 0]] });
    expect(segs[2]).toMatchObject({ start: 40, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] });
  });

  it("a section override wins over the Prop, its kind, and the section colour; a Prop override wins over the section colour", () => {
    const decorated = look([
      { propKind: "arch", style: { ...style, color: "#00ff00" } },
      { propId: "prop-arch", style: { ...style, color: "#ffffff", fx: 2 } },
      { propId: "prop-arch", sectionId: "right", style: { ...style, color: "#ff00ff", fx: 13 } },
    ]);
    const targets = lookTargets({ ledCount: 60, elements: attached, props: [prop(sections)] });
    expect(resolveLookStyle(decorated, targets[1]!)).toMatchObject({ color: "#ff00ff", fx: 13 });
    expect(resolveLookStyle(decorated, targets[0]!)).toMatchObject({ color: "#ffffff", fx: 2 });
    const kindOnly = look([{ propKind: "arch", style: { ...style, color: "#00ff00" } }]);
    expect(resolveLookStyle(kindOnly, targets[0]!).color).toBe("#00ff00");
  });

  it("a section left out of the Look is a segment that is off", () => {
    const decorated = look([{ propId: "prop-arch", sectionId: "left", off: true, style }]);
    const preset = buildLookPreset(decorated, lookTargets({ ledCount: 60, elements: attached, props: [prop(sections)] }), false);
    const segs = preset.seg as { start: number; on: boolean }[];
    expect(segs.map((row) => [row.start, row.on])).toEqual([[5, false], [15, true], [40, true]]);
  });

  it("a section override on another Prop with the same section id does not leak", () => {
    const other = look([{ propId: "prop-other", sectionId: "left", style: { ...style, color: "#123456" } }]);
    const targets = lookTargets({ ledCount: 60, elements: attached, props: [prop(sections)] });
    expect(resolveLookStyle(other, targets[0]!).color).toBe("#ff0000");
  });

  it("names a section that is not one range instead of writing one wrong segment", () => {
    const split: PropSection[] = [{ id: "ends", name: "Ends", edgeIds: ["e1", "e3"], pinnedRanges: [], color: "#ff0000" }];
    const elements: Element[] = [
      { id: "el-a", lightId: "light-1", label: "Arch · Ends", start: 0, stop: 10 },
      { id: "el-b", lightId: "light-1", label: "Arch · Ends", start: 20, stop: 30 },
    ];
    const geometry = { ledCount: 30, elements, props: [prop(split)] };
    expect(lookTargets(geometry).map((row) => [row.start, row.stop, row.sectionId])).toEqual([
      [0, 10, "ends"],
      [20, 30, "ends"],
    ]);
    expect(lookSectionNotes(geometry).join(" ")).toMatch(/Ends is 2 separate ranges.*ledmap/);
  });

  it("says so when the sections changed after Attach, and keeps the Prop's other lights", () => {
    const fewer = [sections[0]!];
    const geometry = { ledCount: 60, elements: attached, props: [prop(fewer)] };
    expect(lookTargets(geometry).map((row) => [row.start, row.stop, row.sectionId ?? row.elementId])).toEqual([
      [5, 15, "left"],
      [15, 25, "el-b"],
      [40, 50, "el-spare"],
    ]);
    expect(lookSectionNotes(geometry).join(" ")).toMatch(/no longer match the Segments written at Attach/);
  });
});

describe("section overrides in the library", () => {
  it("needs a Prop, and normalising keeps the section and off", () => {
    expect(isLookOverride({ sectionId: "left", style })).toBe(false);
    expect(isLookOverride({ propId: "prop-arch", sectionId: "left", style })).toBe(true);
    expect(isLookOverride({ propId: "prop-arch", sectionId: "left", off: false, style })).toBe(false);
    const kept = normalizeLook(look([{ propId: "prop-arch", sectionId: "left", off: true, style }]));
    expect(kept.overrides[0]).toMatchObject({ propId: "prop-arch", sectionId: "left", off: true });
  });
});

describe("props in a Look", () => {
  it("turns off a prop the Look's list leaves out, and keeps every prop on in a Look with no list", () => {
    const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ff0000" };
    const look = { id: "l", name: "Half", slot: 1, style, overrides: [], propIds: ["a"] };
    const a = { id: "a", label: "A", kind: "roofline" as const, elementIds: [] };
    const b = { id: "b", label: "B", kind: "roofline" as const, elementIds: [] };
    expect(resolveLookTarget(look, { start: 0, stop: 1, prop: a }).off).toBe(false);
    expect(resolveLookTarget(look, { start: 0, stop: 1, prop: b }).off).toBe(true);
    const { propIds: _none, ...legacy } = look;
    expect(resolveLookTarget(legacy, { start: 0, stop: 1, prop: b }).off).toBe(false);
    const pinned = pinLookProps([legacy, look], ["a"]);
    expect(pinned.changed).toBe(1);
    expect(pinned.looks[0]!.propIds).toEqual(["a"]);
    expect(pinned.looks[1]).toBe(look);
  });
});
