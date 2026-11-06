import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countLayout,
  defaultSections,
  defaultWireframeSpec,
  layoutFromMeasurements,
  parseLedmapJson,
  propStrings,
  type PropLayout,
  type BackupDocument,
  type Element,
  type Light,
  type Look,
  type LooksDocument,
  type Prop,
  type PropAttachment,
  type ShapeMotion,
  type WledSnapshot,
} from "@nightplot/shared";
import { pushLooksToLight, type LookRouteDeps } from "./look-routes.ts";
import { createFixtureBox } from "./wled-fixture-box.ts";
import {
  createWledLedmapReader,
  createWledLedmapWriter,
  createWledPresetsReader,
  createWledPresetsWriter,
  type ReadWledLedmap,
  type WriteWledLedmap,
} from "./wled/native-backup.ts";

const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };
const closers: (() => void)[] = [];
afterEach(() => { while (closers.length) closers.pop()!(); });

function zigzag() {
  return layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "zigzag", params: { width: 1, height: 1, passes: 4 } })!;
}

function bush(id: string, designCount?: number): Prop {
  const layout = zigzag();
  return {
    id,
    lightId: "light-1",
    label: id,
    kind: "custom",
    elementIds: [`el-${id}`],
    layout,
    sections: defaultSections(layout),
    ...(designCount === undefined ? {} : { design: { ledCount: designCount } as unknown as Prop["design"] }),
  };
}

const BUSH_LIGHTS = countLayout(zigzag()).total;

function look(id: string, slot: number, propId: string | null, motion: ShapeMotion | null): Look {
  return { id, name: id, slot, style, overrides: propId && motion ? [{ propId, style: { ...style, motion } }] : [] };
}

function documentOf(looks: Look[], playlists: LooksDocument["playlists"] = []): LooksDocument {
  return { version: 1, looks, playlists, schedule: null };
}

async function boxLight(ledCount: number) {
  const box = createFixtureBox({ ledCount });
  const server = box.listen();
  await once(server, "listening");
  closers.push(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const light = {
    id: "light-1", name: "Porch", hostname: "127.0.0.1", port: address.port, ledCount, rgbw: false,
  } as Light;
  const snap = { name: "Porch", firmware: "0.15.4", mac: null, ledCount, rgbw: false, maxSegments: 32 } as WledSnapshot;
  return { box, light, snap, before: box.presets() };
}

function deps(input: {
  props: Prop[];
  elements: Element[];
  attachments?: PropAttachment[];
  readLedmap?: ReadWledLedmap;
  writeLedmap?: WriteWledLedmap;
}) {
  const replace = vi.fn();
  const readLedmap = input.readLedmap ?? createWledLedmapReader();
  const writeLedmap = input.writeLedmap ?? createWledLedmapWriter();
  const value = {
    store: {
      elementsFor: () => input.elements,
      propsFor: () => input.props,
      loadProps: () => input.props,
      loadAttachments: () => input.attachments ?? [],
      replace,
    },
    readPresets: createWledPresetsReader(),
    writePresets: createWledPresetsWriter(),
    readLedmap,
    writeLedmap,
    readCfg: async () => null,
    writeCfg: async () => true,
    captureDevice: async () => ({ id: "backup-1" }) as BackupDocument,
  } as unknown as LookRouteDeps;
  return { value, replace };
}

function bushOn(light: Light, extra: Partial<Prop> = {}) {
  const prop = { ...bush("bush"), ...extra };
  const elements: Element[] = [{ id: "el-bush", lightId: light.id, label: "Bush", start: 0, stop: BUSH_LIGHTS }];
  return { prop, elements };
}

function presetsOn(box: ReturnType<typeof createFixtureBox>) {
  return JSON.parse(box.presets()) as Record<string, { ledmap?: number; seg?: { start: number; stop: number; rev: boolean }[] }>;
}

const push = (value: LookRouteDeps, light: Light, snap: WledSnapshot, document: LooksDocument) =>
  pushLooksToLight(value, { light, snap, document, includeSchedule: false, runSlot: null, udp: null });

describe("pushing Looks with motion maps to a fixture Light", () => {
  it("writes ledmapN.json for each distinct map, rereads each, and names the map in each preset", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const { value, replace } = deps({ props: [prop], elements });
    const document = documentOf(
      [look("up", 1, "bush", "up"), look("plain", 2, null, null), look("out", 3, "bush", "outward")],
      [{ id: "pl", name: "Nightly", slot: 16, lookIds: ["up", "out"], durationTenths: 100, transitionTenths: 7 }],
    );
    const result = await push(value, light, snap, document);
    expect(result.status).toBe("matched");
    expect(result.detail).toMatch(/3 light map files \(ledmap\.json, ledmap1\.json, ledmap2\.json\)/);
    expect(box.ledmapSlots()).toEqual([0, 1, 2]);
    // The base map is the wire order, and the others are the same lights in another order.
    const base = parseLedmapJson(box.ledmap(0)!)!;
    expect(base).toEqual(Array.from({ length: BUSH_LIGHTS }, (_, index) => index));
    for (const slot of [1, 2]) {
      const map = parseLedmapJson(box.ledmap(slot)!)!;
      expect(map).toHaveLength(BUSH_LIGHTS);
      expect([...map].sort((a, b) => a - b)).toEqual(base);
      expect(map).not.toEqual(base);
    }
    const presets = presetsOn(box);
    expect(presets["1"]!.ledmap).toBe(1);
    expect(presets["2"]!.ledmap).toBe(0);
    expect(presets["3"]!.ledmap).toBe(2);
    expect(presets["250"]!.ledmap).toBe(0);
    expect(presets["16"]!.ledmap).toBe(0);
    expect(presets["1"]!.seg).toMatchObject([{ start: 0, stop: BUSH_LIGHTS, rev: false }]);
    const saved = replace.mock.calls[0]![0] as Light;
    expect(saved.lastLedmap?.map((row) => row.slot)).toEqual([0, 1, 2]);
    expect(saved.lastLedmap?.every((row) => /^ledmap1:/.test(row.digest))).toBe(true);
  });

  it("writes no map file and sets ledmap 0 when no Look has a motion", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const { value, replace } = deps({ props: [prop], elements });
    const result = await push(value, light, snap, documentOf([look("plain", 1, null, null)]));
    expect(result.status).toBe("matched");
    expect(box.ledmapSlots()).toEqual([]);
    expect(presetsOn(box)["1"]!.ledmap).toBe(0);
    expect((replace.mock.calls[0]![0] as Light).lastLedmap).toBeUndefined();
  });

  it("a map that rereads different is a mismatch: stops there, writes no presets, records the files already written", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const reader = createWledLedmapReader();
    const { value, replace } = deps({
      props: [prop],
      elements,
      readLedmap: async (target, map) => {
        const raw = await reader(target, map);
        return map === 1 && raw ? raw.replace(/\d+/, "9999") : raw;
      },
    });
    const result = await push(value, light, snap, documentOf([look("up", 1, "bush", "up"), look("out", 2, "bush", "outward")]));
    expect(result.status).toBe("mismatch");
    expect(result.detail).toMatch(/ledmap1\.json.*reread differs.*left in place: ledmap\.json\. No presets were sent/);
    expect(box.ledmapSlots()).toEqual([0, 1]);
    expect(box.presets()).toBe(before);
    expect(replace).toHaveBeenCalledTimes(1);
    const saved = replace.mock.calls[0]![0] as Light;
    expect(saved.lastLedmap?.map((row) => row.slot)).toEqual([0]);
    expect(saved.lastLookPush).toBeUndefined();
  });

  it("a map that does not reread is unknown, not success", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const { value, replace } = deps({
      props: [prop],
      elements,
      readLedmap: async (_target, map) => {
        if (map === 2) throw new Error("timeout");
        return createWledLedmapReader()(_target, map);
      },
    });
    const result = await push(value, light, snap, documentOf([look("up", 1, "bush", "up"), look("out", 2, "bush", "outward")]));
    expect(result.status).toBe("unknown");
    expect(result.detail).toMatch(/ledmap2\.json.*did not reread/);
    expect(box.presets()).toBe(before);
    expect((replace.mock.calls[0]![0] as Light).lastLedmap?.map((row) => row.slot)).toEqual([0, 1]);
  });

  it("a map the controller refuses is a failure and nothing else is sent", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const writer = createWledLedmapWriter();
    const { value } = deps({
      props: [prop],
      elements,
      writeLedmap: async (target, json, map) => {
        if (map === 1) throw new Error("WLED ledmap1.json upload returned HTTP 500.");
        await writer(target, json, map);
      },
    });
    const result = await push(value, light, snap, documentOf([look("up", 1, "bush", "up")]));
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/did not take ledmap1\.json.*left in place: ledmap\.json/);
    expect(box.ledmapSlots()).toEqual([0]);
    expect(box.presets()).toBe(before);
  });

  it("a later push that needs no map replaces the old base map with a straight one", async () => {
    const { box, light, snap } = await boxLight(60);
    const house: Prop = { id: "house", lightId: light.id, label: "Well house", kind: "wireframe", elementIds: ["face0"], wireframe: defaultWireframeSpec({ sides: 4 }) };
    const faces: Element[] = [{ id: "face0", lightId: light.id, label: "Face", start: 0, stop: 60 }];
    const first = deps({ props: [house], elements: faces });
    expect((await push(first.value, light, snap, documentOf([look("plain", 1, null, null)]))).status).toBe("matched");
    expect(parseLedmapJson(box.ledmap(0)!)!.every((value, index) => value === index)).toBe(false);
    const recorded = first.replace.mock.calls[0]![0] as Light;

    // The well house is gone, so nothing needs a map; the old base map must not stay.
    const second = deps({ props: [], elements: [] });
    const result = await push(second.value, recorded, snap, documentOf([look("plain", 1, null, null)]));
    expect(result.status).toBe("matched");
    expect(parseLedmapJson(box.ledmap(0)!)).toEqual(Array.from({ length: 60 }, (_, index) => index));
    expect(presetsOn(box)["1"]!.ledmap).toBe(0);
    const after = second.replace.mock.calls[0]![0] as Light;
    expect(after.lastLedmap?.map((row) => row.slot)).toEqual([0]);
    expect(after.lastLedmap?.[0]!.digest).not.toBe(recorded.lastLedmap?.[0]!.digest);
  });

  it("finds an old base map on the board even when the app has no record of it", async () => {
    const { box, light, snap } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    box.setLedmap(JSON.stringify({ map: Array.from({ length: BUSH_LIGHTS }, (_, index) => BUSH_LIGHTS - 1 - index) }), 0);
    const { value } = deps({ props: [prop], elements });
    const result = await push(value, light, snap, documentOf([look("plain", 1, null, null)]));
    expect(result.status).toBe("matched");
    expect(parseLedmapJson(box.ledmap(0)!)).toEqual(Array.from({ length: BUSH_LIGHTS }, (_, index) => index));
  });

  it("a second push with fewer maps leaves unused slots alone and keeps their record", async () => {
    const { box, light, snap } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light);
    const { value, replace } = deps({ props: [prop], elements });
    await push(value, light, snap, documentOf([look("up", 1, "bush", "up"), look("out", 2, "bush", "outward")]));
    const recorded = replace.mock.calls[0]![0] as Light;
    const second = await push(value, recorded, snap, documentOf([look("up", 1, "bush", "up")]));
    expect(second.status).toBe("matched");
    const after = replace.mock.calls[1]![0] as Light;
    expect(after.lastLedmap?.map((row) => row.slot)).toEqual([0, 1, 2]);
    expect(box.ledmapSlots()).toEqual([0, 1, 2]);
    expect(presetsOn(box)["1"]!.ledmap).toBe(1);
  });

  it("refuses more than nine different light orders before anything is written", async () => {
    const { box, light, snap, before } = await boxLight(400);
    const props = ["a", "b", "c"].map((id) => bush(id));
    const elements: Element[] = props.map((prop, index) => ({ id: prop.elementIds[0]!, lightId: light.id, label: prop.label, start: index * 100, stop: index * 100 + BUSH_LIGHTS }));
    const sorts: (ShapeMotion)[] = ["wire", "up", "outward", "clockwise"];
    const looks = Array.from({ length: 10 }, (_, index): Look => ({
      id: `look${index}`,
      name: `Look ${index}`,
      slot: index + 1,
      style,
      overrides: props.map((prop, at) => ({ propId: prop.id, style: { ...style, motion: sorts[Math.floor((index + 1) / 4 ** at) % 4]! } })),
    }));
    const { value, replace } = deps({ props, elements });
    const result = await push(value, light, snap, documentOf(looks));
    expect(result.status).toBe("refused");
    expect(result.detail).toMatch(/more than 9 different light orders/);
    expect(box.ledmapSlots()).toEqual([]);
    expect(box.presets()).toBe(before);
    expect(replace).not.toHaveBeenCalled();
    // Nine is the most WLED holds beside the base map.
    const nine = await push(value, light, snap, documentOf(looks.slice(0, 9)));
    expect(nine.status).toBe("matched");
    expect(box.ledmapSlots()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("refuses when the drawing and the attached light count disagree, before any write", async () => {
    const { box, light, snap, before } = await boxLight(BUSH_LIGHTS);
    const { prop, elements } = bushOn(light, { design: { ledCount: BUSH_LIGHTS - 3 } as unknown as Prop["design"] });
    const { value, replace } = deps({ props: [prop], elements });
    const result = await push(value, light, snap, documentOf([look("up", 1, "bush", "up")]));
    expect(result.status).toBe("refused");
    expect(result.detail).toMatch(new RegExp(`drawn with ${BUSH_LIGHTS} lights but attached with ${BUSH_LIGHTS - 3}`));
    expect(box.ledmapSlots()).toEqual([]);
    expect(box.presets()).toBe(before);
    expect(replace).not.toHaveBeenCalled();
  });

  it("puts a well house's face map in ledmap.json, with no sections and ledmap 0 in every preset", async () => {
    const { box, light, snap, before } = await boxLight(60);
    const house: Prop = { id: "house", lightId: light.id, label: "Well house", kind: "wireframe", elementIds: ["face0"], wireframe: defaultWireframeSpec({ sides: 4 }) };
    const elements: Element[] = [{ id: "face0", lightId: light.id, label: "Face", start: 0, stop: 60 }];
    const { value, replace } = deps({ props: [house], elements });
    const result = await push(value, light, snap, documentOf([look("up", 1, "house", "up")]));
    expect(result.status).toBe("matched");
    expect(box.ledmapSlots()).toEqual([0]);
    expect(parseLedmapJson(box.ledmap(0)!)).toHaveLength(60);
    expect(presetsOn(box)["1"]!.ledmap).toBe(0);
    expect((replace.mock.calls[0]![0] as Light).lastLedmap).toEqual([expect.objectContaining({ slot: 0 })]);
  });

  it("maps a prop attached after another one, beside a well house, on one Light", async () => {
    const { box, light, snap, before } = await boxLight(60 + BUSH_LIGHTS);
    const house: Prop = { id: "house", lightId: light.id, label: "Well house", kind: "wireframe", elementIds: ["face0"], wireframe: defaultWireframeSpec({ sides: 4 }), design: { ledCount: 60 } as unknown as Prop["design"] };
    const tree = bush("bush", BUSH_LIGHTS);
    const elements: Element[] = [
      { id: "face0", lightId: light.id, label: "Face", start: 0, stop: 60 },
      { id: "el-bush", lightId: light.id, label: "Bush", start: 60, stop: 60 + BUSH_LIGHTS },
    ];
    const attachments: PropAttachment[] = [
      { propId: "house", lightId: light.id, outputId: "out", startIndex: 0, afterPropId: null },
      { propId: "bush", lightId: light.id, outputId: "out", startIndex: null, afterPropId: "house" },
    ];
    const { value } = deps({ props: [house, tree], elements, attachments });
    const result = await push(value, light, snap, documentOf([look("up", 1, "bush", "up")]));
    expect(result.status).toBe("matched");
    expect(box.ledmapSlots()).toEqual([0, 1]);
    const base = parseLedmapJson(box.ledmap(0)!)!;
    const up = parseLedmapJson(box.ledmap(1)!)!;
    expect(up.slice(0, 60)).toEqual(base.slice(0, 60));
    expect(up.slice(60)).not.toEqual(base.slice(60));
    expect(presetsOn(box)["1"]!.seg).toEqual(expect.arrayContaining([expect.objectContaining({ start: 60, stop: 60 + BUSH_LIGHTS })]));
  });

  it("writes both strings of a split tree, each on its own output, and puts the second in the map", async () => {
    const { box, light: base, snap, before } = await boxLight(200);
    const light = {
      ...base,
      outputs: [
        { id: "out-a", index: 0, start: 0, ledCount: 100 },
        { id: "out-b", index: 1, start: 100, ledCount: 100 },
      ],
    } as Light;
    const s1 = [
      { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
      { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
    ];
    const s2 = [
      { id: "e3", from: "c4", to: "c5", kind: "lit" as const },
      { id: "e5", from: "c5", to: "c6", kind: "lit" as const },
    ];
    const layout: PropLayout = {
      source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0,
      corners: [
        { id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: 1 }, { id: "c3", x: -0.5, y: 1.5 },
        { id: "c4", x: 0.6, y: 0.2 }, { id: "c5", x: 0.6, y: 1.2 }, { id: "c6", x: 1, y: 1.8 },
      ],
      run: s1,
      strings: [{ id: "s1", startId: "c1", run: s1 }, { id: "s2", startId: "c4", run: s2 }],
    };
    const [one, two] = propStrings({ layout, design: undefined }).map((row) => row.ledCount!) as [number, number];
    const tree: Prop = {
      id: "tree", lightId: light.id, label: "Tree", kind: "custom", elementIds: ["ta", "tb"], layout,
      sections: [
        { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
        { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
      ],
    };
    const elements: Element[] = [
      { id: "ta", lightId: light.id, label: "Tree · Left", start: 5, stop: 5 + one },
      { id: "tb", lightId: light.id, label: "Tree · Right", start: 110, stop: 110 + two },
    ];
    const attachments: PropAttachment[] = [
      { propId: "tree", lightId: light.id, outputId: "out-a", startIndex: 5, afterPropId: null, stringId: "s1" },
      { propId: "tree", lightId: light.id, outputId: "out-b", startIndex: 10, afterPropId: null, stringId: "s2" },
    ];
    const { value } = deps({ props: [tree], elements, attachments });
    const result = await push(value, light, snap, documentOf([look("up", 1, "tree", "up")]));
    expect(result.status).toBe("matched");
    expect(box.ledmapSlots()).toEqual([0, 1]);
    const up = parseLedmapJson(box.ledmap(1)!)!;
    expect(up).toHaveLength(200);
    expect(new Set(up).size).toBe(200);
    // Lights outside both strings keep their place. Upward is sorted across the whole tree, so the lights of both
    // strings fill the two runs between them, and the second string is part of the map.
    const inStrings = (value: number) => (value >= 5 && value < 5 + one) || (value >= 110 && value < 110 + two);
    expect(up.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(up.slice(5 + one, 110)).toEqual(Array.from({ length: 110 - 5 - one }, (_, i) => 5 + one + i));
    expect([...up.slice(5, 5 + one), ...up.slice(110, 110 + two)].every(inStrings)).toBe(true);
    expect(up.slice(110, 110 + two)).not.toEqual(Array.from({ length: two }, (_, i) => 110 + i));
    expect(up.slice(110 + two)).toEqual(Array.from({ length: 200 - 110 - two }, (_, i) => 110 + two + i));
    // Segments reach both strings and nothing between them.
    const seg = presetsOn(box)["1"]!.seg!;
    expect(seg.some((row) => row.start >= 110 && row.stop <= 110 + two)).toBe(true);
    expect(seg.every((row) => (row.start >= 5 && row.stop <= 5 + one) || (row.start >= 110 && row.stop <= 110 + two))).toBe(true);
    expect(box.presets()).not.toBe(before);
  });
});
