import { describe, expect, it } from "vitest";
import type { Element } from "./lights.ts";
import type { PropLayout } from "./prop/layout.ts";
import type { Prop } from "./prop/types.ts";
import { buildLookPreset, buildPlaylistPreset, lookTargets, LOOK_OFF_SLOT, type Look, type LooksDocument } from "./look.ts";
import {
  intersectEffects,
  lookChangesFor,
  lookItemDigests,
  lookItemNames,
  parseWledEffects,
  parseWledPalettes,
  patchStyle,
  propMode,
  propStyle,
  sampleLookStyle,
  sectionMode,
  sectionStyle,
  sectionsFollow,
  setPropMode,
  setSectionMode,
} from "./look-design.ts";

const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };

function layout(): PropLayout {
  const run = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
  ];
  return {
    source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1, y: 1 }],
    run, strings: [{ id: "s1", startId: "c1", run }],
  };
}

const arch: Prop = {
  id: "arch", lightId: "light-1", label: "Arch", kind: "arch", elementIds: ["el-a", "el-b"], layout: layout(),
  sections: [
    { id: "left", name: "Left", edgeIds: ["e1"], pinnedRanges: [] },
    { id: "right", name: "Right", edgeIds: ["e2"], pinnedRanges: [] },
  ],
};
const tree: Prop = { id: "tree", lightId: "light-1", label: "Tree", kind: "tree", elementIds: ["el-t"] };
const all = ["arch", "tree"];
const elements: Element[] = [
  { id: "el-a", lightId: "light-1", label: "Arch · Left", start: 0, stop: 10 },
  { id: "el-b", lightId: "light-1", label: "Arch · Right", start: 10, stop: 20 },
  { id: "el-t", lightId: "light-1", label: "Tree", start: 20, stop: 30 },
];

function look(extra: Partial<Look> = {}): Look {
  return { id: "warm", name: "Warm", slot: 1, style, overrides: [], ...extra };
}

describe("Follow, Own style and Off", () => {
  it("a new Look has every prop following", () => {
    expect(propMode(look(), arch)).toBe("follow");
    expect(sectionMode(look(), "arch", "left")).toBe("follow");
    expect(sectionsFollow(look(), "arch")).toBe(true);
  });

  it("Own copies what the prop showed, Follow drops it, Off leaves it out of the Look", () => {
    const own = setPropMode(look(), all, arch, "own");
    expect(propMode(own, arch)).toBe("own");
    expect(propStyle(own, arch)).toEqual(style);
    const back = setPropMode(own, all, arch, "follow");
    expect(back.overrides).toEqual([]);
    const off = setPropMode(look(), all, tree, "off");
    expect(off.propIds).toEqual(["arch"]);
    expect(propMode(off, tree)).toBe("off");
    expect(propMode(setPropMode(off, all, tree, "follow"), tree)).toBe("follow");
  });

  it("changing a following prop's colour makes it Own; changing the Look changes every follower", () => {
    const red = patchStyle(look(), all, { prop: arch }, { color: "#ff0000" });
    expect(propMode(red, arch)).toBe("own");
    expect(propStyle(red, arch).color).toBe("#ff0000");
    expect(propStyle(red, tree).color).toBe("#ffa000");
    const blue = patchStyle(red, all, {}, { color: "#0000ff" });
    expect(propStyle(blue, tree).color).toBe("#0000ff");
    expect(propStyle(blue, arch).color).toBe("#ff0000");
  });

  it("a section can be Own or Off; turning a section on turns its prop on", () => {
    const off = setPropMode(look(), all, arch, "off");
    const left = setSectionMode(off, all, arch, "left", "own");
    expect(propMode(left, arch)).toBe("follow");
    expect(sectionMode(left, "arch", "left")).toBe("own");
    const dark = setSectionMode(left, all, arch, "right", "off");
    expect(sectionStyle(dark, arch, "right")).toBeNull();
    expect(sectionsFollow(dark, "arch")).toBe(false);
    const greenLeft = patchStyle(dark, all, { prop: arch, sectionId: "left" }, { color: "#00ff00" });
    expect(sectionStyle(greenLeft, arch, "left")?.color).toBe("#00ff00");
  });
});

describe("what goes to the Light", () => {
  it("following sections are one segment; one Own section splits them again", () => {
    const merged = buildLookPreset(look(), lookTargets({ ledCount: 30, elements, props: [arch, tree] }), false);
    expect((merged.seg as { start: number; stop: number }[]).map((row) => [row.start, row.stop])).toEqual([[0, 20], [20, 30]]);
    const split = setSectionMode(look(), all, arch, "left", "own");
    const seg = buildLookPreset(split, lookTargets({ ledCount: 30, elements, props: [arch, tree] }), false).seg as { start: number }[];
    expect(seg.map((row) => row.start)).toEqual([0, 10, 20]);
  });

  it("sends opacity, direction, third colour and the Look's fade time", () => {
    const styled = look({ style: { ...style, opacity: 128, dir: "mirror", color3: "#0000ff" }, transitionTenths: 20 });
    const preset = buildLookPreset(styled, lookTargets({ ledCount: 30, elements, props: [tree] }), false);
    const seg = (preset.seg as Record<string, unknown>[])[0]!;
    expect(seg).toMatchObject({ bri: 128, rev: false, mi: true });
    expect((seg.col as number[][])[2]).toEqual([0, 0, 255]);
    expect(preset.transition).toBe(20);
  });

  it("a playlist sends a time for each Look and can play once then turn off", () => {
    const looks = [look(), look({ id: "cool", slot: 2 })];
    const preset = buildPlaylistPreset(
      { id: "p", name: "Night", slot: 10, lookIds: ["warm", "cool"], durationTenths: 600, transitionTenths: 7, durationsTenths: [1200, 300], repeat: false },
      looks,
    );
    expect(preset?.playlist).toMatchObject({ ps: [1, 2], dur: [1200, 300], repeat: 1, end: LOOK_OFF_SLOT });
  });
});

describe("what a Light has not been sent", () => {
  const doc: LooksDocument = { version: 1, looks: [look()], playlists: [], schedule: null };

  it("a Light never sent to has everything unsent", () => {
    expect(lookChangesFor(doc, null)).toEqual([{ key: "look:warm", name: "Warm", kind: "new" }]);
  });

  it("names a changed Look and a deleted one", () => {
    const sent = { items: lookItemDigests(doc), names: lookItemNames(doc) };
    expect(lookChangesFor(doc, sent)).toEqual([]);
    const changed = { ...doc, looks: [look({ style: { ...style, color: "#ff0000" } })] };
    expect(lookChangesFor(changed, sent)).toEqual([{ key: "look:warm", name: "Warm", kind: "changed" }]);
    expect(lookChangesFor({ ...doc, looks: [] }, sent)).toEqual([{ key: "look:warm", name: "Warm", kind: "deleted" }]);
  });
});

describe("effects read from a Light", () => {
  it("reads sliders, colours and palette use from fxdata, and hides 2D and sound effects", () => {
    const list = parseWledEffects(
      ["Solid", "Blink", "RSVD", "Fire 2012", "Matrix", "DJ Light"],
      ["", "!,Duty cycle;!,!;!;01", "", "!,Spark rate;;!;1", "!,Spawn;!,!;;2", "Speed;;;1f"],
    );
    expect(list.map((row) => row.name)).toEqual(["Solid", "Blink", "Fire 2012", "Matrix", "DJ Light"]);
    const blink = list.find((row) => row.name === "Blink")!;
    expect(blink.sliders).toEqual(["Speed", "Duty cycle"]);
    expect(blink.colours).toEqual(["Colour", "Background", null]);
    const fire = list.find((row) => row.name === "Fire 2012")!;
    expect(fire.colours).toEqual([null, null, null]);
    expect(fire.palette).toBe(true);
    expect(list.find((row) => row.name === "Matrix")!.hidden).toBe(true);
    expect(list.find((row) => row.name === "DJ Light")!.hidden).toBe(true);
    expect(list.find((row) => row.name === "Blink")!.hidden).toBe(false);
  });

  it("keeps only effects every Light has", () => {
    const a = parseWledEffects(["Solid", "Blink", "Breathe"], null);
    const b = parseWledEffects(["Solid", "Blink"], null);
    expect(intersectEffects([a, b]).map((row) => row.name)).toEqual(["Solid", "Blink"]);
  });

  it("reads palette names and drops empty ones", () => {
    expect(parseWledPalettes(["Default", "", "* Color 1"])).toEqual([{ pal: 0, name: "Default" }, { pal: 2, name: "Color 1" }]);
  });

  it("draws Solid in the Look colour at every light", () => {
    expect(sampleLookStyle({ ...style, bri: 255 }, 3, 10, 1.5)).toEqual([255, 160, 0]);
  });
});
