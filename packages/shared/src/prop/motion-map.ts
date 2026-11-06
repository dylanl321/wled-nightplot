/**
 * The motion map builder. A motion map is a WLED ledmap that lists a
 * controller's lights in the order an effect should visit them, sorted by a
 * shape field (height, distance from the centre, angle) instead of by wire.
 * WLED then runs its ordinary 1D effects over that order, so Upward is a
 * Chase sorted by height.
 *
 * Pure and deterministic. It reads the drawings and writes nothing: no
 * server, no Look, no controller. A map here is a plan, not lit lights.
 * Design: docs/hang-to-effects.md ("How a map is built").
 *
 * Reading the result. `map[virtual] = physical`, the same as `ledmapN.json`.
 * The props sit on the Light's strip where they are attached, and each
 * prop's block of the map covers exactly its own physical lights, so lights
 * outside any prop keep their place. Inside a prop each section is one
 * contiguous block, so a section is still one WLED segment, and the block
 * is sorted by the section's motion.
 *
 * Lights: the physical order inside a prop is the lit lights in string order
 * (the order `countLayout` counts them). Dark jumps, hidden runs and wire
 * runs hold no lights and take no entries. It does not read `LayoutCorner.z`.
 */

import type { ShapeMotion } from "../look.ts";
import { layoutStrings } from "./layout.ts";
import { readPropShape, type ShapeLight } from "./shape.ts";
import type { Prop } from "./types.ts";
import { compileWireframe, ledmapDigest } from "./wireframe.ts";

/** WLED loads `ledmap.json` (0) and `ledmap1.json` to `ledmap9.json`. */
export const MOTION_MAP_MAX_EXTRA = 9;

/** Toward the centre, Downward and Counter-clockwise reuse another motion's sort and set the segment's `rev` flag. */
export type MotionSort = "wire" | "r" | "h" | "a";

const MOTION_SORT: Record<ShapeMotion, { sort: MotionSort; rev: boolean }> = {
  wire: { sort: "wire", rev: false },
  outward: { sort: "r", rev: false },
  inward: { sort: "r", rev: true },
  up: { sort: "h", rev: false },
  down: { sort: "h", rev: true },
  clockwise: { sort: "a", rev: false },
  counter: { sort: "a", rev: true },
};

/** The sort a motion uses and whether the segment runs reversed. */
export function motionSort(motion: ShapeMotion): { sort: MotionSort; rev: boolean } {
  return MOTION_SORT[motion];
}

/** A prop on the Light, with where its first light sits on the Light's strip. */
export type MotionMapProp = {
  prop: Pick<Prop, "id" | "label" | "layout" | "sections" | "wireframe" | "shapeRoles">;
  /** Physical index of the prop's first light on the Light's combined strip. */
  start: number;
  /** Lights the prop owns. Needed for a well house and for a prop with no drawing. A drawn prop counts its own. */
  ledCount?: number;
};

/** A motion for one section, or for the whole prop when `sectionId` is absent. A section falls back to its prop's, then to along the wire. */
export type MotionChoice = {
  propId: string;
  sectionId?: string;
  motion: ShapeMotion;
};

export type MotionMapLookInput = {
  id: string;
  motions: readonly MotionChoice[];
};

export type MotionMapInput = {
  /** Props on one Light in attach order. */
  props: readonly MotionMapProp[];
  looks: readonly MotionMapLookInput[];
  /** Lights on the Light. Lights past the last prop keep their place. Defaults to the end of the last prop. */
  ledCount?: number;
};

/** Where a section sits in a map: positions in the map, not physical lights. */
export type MotionMapSection = {
  propId: string;
  sectionId: string;
  /** Inclusive start, exclusive stop, in map positions. */
  start: number;
  stop: number;
  motion: ShapeMotion;
  /** The segment runs reversed (Toward the centre, Downward, Counter-clockwise). */
  rev: boolean;
};

export type MotionMapSlot = {
  /** 0 is `ledmap.json`, 1 to 9 are `ledmap1.json` to `ledmap9.json`. */
  slot: number;
  digest: string;
  map: number[];
};

export type MotionMapLook = {
  lookId: string;
  /** Which `ledmapN` this Look's preset names. */
  slot: number;
  sections: MotionMapSection[];
};

export type MotionMapResult =
  | { ok: true; ledCount: number; maps: MotionMapSlot[]; looks: MotionMapLook[]; notes: string[] }
  | { ok: false; message: string; maps: []; looks: []; notes: string[] };

type Group = {
  sectionId: string | null;
  /** Positions in the prop's lights, in wire order. */
  locals: number[];
};

type PropPlan =
  | { kind: "drawn"; item: MotionMapProp; count: number; lights: ShapeLight[]; groups: Group[] }
  | { kind: "block"; item: MotionMapProp; count: number; local: number[] };

const SORT_EPS = 1e6;

function refuse(message: string, notes: string[]): MotionMapResult {
  return { ok: false, message, maps: [], looks: [], notes };
}

function quantise(value: number): number {
  return Math.round(value * SORT_EPS);
}

/** Lights of a drawn prop grouped by section. Lights in no section form their own group, so every light is placed once. */
function groupLights(item: MotionMapProp, lights: readonly ShapeLight[], notes: string[]): Group[] {
  const prop = item.prop;
  const layout = prop.layout!;
  const firstId = layoutStrings(layout)[0]?.id ?? "s1";
  const claimed = new Set<number>();
  const groups: Group[] = [];
  for (const section of prop.sections ?? []) {
    const edges = new Set(section.edgeIds);
    const locals: number[] = [];
    let shared = 0;
    lights.forEach((light, local) => {
      const pinned = section.pinnedRanges.some((range) => (range.stringId ?? firstId) === light.stringId && light.index >= range.start && light.index < range.stop);
      if (!edges.has(light.edgeId) && !pinned) return;
      if (claimed.has(local)) {
        shared += 1;
        return;
      }
      claimed.add(local);
      locals.push(local);
    });
    if (shared > 0) notes.push(`${prop.label} · ${section.name} shares ${shared} light${shared === 1 ? "" : "s"} with an earlier section. Each light is placed once, in the first section that names it.`);
    if (locals.length > 0) groups.push({ sectionId: section.id, locals });
  }
  const rest: number[] = [];
  lights.forEach((_, local) => {
    if (!claimed.has(local)) rest.push(local);
  });
  if (rest.length > 0) groups.push({ sectionId: null, locals: rest });
  return groups.sort((left, right) => left.locals[0]! - right.locals[0]!);
}

function planProp(item: MotionMapProp, notes: string[]): PropPlan {
  const prop = item.prop;
  const given = Number.isInteger(item.ledCount) && (item.ledCount ?? -1) >= 0 ? item.ledCount! : null;
  if (prop.wireframe) {
    const count = given ?? 0;
    if (given === null) notes.push(`${prop.label} has no light count, so it is left as wired.`);
    const compiled = count > 0 ? compileWireframe(prop.wireframe, count) : null;
    const local = compiled && compiled.ledmap.length === count ? compiled.ledmap.slice() : Array.from({ length: count }, (_, index) => index);
    return { kind: "block", item, count, local };
  }
  if (prop.layout) {
    const shape = readPropShape(prop.layout, { overrides: prop.shapeRoles ?? [] });
    const lights = shape.lights;
    if (given !== null && given !== lights.length) {
      notes.push(`${prop.label} is drawn with ${lights.length} lights but attached with ${given}. The drawing's count is used.`);
    }
    return { kind: "drawn", item, count: lights.length, lights, groups: groupLights(item, lights, notes) };
  }
  const count = given ?? 0;
  if (given === null) notes.push(`${prop.label} has no drawing or light count, so it is left as wired.`);
  return { kind: "block", item, count, local: Array.from({ length: count }, (_, index) => index) };
}

function choiceFor(look: MotionMapLookInput, propId: string, sectionId: string | null): ShapeMotion {
  let whole: ShapeMotion | null = null;
  for (const choice of look.motions) {
    if (choice.propId !== propId) continue;
    if (choice.sectionId === undefined) whole = choice.motion;
    else if (sectionId !== null && choice.sectionId === sectionId) return choice.motion;
  }
  return whole ?? "wire";
}

/** Sort one block. Ties go to the angle around the centre, then the wire order, so neighbours stay neighbours. */
function sortBlock(locals: readonly number[], lights: readonly ShapeLight[], sort: MotionSort): number[] {
  if (sort === "wire") return locals.slice();
  return locals.slice().sort((left, right) => {
    const a = lights[left]!.fields;
    const b = lights[right]!.fields;
    return quantise(a[sort] - b[sort]) || quantise(a.a - b.a) || left - right;
  });
}

function buildMap(plans: readonly PropPlan[], total: number, look: MotionMapLookInput | null): { map: number[]; sections: MotionMapSection[] } {
  const map = Array.from({ length: total }, (_, index) => index);
  const sections: MotionMapSection[] = [];
  for (const plan of plans) {
    const base = plan.item.start;
    if (plan.kind === "block") {
      plan.local.forEach((local, offset) => {
        map[base + offset] = base + local;
      });
      continue;
    }
    let cursor = base;
    for (const group of plan.groups) {
      const motion = look ? choiceFor(look, plan.item.prop.id, group.sectionId) : "wire";
      const { sort, rev } = motionSort(motion);
      const ordered = sortBlock(group.locals, plan.lights, sort);
      const start = cursor;
      for (const local of ordered) {
        map[cursor] = base + local;
        cursor += 1;
      }
      if (group.sectionId !== null) {
        sections.push({ propId: plan.item.prop.id, sectionId: group.sectionId, start, stop: cursor, motion, rev });
      }
    }
  }
  return { map, sections };
}

function sameMap(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * One map per Look for one Light, deduplicated. Slot 0 is the base map
 * (as wired, with a well house's face map packed in its block); a Look whose
 * map is the base names slot 0. More than nine other distinct maps is
 * refused. Bad input comes back as a refusal with a plain message.
 */
export function buildMotionMaps(input: MotionMapInput): MotionMapResult {
  const notes: string[] = [];
  const ordered = input.props
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number.isInteger(item.start) && item.start >= 0)
    .sort((left, right) => left.item.start - right.item.start || left.index - right.index)
    .map(({ item }) => item);
  for (const item of input.props) {
    if (!Number.isInteger(item.start) || item.start < 0) {
      return refuse(`${item.prop.label} does not start at a whole light on this Light, so no motion map was built.`, notes);
    }
  }
  const plans = ordered.map((item) => planProp(item, notes));
  let end = 0;
  let previous: PropPlan | null = null;
  for (const plan of plans) {
    if (previous && plan.item.start < end) {
      return refuse(`${previous.item.prop.label} and ${plan.item.prop.label} share lights on this Light, so no motion map was built.`, notes);
    }
    end = plan.item.start + plan.count;
    previous = plan;
  }
  const total = Math.max(end, Number.isInteger(input.ledCount) ? input.ledCount! : 0);
  if (total === 0) return refuse("This Light has no lights to map.", notes);

  const base = buildMap(plans, total, null).map;
  const maps: MotionMapSlot[] = [{ slot: 0, digest: ledmapDigest(base), map: base }];
  const looks: MotionMapLook[] = [];
  const seen = new Set<string>();
  for (const look of input.looks) {
    if (seen.has(look.id)) {
      notes.push(`Look ${look.id} appears twice. The first one is used.`);
      continue;
    }
    seen.add(look.id);
    const built = buildMap(plans, total, look);
    const digest = ledmapDigest(built.map);
    let slot = maps.find((row) => row.digest === digest && sameMap(row.map, built.map));
    if (!slot) {
      if (maps.length > MOTION_MAP_MAX_EXTRA) {
        return refuse(
          `These Looks need more than ${MOTION_MAP_MAX_EXTRA} different light orders on this Light, and WLED holds ${MOTION_MAP_MAX_EXTRA} besides the base. Use fewer different motions across Looks, or run the rest along the wire.`,
          notes,
        );
      }
      slot = { slot: maps.length, digest, map: built.map };
      maps.push(slot);
    }
    looks.push({ lookId: look.id, slot: slot.slot, sections: built.sections });
  }
  return { ok: true, ledCount: total, maps, looks, notes };
}
