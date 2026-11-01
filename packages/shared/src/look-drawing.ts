/**
 * The yard drawn front-on for Looks: every light of every prop, in path
 * order, with the section it belongs to. And the colour a Look gives each
 * light at a moment, so the Looks page and the Look view draw the same
 * thing. A drawing is not the lights; Preview on lights is.
 */
import { lookIncludesProp, type Look, type LookStyle } from "./look.ts";
import { propStyle, sampleLookStyle, sectionStyle, sectionsFollow } from "./look-design.ts";
import { pathEdgeIndexRanges } from "./prop/sections.ts";
import { yardLightPositions } from "./prop/space.ts";
import type { Prop } from "./prop/types.ts";

export type DrawnLight = { x: number; y: number; sectionId: string | null };
export type DrawnSection = { id: string; name: string; /** First and last light (inclusive) in this prop's drawn order. */ first: number; last: number };
export type DrawnProp = { id: string; label: string; kind: Prop["kind"]; lights: DrawnLight[]; sections: DrawnSection[] };

export function drawnYard(props: readonly Prop[]): DrawnProp[] {
  const all = yardLightPositions(props);
  return props.flatMap((prop) => {
    if (!prop.layout) return [];
    const ranges = pathEdgeIndexRanges(prop.layout);
    const mine = all.filter((light) => light.propId === prop.id);
    const lights: DrawnLight[] = mine.map((light) => {
      const edge = ranges.find((row) => row.edgeId === light.edgeId && (row.stringId === light.stringId || row.stringId === "s1"));
      const inside = edge && light.index >= edge.start && light.index < edge.stop;
      const section = inside ? prop.sections?.find((row) => row.edgeIds.includes(light.edgeId)) : undefined;
      return { x: light.x, y: light.y, sectionId: section?.id ?? null };
    });
    const sections: DrawnSection[] = (prop.sections ?? []).flatMap((section) => {
      const idx = lights.map((light, index) => (light.sectionId === section.id ? index : -1)).filter((index) => index >= 0);
      return idx.length ? [{ id: section.id, name: section.name, first: idx[0]!, last: idx[idx.length - 1]! }] : [];
    });
    return [{ id: prop.id, label: prop.label, kind: prop.kind, lights, sections }];
  });
}

/** The style that lights one light, or null when it is off in this Look. */
export function drawnLightStyle(look: Look, prop: Pick<Prop, "id" | "kind">, drawn: DrawnProp, index: number):
  { style: LookStyle; at: number; of: number } | null {
  if (!lookIncludesProp(look, prop.id)) return null;
  const light = drawn.lights[index];
  if (!light) return null;
  if (!drawn.sections.length || sectionsFollow(look, prop.id)) {
    return { style: propStyle(look, prop), at: index, of: drawn.lights.length };
  }
  const section = light.sectionId ? drawn.sections.find((row) => row.id === light.sectionId) : undefined;
  if (!section) return { style: propStyle(look, prop), at: index, of: drawn.lights.length };
  const style = sectionStyle(look, prop, section.id);
  return style ? { style, at: index - section.first, of: section.last - section.first + 1 } : null;
}

/** RGB for one light at `t` seconds, scaled by the Look's brightness. Null when off. */
export function drawnLightColour(look: Look, prop: Pick<Prop, "id" | "kind">, drawn: DrawnProp, index: number, t: number): [number, number, number] | null {
  const lit = drawnLightStyle(look, prop, drawn, index);
  if (!lit) return null;
  const c = sampleLookStyle(lit.style, lit.at, lit.of, t);
  const k = 0.35 + 0.65 * (look.style.bri / 255);
  return [c[0] * k, c[1] * k, c[2] * k];
}
