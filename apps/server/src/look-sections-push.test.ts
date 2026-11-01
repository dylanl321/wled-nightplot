import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BackupDocument, Element, Light, LooksDocument, Prop, PropLayout, WledSnapshot } from "@nightplot/shared";
import { pushLooksToLight, type LookRouteDeps } from "./look-routes.ts";
import { FileLooksStore } from "./store/looks-store.ts";

const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };

function layout(): PropLayout {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
  ];
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1, y: 1 }],
    run,
    strings: [{ id: "s1", startId: "c1", run }],
  };
}

const prop: Prop = {
  id: "prop-arch",
  lightId: "light-1",
  label: "Arch",
  kind: "arch",
  elementIds: ["el-a", "el-b"],
  layout: layout(),
  sections: [
    { id: "left", name: "Left", edgeIds: ["e1"], pinnedRanges: [], color: "#ff0000" },
    { id: "right", name: "Right", edgeIds: ["e2"], pinnedRanges: [], color: "#0000ff" },
  ],
};

const elements: Element[] = [
  { id: "el-a", lightId: "light-1", label: "Arch · Left", start: 0, stop: 10 },
  { id: "el-b", lightId: "light-1", label: "Arch · Right", start: 10, stop: 20 },
];

const light = {
  id: "light-1",
  name: "Porch",
  hostname: "192.168.1.40",
  port: 80,
  ledCount: 20,
  rgbw: false,
} as Light;

const snap = { name: "Porch", firmware: "0.15.4", mac: null, ledCount: 20, rgbw: false, maxSegments: 32 } as WledSnapshot;

const document: LooksDocument = {
  version: 1,
  looks: [{
    id: "look-warm",
    name: "Warm white",
    slot: 1,
    style,
    overrides: [{ propId: "prop-arch", sectionId: "right", style: { ...style, color: "#ff00ff", fx: 13 } }],
  }],
  playlists: [],
  schedule: null,
};

/** A controller whose presets.json can be told to read back something else. */
function deps(options: { corrupt?: boolean; maxSegments?: number } = {}) {
  let presets = "{}";
  const replace = vi.fn();
  const value = {
    store: { elementsFor: () => elements, propsFor: () => [prop], replace },
    readPresets: async () => presets,
    writePresets: async (_target: unknown, raw: string) => {
      presets = options.corrupt ? raw.replace("#ff00ff", "x").replace(/"fx":13/, '"fx":0') : raw;
    },
    readLedmap: async () => null,
    writeLedmap: async () => {},
    readCfg: async () => null,
    writeCfg: async () => true,
    captureDevice: async () => ({ id: "backup-1" }) as BackupDocument,
  } as unknown as LookRouteDeps;
  return { value, replace, written: () => presets };
}

describe("pushing a Look that names sections", () => {
  it("writes the section ranges with the section override and the section colour, then reads them back", async () => {
    const { value, replace, written } = deps();
    const result = await pushLooksToLight(value, { light, snap, document, includeSchedule: false, runSlot: null, udp: null });
    expect(result.status).toBe("matched");
    const preset = (JSON.parse(written()) as Record<string, { seg: { start: number; stop: number; fx: number; col: number[][] }[] }>)["1"]!;
    expect(preset.seg.map((seg) => [seg.start, seg.stop, seg.fx, seg.col[0]])).toEqual([
      [0, 10, 0, [255, 0, 0]],
      [10, 20, 13, [255, 0, 255]],
    ]);
    expect(replace).toHaveBeenCalledOnce();
  });

  it("a preset that reads back different is a mismatch, not success, and is not recorded as pushed", async () => {
    const { value, replace } = deps({ corrupt: true });
    const result = await pushLooksToLight(value, { light, snap, document, includeSchedule: false, runSlot: null, udp: null });
    expect(result.status).toBe("mismatch");
    expect(result.detail).toMatch(/reads back different/);
    expect(replace).not.toHaveBeenCalled();
  });

  it("refuses before writing when the sections need more segments than the controller holds", async () => {
    const { value, written } = deps();
    const result = await pushLooksToLight(value, { light, snap: { ...snap, maxSegments: 1 }, document, includeSchedule: false, runSlot: null, udp: null });
    expect(result.status).toBe("refused");
    expect(result.detail).toMatch(/needs 2 segments.*holds 1.*Nothing was sent/);
    expect(written()).toBe("{}");
  });
});

describe("saving a Look that names sections", () => {
  it("keeps the section overrides, including a section left out, after a reload", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nightplot-look-sections-")), "looks.json");
    const withOff: LooksDocument = {
      ...document,
      looks: [{ ...document.looks[0]!, overrides: [...document.looks[0]!.overrides, { propId: "prop-arch", sectionId: "left", off: true, style }] }],
    };
    new FileLooksStore(path).save(withOff);
    expect(new FileLooksStore(path).looks()[0]!.overrides).toEqual([
      expect.objectContaining({ propId: "prop-arch", sectionId: "right", style: expect.objectContaining({ color: "#ff00ff" }) }),
      expect.objectContaining({ propId: "prop-arch", sectionId: "left", off: true }),
    ]);
  });
});
