import { describe, expect, it } from "vitest";
import type { Element, Light } from "../lights.ts";
import { buildManagedPresets, buildPlaylistPreset, lookTargetsForLook, mergeFollowingSections, type Look, type LookStyle, type ShapeMotion } from "../look.ts";
import { countLayout, layoutFromMeasurements, type PropLayout } from "./layout.ts";
import { planLightMaps } from "./light-maps.ts";
import { defaultSections } from "./sections.ts";
import type { Prop, PropAttachment, PropDesign } from "./types.ts";
import { compileWireframe, defaultWireframeSpec } from "./wireframe.ts";

const style: LookStyle = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };

function zigzag(): PropLayout {
  return layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "zigzag", params: { width: 1, height: 1, passes: 4 } })!;
}

function drawnProp(id: string, designCount?: number | null): Prop {
  const layout = zigzag();
  const count = countLayout(layout).total;
  return {
    id,
    lightId: "light-1",
    label: id,
    kind: "custom",
    elementIds: [`el-${id}`],
    layout,
    sections: defaultSections(layout),
    ...(designCount === undefined ? {} : { design: { ledCount: designCount === null ? count : designCount } as unknown as PropDesign }),
  };
}

/** Two strings with a dark hop, split into a left and a right section. */
function twoStringTree(): Prop {
  const s1 = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
  ];
  const s2 = [
    { id: "e3", from: "c4", to: "c5", kind: "lit" as const },
    { id: "e4", from: "c5", to: "c6", kind: "hidden" as const },
    { id: "e5", from: "c6", to: "c7", kind: "lit" as const },
  ];
  const layout: PropLayout = {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [
      { id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: 1 }, { id: "c3", x: -0.5, y: 1.5 },
      { id: "c4", x: 0.6, y: 0.2 }, { id: "c5", x: 0.6, y: 1.2 }, { id: "c6", x: 1, y: 1.2 }, { id: "c7", x: 1, y: 1.8 },
    ],
    run: s1,
    strings: [{ id: "s1", startId: "c1", run: s1 }, { id: "s2", startId: "c4", run: s2 }],
  };
  return {
    id: "tree",
    lightId: "light-1",
    label: "tree",
    kind: "custom",
    elementIds: ["el-tree"],
    layout,
    sections: [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ],
  };
}

const light = { id: "light-1", ledCount: 400, outputs: undefined } as Pick<Light, "id" | "ledCount" | "outputs">;

function element(prop: Prop, start: number): Element {
  const count = countLayout(prop.layout!).total;
  return { id: prop.elementIds[0]!, lightId: "light-1", label: prop.label, start, stop: start + count };
}

function look(id: string, slot: number, overrides: Look["overrides"] = [], extra: Partial<Look> = {}): Look {
  return { id, name: id, slot, style, overrides, ...extra };
}

function moves(propId: string, motion: ShapeMotion) {
  return [{ propId, style: { ...style, motion } }];
}

describe("planLightMaps", () => {
  it("maps a drawn prop found only by its Segments and names each Look's map in its preset", () => {
    const bush = drawnProp("bush");
    const count = countLayout(bush.layout!).total;
    const elements = [element(bush, 10)];
    const looks = [look("up", 1, moves("bush", "up")), look("plain", 2), look("down", 3, moves("bush", "down"))];
    const plan = planLightMaps({ light, props: [bush], elements, attachments: [], looks });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.writes.map((row) => row.slot)).toEqual([0, 1]);
    expect(plan.writes[0]!.map.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Upward and Downward are one sort, so they share a map. They differ only in the segment's rev.
    expect(plan.plan!.result.looks.map((row) => row.slot)).toEqual([1, 0, 1]);
    const presets = buildManagedPresets({
      looks,
      playlists: [{ id: "pl", name: "Nightly", slot: 16, lookIds: ["up"], durationTenths: 100, transitionTenths: 7 }],
      targets: [],
      rgbw: false,
      geometry: { ledCount: 400, elements, props: [bush] },
      maps: plan.plan,
    }) as Record<string, { ledmap?: number; seg?: { start: number; stop: number; rev: boolean; mi: boolean }[] }>;
    expect(presets["1"]!.ledmap).toBe(1);
    expect(presets["2"]!.ledmap).toBe(0);
    expect(presets["3"]!.ledmap).toBe(1);
    expect(presets["250"]!.ledmap).toBe(0);
    expect(presets["16"]!.ledmap).toBe(0);
    // One segment over the whole prop in map positions, upward and then downward.
    expect(presets["1"]!.seg).toMatchObject([{ start: 10, stop: 10 + count, rev: false, mi: false }]);
    expect(presets["3"]!.seg).toMatchObject([{ start: 10, stop: 10 + count, rev: true, mi: false }]);
    // The Look with no motion keeps the Segments it always had.
    expect(presets["2"]!.seg!.length).toBeGreaterThan(0);
  });

  it("writes no map file when every Look runs in wire order", () => {
    const bush = drawnProp("bush");
    const plan = planLightMaps({ light, props: [bush], elements: [element(bush, 0)], attachments: [], looks: [look("plain", 1)] });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.writes).toEqual([]);
  });

  it("starts a prop after another one by following the chain, with its output's offset", () => {
    const first = drawnProp("first", null);
    const second = drawnProp("second", null);
    const count = countLayout(first.layout!).total;
    const attachments: PropAttachment[] = [
      { propId: "first", lightId: "light-1", outputId: "out-b", startIndex: 5, afterPropId: null },
      { propId: "second", lightId: "light-1", outputId: "out-b", startIndex: null, afterPropId: "first" },
    ];
    const outputs = [{ id: "out-a", start: 0, ledCount: 100 }, { id: "out-b", start: 100, ledCount: 250 }] as Light["outputs"];
    const plan = planLightMaps({
      light: { ...light, outputs },
      props: [first, second],
      elements: [],
      attachments,
      looks: [look("up", 1, [...moves("first", "up"), ...moves("second", "up")])],
    });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.plan!.blocks).toEqual([
      { propId: "first", start: 105, count },
      { propId: "second", start: 105 + count, count },
    ]);
    // Lights before the first prop keep their place.
    expect(plan.writes[1]!.map.slice(0, 105)).toEqual(Array.from({ length: 105 }, (_, index) => index));
  });

  it("refuses before anything when the drawing and the attachment disagree", () => {
    const bush = drawnProp("bush", 7);
    const plan = planLightMaps({ light, props: [bush], elements: [element(bush, 0)], attachments: [], looks: [look("up", 1, moves("bush", "up"))] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/bush is drawn with \d+ lights but attached with 7.*Nothing was sent/);
  });

  it("refuses a prop that runs past the end of the Light", () => {
    const bush = drawnProp("bush");
    const plan = planLightMaps({ light: { ...light, ledCount: 20 }, props: [bush], elements: [element(bush, 0)], attachments: [], looks: [] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toMatch(/this Light has 20/);
  });

  it("refuses more than nine different light orders with the builder's plain message", () => {
    const props = ["a", "b", "c"].map((id) => drawnProp(id));
    const elements = props.map((prop, index) => element(prop, index * 100));
    const sorts: ShapeMotion[] = ["wire", "up", "outward", "clockwise"];
    const looksOf = (count: number) => Array.from({ length: count }, (_, index) => {
      const code = index + 1;
      const overrides = props.flatMap((prop, at) => moves(prop.id, sorts[Math.floor(code / 4 ** at) % 4]!));
      return look(`look${index}`, index + 1, overrides);
    });
    const nine = planLightMaps({ light, props, elements, attachments: [], looks: looksOf(9) });
    expect(nine.ok).toBe(true);
    const ten = planLightMaps({ light, props, elements, attachments: [], looks: looksOf(10) });
    expect(ten.ok).toBe(false);
    if (!ten.ok) expect(ten.message).toMatch(/more than 9 different light orders.*Nothing was sent/);
  });

  it("has no maps for a Light with no drawn or wireframe prop", () => {
    const plain: Prop = { id: "p", lightId: "light-1", label: "P", kind: "custom", elementIds: [] };
    const plan = planLightMaps({ light, props: [plain], elements: [], attachments: [], looks: [look("up", 1)] });
    expect(plan).toEqual({ ok: true, plan: null, writes: [], notes: [] });
  });

  it("packs a well house's face map in the base map, reports no sections for it, and leaves its Segments alone", () => {
    const spec = defaultWireframeSpec({ sides: 4 });
    const house: Prop = { id: "house", lightId: "light-1", label: "Well house", kind: "wireframe", elementIds: [], wireframe: spec };
    const compiled = compileWireframe(spec, 60);
    const elements: Element[] = [{ id: "face0", lightId: "light-1", label: "Face", start: 0, stop: 60 }];
    const withFace: Prop = { ...house, elementIds: ["face0"] };
    const upward = look("up", 1, moves("house", "up"));
    const plan = planLightMaps({ light: { ...light, ledCount: 60 }, props: [withFace], elements, attachments: [], looks: [upward] });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.writes.map((row) => row.slot)).toEqual([0]);
    expect(plan.writes[0]!.map).toEqual(compiled.ledmap);
    expect(plan.plan!.result.looks[0]).toMatchObject({ slot: 0, sections: [], rests: [] });
    const geometry = { ledCount: 60, elements, props: [withFace] };
    const presets = buildManagedPresets({ looks: [upward], playlists: [], targets: [], rgbw: false, geometry, maps: plan.plan }) as Record<string, { ledmap: number; seg: { start: number; stop: number }[] }>;
    const expected = mergeFollowingSections(upward, lookTargetsForLook(upward, geometry)).map((row) => [row.start, row.stop]);
    expect(presets["1"]!.ledmap).toBe(0);
    expect(presets["1"]!.seg.map((row) => [row.start, row.stop])).toEqual(expected);
  });

  it("refuses a wireframe the Light cannot hold", () => {
    const house: Prop = { id: "house", lightId: "light-1", label: "Well house", kind: "wireframe", elementIds: [], wireframe: defaultWireframeSpec({ sides: 4 }) };
    const plan = planLightMaps({ light: { ...light, ledCount: 0 }, props: [house], elements: [], attachments: [], looks: [] });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.wireframe).toBe(true);
  });

  it("keeps a section its own segment, in map positions, when a Look styles that section", () => {
    const bush = twoStringTree();
    const elements = [element(bush, 0)];
    const own = look("own", 1, [{ propId: "tree", sectionId: "right", style: { ...style, motion: "outward" } }]);
    const plan = planLightMaps({ light, props: [bush], elements, attachments: [], looks: [own] });
    if (!plan.ok) throw new Error(plan.message);
    const geometry = { ledCount: 400, elements, props: [bush] };
    const presets = buildManagedPresets({ looks: [own], playlists: [], targets: [], rgbw: false, geometry, maps: plan.plan }) as Record<string, { ledmap: number; seg: { start: number; stop: number }[] }>;
    expect(presets["1"]!.ledmap).toBe(1);
    // Every light of the prop is addressed once, and no two segments overlap.
    const seg = presets["1"]!.seg.map((row) => [row.start, row.stop] as const).sort((a, b) => a[0] - b[0]);
    expect(seg[0]![0]).toBe(0);
    expect(seg.at(-1)![1]).toBe(countLayout(bush.layout!).total);
    seg.forEach((row, index) => {
      if (index > 0) expect(row[0]).toBe(seg[index - 1]![1]);
    });
  });
});

describe("buildPlaylistPreset", () => {
  it("runs on the base map", () => {
    const preset = buildPlaylistPreset({ id: "pl", name: "Nightly", slot: 16, lookIds: ["a"], durationTenths: 100, transitionTenths: 7 }, [look("a", 1)]);
    expect(preset).toMatchObject({ ledmap: 0 });
  });
});
