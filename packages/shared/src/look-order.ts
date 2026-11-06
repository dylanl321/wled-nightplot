/**
 * The order the yard preview visits each light of a Prop in a Look, taken from
 * the same code that writes the controller's motion map (`buildMotionMaps` and
 * `motionSort`), so the drawing and the lights cannot disagree about which
 * light an effect reaches first. A drawing, not the lights: Preview on lights
 * is the check. Design: docs/hang-to-effects.md (slice 4).
 *
 * Returns null when the Look gives the Prop no map of its own (every motion is
 * "wire", the motion sorts to the wire order, the Prop has no drawing, it is a
 * wireframe, or the map cannot be built). The preview then runs along the wire
 * and applies the style's `dir`, which is what `directionForMotion` stored and
 * what the push sends when it has no map for that Prop.
 */
import { lookIncludesProp, type Look, type ShapeMotion } from "./look.ts";
import { layoutLightPoints } from "./prop/space.ts";
import { motionsFor } from "./prop/light-maps.ts";
import { buildMotionMaps } from "./prop/motion-map.ts";
import { readPropShape } from "./prop/shape.ts";
import type { Prop } from "./prop/types.ts";

/** Where one drawn light sits in the order its section is visited. */
export type PreviewLight = {
  /** The section the push gives this light, or null for the Prop's own style. */
  sectionId: string | null;
  /** Place in the map, counted from the first light of the block. */
  at: number;
  /** Lights in the block the effect runs over. */
  of: number;
  /** The segment runs reversed (Toward the centre, Downward, Counter-clockwise). */
  rev: boolean;
  /** True when the map orders this block. False means it is in wire order and the style's `dir` applies. */
  mapped: boolean;
};

export type PreviewOrder = {
  /** One entry per drawn light, in the Prop's drawn order (the same indexes as `DrawnProp.lights`). */
  lights: PreviewLight[];
  motions: ShapeMotion[];
};

export function lookPreviewOrder(look: Look, prop: Prop): PreviewOrder | null {
  if (!prop.layout || prop.wireframe || !lookIncludesProp(look, prop.id)) return null;
  const input = motionsFor(look, [prop]);
  if (!input.motions.some((row) => row.motion !== "wire")) return null;
  const built = buildMotionMaps({ props: [{ prop, start: 0 }], looks: [input] });
  if (!built.ok) return null;
  const entry = built.looks[0];
  const own = entry && built.maps.find((row) => row.slot === entry.slot);
  if (!entry || !own || own.map.every((value, index) => value === index)) return null;

  const shape = readPropShape(prop.layout, { overrides: prop.shapeRoles ?? [] });
  const drawn = layoutLightPoints(prop.layout);
  if (shape.lights.length !== drawn.length || own.map.length < drawn.length) return null;
  const local = new Map(shape.lights.map((light, at) => [`${light.stringId}:${light.index}`, at]));
  const place = new Array<number>(own.map.length);
  own.map.forEach((physical, virtual) => { place[physical] = virtual; });
  const segments = [
    ...entry.sections.map((row) => ({ ...row, sectionId: row.sectionId as string | null })),
    ...entry.rests.map((row) => ({ ...row, sectionId: null as string | null })),
  ];

  const lights: PreviewLight[] = [];
  for (const light of drawn) {
    const at = local.get(`${light.stringId}:${light.index}`);
    if (at === undefined) return null;
    const pos = place[at]!;
    const segment = segments.find((row) => pos >= row.start && pos < row.stop);
    if (!segment) return null;
    lights.push({
      sectionId: segment.sectionId,
      at: pos - segment.start,
      of: segment.stop - segment.start,
      rev: segment.rev,
      mapped: segment.motion !== "wire",
    });
  }
  return { lights, motions: [...new Set(segments.map((row) => row.motion))] };
}
