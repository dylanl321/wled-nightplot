import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countLayout,
  defaultSections,
  defaultWireframeSpec,
  layoutFromMeasurements,
  parseLedmapJson,
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

  it("a map that rereads different is a mismatch: stops there, writes no presets, records nothing", async () => {
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
    expect(result.detail).toMatch(/ledmap1\.json.*reread differs/);
    expect(box.ledmapSlots()).toEqual([0, 1]);
    expect(box.presets()).toBe(before);
    expect(replace).not.toHaveBeenCalled();
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
    expect(replace).not.toHaveBeenCalled();
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
    expect(result.detail).toMatch(/did not take ledmap1\.json.*Nothing else was sent/);
    expect(box.ledmapSlots()).toEqual([0]);
    expect(box.presets()).toBe(before);
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
});
