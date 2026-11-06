import { describe, expect, it } from "vitest";
import { drawnLightStyle, drawnLightColour, drawnOrder, drawnYard } from "./look-drawing.ts";
import { sampleLookStyle } from "./look-design.ts";
import { lookPreviewOrder } from "./look-order.ts";
import { lookFrame } from "./look-preview.ts";
import { SHAPE_MOTIONS, type Look, type LookStyle, type ShapeMotion } from "./look.ts";
import { layoutFromMeasurements, type LayoutEdge, type LayoutString, type PropLayout } from "./prop/layout.ts";
import { buildMotionMaps, motionSort } from "./prop/motion-map.ts";
import { motionsFor } from "./prop/light-maps.ts";
import { defaultSections } from "./prop/sections.ts";
import { readPropShape } from "./prop/shape.ts";
import { layoutLightPoints } from "./prop/space.ts";
import type { Prop, PropSection } from "./prop/types.ts";

const base: LookStyle = { fx: 13, pal: 0, sx: 128, ix: 128, bri: 255, color: "#ff0000", color2: "#0000ff" };

function drawn(spec: { corners: [string, number, number][]; strings: { id: string; edges: [string, string, string, ("lit" | "hidden" | "wire")?][] }[] }): PropLayout {
  const strings: LayoutString[] = spec.strings.map((row) => ({
    id: row.id,
    startId: row.edges[0]![1],
    run: row.edges.map(([id, from, to, kind]): LayoutEdge => ({ id, from, to, kind: kind ?? "lit" })),
  }));
  return { source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0, corners: spec.corners.map(([id, x, y]) => ({ id, x, y })), run: strings[0]!.run, strings };
}

const ZIGZAG = layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "zigzag", params: { width: 1, height: 1, passes: 4 } })!;
/** Two strings, the second hopping dark across a gap. */
const SPLIT_TREE = drawn({
  corners: [["c1", 0, 0], ["c2", 0, 1], ["c3", -0.5, 1.5], ["c4", 0.6, 0.2], ["c5", 0.6, 1.2], ["c6", 1, 1.2], ["c7", 1, 1.8]],
  strings: [
    { id: "s1", edges: [["e1", "c1", "c2"], ["e2", "c2", "c3"]] },
    { id: "s2", edges: [["e3", "c4", "c5"], ["e4", "c5", "c6", "hidden"], ["e5", "c6", "c7"]] },
  ],
});
const SPIRAL = layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "spiral", params: { height: 1.5, around: 1.2, gap: 0.2 } })!;
const RING = layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "window", params: { width: 1.2, height: 0.8 } })!;

function prop(id: string, layout: PropLayout, sections?: PropSection[]): Prop {
  return { id, label: id, kind: "custom", elementIds: [], layout, sections: sections ?? defaultSections(layout) } as Prop;
}

function look(propId: string, motion: ShapeMotion, extra: Partial<Look> = {}): Look {
  return { id: "l", name: "L", slot: 1, style: { ...base, motion }, overrides: [], ...extra };
}

const CASES: [string, Prop][] = [
  ["zigzag bush", prop("bush", ZIGZAG)],
  ["two-string split tree", prop("tree", SPLIT_TREE, [{ id: "all", name: "All", edgeIds: ["e1", "e2", "e3", "e4", "e5"], pinnedRanges: [] }])],
  ["window frame", prop("frame", RING)],
  ["spiral", prop("spiral", SPIRAL)],
];

/** The controller's map for one Look, built by the same call the push makes. */
function controller(p: Prop, l: Look) {
  const built = buildMotionMaps({ props: [{ prop: p, start: 0 }], looks: [motionsFor(l, [p])] });
  if (!built.ok) throw new Error(built.message);
  const entry = built.looks[0]!;
  return { entry, map: built.maps.find((row) => row.slot === entry.slot)!.map, base: built.maps[0]!.map };
}

describe("yard preview order matches the motion map", () => {
  for (const [name, p] of CASES) {
    for (const motion of SHAPE_MOTIONS.filter((row) => row !== "wire")) {
      it(`${name}: ${motion} visits the lights in the order the map writes`, () => {
        const l = look(p.id, motion);
        const { entry, map } = controller(p, l);
        const order = lookPreviewOrder(l, p);
        const shape = readPropShape(p.layout!);
        const points = layoutLightPoints(p.layout!);
        const key = (light: { stringId: string; index: number }) => `${light.stringId}:${light.index}`;
        const localOf = new Map(shape.lights.map((light, at) => [key(light), at]));
        if (!order) {
          // No map of its own: the controller map is the wire order, and the preview runs along it.
          expect(map).toEqual(map.map((_, index) => index));
          return;
        }
        const rest = entry.rests[0] ?? entry.sections[0]!;
        const { sort, rev } = motionSort(motion);
        expect(order.lights).toHaveLength(points.length);
        // Which drawn light does the effect reach at each pixel? Pixel i of the segment is map[start + i], or reversed.
        const reached = new Map<number, number>();
        order.lights.forEach((light, drawnIndex) => {
          expect(light.rev).toBe(rev);
          expect(light.mapped).toBe(true);
          const physical = map[rest.start + light.at];
          expect(physical).toBe(localOf.get(key(points[drawnIndex]!)));
          reached.set(rev ? light.of - 1 - light.at : light.at, physical!);
        });
        expect(reached.size).toBe(points.length);
        // Independently: along the effect, the motion's field only ever grows (Upward) or shrinks (Downward).
        const values = [...reached.keys()].sort((a, b) => a - b).map((pixel) => shape.lights[reached.get(pixel)!]!.fields[sort as "h" | "r" | "a"]);
        const sign = rev ? -1 : 1;
        expect(values.every((value, i) => i === 0 || sign * (value - values[i - 1]!) >= -1e-5)).toBe(true);
      });
    }
  }

  it("covers both strings of a split tree in one order", () => {
    const p = CASES[1]![1];
    const order = lookPreviewOrder(look(p.id, "up"), p)!;
    const points = layoutLightPoints(p.layout!);
    expect(new Set(points.map((light) => light.stringId))).toEqual(new Set(["s1", "s2"]));
    expect(new Set(order.lights.map((light) => light.at)).size).toBe(points.length);
    expect(order.lights.every((light) => light.of === points.length)).toBe(true);
  });

  it("differs from wire order on a zigzag, so the drawing would have lied before", () => {
    const p = CASES[0]![1];
    const order = lookPreviewOrder(look(p.id, "up"), p)!;
    expect(order.lights.map((light) => light.at)).not.toEqual(order.lights.map((_, index) => index));
  });

  it("returns null, and the preview runs along the wire with dir, when there is no map of its own", () => {
    const p = CASES[0]![1];
    expect(lookPreviewOrder(look(p.id, "wire"), p)).toBeNull();
    expect(lookPreviewOrder({ ...look(p.id, "up"), propIds: [] }, p)).toBeNull();
    expect(lookPreviewOrder(look(p.id, "up"), { ...p, layout: undefined } as Prop)).toBeNull();
    // A straight strip wired upward already runs in the motion's order, so it needs no map.
    const strip = prop("strip", drawn({ corners: [["c1", 0, 0], ["c2", 0, 1]], strings: [{ id: "s1", edges: [["e1", "c1", "c2"]] }] }));
    const l = look(strip.id, "up", { style: { ...base, motion: "up", dir: "fwd" } });
    const drawnStrip = drawnYard([strip])[0]!;
    expect(drawnOrder(l, strip, drawnStrip)).toBeNull();
    expect(drawnLightStyle(l, strip, drawnStrip, 3)).toMatchObject({ at: 3, of: drawnStrip.lights.length });
  });

  it("uses each section's own motion and leaves a Wire section in wire order", () => {
    const p = prop("tree", SPLIT_TREE, [
      { id: "a", name: "A", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "b", name: "B", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ]);
    const l = look(p.id, "wire", {
      style: { ...base },
      overrides: [{ propId: p.id, sectionId: "a", style: { ...base, motion: "inward" } }, { propId: p.id, sectionId: "b", style: { ...base } }],
    });
    const order = lookPreviewOrder(l, p)!;
    const a = order.lights.filter((light) => light.sectionId === "a");
    const b = order.lights.filter((light) => light.sectionId === "b");
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((light) => light.mapped && light.rev)).toBe(true);
    expect(b.every((light) => !light.mapped)).toBe(true);
    expect(b.map((light) => light.at)).toEqual(b.map((_, index) => index));
    const yard = drawnYard([p])[0]!;
    const lit = drawnLightStyle(l, p, yard, order.lights.findIndex((light) => light.sectionId === "b"), order)!;
    expect(lit.ordered).toBeUndefined();
  });

  it("ignores dir when a map orders the lights, as the push does", () => {
    const p = CASES[0]![1];
    const mirrored = look(p.id, "up", { style: { ...base, motion: "up", dir: "mirror" } });
    const plain = look(p.id, "up");
    const yard = drawnYard([p])[0]!;
    for (let i = 0; i < yard.lights.length; i += 5) {
      expect(drawnLightColour(mirrored, p, yard, i, 1.3, lookPreviewOrder(mirrored, p))).toEqual(drawnLightColour(plain, p, yard, i, 1.3, lookPreviewOrder(plain, p)));
    }
  });
});

describe("sampleLookStyle with an order", () => {
  it("applies only the map's rev, not the style's dir", () => {
    const style: LookStyle = { ...base, fx: 13, dir: "mirror" };
    expect(sampleLookStyle(style, 2, 10, 0.4, { rev: false })).toEqual(sampleLookStyle({ ...style, dir: "fwd" }, 2, 10, 0.4));
    expect(sampleLookStyle(style, 2, 10, 0.4, { rev: true })).toEqual(sampleLookStyle({ ...style, dir: "rev" }, 2, 10, 0.4));
    expect(sampleLookStyle(style, 2, 10, 0.4)).toEqual(sampleLookStyle({ ...style, dir: "mirror" }, 2, 10, 0.4));
  });
});

describe("lookFrame in map order", () => {
  it("paints a Chase from the bottom of a zigzag up, not along the wire", () => {
    const p = CASES[0]![1];
    const wire = lookFrame({ look: look(p.id, "wire"), props: [p], t: 0.3 });
    const up = lookFrame({ look: look(p.id, "up"), props: [p], t: 0.3 });
    expect(up).toHaveLength(wire.length);
    const colourOf = (frame: typeof wire) => new Map(frame.map((light) => [`${light.x.toFixed(4)},${light.y.toFixed(4)}`, light.color]));
    const a = colourOf(wire), b = colourOf(up);
    expect([...b].some(([at, colour]) => a.get(at) !== colour)).toBe(true);
    // Each light's colour is the one the effect gives its place in the map order.
    const order = lookPreviewOrder(look(p.id, "up"), p)!;
    const points = layoutLightPoints(p.layout!);
    const colours = wire.map((light) => light.color);
    points.forEach((light, drawnIndex) => {
      expect(b.get(`${light.x.toFixed(4)},${light.y.toFixed(4)}`)).toBe(colours[order.lights[drawnIndex]!.at]);
    });
  });
});
