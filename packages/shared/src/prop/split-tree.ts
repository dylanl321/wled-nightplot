/**
 * A split tree is a trunk that forks. The skeleton is flat, drawn front-on
 * (spread left to right, height up), and that is what you edit. The lights
 * are not flat: they coil round each trunk the way a string is really put
 * up, so every corner of the coil carries a depth (`z`, toward the street).
 * The editor draws the front view; the street view and the shape reader see
 * the coil as round.
 *
 * How a string goes up a real tree, and so how it is drawn:
 *  - It wraps up a trunk at the wrap gap, round a trunk as thick as `around`.
 *    Branches are thinner than the trunk they grow from.
 *  - At a fork it carries straight on, wrapping up the next branch.
 *  - It cannot jump to a sibling. When it is done with one branch it runs
 *    straight back down the back of that branch to the fork, then wraps up
 *    the next one.
 *  - A move that cannot be walked down the tree is a dark jump (`wire`).
 *
 * With no strings set, the tree is one string walked in that order: up the
 * trunk, up the left branch, back down, up the next. Strings set by hand
 * cover the trunks they name, in order, and any trunk left over is drawn as
 * its own loose coil.
 *
 * Geometry is in the prop's unit; layout corners are metres. A string's
 * spacing stays in millimetres.
 */

import {
  assignStableRunIds,
  METRES_PER_FOOT,
  type LayoutBody,
  type LayoutCorner,
  type LayoutEdge,
  type LayoutString,
  type LayoutUnits,
  type PropLayout,
} from "./layout.ts";
import {
  addPoseBranch,
  forkPoseNode,
  movePoseJoint,
  poseSummary,
  poseTips,
  scalePoseHeight,
  scalePoseSpacing,
  setPoseSplit,
} from "./split-pose.ts";
import {
  SPLIT_TREE_TRUNKS_MAX,
  SPLIT_TREE_TRUNKS_MIN,
  type PropSection,
  type SplitPose,
  type SplitPoseNode,
  type SplitTreeString,
  type SplitTreeTrunkEnd,
} from "./types.ts";

export {
  addPoseBranch,
  forkPoseNode,
  movePoseJoint,
  poseSummary,
  poseTips,
  scalePoseHeight,
  scalePoseSpacing,
  setPoseSplit,
};

export type SplitTreeLevels = 1 | 2;

export type SplitTrunk = {
  id: string;
  parentId: string | null;
  /** Prop units, from the ground. */
  from: number;
  to: number;
  /** Prop units. 0 is the centre line. */
  x0: number;
  x1: number;
  /** Metres. Thickest at the ground; each branch is thinner than the one it grows from. */
  radius0: number;
  radius1: number;
  /** Turns of the wrap up this trunk, at the wrap gap. */
  turns: number;
  /** Where the wrap starts round the trunk, in radians. A branch carries on from where its parent's wrap ended. */
  phase0: number;
  /** Metres of string to coil up the trunk. */
  lengthM: number;
  /** Metres along the wood, root to tip. */
  woodM: number;
  /** Metres of vertical rise. */
  riseM: number;
};

export type SplitTreeSpec = {
  units: LayoutUnits;
  height: number;
  split: number;
  spacing: number;
  trunks: number;
  levels: SplitTreeLevels;
  /** Around the main trunk at the ground, prop units. Absent uses {@link splitWrapDefaults}. */
  around?: number;
  /** Rise from one wrap to the next, prop units. Absent uses {@link splitWrapDefaults}. */
  gap?: number;
  trunkTo?: readonly SplitTreeTrunkEnd[];
  strings?: readonly SplitTreeString[];
  /** Joints placed by hand. Absent while the tree is still the even starting shape. */
  pose?: SplitPose;
};

export type TrunkStringCover = {
  stringId: string;
  /** Metres of this trunk's wrap this string covers. */
  coveredM: number;
  lights: number;
  /** Metres of this string still unused after this trunk's wrap. Null when the count is not set. */
  remainingM: number | null;
};

export type TrunkCover = {
  trunkId: string;
  lengthM: number;
  coveredM: number;
  openM: number;
  strings: TrunkStringCover[];
};

export type SplitHop = {
  stringId: string;
  fromId: string;
  toId: string;
  /** The two pieces do not meet by walking the tree, so the string jumps in the dark. */
  dark: boolean;
  /** The string runs back down the back of the branch before the next one. */
  back: boolean;
};

const EPS = 1e-6;
/** Coil corners per turn: left edge, front, right edge, back. */
const PER_TURN = 4;
/** Fine steps per coil corner when measuring the real length of the wrap. */
const MEASURE_STEPS = 8;
const MAX_TURNS = 200;
/** Body radius over the coil, so a rim of wood shows round the lights. */
const BODY = 1.15;
/** A branch starts this much thinner than the end of the trunk it grows from. */
const BRANCH_THIN = 0.8;
/** A trunk narrows this much along its own length; a tip narrows more. */
const TAPER_FORK = 0.85;
const TAPER_TIP = 0.6;
/** The id of the one string the tree is drawn as when no strings are set. */
export const SPLIT_WALK_ID = "walk";

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function toMetres(units: LayoutUnits, value: number): number {
  return value * (units === "ft" ? METRES_PER_FOOT : 1);
}

/** A small ornamental tree: a foot around, wrapped every 6 in (30 cm and 15 cm). Prop units. */
export function splitWrapDefaults(units: LayoutUnits): { around: number; gap: number } {
  return units === "ft" ? { around: 1, gap: 0.5 } : { around: 0.3, gap: 0.15 };
}

function wrapSizes(spec: Pick<SplitTreeSpec, "units" | "around" | "gap">): { aroundM: number; gapM: number } {
  const fallback = splitWrapDefaults(spec.units);
  const around = spec.around != null && spec.around > 0 ? spec.around : fallback.around;
  const gap = spec.gap != null && spec.gap > 0 ? spec.gap : fallback.gap;
  return { aroundM: toMetres(spec.units, around), gapM: toMetres(spec.units, gap) };
}

function tipX(index: number, tips: number, spacing: number): number {
  return (index - (tips - 1) / 2) * spacing;
}

function forkX(start: number, count: number, tips: number, spacing: number): number {
  return (tipX(start, tips, spacing) + tipX(start + count - 1, tips, spacing)) / 2;
}

type Bone = { id: string; parentId: string | null; from: number; to: number; x0: number; x1: number };

/** The even starting skeleton from the whole-tree numbers. Null when they cannot make a tree. */
function evenBones(spec: SplitTreeSpec): Bone[] | null {
  const tips = Math.round(spec.trunks);
  const { height, split, spacing } = spec;
  if (!Number.isInteger(tips) || tips < SPLIT_TREE_TRUNKS_MIN || tips > SPLIT_TREE_TRUNKS_MAX) return null;
  if (!(height > 0) || !(split > 0) || !(spacing > 0) || split >= height - EPS) return null;
  const levels: SplitTreeLevels = spec.levels === 2 && tips >= 3 ? 2 : 1;
  const bones: Bone[] = [{ id: "t0", parentId: null, from: 0, to: split, x0: 0, x1: 0 }];
  if (levels === 1) {
    for (let index = 0; index < tips; index += 1) {
      bones.push({ id: `t0.${index}`, parentId: "t0", from: split, to: height, x0: 0, x1: tipX(index, tips, spacing) });
    }
  } else {
    const left = Math.ceil(tips / 2);
    const second = split + (height - split) / 2;
    addSide(bones, "t0.0", 0, left, second, tips, spacing, split, height);
    addSide(bones, "t0.1", left, tips - left, second, tips, spacing, split, height);
  }
  applyEnds(bones, spec.trunkTo ?? [], height);
  return bones.filter((bone) => bone.to > bone.from + EPS);
}

function addSide(bones: Bone[], id: string, tipStart: number, count: number, second: number, tips: number, spacing: number, split: number, height: number): void {
  const x1 = count === 1 ? tipX(tipStart, tips, spacing) : forkX(tipStart, count, tips, spacing);
  const forks = count > 1;
  bones.push({ id, parentId: "t0", from: split, to: forks ? second : height, x0: 0, x1 });
  if (!forks) return;
  for (let index = 0; index < count; index += 1) {
    bones.push({ id: `${id}.${index}`, parentId: id, from: second, to: height, x0: x1, x1: tipX(tipStart + index, tips, spacing) });
  }
}

function applyEnds(bones: Bone[], ends: readonly SplitTreeTrunkEnd[], height: number): void {
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  const hasChild = new Set(bones.map((bone) => bone.parentId).filter((id): id is string => id != null));
  for (const end of ends) {
    const bone = byId.get(end.id);
    if (!bone || bone.id === "t0") continue;
    const minStep = Math.max((height - bone.from) * 0.02, 1e-3);
    const cap = hasChild.has(bone.id) ? height - minStep : height;
    if (!(end.to > bone.from) || !(cap > bone.from)) continue;
    bone.to = Math.min(Math.max(end.to, bone.from + minStep), cap);
  }
  for (const bone of bones) {
    const parent = bone.parentId ? byId.get(bone.parentId) : undefined;
    if (!parent) continue;
    bone.from = parent.to;
    bone.x0 = parent.x1;
    if (bone.to <= bone.from + EPS) bone.to = Math.min(height, bone.from + Math.max((height - bone.from) * 0.5, 1e-3));
  }
}

/** The skeleton from placed joints, parents first. */
function posedBones(pose: SplitPose): Bone[] | null {
  const ids = new Map(pose.nodes.map((node) => [node.id, node]));
  if (!ids.has("base") || !ids.has("t0")) return null;
  const rest = pose.nodes.filter((node) => node.id !== "base");
  const ordered: SplitPoseNode[] = [];
  const seen = new Set<string>(["base"]);
  for (let guard = 0; ordered.length < rest.length && guard < 48; guard += 1) {
    for (const node of rest) {
      if (seen.has(node.id) || !node.parentId || !seen.has(node.parentId)) continue;
      ordered.push(node);
      seen.add(node.id);
    }
  }
  if (ordered.length !== rest.length || ordered.length < 2) return null;
  const bones: Bone[] = [];
  for (const node of ordered) {
    const parent = ids.get(node.parentId!)!;
    if (!(Math.hypot(node.x - parent.x, node.y - parent.y) > 1e-3)) return null;
    bones.push({
      id: node.id,
      parentId: node.parentId === "base" ? null : node.parentId,
      from: parent.y,
      to: node.y,
      x0: parent.x,
      x1: node.x,
    });
  }
  return bones;
}

/**
 * The trunks, parents first, with their thickness and wrap. Null when the
 * numbers cannot make a tree. A trunk id stays put while the tip count and
 * fork depth still produce it.
 */
export function splitTreeTrunks(spec: SplitTreeSpec): SplitTrunk[] | null {
  const bones = (spec.pose ? posedBones(spec.pose) : null) ?? evenBones({ ...spec, pose: undefined });
  if (!bones || bones.length === 0) return null;
  const { aroundM, gapM } = wrapSizes(spec);
  const hasChild = new Set(bones.map((bone) => bone.parentId).filter((id): id is string => id != null));
  const done = new Map<string, SplitTrunk>();
  const trunks: SplitTrunk[] = [];
  for (const bone of bones) {
    const parent = bone.parentId ? done.get(bone.parentId) : undefined;
    const radius0 = parent ? parent.radius1 * BRANCH_THIN : aroundM / (2 * Math.PI);
    const radius1 = radius0 * (hasChild.has(bone.id) ? TAPER_FORK : TAPER_TIP);
    const woodM = toMetres(spec.units, Math.hypot(bone.x1 - bone.x0, bone.to - bone.from));
    const turns = Math.min(MAX_TURNS, Math.max(0.5, woodM / gapM));
    const phase0 = parent ? (parent.phase0 + 2 * Math.PI * parent.turns) % (2 * Math.PI) : 0;
    const partial = { ...bone, radius0, radius1, turns, phase0 };
    const trunk: SplitTrunk = {
      id: bone.id,
      parentId: bone.parentId,
      from: round(bone.from),
      to: round(bone.to),
      x0: round(bone.x0),
      x1: round(bone.x1),
      radius0: round(radius0),
      radius1: round(radius1),
      turns: round(turns),
      phase0,
      riseM: round(toMetres(spec.units, Math.abs(bone.to - bone.from))),
      woodM: round(woodM),
      lengthM: round(coilLength(partial, spec.units, 0, 1)),
    };
    done.set(trunk.id, trunk);
    trunks.push(trunk);
  }
  return trunks;
}

/** The even starting tree, as joints. Dragging or forking stores the result and the numbers follow it. */
export function defaultSplitPose(spec: SplitTreeSpec): SplitPose | null {
  const bones = evenBones({ ...spec, pose: undefined });
  if (!bones || bones.length === 0) return null;
  const root = bones[0]!;
  const nodes: SplitPoseNode[] = [{ id: "base", parentId: null, x: round(root.x0), y: round(root.from) }];
  for (const bone of bones) nodes.push({ id: bone.id, parentId: bone.parentId ?? "base", x: round(bone.x1), y: round(bone.to) });
  return { nodes };
}

type Point3 = { x: number; y: number; z: number };
type CoilShape = Bone & { radius0: number; radius1: number; turns: number; phase0: number };

function axisAt(trunk: Bone, t: number, units: LayoutUnits): { x: number; y: number } {
  return {
    x: toMetres(units, trunk.x0 + (trunk.x1 - trunk.x0) * t),
    y: toMetres(units, trunk.from + (trunk.to - trunk.from) * t),
  };
}

/**
 * A point on the coil. Angle 0 is the left edge of the trunk seen from the
 * street, a quarter turn is the front (toward the street), half is the right
 * edge, three quarters the back.
 */
function coilAt(trunk: CoilShape, t: number, units: LayoutUnits): Point3 {
  const centre = axisAt(trunk, t, units);
  const dx = toMetres(units, trunk.x1 - trunk.x0);
  const dy = toMetres(units, trunk.to - trunk.from);
  const length = Math.hypot(dx, dy) || 1;
  // Across the trunk, pointing to the right of the way it grows.
  const nx = dy / length;
  const ny = -dx / length;
  const radius = trunk.radius0 + (trunk.radius1 - trunk.radius0) * t;
  const angle = trunk.phase0 + 2 * Math.PI * trunk.turns * t;
  const across = -Math.cos(angle) * radius;
  return { x: centre.x + nx * across, y: centre.y + ny * across, z: Math.sin(angle) * radius };
}

function coilLength(trunk: CoilShape, units: LayoutUnits, t0: number, t1: number): number {
  const steps = Math.max(12, Math.ceil(trunk.turns * PER_TURN * MEASURE_STEPS * (t1 - t0)));
  let total = 0;
  let previous = coilAt(trunk, t0, units);
  for (let step = 1; step <= steps; step += 1) {
    const point = coilAt(trunk, t0 + ((t1 - t0) * step) / steps, units);
    total += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    previous = point;
  }
  return total;
}

/** A short name for the trunk list. */
export function splitTrunkLabel(trunk: SplitTrunk, trunks: readonly SplitTrunk[]): string {
  if (!trunk.parentId) return "Main trunk";
  const siblings = trunks.filter((row) => row.parentId === trunk.parentId);
  const index = siblings.findIndex((row) => row.id === trunk.id);
  const child = trunks.some((row) => row.parentId === trunk.id);
  if (siblings.length === 2) {
    const side = index === 0 ? "Left" : "Right";
    return child ? `${side} branch` : trunk.parentId === "t0" ? side : `${side} tip`;
  }
  if (siblings.length === 3 && !child) return ["Left", "Middle", "Right"][index] ?? `Trunk ${index + 1}`;
  return child ? `Branch ${index + 1}` : `Trunk ${index + 1}`;
}

/** The trunk a run belongs to: a coil piece, the run back down it, or the lead onto it. */
export function trunkIdFromEdge(edgeId: string): string | null {
  const own = /^e-(t\d+(?:\.\d+)*)(?:-(?:\d+|back(?:-\d+)?))?$/.exec(edgeId);
  if (own?.[1]) return own[1];
  const link = /^e-link-(t\d+(?:\.\d+)*)-(t\d+(?:\.\d+)*)(?:-\d+)?$/.exec(edgeId);
  return link?.[2] ?? null;
}

/** One piece of the coil: a quarter turn. */
type Quarter = { trunkId: string; edgeId: string; fromId: string; toId: string; lengthM: number; name: string };

type Piece = {
  edge: LayoutEdge;
  /** Metres of string, for lights. Zero on a dark jump. */
  lengthM: number;
  /** The trunk whose coverage this piece counts toward, for coil pieces only. */
  trunkId?: string;
};

type Plan = {
  trunks: SplitTrunk[];
  quarters: Map<string, Quarter[]>;
  corners: Map<string, LayoutCorner>;
  /** Pieces of each string, in order, with lights already set for a string set by hand. */
  runs: { id: string; pieces: Piece[] }[];
  owned: Set<string>;
  claims: Map<string, TrunkStringCover[]>;
  hops: SplitHop[];
};

function setCorner(corners: Map<string, LayoutCorner>, id: string, point: { x: number; y: number; z?: number }): void {
  const z = point.z != null ? round(point.z) : 0;
  corners.set(id, { id, x: round(point.x), y: round(point.y), ...(Math.abs(z) > EPS ? { z } : {}) });
}

function buildCoils(trunks: readonly SplitTrunk[], units: LayoutUnits, corners: Map<string, LayoutCorner>): Map<string, Quarter[]> {
  const quarters = new Map<string, Quarter[]>();
  for (const trunk of trunks) {
    const count = Math.max(2, Math.round(trunk.turns * PER_TURN));
    const label = splitTrunkLabel(trunk, trunks);
    for (let k = 0; k <= count; k += 1) setCorner(corners, `c-${trunk.id}-w${k}`, coilAt(trunk, k / count, units));
    const rows: Quarter[] = [];
    for (let k = 0; k < count; k += 1) {
      const wrap = Math.floor(k / PER_TURN) + 1;
      const named = k === 0 ? label : `${label} wrap ${wrap}`;
      rows.push({
        trunkId: trunk.id,
        edgeId: k === 0 ? `e-${trunk.id}` : `e-${trunk.id}-${k + 1}`,
        fromId: `c-${trunk.id}-w${k}`,
        toId: `c-${trunk.id}-w${k + 1}`,
        lengthM: round(Math.max(1e-6, coilLength(trunk, units, k / count, (k + 1) / count))),
        name: named.length > 40 ? label : named,
      });
    }
    quarters.set(trunk.id, rows);
  }
  return quarters;
}

/** Joints on the centre line, for the editor's handles. Not on any run. */
function putJoints(trunks: readonly SplitTrunk[], units: LayoutUnits, corners: Map<string, LayoutCorner>): void {
  for (const trunk of trunks) {
    const startId = trunk.parentId ? `c-${trunk.parentId}` : "c-base";
    if (!corners.has(startId)) setCorner(corners, startId, axisAt(trunk, 0, units));
    setCorner(corners, `c-${trunk.id}`, axisAt(trunk, 1, units));
  }
}

/** Where a string reaches the bottom of a trunk, coming down its back. */
function backCorner(trunk: SplitTrunk, units: LayoutUnits, corners: Map<string, LayoutCorner>): string {
  const id = `c-${trunk.id}-back`;
  if (!corners.has(id)) setCorner(corners, id, { ...axisAt(trunk, 0, units), z: -trunk.radius0 });
  return id;
}

function ancestors(trunk: SplitTrunk, byId: Map<string, SplitTrunk>): SplitTrunk[] {
  const chain: SplitTrunk[] = [];
  for (let cursor: SplitTrunk | undefined = trunk; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) chain.push(cursor);
  return chain;
}

/** Trunks in the order one string would wrap them: each trunk, then its branches left to right. */
export function splitWalkOrder(trunks: readonly SplitTrunk[]): string[] {
  const order: string[] = [];
  const visit = (id: string) => {
    order.push(id);
    trunks.filter((row) => row.parentId === id).sort((a, b) => a.x1 - b.x1).forEach((child) => visit(child.id));
  };
  const root = trunks.find((trunk) => !trunk.parentId);
  if (root) visit(root.id);
  return order;
}

function distance(corners: Map<string, LayoutCorner>, fromId: string, toId: string): number {
  const a = corners.get(fromId);
  const b = corners.get(toId);
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
}

function prepare(spec: SplitTreeSpec): Plan | null {
  const trunks = splitTreeTrunks(spec);
  if (!trunks) return null;
  const corners = new Map<string, LayoutCorner>();
  putJoints(trunks, spec.units, corners);
  const quarters = buildCoils(trunks, spec.units, corners);
  const byId = new Map(trunks.map((trunk) => [trunk.id, trunk]));
  const owned = new Set<string>();
  const usedIds = new Set<string>();
  const claims = new Map<string, TrunkStringCover[]>();
  const hops: SplitHop[] = [];
  const runs: Plan["runs"] = [];
  const freshId = (base: string) => {
    let id = base;
    for (let n = 2; usedIds.has(id); n += 1) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };

  const explicit = (spec.strings ?? []).length > 0;
  const strings: SplitTreeString[] = explicit
    ? [...(spec.strings ?? [])]
    : [{ id: SPLIT_WALK_ID, ledProductId: null, pitchMm: 0, ledCount: null, trunkIds: splitWalkOrder(trunks) }];

  for (const string of strings) {
    const path = string.trunkIds.filter((id, index) => byId.has(id) && string.trunkIds.indexOf(id) === index);
    if (path.length === 0) continue;
    const pitchM = string.pitchMm / 1000;
    // Lights are only set per piece for a string with its own spacing. The walk uses the prop's spacing.
    let left = explicit && string.ledCount != null ? string.ledCount : Infinity;
    let along = 0;
    const pieces: Piece[] = [];
    const lightsFor = (lengthM: number): number | undefined => {
      if (!explicit || !(pitchM > 0)) return undefined;
      const lights = Math.min(left, Math.max(0, Math.round((along + lengthM) / pitchM) - Math.round(along / pitchM)));
      left -= lights;
      return lights;
    };
    const lit = (id: string, fromId: string, toId: string, name: string, lengthM: number, trunkId?: string) => {
      const lights = lightsFor(lengthM);
      along += lengthM;
      pieces.push({
        edge: { id, from: fromId, to: toId, kind: "lit", name, wrapLengthM: round(Math.max(1e-6, lengthM)), ...(lights != null ? { lockedLights: lights } : {}) },
        lengthM,
        ...(trunkId ? { trunkId } : {}),
      });
    };
    const wire = (id: string, fromId: string, toId: string) => {
      pieces.push({ edge: { id, from: fromId, to: toId, kind: "wire", name: "Dark jump" }, lengthM: 0 });
    };
    const out = () => left <= 0;

    let cursor: string | null = null;
    let previous: SplitTrunk | null = null;
    let finished = false;
    for (let index = 0; index < path.length; index += 1) {
      const trunk = byId.get(path[index]!)!;
      const rows = (quarters.get(trunk.id) ?? []).filter((row) => !owned.has(row.edgeId));
      const first = rows[0];
      if (cursor && previous && first) {
        const label = splitTrunkLabel(trunk, trunks);
        if (!finished) {
          hops.push({ stringId: string.id, fromId: previous.id, toId: trunk.id, dark: true, back: false });
          wire(freshId(`w-${string.id}-${index}`), cursor, first.fromId);
        } else if (trunk.parentId === previous.id) {
          hops.push({ stringId: string.id, fromId: previous.id, toId: trunk.id, dark: false, back: false });
          lit(freshId(`e-link-${previous.id}-${trunk.id}`), cursor, first.fromId, `Onto ${label}`.slice(0, 40), distance(corners, cursor, first.fromId));
        } else {
          // Run back down the back of each trunk until the fork the next one grows from.
          const chain = ancestors(previous, byId);
          const stop = chain.findIndex((row) => row.id === trunk.parentId);
          if (stop <= 0) {
            hops.push({ stringId: string.id, fromId: previous.id, toId: trunk.id, dark: true, back: false });
            wire(freshId(`w-${string.id}-${index}`), cursor, first.fromId);
          } else {
            hops.push({ stringId: string.id, fromId: previous.id, toId: trunk.id, dark: false, back: true });
            for (const down of chain.slice(0, stop)) {
              if (out()) break;
              const bottom = backCorner(down, spec.units, corners);
              lit(freshId(`e-${down.id}-back`), cursor, bottom, "Back down", distance(corners, cursor, bottom));
              cursor = bottom;
            }
            if (!out()) lit(freshId(`e-link-${chain[stop - 1]!.id}-${trunk.id}`), cursor, first.fromId, `Onto ${label}`.slice(0, 40), distance(corners, cursor, first.fromId));
          }
        }
      }
      if (out() || rows.length === 0) {
        // Used up, or another string already covers this trunk: nothing of this string lands here.
        pushClaim(claims, trunk.id, { stringId: string.id, coveredM: 0, lights: 0, remainingM: remainingM(string, left, pitchM) });
        continue;
      }
      let lights = 0;
      let covered = 0;
      for (const row of rows) {
        if (out()) break;
        owned.add(row.edgeId);
        usedIds.add(row.edgeId);
        lit(row.edgeId, row.fromId, row.toId, row.name, row.lengthM, trunk.id);
        const placed = pieces[pieces.length - 1]!.edge.lockedLights;
        lights += placed ?? 0;
        covered += row.lengthM;
        cursor = row.toId;
      }
      const all = quarters.get(trunk.id) ?? [];
      finished = cursor === all[all.length - 1]?.toId;
      pushClaim(claims, trunk.id, {
        stringId: string.id,
        coveredM: round(explicit && pitchM > 0 ? lights * pitchM : covered),
        lights,
        remainingM: remainingM(string, left, pitchM),
      });
      previous = trunk;
    }
    if (pieces.length > 0) runs.push({ id: string.id, pieces });
  }
  return { trunks, quarters, corners, runs, owned, claims, hops };
}

function remainingM(string: SplitTreeString, left: number, pitchM: number): number | null {
  if (string.ledCount == null || !Number.isFinite(left) || !(pitchM > 0)) return null;
  return round(Math.max(0, left) * pitchM);
}

function pushClaim(claims: Map<string, TrunkStringCover[]>, trunkId: string, row: TrunkStringCover): void {
  const list = claims.get(trunkId) ?? [];
  const index = list.findIndex((have) => have.stringId === row.stringId);
  if (index >= 0) {
    const have = list[index]!;
    list[index] = { stringId: row.stringId, coveredM: round(have.coveredM + row.coveredM), lights: have.lights + row.lights, remainingM: row.remainingM };
  } else list.push(row);
  claims.set(trunkId, list);
}

/**
 * How much of each trunk the strings cover, and which hops are dark or run back down.
 * Strings are used in list order. A string that names two trunks wraps the first before the second.
 */
export function splitTreeCoverage(spec: SplitTreeSpec): { trunks: SplitTrunk[]; cover: TrunkCover[]; hops: SplitHop[] } | null {
  const plan = prepare(spec);
  if (!plan) return null;
  const cover = plan.trunks.map((trunk) => {
    const rows = plan.quarters.get(trunk.id) ?? [];
    const openM = round(rows.filter((row) => !plan.owned.has(row.edgeId)).reduce((sum, row) => sum + row.lengthM, 0));
    const strings = (plan.claims.get(trunk.id) ?? []).filter((row) => row.stringId !== SPLIT_WALK_ID);
    return { trunkId: trunk.id, lengthM: trunk.lengthM, coveredM: round(Math.max(0, trunk.lengthM - openM)), openM, strings };
  });
  return { trunks: plan.trunks, cover, hops: plan.hops.filter((hop) => hop.stringId !== SPLIT_WALK_ID) };
}

/** The drawing: a tapered body per trunk, the coil round each one, and the runs back down where a string continues. */
export function splitTreeLayout(spec: SplitTreeSpec & { pitchM: number }): PropLayout | null {
  const plan = prepare(spec);
  if (!plan || !(spec.pitchM > 0)) return null;
  const strings: LayoutString[] = plan.runs.map((run) => ({ id: run.id, startId: run.pieces[0]!.edge.from, run: run.pieces.map((piece) => piece.edge) }));
  // Coil no string reaches: its own loose run, so it still shows and can be put in a section.
  for (const trunk of plan.trunks) {
    const loose = (plan.quarters.get(trunk.id) ?? []).filter((row) => !plan.owned.has(row.edgeId));
    if (loose.length === 0) continue;
    strings.push({
      id: `sk-${trunk.id}`,
      startId: loose[0]!.fromId,
      run: loose.map((row) => ({ id: row.edgeId, from: row.fromId, to: row.toId, kind: "lit" as const, name: row.name, wrapLengthM: row.lengthM })),
    });
  }
  if (strings.length === 0) return null;
  const bodies: LayoutBody[] = plan.trunks.map((trunk) => {
    const start = axisAt(trunk, 0, spec.units);
    const end = axisAt(trunk, 1, spec.units);
    return { id: trunk.id, x0: round(start.x), y0: round(start.y), x1: round(end.x), y1: round(end.y), r0: round(trunk.radius0 * BODY), r1: round(trunk.radius1 * BODY) };
  });
  const { aroundM, gapM } = wrapSizes(spec);
  const per = toMetres(spec.units, 1);
  const params: Record<string, number> = {
    height: spec.height,
    split: spec.split,
    spacing: spec.spacing,
    trunks: Math.round(spec.trunks),
    levels: spec.levels === 2 ? 2 : 1,
    around: round(aroundM / per),
    gap: round(gapM / per),
  };
  const layout: PropLayout = {
    source: "template",
    template: { type: "split-tree", params },
    units: spec.units,
    pitchM: spec.pitchM,
    startOffsetM: 0,
    corners: [...plan.corners.values()],
    run: strings[0]!.run,
    strings,
    bodies,
  };
  return assignStableRunIds(layout);
}

const SECTION_COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

function genericName(name: string | undefined): boolean {
  return !name || name === "Back down" || name.startsWith("Onto ") || name.includes(" wrap ");
}

/**
 * One section per trunk, kept when a rebuild splits that trunk into new
 * pieces. A run with no section yet joins its trunk's. A run back down a
 * trunk stays with that trunk; the lead onto a branch joins the branch.
 */
export function groupSplitTreeSections(layout: PropLayout, sections: readonly PropSection[]): PropSection[] {
  const lit = (layout.strings ?? []).flatMap((string) => string.run).filter((edge) => edge.kind === "lit");
  const present = new Set(lit.map((edge) => edge.id));
  const next: PropSection[] = sections.map((section) => ({ ...section, edgeIds: section.edgeIds.filter((id) => present.has(id)) }));
  for (const edge of lit) {
    const trunk = trunkIdFromEdge(edge.id);
    if (!trunk) continue;
    let index = next.findIndex((section) => (
      section.id === `section.${trunk}` || section.edgeIds.includes(`e-${trunk}`) || section.edgeIds.includes(edge.id)
    ));
    const generic = genericName(edge.name);
    if (index < 0) {
      next.push({
        id: `section.${trunk}`,
        name: generic ? "Trunk" : edge.name!,
        edgeIds: [],
        pinnedRanges: [],
        color: SECTION_COLOURS[next.length % SECTION_COLOURS.length],
      });
      index = next.length - 1;
    } else if (next[index]!.name === "Trunk" && !generic) {
      next[index] = { ...next[index]!, name: edge.name! };
    }
    const section = next[index]!;
    if (!section.edgeIds.includes(edge.id)) section.edgeIds.push(edge.id);
    for (let other = 0; other < next.length; other += 1) {
      if (other === index) continue;
      const row = next[other]!;
      if (row.edgeIds.includes(edge.id)) next[other] = { ...row, edgeIds: row.edgeIds.filter((id) => id !== edge.id) };
    }
  }
  return next.filter((section) => section.edgeIds.length > 0);
}
