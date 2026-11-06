/**
 * A split tree is a trunk that forks, drawn front-on (spread left to right,
 * height up). The skeleton is a tree of trunk segments, not one polyline.
 * Each segment has a thickness and a wrap: a linear string coiled up the
 * trunk, the same idea as a spiral around one post. A string cannot teleport
 * to a sibling. After it finishes a trunk it takes a back path down the far
 * side, then up the next trunk. A hop that does not meet by walking the
 * tree is a dark run (`kind: "wire"`).
 *
 * Length stored on a run is the string length along that piece. Trunk
 * heights, split height and tip spacing stay in the prop's unit. A string's
 * spacing stays in millimetres; leftover string length is metres.
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
  movePoseMeet,
  movePoseTurn,
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
  movePoseMeet,
  movePoseTurn,
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
  /** Prop units. Wider at the root, narrower at a tip. */
  radius0: number;
  radius1: number;
  /** Whole turns of the wrap that climbs this trunk. */
  turns: number;
  /** Metres of string to coil up the trunk. */
  lengthM: number;
  /** Metres along the wood, tip to root. */
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
  trunkTo?: readonly SplitTreeTrunkEnd[];
  strings?: readonly SplitTreeString[];
  /** Placed joints and wrap junctions. Absent while the tree is still the even starting shape. */
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
  /** The string goes back down the far side before the next trunk. */
  back: boolean;
};

type Half = {
  trunkId: string;
  index: number;
  edgeId: string;
  fromId: string;
  toId: string;
  wrapLengthM: number;
  name: string;
};

type Piece =
  | { kind: "half"; half: Half; lights: number }
  | { kind: "back"; edgeId: string; trunkId: string; fromId: string; toId: string; wrapLengthM: number; lights: number }
  | { kind: "link"; edgeId: string; fromId: string; toId: string; name: string; wrapLengthM: number; lights: number }
  | { kind: "wire"; edgeId: string; fromId: string; toId: string };

const EPS = 1e-6;
/** Body radius over the coil, so a rim of trunk shows around the lights. */
const BODY = 1.12;
/** Back path sits well outside the trunk, so the return reads beside the wrap. */
const BACK = 2.4;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function toMetres(units: LayoutUnits, value: number): number {
  return value * (units === "ft" ? METRES_PER_FOOT : 1);
}

function tipX(index: number, tips: number, spacing: number): number {
  return (index - (tips - 1) / 2) * spacing;
}

function forkX(start: number, count: number, tips: number, spacing: number): number {
  const first = tipX(start, tips, spacing);
  const last = tipX(start + count - 1, tips, spacing);
  return (first + last) / 2;
}

function baseRadius(height: number, spacing: number): number {
  return Math.min(height * 0.09, spacing * 0.22);
}

function turnsFor(wood: number, radius: number): number {
  const gap = Math.max(radius * 1.2, wood / 6);
  return Math.min(6, Math.max(3, Math.round(wood / gap)));
}

/**
 * The trunks, parents first. Null when the numbers cannot make a tree.
 * A trunk id stays put when the tip count and the fork depth still produce it.
 */
export function splitTreeTrunks(spec: SplitTreeSpec): SplitTrunk[] | null {
  if (spec.pose) {
    const placed = trunksFromPose(spec);
    if (placed) return placed;
  }
  const tips = Math.round(spec.trunks);
  const { height, split, spacing, units } = spec;
  if (!Number.isInteger(tips) || tips < SPLIT_TREE_TRUNKS_MIN || tips > SPLIT_TREE_TRUNKS_MAX) return null;
  if (!(height > 0) || !(split > 0) || !(spacing > 0) || split >= height - EPS) return null;
  const levels: SplitTreeLevels = spec.levels === 2 && tips >= 3 ? 2 : 1;
  const nodes: Omit<SplitTrunk, "lengthM" | "riseM" | "woodM" | "radius0" | "radius1" | "turns">[] = [
    { id: "t0", parentId: null, from: 0, to: split, x0: 0, x1: 0 },
  ];
  if (levels === 1) {
    for (let index = 0; index < tips; index += 1) {
      nodes.push({
        id: `t0.${index}`,
        parentId: "t0",
        from: split,
        to: height,
        x0: 0,
        x1: tipX(index, tips, spacing),
      });
    }
  } else {
    const left = Math.ceil(tips / 2);
    const right = tips - left;
    const second = split + (height - split) / 2;
    addSide(nodes, "t0.0", 0, left, second, tips, spacing, split, height);
    addSide(nodes, "t0.1", left, right, second, tips, spacing, split, height);
  }
  applyEnds(nodes, spec.trunkTo ?? [], height);
  const root = baseRadius(height, spacing);
  const kept = nodes.filter((node) => node.to > node.from + EPS);
  const hasChild = new Set(kept.map((node) => node.parentId).filter((id): id is string => id != null));
  return kept.map((node) => {
    const wood = Math.hypot(node.x1 - node.x0, node.to - node.from);
    const depth = node.id.split(".").length - 1;
    const radius0 = root * 0.55 ** depth;
    const radius1 = radius0 * (hasChild.has(node.id) ? 0.75 : 0.48);
    const turns = turnsFor(wood, radius0);
    const rise = toMetres(units, node.to - node.from);
    const woodM = toMetres(units, wood);
    const lengthM = helixLength(node, radius0, radius1, turns, units);
    return {
      ...node,
      from: round(node.from),
      to: round(node.to),
      x0: round(node.x0),
      x1: round(node.x1),
      radius0: round(radius0),
      radius1: round(radius1),
      turns,
      riseM: round(rise),
      woodM: round(woodM),
      lengthM: round(lengthM),
    };
  });
}

function addSide(
  nodes: Omit<SplitTrunk, "lengthM" | "riseM" | "woodM" | "radius0" | "radius1" | "turns">[],
  id: string,
  tipStart: number,
  count: number,
  second: number,
  tips: number,
  spacing: number,
  split: number,
  height: number,
): void {
  const x1 = count === 1 ? tipX(tipStart, tips, spacing) : forkX(tipStart, count, tips, spacing);
  const forks = count > 1;
  nodes.push({ id, parentId: "t0", from: split, to: forks ? second : height, x0: 0, x1 });
  if (!forks) return;
  for (let index = 0; index < count; index += 1) {
    nodes.push({
      id: `${id}.${index}`,
      parentId: id,
      from: second,
      to: height,
      x0: x1,
      x1: tipX(tipStart + index, tips, spacing),
    });
  }
}

function applyEnds(
  nodes: { id: string; parentId: string | null; from: number; to: number; x0: number; x1: number }[],
  ends: readonly SplitTreeTrunkEnd[],
  height: number,
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const hasChild = new Set(nodes.map((node) => node.parentId).filter((id): id is string => id != null));
  for (const end of ends) {
    const node = byId.get(end.id);
    if (!node || node.id === "t0") continue;
    const minStep = Math.max((height - node.from) * 0.02, 1e-3);
    const cap = hasChild.has(node.id) ? height - minStep : height;
    if (!(end.to > node.from) || !(cap > node.from)) continue;
    node.to = Math.min(Math.max(end.to, node.from + minStep), cap);
  }
  for (const node of nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent) continue;
    node.from = parent.to;
    node.x0 = parent.x1;
    if (node.to <= node.from + EPS) node.to = Math.min(height, node.from + Math.max((height - node.from) * 0.5, 1e-3));
  }
}

type Axis = { x: number; y: number };
type Sample = Axis & { z: number };

function axisAt(trunk: SplitTrunk, t: number, units: LayoutUnits): Axis {
  return {
    x: toMetres(units, trunk.x0 + (trunk.x1 - trunk.x0) * t),
    y: toMetres(units, trunk.from + (trunk.to - trunk.from) * t),
  };
}

/** Screen perpendicular that points away from the centre line, so the coil crosses the trunk. */
function outward(trunk: SplitTrunk, units: LayoutUnits): { px: number; py: number; length: number } {
  const a = axisAt(trunk, 0, units);
  const b = axisAt(trunk, 1, units);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1e-6;
  let px = -dy / length;
  let py = dx / length;
  const side = Math.sign(trunk.x0 + trunk.x1) || 1;
  if (px * side < 0) {
    px = -px;
    py = -py;
  }
  return { px, py, length };
}

function radiusAt(trunk: SplitTrunk, t: number, units: LayoutUnits): number {
  return toMetres(units, trunk.radius0 + (trunk.radius1 - trunk.radius0) * t);
}

function helixAt(trunk: SplitTrunk, t: number, units: LayoutUnits): Sample {
  const center = axisAt(trunk, t, units);
  const frame = outward(trunk, units);
  const radius = radiusAt(trunk, t, units);
  const angle = 2 * Math.PI * trunk.turns * t;
  const across = Math.cos(angle);
  return {
    x: center.x + frame.px * radius * across,
    y: center.y + frame.py * radius * across,
    z: radius * Math.sin(angle),
  };
}

function helixLength(
  node: { x0: number; x1: number; from: number; to: number; id: string; parentId: string | null },
  radius0: number,
  radius1: number,
  turns: number,
  units: LayoutUnits,
  t0 = 0,
  t1 = 1,
): number {
  const trunk = { ...node, radius0, radius1, turns, lengthM: 0, woodM: 0, riseM: 0 };
  const steps = Math.max(12, turns * 48);
  let total = 0;
  let previous = helixAt(trunk, t0, units);
  for (let step = 1; step <= steps; step += 1) {
    const point = helixAt(trunk, t0 + (t1 - t0) * (step / steps), units);
    total += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    previous = point;
  }
  return total;
}

/** Keep the coil on the wood and stop it short of a fork, so the wraps do not pile up there. */
function coilSpan(trunk: { x0: number; x1: number; from: number; to: number; radius0: number; radius1: number; parentId: string | null }, hasChild: boolean): { t0: number; t1: number } {
  const wood = Math.hypot(trunk.x1 - trunk.x0, trunk.to - trunk.from) || 1e-6;
  const radius = Math.max(trunk.radius0, trunk.radius1, 1e-3);
  const dt = Math.min(0.42, (radius * 1.75) / wood);
  const t0 = trunk.parentId ? Math.min(0.42, dt) : 0;
  const t1 = hasChild ? Math.max(t0 + 0.28, 1 - dt) : 1;
  return { t0, t1 };
}

function meetCornerId(forkId: string): string {
  return `c-meet-${forkId}`;
}

/** Where the wraps join at a fork, in metres. A placed meet wins; otherwise it sits off the wood. */
export function splitMeetPoint(trunk: SplitTrunk, spec: SplitTreeSpec): { x: number; y: number } {
  const joint = axisAt(trunk, 1, spec.units);
  const placed = spec.pose?.meets.find((meet) => meet.forkId === trunk.id);
  if (placed) {
    return {
      x: round(joint.x + toMetres(spec.units, placed.x)),
      y: round(joint.y + toMetres(spec.units, placed.y)),
    };
  }
  const frame = outward(trunk, spec.units);
  const radius = radiusAt(trunk, 1, spec.units);
  return {
    x: round(joint.x + frame.px * radius * 2.2),
    y: round(joint.y + frame.py * radius * 2.2),
  };
}

/**
 * The even starting tree, as joints. Dragging, forking, or placing a meet
 * stores the result and the numbers follow it.
 */
export function defaultSplitPose(spec: SplitTreeSpec): SplitPose | null {
  const trunks = splitTreeTrunks({ ...spec, pose: undefined });
  if (!trunks || trunks.length === 0) return null;
  const root = trunks[0]!;
  const nodes: SplitPoseNode[] = [{ id: "base", parentId: null, x: round(root.x0), y: round(root.from) }];
  for (const trunk of trunks) {
    nodes.push({ id: trunk.id, parentId: trunk.parentId ?? "base", x: round(trunk.x1), y: round(trunk.to) });
  }
  return { nodes, meets: [], turns: [] };
}

function trunksFromPose(spec: SplitTreeSpec): SplitTrunk[] | null {
  const pose = spec.pose;
  if (!pose) return null;
  const ids = new Map(pose.nodes.map((node) => [node.id, node]));
  if (!ids.has("base") || !ids.has("t0")) return null;
  const ordered: SplitPoseNode[] = [];
  const seen = new Set<string>(["base"]);
  const rest = pose.nodes.filter((node) => node.id !== "base");
  let guard = 0;
  while (ordered.length < rest.length && guard < 48) {
    guard += 1;
    for (const node of rest) {
      if (seen.has(node.id) || !node.parentId || !seen.has(node.parentId)) continue;
      ordered.push(node);
      seen.add(node.id);
    }
  }
  if (ordered.length !== rest.length || ordered.length < 2) return null;
  const root = baseRadius(spec.height, spec.spacing);
  const hasChild = new Set(ordered.map((node) => node.parentId).filter((id): id is string => id != null && id !== "base"));
  const trunks: SplitTrunk[] = [];
  for (const node of ordered) {
    const parent = ids.get(node.parentId!);
    if (!parent) return null;
    const wood = Math.hypot(node.x - parent.x, node.y - parent.y);
    if (!(wood > 1e-3)) return null;
    const depth = node.id.split(".").length - 1;
    const radius0 = root * 0.55 ** depth;
    const radius1 = radius0 * (hasChild.has(node.id) ? 0.75 : 0.48);
    const turns = turnsFor(wood, radius0);
    const partial = {
      id: node.id,
      parentId: node.parentId === "base" ? null : node.parentId,
      from: parent.y,
      to: node.y,
      x0: parent.x,
      x1: node.x,
    };
    const span = coilSpan({ ...partial, radius0, radius1 }, hasChild.has(node.id));
    const lengthM = helixLength(partial, radius0, radius1, turns, spec.units, span.t0, span.t1);
    trunks.push({
      id: node.id,
      parentId: partial.parentId,
      from: round(parent.y),
      to: round(node.y),
      x0: round(parent.x),
      x1: round(node.x),
      radius0: round(radius0),
      radius1: round(radius1),
      turns,
      riseM: round(toMetres(spec.units, Math.abs(node.y - parent.y))),
      woodM: round(toMetres(spec.units, wood)),
      lengthM: round(lengthM),
    });
  }
  return trunks;
}

function helixStops(trunk: SplitTrunk, units: LayoutUnits, t0: number, t1: number): { t: number; at: number }[] {
  const halves = trunk.turns * 2;
  const steps = Math.max(24, trunk.turns * 64);
  const cum: number[] = [0];
  let previous = helixAt(trunk, t0, units);
  for (let step = 1; step <= steps; step += 1) {
    const point = helixAt(trunk, t0 + (t1 - t0) * (step / steps), units);
    cum.push(cum[cum.length - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z));
    previous = point;
  }
  const stops: { t: number; at: number }[] = [];
  for (let k = 0; k <= halves; k += 1) {
    const index = Math.round((k / halves) * steps);
    stops.push({ t: t0 + (t1 - t0) * (k / halves), at: cum[index] ?? 0 });
  }
  return stops;
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

export function trunkIdFromEdge(edgeId: string): string | null {
  const wrap = /^e-(t\d+(?:\.\d+)*)(?:-(?:\d+|back|meet|in))?$/.exec(edgeId);
  if (wrap?.[1]) return wrap[1];
  const link = /^e-link-(t\d+(?:\.\d+)*)-(t\d+(?:\.\d+)*)(?:-in)?$/.exec(edgeId);
  return link?.[2] ?? null;
}

type Remain = { metres: number; lights: number } | null;

function remainOf(string: SplitTreeString): Remain {
  if (string.ledCount == null || !(string.pitchMm > 0)) return null;
  return { metres: (string.ledCount * string.pitchMm) / 1000, lights: string.ledCount };
}

function ancestors(trunk: SplitTrunk, byId: Map<string, SplitTrunk>): SplitTrunk[] {
  const chain: SplitTrunk[] = [];
  let cursor: SplitTrunk | undefined = trunk;
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}

function lowestCommon(a: SplitTrunk, b: SplitTrunk, byId: Map<string, SplitTrunk>): SplitTrunk {
  const seen = new Set(ancestors(a, byId).map((trunk) => trunk.id));
  for (const trunk of ancestors(b, byId)) if (seen.has(trunk.id)) return trunk;
  return byId.get("t0") ?? a;
}

function descent(from: SplitTrunk, ancestorId: string, byId: Map<string, SplitTrunk>): SplitTrunk[] {
  const path: SplitTrunk[] = [];
  let cursor: SplitTrunk | undefined = from;
  while (cursor && cursor.id !== ancestorId) {
    path.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

type Plan = {
  trunks: SplitTrunk[];
  halves: Map<string, Half[]>;
  corners: Map<string, LayoutCorner>;
  pieces: Map<string, Piece[]>;
  claims: Map<string, TrunkStringCover[]>;
  hops: SplitHop[];
  units: LayoutUnits;
};

function buildHalves(trunks: readonly SplitTrunk[], units: LayoutUnits, corners: Map<string, LayoutCorner>): Map<string, Half[]> {
  const halves = new Map<string, Half[]>();
  const hasChild = new Set(trunks.map((trunk) => trunk.parentId).filter((id): id is string => id != null));
  for (const trunk of trunks) {
    const span = coilSpan(trunk, hasChild.has(trunk.id));
    const stops = helixStops(trunk, units, span.t0, span.t1);
    const label = splitTrunkLabel(trunk, trunks);
    stops.forEach((stop, index) => {
      const id = `c-${trunk.id}-w${index}`;
      const point = helixAt(trunk, stop.t, units);
      corners.set(id, { id, x: round(point.x), y: round(point.y) });
    });
    const rows: Half[] = [];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const wrap = Math.floor(index / 2) + 1;
      const side = index % 2 === 0 ? "front" : "far";
      const named = index === 0 ? label : `${label} wrap ${wrap} ${side}`;
      rows.push({
        trunkId: trunk.id,
        index,
        edgeId: index === 0 ? `e-${trunk.id}` : `e-${trunk.id}-${index + 1}`,
        fromId: `c-${trunk.id}-w${index}`,
        toId: `c-${trunk.id}-w${index + 1}`,
        wrapLengthM: round(Math.max(1e-6, stops[index + 1]!.at - stops[index]!.at)),
        name: named.length > 40 ? label : named,
      });
    }
    halves.set(trunk.id, rows);
  }
  return halves;
}

function putAxis(trunks: readonly SplitTrunk[], units: LayoutUnits, corners: Map<string, LayoutCorner>): void {
  for (const trunk of trunks) {
    const start = axisAt(trunk, 0, units);
    const end = axisAt(trunk, 1, units);
    const startId = trunk.parentId ? `c-${trunk.parentId}` : "c-base";
    if (!corners.has(startId)) corners.set(startId, { id: startId, x: round(start.x), y: round(start.y) });
    const endId = `c-${trunk.id}`;
    corners.set(endId, { id: endId, x: round(end.x), y: round(end.y) });
  }
}

function kneePoint(trunk: SplitTrunk, fork: SplitTrunk | undefined, spec: SplitTreeSpec, stringId: string, toId: string): Axis {
  const placed = spec.pose?.turns.find((turn) => turn.stringId === stringId && turn.fromId === trunk.id && turn.toId === toId);
  if (placed) {
    const anchor = fork ?? trunk;
    const joint = axisAt(anchor, fork ? 1 : 0, spec.units);
    return {
      x: round(joint.x + toMetres(spec.units, placed.x)),
      y: round(joint.y + toMetres(spec.units, placed.y)),
    };
  }
  return sidePoint(trunk, 0, BACK, spec.units);
}

function sidePoint(trunk: SplitTrunk, t: number, scale: number, units: LayoutUnits): Axis {
  const center = axisAt(trunk, t, units);
  const frame = outward(trunk, units);
  const radius = radiusAt(trunk, t, units) * scale;
  return { x: round(center.x + frame.px * radius), y: round(center.y + frame.py * radius) };
}

/**
 * How much of each trunk the strings cover, and which hops are dark or a back path.
 * Strings are used in list order. One string that names two trunks uses the first before the second.
 */
export function splitTreeCoverage(spec: SplitTreeSpec): { trunks: SplitTrunk[]; cover: TrunkCover[]; hops: SplitHop[] } | null {
  const plan = prepare(spec);
  if (!plan) return null;
  return { trunks: plan.trunks, cover: coverOf(plan), hops: plan.hops };
}

function coverOf(plan: Plan): TrunkCover[] {
  return plan.trunks.map((trunk) => {
    const halves = plan.halves.get(trunk.id) ?? [];
    const openM = round(halves.filter((half) => !halfOwned(plan, half.edgeId)).reduce((sum, half) => sum + half.wrapLengthM, 0));
    const strings = plan.claims.get(trunk.id) ?? [];
    const coveredM = round(Math.max(0, trunk.lengthM - openM));
    return { trunkId: trunk.id, lengthM: trunk.lengthM, coveredM, openM, strings };
  });
}

function halfOwned(plan: Plan, edgeId: string): boolean {
  for (const pieces of plan.pieces.values()) {
    if (pieces.some((piece) => piece.kind === "half" && piece.half.edgeId === edgeId)) return true;
  }
  return false;
}

function prepare(spec: SplitTreeSpec): Plan | null {
  const trunks = splitTreeTrunks(spec);
  if (!trunks) return null;
  const corners = new Map<string, LayoutCorner>();
  putAxis(trunks, spec.units, corners);
  const halves = buildHalves(trunks, spec.units, corners);
  for (const trunk of trunks) {
    if (!trunks.some((row) => row.parentId === trunk.id)) continue;
    const meet = splitMeetPoint(trunk, spec);
    const id = meetCornerId(trunk.id);
    corners.set(id, { id, x: meet.x, y: meet.y });
  }
  const byId = new Map(trunks.map((trunk) => [trunk.id, trunk]));
  const pieces = new Map<string, Piece[]>();
  const claims = new Map<string, TrunkStringCover[]>();
  const hops: SplitHop[] = [];
  const owned = new Set<string>();
  const leadUsed = new Set<string>();
  for (const string of spec.strings ?? []) {
    const path = string.trunkIds.filter((id, index) => byId.has(id) && string.trunkIds.indexOf(id) === index);
    if (path.length === 0) continue;
    const remain = remainOf(string);
    if (!remain) {
      for (const trunkId of path) pushClaim(claims, trunkId, { stringId: string.id, coveredM: 0, lights: 0, remainingM: null });
      continue;
    }
    const run: Piece[] = [];
    const pitchM = string.pitchMm / 1000;
    const spend = (lengthM: number): number => {
      if (remain.lights <= 0 || !(lengthM > 0)) return 0;
      const capacity = Math.max(1, Math.round(lengthM / pitchM));
      const lights = Math.min(remain.lights, capacity);
      remain.lights -= lights;
      remain.metres = round(Math.max(0, remain.metres - lights * pitchM));
      return lights;
    };
    const take = (trunkId: string): { halves: { half: Half; lights: number }[]; reached: boolean } => {
      const rows = halves.get(trunkId) ?? [];
      const taken: { half: Half; lights: number }[] = [];
      for (const half of rows) {
        if (owned.has(half.edgeId) || remain.lights <= 0) continue;
        const lights = spend(half.wrapLengthM);
        if (lights <= 0) break;
        owned.add(half.edgeId);
        taken.push({ half, lights });
      }
      const last = rows[rows.length - 1];
      return { halves: taken, reached: Boolean(last && taken.some((row) => row.half.edgeId === last.edgeId)) };
    };
    const ensure = (id: string, at: Axis) => {
      if (!corners.has(id)) corners.set(id, { id, x: at.x, y: at.y });
    };
    const link = (fromId: string, toId: string, name: string, edgeId: string) => {
      const from = corners.get(fromId);
      const to = corners.get(toId);
      if (!from || !to || fromId === toId) return;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (!(length > 1e-4)) return;
      run.push({ kind: "link", edgeId, fromId, toId, name, wrapLengthM: round(length), lights: spend(length) });
    };
    let pending: { fromId: string; wire: boolean; name: string; edgeId: string } | null = null;
    for (let index = 0; index < path.length; index += 1) {
      const trunkId = path[index]!;
      const from = byId.get(trunkId)!;
      const rows = (halves.get(trunkId) ?? []).filter((half) => !owned.has(half.edgeId));
      const first = rows[0];
      if (pending && first) {
        if (pending.wire) run.push({ kind: "wire", edgeId: pending.edgeId, fromId: pending.fromId, toId: first.fromId });
        else link(pending.fromId, first.fromId, pending.name, pending.edgeId);
      }
      pending = null;
      const taken = take(trunkId);
      const lights = taken.halves.reduce((sum, row) => sum + row.lights, 0);
      pushClaim(claims, trunkId, {
        stringId: string.id,
        coveredM: round(lights * pitchM),
        lights,
        remainingM: round(remain.metres),
      });
      for (const row of taken.halves) run.push({ kind: "half", half: row.half, lights: row.lights });
      const nextId = path[index + 1];
      if (!nextId) continue;
      const to = byId.get(nextId)!;
      const endId = run.length > 0 ? pieceEnd(run[run.length - 1]!) : null;
      if (!endId) {
        hops.push({ stringId: string.id, fromId: trunkId, toId: nextId, dark: true, back: false });
        continue;
      }
      if (!taken.reached) {
        hops.push({ stringId: string.id, fromId: trunkId, toId: nextId, dark: true, back: false });
        if (remain.lights > 0) pending = { fromId: endId, wire: true, name: "Dark jump", edgeId: `w-${string.id}-${index + 1}` };
        continue;
      }
      if (to.parentId === from.id) {
        hops.push({ stringId: string.id, fromId: trunkId, toId: nextId, dark: false, back: false });
        const meet = meetCornerId(from.id);
        if (corners.has(meet)) {
          const meetEdge = leadUsed.has(`e-${from.id}-meet`) ? `e-link-${from.id}-${to.id}` : `e-${from.id}-meet`;
          const inEdge = leadUsed.has(`e-${to.id}-in`) ? `e-link-${from.id}-${to.id}-in` : `e-${to.id}-in`;
          leadUsed.add(meetEdge);
          leadUsed.add(inEdge);
          link(endId, meet, "Onto the branch", meetEdge);
          pending = { fromId: meet, wire: false, name: "Onto the branch", edgeId: inEdge };
        } else {
          pending = { fromId: endId, wire: false, name: "Onto the branch", edgeId: `e-link-${from.id}-${to.id}` };
        }
        continue;
      }
      const shared = lowestCommon(from, to, byId);
      const down = to.parentId === shared.id ? descent(from, shared.id, byId) : [];
      if (down.length === 0) {
        hops.push({ stringId: string.id, fromId: trunkId, toId: nextId, dark: true, back: false });
        pending = { fromId: endId, wire: true, name: "Dark jump", edgeId: `w-${string.id}-${index + 1}` };
        continue;
      }
      let cursor = endId;
      down.forEach((trunk, step) => {
        const topId = `c-${trunk.id}-down-top`;
        ensure(topId, sidePoint(trunk, 1, BACK, spec.units));
        const fromName = step === 0 ? down[0]!.id : down[step - 1]!.id;
        link(cursor, topId, "Back down", `e-link-${fromName}-${trunk.id}-out`);
        const downId = `c-${trunk.id}-down`;
        const fork = trunk.parentId ? byId.get(trunk.parentId) : undefined;
        ensure(downId, kneePoint(trunk, fork, spec, string.id, nextId));
        const fromCorner = corners.get(topId);
        const toCorner = corners.get(downId);
        const length = fromCorner && toCorner ? Math.hypot(toCorner.x - fromCorner.x, toCorner.y - fromCorner.y) : trunk.woodM;
        run.push({
          kind: "back",
          edgeId: `e-${trunk.id}-back`,
          trunkId: trunk.id,
          fromId: topId,
          toId: downId,
          wrapLengthM: round(Math.max(1e-6, length)),
          lights: spend(length),
        });
        cursor = downId;
      });
      hops.push({ stringId: string.id, fromId: trunkId, toId: nextId, dark: false, back: true });
      pending = { fromId: cursor, wire: false, name: "Across the fork", edgeId: `e-link-${down[down.length - 1]!.id}-${to.id}` };
    }
    if (run.length > 0) pieces.set(string.id, run);
  }
  return { trunks, halves, corners, pieces, claims, hops, units: spec.units };
}

function pieceEnd(piece: Piece): string {
  switch (piece.kind) {
    case "half":
      return piece.half.toId;
    case "back":
    case "link":
    case "wire":
      return piece.toId;
    default: {
      const never: never = piece;
      return never;
    }
  }
}

function pushClaim(claims: Map<string, TrunkStringCover[]>, trunkId: string, row: TrunkStringCover): void {
  const list = claims.get(trunkId) ?? [];
  const index = list.findIndex((have) => have.stringId === row.stringId);
  if (index >= 0) {
    const have = list[index]!;
    list[index] = {
      stringId: row.stringId,
      coveredM: round(have.coveredM + row.coveredM),
      lights: have.lights + row.lights,
      remainingM: row.remainingM,
    };
  } else list.push(row);
  claims.set(trunkId, list);
}

/** The drawing: a thick trunk per segment, a coil up each one, and back paths where a string continues. */
export function splitTreeLayout(spec: SplitTreeSpec & { pitchM: number }): PropLayout | null {
  const plan = prepare(spec);
  if (!plan || !(spec.pitchM > 0)) return null;
  const runs = new Map<string, LayoutEdge[]>();
  const edgeFor = (piece: Piece): LayoutEdge => {
    switch (piece.kind) {
      case "half":
        return {
          id: piece.half.edgeId,
          from: piece.half.fromId,
          to: piece.half.toId,
          kind: "lit",
          name: piece.half.name,
          wrapLengthM: piece.half.wrapLengthM,
          lockedLights: piece.lights,
        };
      case "back":
        return {
          id: piece.edgeId,
          from: piece.fromId,
          to: piece.toId,
          kind: "lit",
          name: "Back down",
          wrapLengthM: piece.wrapLengthM,
          lockedLights: piece.lights,
        };
      case "link":
        return {
          id: piece.edgeId,
          from: piece.fromId,
          to: piece.toId,
          kind: "lit",
          name: piece.name,
          wrapLengthM: piece.wrapLengthM,
          lockedLights: piece.lights,
        };
      case "wire":
        return { id: piece.edgeId, from: piece.fromId, to: piece.toId, kind: "wire", name: "Dark jump" };
      default: {
        const never: never = piece;
        return never;
      }
    }
  };
  for (const [id, run] of plan.pieces) runs.set(id, run.map(edgeFor));
  for (const trunk of plan.trunks) {
    const loose = (plan.halves.get(trunk.id) ?? []).filter((half) => !halfOwned(plan, half.edgeId));
    if (loose.length === 0) continue;
    runs.set(`sk-${trunk.id}`, loose.map((half) => ({
      id: half.edgeId,
      from: half.fromId,
      to: half.toId,
      kind: "lit" as const,
      name: half.name,
      wrapLengthM: half.wrapLengthM,
    })));
  }
  const usedEdges = new Set<string>();
  for (const run of runs.values()) for (const edge of run) usedEdges.add(edge.id);
  const leadEdge = (id: string, fromId: string, toId: string): LayoutEdge | null => {
    const from = plan.corners.get(fromId);
    const to = plan.corners.get(toId);
    if (!from || !to) return null;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!(length > 1e-4)) return null;
    return { id, from: fromId, to: toId, kind: "lit", name: "Meet", wrapLengthM: round(length) };
  };
  for (const trunk of plan.trunks) {
    const halves = plan.halves.get(trunk.id) ?? [];
    const first = halves[0];
    const last = halves[halves.length - 1];
    if (!first || !last) continue;
    const incoming: LayoutEdge[] = [];
    const outgoing: LayoutEdge[] = [];
    if (trunk.parentId && !usedEdges.has(`e-${trunk.id}-in`)) {
      const lead = leadEdge(`e-${trunk.id}-in`, meetCornerId(trunk.parentId), first.fromId);
      if (lead) incoming.push(lead);
    }
    const meetId = meetCornerId(trunk.id);
    if (plan.corners.has(meetId) && !usedEdges.has(`e-${trunk.id}-meet`)) {
      const lead = leadEdge(`e-${trunk.id}-meet`, last.toId, meetId);
      if (lead) outgoing.push(lead);
    }
    if (incoming.length + outgoing.length === 0) continue;
    const key = `sk-${trunk.id}`;
    runs.set(key, [...incoming, ...(runs.get(key) ?? []), ...outgoing]);
    for (const edge of [...incoming, ...outgoing]) usedEdges.add(edge.id);
  }
  const layoutStrings: LayoutString[] = [];
  const push = (id: string) => {
    const run = runs.get(id);
    if (!run || run.length === 0) return;
    layoutStrings.push({ id, startId: run[0]!.from, run });
  };
  for (const string of spec.strings ?? []) push(string.id);
  for (const trunk of plan.trunks) push(`sk-${trunk.id}`);
  if (layoutStrings.length === 0) return null;
  const bodies: LayoutBody[] = plan.trunks.map((trunk) => {
    const start = axisAt(trunk, 0, spec.units);
    const end = axisAt(trunk, 1, spec.units);
    return {
      id: trunk.id,
      x0: round(start.x),
      y0: round(start.y),
      x1: round(end.x),
      y1: round(end.y),
      r0: round(radiusAt(trunk, 0, spec.units) * BODY),
      r1: round(radiusAt(trunk, 1, spec.units) * BODY),
    };
  });
  const params: Record<string, number> = {
    height: spec.height,
    split: spec.split,
    spacing: spec.spacing,
    trunks: Math.round(spec.trunks),
    levels: spec.levels === 2 ? 2 : 1,
  };
  const layout: PropLayout = {
    source: "template",
    template: { type: "split-tree", params },
    units: spec.units,
    pitchM: spec.pitchM,
    startOffsetM: 0,
    corners: [...plan.corners.values()],
    run: layoutStrings[0]!.run,
    strings: layoutStrings,
    bodies,
  };
  return assignStableRunIds(layout);
}

const SECTION_COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

/**
 * Keep a section on its trunk when a rebuild splits that trunk into pieces.
 * A lit run with no section yet gets the trunk's section. A back path stays
 * on the trunk it runs down.
 */
export function groupSplitTreeSections(layout: PropLayout, sections: readonly PropSection[]): PropSection[] {
  const lit = (layout.strings ?? []).flatMap((string) => string.run).filter((edge) => edge.kind === "lit");
  const present = new Set(lit.map((edge) => edge.id));
  const next: PropSection[] = sections.map((section) => ({
    ...section,
    edgeIds: section.edgeIds.filter((id) => present.has(id)),
  }));
  for (const edge of lit) {
    const trunk = trunkIdFromEdge(edge.id);
    if (!trunk) continue;
    let index = next.findIndex((section) => (
      section.id === `section.${trunk}` || section.edgeIds.includes(`e-${trunk}`) || section.edgeIds.includes(edge.id)
    ));
    const generic = edge.name === "Back down" || edge.name === "Across the fork" || edge.name === "Onto the branch" || edge.name === "Meet" || edge.name?.includes(" wrap ");
    if (index < 0) {
      next.push({
        id: `section.${trunk}`,
        name: generic ? "Trunk" : edge.name ?? "Trunk",
        edgeIds: [],
        pinnedRanges: [],
        color: SECTION_COLOURS[next.length % SECTION_COLOURS.length],
      });
      index = next.length - 1;
    } else if (next[index]!.name === "Trunk" && edge.name && !generic) {
      next[index] = { ...next[index]!, name: edge.name };
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
