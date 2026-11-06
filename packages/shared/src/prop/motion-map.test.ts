import { describe, expect, it } from "vitest";
import type { ShapeMotion } from "../look.ts";
import { countLayout, layoutFromMeasurements, type LayoutEdge, type LayoutString, type PropLayout } from "./layout.ts";
import { buildMotionMaps, motionSort, type MotionChoice, type MotionMapProp, type MotionMapResult } from "./motion-map.ts";
import { defaultSections } from "./sections.ts";
import { readPropShape } from "./shape.ts";
import type { Prop, PropSection } from "./types.ts";
import { compileWireframe, defaultWireframeSpec, ledmapDigest } from "./wireframe.ts";

type Spec = { corners: [string, number, number][]; strings: { id: string; edges: [string, string, string, ("lit" | "hidden" | "wire")?][] }[] };

function drawn(spec: Spec, extra: Partial<PropLayout> = {}): PropLayout {
  const strings: LayoutString[] = spec.strings.map((row) => ({
    id: row.id,
    startId: row.edges[0]![1],
    run: row.edges.map(([id, from, to, kind]): LayoutEdge => ({ id, from, to, kind: kind ?? "lit" })),
  }));
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: spec.corners.map(([id, x, y]) => ({ id, x, y })),
    run: strings[0]!.run,
    strings,
    ...extra,
  };
}

function prop(id: string, layout: PropLayout, sections?: PropSection[]): MotionMapProp["prop"] {
  return { id, label: id, layout, sections: sections ?? defaultSections(layout) };
}

function placed(prop: MotionMapProp["prop"], start: number): MotionMapProp {
  return { prop, start };
}

function ok(result: MotionMapResult) {
  if (!result.ok) throw new Error(result.message);
  return result;
}

function everyOnce(map: readonly number[]): boolean {
  return [...map].sort((a, b) => a - b).every((value, index) => value === index);
}

function look(id: string, propId: string, motion: ShapeMotion, sectionId?: string) {
  const motions: MotionChoice[] = [{ propId, motion, ...(sectionId ? { sectionId } : {}) }];
  return { id, motions };
}

function zigzag(): PropLayout {
  return layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "zigzag", params: { width: 1, height: 1, passes: 4 } })!;
}

/** Two strings. The second hops dark across a gap, and both hold lights at many heights. */
const TREE_ALL: PropSection[] = [{ id: "all", name: "All", edgeIds: ["e1", "e2", "e3", "e4", "e5"], pinnedRanges: [] }];

const TWO_STRING_TREE = drawn({
  corners: [
    ["c1", 0, 0], ["c2", 0, 1], ["c3", -0.5, 1.5],
    ["c4", 0.6, 0.2], ["c5", 0.6, 1.2], ["c6", 1, 1.2], ["c7", 1, 1.8],
  ],
  strings: [
    { id: "s1", edges: [["e1", "c1", "c2"], ["e2", "c2", "c3"]] },
    { id: "s2", edges: [["e3", "c4", "c5"], ["e4", "c5", "c6", "hidden"], ["e5", "c6", "c7"]] },
  ],
});

describe("motion map: one drawn prop", () => {
  it("sorts a zigzag bush by height and places each light once", () => {
    const layout = zigzag();
    const bush = prop("bush", layout);
    const result = ok(buildMotionMaps({ props: [placed(bush, 0)], looks: [look("up", "bush", "up")] }));
    const shape = readPropShape(layout);
    const map = result.maps[result.looks[0]!.slot]!.map;
    expect(map).toHaveLength(shape.lights.length);
    expect(everyOnce(map)).toBe(true);
    const heights = map.map((physical) => shape.lights[physical]!.fields.h);
    expect(heights.every((value, index) => index === 0 || value >= heights[index - 1]! - 1e-6)).toBe(true);
    // Wired up and down, so Upward is not the order it was wired in.
    expect(map).not.toEqual(result.maps[0]!.map);
    expect(result.maps[0]!.map).toEqual(map.map((_, index) => index));
    expect(result.looks[0]!.sections).toEqual([{ propId: "bush", sectionId: "section.zigzag", start: 0, stop: map.length, motion: "up", rev: false }]);
  });

  it("carries a two-string tree across both strings and ignores the dark hop", () => {
    const tree = prop("tree", TWO_STRING_TREE, TREE_ALL);
    const shape = readPropShape(TWO_STRING_TREE);
    // The dark hop holds no lights, and the second string is counted after the first.
    expect(shape.lights).toHaveLength(countLayout(TWO_STRING_TREE).total);
    expect(shape.lights.some((row) => row.edgeId === "e4")).toBe(false);
    const result = ok(buildMotionMaps({ props: [placed(tree, 0)], looks: [look("up", "tree", "up")] }));
    const map = result.maps[result.looks[0]!.slot]!.map;
    expect(map).toHaveLength(shape.lights.length);
    expect(everyOnce(map)).toBe(true);
    const strings = new Set(map.map((physical) => shape.lights[physical]!.stringId));
    expect(strings).toEqual(new Set(["s1", "s2"]));
    const heights = map.map((physical) => shape.lights[physical]!.fields.h);
    expect(heights.every((value, index) => index === 0 || value >= heights[index - 1]! - 1e-6)).toBe(true);
    expect(heights[0]).toBeLessThan(0.1);
    expect(heights.at(-1)).toBeGreaterThan(0.9);
  });

  it("keeps each section one contiguous block, sorted on its own", () => {
    const sections: PropSection[] = [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ];
    const tree = prop("tree", TWO_STRING_TREE, sections);
    const shape = readPropShape(TWO_STRING_TREE);
    const result = ok(buildMotionMaps({
      props: [placed(tree, 0)],
      looks: [{ id: "mix", motions: [{ propId: "tree", sectionId: "left", motion: "up" }, { propId: "tree", sectionId: "right", motion: "down" }] }],
    }));
    const [first, second] = result.looks[0]!.sections;
    expect(first).toMatchObject({ sectionId: "left", start: 0, rev: false });
    expect(second).toMatchObject({ sectionId: "right", start: first!.stop, stop: shape.lights.length, motion: "down", rev: true });
    const map = result.maps[result.looks[0]!.slot]!.map;
    expect(map.slice(first!.start, first!.stop).every((physical) => ["e1", "e2"].includes(shape.lights[physical]!.edgeId))).toBe(true);
    expect(map.slice(second!.start, second!.stop).every((physical) => ["e3", "e5"].includes(shape.lights[physical]!.edgeId))).toBe(true);
  });

  it("places lights that no section names once, and a light two sections name once", () => {
    const sections: PropSection[] = [
      { id: "a", name: "A", edgeIds: ["e1", "e3"], pinnedRanges: [] },
      { id: "b", name: "B", edgeIds: ["e3"], pinnedRanges: [] },
    ];
    const result = ok(buildMotionMaps({ props: [placed(prop("tree", TWO_STRING_TREE, sections), 0)], looks: [look("up", "tree", "up")] }));
    expect(everyOnce(result.maps[result.looks[0]!.slot]!.map)).toBe(true);
    expect(result.notes.join(" ")).toMatch(/shares .* with an earlier section/);
    expect(result.looks[0]!.sections.map((row) => row.sectionId)).toEqual(["a"]);
  });

  it("follows a hand-placed, traced layout", () => {
    // A traced vertical run wired from the top down, with lights placed unevenly by hand.
    const layout = drawn({
      corners: [["c1", 0, 2], ["c2", 0, 0]],
      strings: [{ id: "s1", edges: [["e1", "c1", "c2"]] }],
    });
    layout.run[0] = { ...layout.run[0]!, manualLights: true, lockedLights: 4, lights: [
      { id: "l1", alongM: 0.1 }, { id: "l2", alongM: 0.2 }, { id: "l3", alongM: 1.5 }, { id: "l4", alongM: 1.9 },
    ] };
    layout.strings![0] = { ...layout.strings![0]!, run: layout.run };
    const result = ok(buildMotionMaps({ props: [placed(prop("rail", layout), 0)], looks: [look("up", "rail", "up"), look("down", "rail", "down")] }));
    expect(result.maps[result.looks[0]!.slot]!.map).toEqual([3, 2, 1, 0]);
    expect(result.looks[1]!.slot).toBe(result.looks[0]!.slot);
    expect(result.looks[1]!.sections[0]).toMatchObject({ motion: "down", rev: true });
  });

  it("breaks a height tie by angle, then by wire order", () => {
    // Two strings laid over the same line: every height ties and so does every angle.
    const layout = drawn({
      corners: [["c1", 0, 0], ["c2", 0, 0.5], ["c3", 0, 0], ["c4", 0, 0.5]],
      strings: [{ id: "s1", edges: [["e1", "c1", "c2"]] }, { id: "s2", edges: [["e2", "c3", "c4"]] }],
    });
    const result = ok(buildMotionMaps({ props: [placed(prop("twin", layout, [{ id: "all", name: "All", edgeIds: ["e1", "e2"], pinnedRanges: [] }]), 0)], looks: [look("up", "twin", "up")] }));
    expect(result.maps[result.looks[0]!.slot]!.map).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4, 9]);

    // A square: along the top every light ties on height, so angle decides.
    const square = drawn({
      corners: [["c1", 0, 0], ["c2", 0, 1], ["c3", 1, 1], ["c4", 1, 0]],
      strings: [{ id: "s1", edges: [["e1", "c1", "c2"], ["e2", "c2", "c3"], ["e3", "c3", "c4"]] }],
    });
    const shape = readPropShape(square);
    const map = ok(buildMotionMaps({ props: [placed(prop("sq", square, [{ id: "all", name: "All", edgeIds: ["e1", "e2", "e3"], pinnedRanges: [] }]), 0)], looks: [look("up", "sq", "up")] }));
    const order = map.maps[map.looks[0]!.slot]!.map.map((physical) => shape.lights[physical]!);
    for (let index = 1; index < order.length; index += 1) {
      const a = order[index - 1]!.fields;
      const b = order[index]!.fields;
      if (Math.abs(a.h - b.h) < 1e-6) expect(b.a).toBeGreaterThanOrEqual(a.a - 1e-6);
    }
  });
});

describe("motion map: several props on one Light", () => {
  it("keeps a well house's face map in its block, with a tree after it", () => {
    const spec = defaultWireframeSpec({ sides: 4 });
    const house: MotionMapProp = { prop: { id: "house", label: "Well house", wireframe: spec }, start: 0, ledCount: 80 };
    const tree = placed(prop("tree", TWO_STRING_TREE, TREE_ALL), 80);
    const treeCount = readPropShape(TWO_STRING_TREE).lights.length;
    const result = ok(buildMotionMaps({ props: [house, tree], looks: [look("up", "tree", "up")] }));
    const faceMap = compileWireframe(spec, 80).ledmap;
    for (const slot of result.maps) expect(slot.map.slice(0, 80)).toEqual(faceMap);
    expect(result.maps[0]!.map.slice(80)).toEqual(Array.from({ length: treeCount }, (_, index) => 80 + index));
    const upward = result.maps[result.looks[0]!.slot]!.map;
    expect(upward).toHaveLength(80 + treeCount);
    expect(upward.slice(80).every((physical) => physical >= 80)).toBe(true);
    expect(everyOnce(upward)).toBe(true);
    expect(result.looks[0]!.slot).not.toBe(0);
    expect(result.looks[0]!.sections.every((row) => row.start >= 80)).toBe(true);
  });

  it("lays props out by where they start, leaving gaps and trailing lights as wired", () => {
    const one = placed(prop("a", zigzag()), 5);
    const count = readPropShape(zigzag()).lights.length;
    const two = placed(prop("b", TWO_STRING_TREE, TREE_ALL), 5 + count + 3);
    const result = ok(buildMotionMaps({ props: [two, one], ledCount: 200, looks: [{ id: "up", motions: [{ propId: "a", motion: "up" }, { propId: "b", motion: "up" }] }] }));
    const map = result.maps[result.looks[0]!.slot]!.map;
    expect(map).toHaveLength(200);
    expect(everyOnce(map)).toBe(true);
    expect(map.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(map.slice(5, 5 + count).every((physical) => physical >= 5 && physical < 5 + count)).toBe(true);
    expect(map.slice(5 + count, 5 + count + 3)).toEqual([5 + count, 6 + count, 7 + count]);
    expect(map.slice(5 + count + 3 + readPropShape(TWO_STRING_TREE).lights.length)).toEqual(
      Array.from({ length: 200 - (5 + count + 3 + readPropShape(TWO_STRING_TREE).lights.length) }, (_, index) => 5 + count + 3 + readPropShape(TWO_STRING_TREE).lights.length + index),
    );
  });

  it("refuses props that share lights, without throwing", () => {
    const result = buildMotionMaps({ props: [placed(prop("a", zigzag()), 0), placed(prop("b", zigzag()), 3)], looks: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/share lights/);
    expect(buildMotionMaps({ props: [placed(prop("a", zigzag()), -1)], looks: [] }).ok).toBe(false);
    expect(buildMotionMaps({ props: [], looks: [] }).ok).toBe(false);
  });
});

describe("motion map: maps across Looks", () => {
  const props = () => [placed(prop("bush", zigzag()), 0)];

  it("shares a map between Looks that sort the same way and names the base for as-wired", () => {
    const result = ok(buildMotionMaps({
      props: props(),
      looks: [look("one", "bush", "up"), look("two", "bush", "up"), look("three", "bush", "outward"), look("four", "bush", "wire"), look("five", "bush", "down")],
    }));
    const slots = result.looks.map((row) => row.slot);
    expect(slots[0]).toBe(slots[1]);
    expect(slots[0]).toBe(slots[4]);
    expect(slots[2]).not.toBe(slots[0]);
    expect(slots[3]).toBe(0);
    expect(result.maps.map((row) => row.slot)).toEqual([0, 1, 2]);
    expect(new Set(result.maps.map((row) => row.digest)).size).toBe(3);
    for (const row of result.maps) expect(row.digest).toBe(ledmapDigest(row.map));
  });

  it("gives reversed motions the same map and a rev flag", () => {
    const pairs: [ShapeMotion, ShapeMotion][] = [["up", "down"], ["outward", "inward"], ["clockwise", "counter"]];
    for (const [forward, back] of pairs) {
      const result = ok(buildMotionMaps({ props: props(), looks: [look("f", "bush", forward), look("b", "bush", back)] }));
      expect(result.looks[0]!.slot).toBe(result.looks[1]!.slot);
      expect(result.looks[0]!.sections[0]!.rev).toBe(false);
      expect(result.looks[1]!.sections[0]!.rev).toBe(true);
      expect(motionSort(back).sort).toBe(motionSort(forward).sort);
    }
    expect(motionSort("wire")).toEqual({ sort: "wire", rev: false });
  });

  it("falls back from a section to its prop to along the wire", () => {
    const sections: PropSection[] = [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ];
    const tree = placed(prop("tree", TWO_STRING_TREE, sections), 0);
    const whole = ok(buildMotionMaps({ props: [tree], looks: [look("whole", "tree", "up")] }));
    expect(whole.looks[0]!.sections.map((row) => row.motion)).toEqual(["up", "up"]);
    const some = ok(buildMotionMaps({ props: [tree], looks: [{ id: "some", motions: [{ propId: "tree", sectionId: "right", motion: "up" }] }] }));
    expect(some.looks[0]!.sections.map((row) => row.motion)).toEqual(["wire", "up"]);
  });

  it("refuses more than nine different maps and says so plainly", () => {
    const three = ["a", "b", "c"].map((id, index) => placed(prop(id, zigzag()), index * 100));
    const sorts: ShapeMotion[] = ["wire", "up", "outward", "clockwise"];
    const combos: MotionChoice[][] = [];
    for (let code = 1; code < 64; code += 1) {
      combos.push(["a", "b", "c"].map((propId, index) => ({ propId, motion: sorts[Math.floor(code / 4 ** index) % 4]! })));
    }
    const looksOf = (count: number) => combos.slice(0, count).map((motions, index) => ({ id: `look${index}`, motions }));
    const nine = ok(buildMotionMaps({ props: three, looks: looksOf(9) }));
    expect(nine.maps).toHaveLength(10);
    expect(nine.looks.map((row) => row.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ten = buildMotionMaps({ props: three, looks: looksOf(10) });
    expect(ten.ok).toBe(false);
    if (!ten.ok) {
      expect(ten.message).toMatch(/more than 9 different light orders/);
    }
  });

  it("is deterministic: the same input gives the same maps and digests", () => {
    const run = () => buildMotionMaps({
      props: [placed(prop("bush", zigzag()), 0), placed(prop("tree", TWO_STRING_TREE, TREE_ALL), 100)],
      looks: [look("one", "bush", "up"), look("two", "tree", "clockwise")],
    });
    const first = ok(run());
    const second = ok(run());
    expect(second).toEqual(first);
    expect(first.maps.map((row) => row.digest)).toEqual(second.maps.map((row) => row.digest));
    const other = ok(buildMotionMaps({ props: [placed(prop("bush", zigzag()), 0), placed(prop("tree", TWO_STRING_TREE, TREE_ALL), 100)], looks: [look("one", "bush", "outward")] }));
    expect(other.maps[1]!.digest).not.toBe(first.maps[1]!.digest);
  });
});

describe("motion map: input the builder refuses or notes", () => {
  it("refuses a prop that does not start at a whole light", () => {
    const bush = prop("bush", zigzag());
    for (const start of [-1, 2.5, Number.NaN]) {
      const result = buildMotionMaps({ props: [placed(bush, start)], looks: [] });
      expect(result.ok).toBe(false);
      expect(result.maps).toEqual([]);
      if (!result.ok) expect(result.message).toMatch(/does not start at a whole light/);
    }
  });

  it("uses the first of two Looks with the same id and says so", () => {
    const result = ok(buildMotionMaps({
      props: [placed(prop("bush", zigzag()), 0)],
      looks: [look("same", "bush", "up"), look("same", "bush", "outward")],
    }));
    expect(result.looks).toHaveLength(1);
    expect(result.looks[0]!.slot).toBe(1);
    expect(result.maps).toHaveLength(2);
    expect(result.notes.join(" ")).toMatch(/Look same appears twice/);
  });

  it("keeps lights past the last prop where they are when the Light is longer", () => {
    const bush = prop("bush", zigzag());
    const count = readPropShape(bush.layout!).lights.length;
    const result = ok(buildMotionMaps({ props: [placed(bush, 0)], looks: [look("up", "bush", "up")], ledCount: count + 20 }));
    expect(result.ledCount).toBe(count + 20);
    for (const row of result.maps) {
      expect(row.map).toHaveLength(count + 20);
      expect(row.map.slice(count)).toEqual(Array.from({ length: 20 }, (_, index) => count + index));
    }
  });

  it("leaves a wireframe with no light count as wired and says so", () => {
    const house: MotionMapProp["prop"] = { id: "house", label: "House", wireframe: defaultWireframeSpec({ sides: 4 }) };
    const result = ok(buildMotionMaps({ props: [{ prop: house, start: 0 }], looks: [], ledCount: 12 }));
    expect(result.maps[0]!.map).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(result.notes.join(" ")).toMatch(/House has no light count/);
  });

  it("packs a wireframe's face map as a block of the base map, beside a drawn prop", () => {
    const spec = defaultWireframeSpec({ sides: 4 });
    const house: MotionMapProp["prop"] = { id: "house", label: "House", wireframe: spec };
    const faces = compileWireframe(spec, 40).ledmap;
    const bush = prop("bush", zigzag());
    const count = readPropShape(bush.layout!).lights.length;
    const result = ok(buildMotionMaps({
      props: [{ prop: house, start: 0, ledCount: 40 }, placed(bush, 40)],
      looks: [look("up", "bush", "up")],
    }));
    expect(result.maps[0]!.map.slice(0, 40)).toEqual(faces);
    expect(result.maps[0]!.map.slice(40)).toEqual(Array.from({ length: count }, (_, index) => 40 + index));
    // The well house does not move between maps.
    expect(result.maps[1]!.map.slice(0, 40)).toEqual(faces);
    expect(result.looks[0]!.sections.every((row) => row.propId === "bush")).toBe(true);
  });

  it("notes a drawing and an attachment that disagree and uses the drawing", () => {
    const bush = prop("bush", zigzag());
    const count = readPropShape(bush.layout!).lights.length;
    const result = ok(buildMotionMaps({ props: [{ prop: bush, start: 0, ledCount: count + 7 }], looks: [] }));
    expect(result.ledCount).toBe(count);
    expect(result.notes.join(" ")).toMatch(new RegExp(`drawn with ${count} lights but attached with ${count + 7}`));
  });

  it("sorts a prop's sections as one block for a Look that lists it as joined", () => {
    const sections: PropSection[] = [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ];
    const tree = prop("tree", TWO_STRING_TREE, sections);
    const shape = readPropShape(TWO_STRING_TREE);
    const result = ok(buildMotionMaps({
      props: [placed(tree, 0)],
      looks: [{ id: "up", motions: [{ propId: "tree", motion: "up" }], joined: ["tree"] }],
    }));
    const look = result.looks[0]!;
    expect(look.sections).toEqual([]);
    expect(look.rests).toEqual([{ propId: "tree", start: 0, stop: shape.lights.length, motion: "up", rev: false }]);
    const heights = result.maps[look.slot]!.map.map((physical) => shape.lights[physical]!.fields.h);
    expect(heights.every((value, index) => index === 0 || value >= heights[index - 1]! - 1e-6)).toBe(true);
  });
});
