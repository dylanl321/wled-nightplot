import { describe, expect, it } from "vitest";
import type { Element } from "./lights.ts";
import type { Prop } from "./prop/types.ts";
import {
  LOOK_OFF_SLOT,
  buildLookPreset,
  buildManagedPresets,
  lookTargets,
  managedPresetSlotsMatch,
  mergeWledPresets,
  nextLookSlot,
  resolveLookStyle,
  validateLooksLibrary,
  type Look,
} from "./look.ts";

const style = {
  fx: 0,
  pal: 0,
  sx: 128,
  ix: 128,
  bri: 180,
  color: "#ffa000",
};

function look(overrides: Partial<Look> = {}): Look {
  return {
    id: "look-warm",
    name: "Warm white",
    slot: 1,
    style,
    overrides: [],
    ...overrides,
  };
}

const windowProp: Prop = {
  id: "prop-window",
  lightId: "light-1",
  label: "Front window",
  kind: "window",
  elementIds: ["el-top", "el-right"],
};

const treeProp: Prop = {
  id: "prop-tree",
  lightId: "light-1",
  label: "Maple",
  kind: "tree",
  elementIds: ["el-tree"],
};

const elements: Element[] = [
  { id: "el-top", lightId: "light-1", label: "Front window · top", start: 0, stop: 20 },
  { id: "el-right", lightId: "light-1", label: "Front window · right", start: 20, stop: 40 },
  { id: "el-tree", lightId: "light-1", label: "Maple · tree", start: 50, stop: 80 },
  { id: "el-spare", lightId: "light-1", label: "Spare", start: 90, stop: 100 },
];

describe("lookTargets", () => {
  it("uses each Segment and the Prop that owns it", () => {
    const targets = lookTargets({ ledCount: 100, elements, props: [windowProp, treeProp] });
    expect(targets.map((row) => [row.elementId, row.prop?.id ?? null])).toEqual([
      ["el-top", "prop-window"],
      ["el-right", "prop-window"],
      ["el-tree", "prop-tree"],
      ["el-spare", null],
    ]);
  });

  it("falls back to the whole strip when there are no Segments", () => {
    expect(lookTargets({ ledCount: 60, elements: [], props: [] })).toEqual([
      { start: 0, stop: 60, prop: null },
    ]);
  });
});

describe("resolveLookStyle", () => {
  const decorated = look({
    overrides: [
      { propId: "prop-window", style: { ...style, color: "#00ff00", fx: 9 } },
      { propKind: "tree", style: { ...style, color: "#0000ff", fx: 17 } },
      { elementId: "el-spare", style: { ...style, color: "#ffffff", fx: 2 } },
    ],
  });

  it("prefers a Prop id over kind and the whole-yard default", () => {
    const targets = lookTargets({ ledCount: 100, elements, props: [windowProp, treeProp] });
    expect(resolveLookStyle(decorated, targets[0]!).color).toBe("#00ff00");
    expect(resolveLookStyle(decorated, targets[2]!).fx).toBe(17);
    expect(resolveLookStyle(decorated, targets[3]!).color).toBe("#ffffff");
  });

  it("uses the whole-yard default when nothing matches", () => {
    expect(resolveLookStyle(look(), { start: 0, stop: 10, prop: null }).color).toBe("#ffa000");
  });
});

describe("buildLookPreset", () => {
  it("writes this Light’s Segment geometry and the Prop override colours", () => {
    const decorated = look({
      overrides: [{ propKind: "window", style: { ...style, color: "#ff0000", fx: 13 } }],
    });
    const preset = buildLookPreset(
      decorated,
      lookTargets({ ledCount: 100, elements, props: [windowProp, treeProp] }),
      false,
    );
    const segs = preset.seg as { start: number; stop: number; fx: number; col: number[][] }[];
    expect(segs).toHaveLength(4);
    expect(segs[0]).toMatchObject({ start: 0, stop: 20, fx: 13, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]] });
    expect(segs[2]).toMatchObject({ start: 50, stop: 80, fx: 0 });
  });

  it("pads white for an RGBW Light", () => {
    const preset = buildLookPreset(look(), [{ start: 0, stop: 10, prop: null }], true);
    expect((preset.seg as { col: number[][] }[])[0]!.col[0]).toEqual([255, 160, 0, 0]);
  });
});

describe("mergeWledPresets", () => {
  it("keeps operator slots and replaces Nightplot-managed ones", () => {
    const managed = buildManagedPresets({
      looks: [look()],
      playlists: [{ id: "pl", name: "Nightly", slot: 16, lookIds: ["look-warm"], durationTenths: 100, transitionTenths: 7 }],
      targets: [{ start: 0, stop: 60, prop: null }],
      rgbw: false,
    });
    const merged = JSON.parse(mergeWledPresets(JSON.stringify({ "0": {}, "9": { n: "Mine" }, "1": { n: "Old" } }), managed)) as Record<string, { n?: string }>;
    expect(merged["9"]?.n).toBe("Mine");
    expect(merged["1"]?.n).toBe("Warm white");
    expect(merged[String(LOOK_OFF_SLOT)]).toEqual({ n: "Off", on: false });
    expect(merged["16"]?.n).toBe("Nightly");
  });

  it("treats unreadable existing presets as empty, not a guess", () => {
    const managed = { "1": { n: "Warm white" } };
    expect(JSON.parse(mergeWledPresets("not-json", managed))).toEqual({ "0": {}, "1": { n: "Warm white" } });
  });
});

describe("managedPresetSlotsMatch", () => {
  it("matches only the slots Nightplot wrote", () => {
    const expected = { "1": { n: "Warm white", on: true }, "250": { n: "Off", on: false } };
    expect(managedPresetSlotsMatch(expected, JSON.stringify({ "1": { on: true, n: "Warm white" }, "9": { n: "Other" }, "250": { n: "Off", on: false } }), [1, 250])).toBe(true);
    expect(managedPresetSlotsMatch(expected, JSON.stringify({ "1": { n: "Different" }, "250": { n: "Off", on: false } }), [1, 250])).toBe(false);
    expect(managedPresetSlotsMatch(expected, "nope", [1])).toBeNull();
  });
});

describe("validateLooksLibrary", () => {
  it("refuses a colliding slot or a playlist that names a missing Look", () => {
    expect(validateLooksLibrary([], [])).toMatch(/at least one Look/);
    expect(validateLooksLibrary([look(), look({ id: "other", name: "Other", slot: 1 })], [])).toMatch(/already taken/);
    expect(validateLooksLibrary([look()], [{ id: "pl", name: "Nightly", slot: 16, lookIds: ["missing"], durationTenths: 10, transitionTenths: 0 }])).toMatch(/not in the library/);
  });
});

describe("nextLookSlot", () => {
  it("skips taken slots and the Off slot", () => {
    expect(nextLookSlot([1, 2, LOOK_OFF_SLOT])).toBe(3);
    expect(nextLookSlot(Array.from({ length: 250 }, (_, index) => index + 1))).toBeNull();
  });
});
