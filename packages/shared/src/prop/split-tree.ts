/**
 * A split tree: one trunk that forks, drawn as a street-facing elevation
 * (trunks spread left to right, height up). Tip spacing is the distance
 * along the ground between neighbouring tips. A string keeps its own
 * spacing in millimetres. A hop from one trunk to another that does not
 * meet is a dark run.
 *
 * `wrapLengthM` on each lit run is the length of string along that piece
 * (the slant). The corners' heights are the true rise, so a later effect
 * can read height the same way a spiral's drawing keeps its real length.
 */

import {
  assignStableRunIds,
  METRES_PER_FOOT,
  type LayoutCorner,
  type LayoutEdge,
  type LayoutString,
  type LayoutUnits,
  type PropLayout,
} from "./layout.ts";
import {
  SPLIT_TREE_TRUNKS_MAX,
  SPLIT_TREE_TRUNKS_MIN,
  type PropSection,
  type SplitTreeString,
  type SplitTreeTrunkEnd,
} from "./types.ts";

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
  /** Metres of string along the trunk. */
  lengthM: number;
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
};

export type TrunkStringCover = {
  stringId: string;
  /** Metres of this trunk this string covers. */
  coveredM: number;
  lights: number;
  /** Metres of this string still unused after this trunk. Null when the count is not set. */
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
  dark: boolean;
};

type Segment = {
  stringId: string | null;
  trunkId: string;
  t0: number;
  t1: number;
  lights: number | null;
  fromCorner: string;
  toCorner: string;
};

const EPS = 1e-6;

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

/**
 * The trunks, parents first. Null when the numbers cannot make a tree.
 * A trunk id stays put when the tip count and the fork depth still produce it.
 */
export function splitTreeTrunks(spec: SplitTreeSpec): SplitTrunk[] | null {
  const tips = Math.round(spec.trunks);
  const { height, split, spacing, units } = spec;
  if (!Number.isInteger(tips) || tips < SPLIT_TREE_TRUNKS_MIN || tips > SPLIT_TREE_TRUNKS_MAX) return null;
  if (!(height > 0) || !(split > 0) || !(spacing > 0) || split >= height - EPS) return null;
  const levels: SplitTreeLevels = spec.levels === 2 && tips >= 3 ? 2 : 1;
  const nodes: Omit<SplitTrunk, "lengthM" | "riseM">[] = [
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
  return nodes
    .filter((node) => node.to > node.from + EPS)
    .map((node) => {
      const rise = toMetres(units, node.to - node.from);
      const run = toMetres(units, Math.hypot(node.x1 - node.x0, node.to - node.from));
      return { ...node, from: round(node.from), to: round(node.to), x0: round(node.x0), x1: round(node.x1), riseM: round(rise), lengthM: round(run) };
    });
}

function addSide(
  nodes: Omit<SplitTrunk, "lengthM" | "riseM">[],
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

function applyEnds(nodes: Omit<SplitTrunk, "lengthM" | "riseM">[], ends: readonly SplitTreeTrunkEnd[], height: number): void {
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
  const match = /^e-(t\d+(?:\.\d+)*)(?:-\d+)?$/.exec(edgeId);
  return match?.[1] ?? null;
}

type Remain = { metres: number | null; lights: number | null };

function remainOf(string: SplitTreeString): Remain {
  if (string.ledCount == null || !(string.pitchMm > 0)) return { metres: null, lights: null };
  return { metres: (string.ledCount * string.pitchMm) / 1000, lights: string.ledCount };
}

/**
 * How much of each trunk the strings cover, and which hops are dark.
 * Strings are used in list order. One string that names two trunks uses
 * the first trunk before the second.
 */
export function splitTreeCoverage(spec: SplitTreeSpec): { trunks: SplitTrunk[]; cover: TrunkCover[]; hops: SplitHop[] } | null {
  const trunks = splitTreeTrunks(spec);
  if (!trunks) return null;
  const strings = (spec.strings ?? []).filter((string) => string.trunkIds.length > 0);
  const byId = new Map(trunks.map((trunk) => [trunk.id, trunk]));
  const remain = new Map(strings.map((string) => [string.id, remainOf(string)]));
  const order = trunkWalk(trunks, strings);
  const cover: TrunkCover[] = [];
  const placed = new Map<string, { trunkId: string; endT: number }[]>();
  for (const trunkId of order) {
    const trunk = byId.get(trunkId);
    if (!trunk) continue;
    const onTrunk = strings.filter((string) => string.trunkIds.includes(trunkId));
    let along = 0;
    const rows: TrunkStringCover[] = [];
    for (const string of onTrunk) {
      const left = remain.get(string.id);
      if (!left || left.metres == null || left.lights == null) {
        rows.push({ stringId: string.id, coveredM: 0, lights: 0, remainingM: null });
        continue;
      }
      if (left.metres <= EPS || along >= trunk.lengthM - EPS) {
        rows.push({ stringId: string.id, coveredM: 0, lights: 0, remainingM: round(left.metres) });
        continue;
      }
      const room = trunk.lengthM - along;
      const pitchM = string.pitchMm / 1000;
      let lights = Math.min(left.lights, Math.max(0, Math.round(Math.min(left.metres, room) / pitchM)));
      while (lights > 0 && lights * pitchM > room + 1e-4) lights -= 1;
      const used = round(lights * pitchM);
      along = round(along + used);
      left.lights -= lights;
      left.metres = round(Math.max(0, left.metres - used));
      rows.push({ stringId: string.id, coveredM: used, lights, remainingM: left.metres });
      if (lights > 0) {
        const list = placed.get(string.id) ?? [];
        list.push({ trunkId, endT: trunk.lengthM > EPS ? along / trunk.lengthM : 1 });
        placed.set(string.id, list);
      }
    }
    const coveredM = round(rows.reduce((sum, row) => sum + row.coveredM, 0));
    let openM = round(Math.max(0, trunk.lengthM - coveredM));
    const lastCover = [...rows].reverse().find((row) => row.coveredM > 0);
    const lastPitch = onTrunk.find((string) => string.id === lastCover?.stringId)?.pitchMm;
    // Less than one light of the string that stopped here is not an open stretch.
    if (lastPitch != null && openM < lastPitch / 1000) openM = 0;
    cover.push({ trunkId, lengthM: trunk.lengthM, coveredM, openM, strings: rows });
  }
  const hops: SplitHop[] = [];
  const coverBy = new Map(cover.map((row) => [row.trunkId, row]));
  for (const string of strings) {
    const hits = string.trunkIds.filter((id, index) => string.trunkIds.indexOf(id) === index && byId.has(id));
    for (let index = 0; index < hits.length - 1; index += 1) {
      const fromId = hits[index]!;
      const toId = hits[index + 1]!;
      const from = byId.get(fromId)!;
      const to = byId.get(toId)!;
      const meets = to.parentId === from.id && Math.abs(to.from - from.to) < 1e-3 && Math.abs(to.x0 - from.x1) < 1e-3;
      const fromCover = coverBy.get(fromId)?.strings.find((row) => row.stringId === string.id);
      const reached = (fromCover?.coveredM ?? 0) >= from.lengthM - 1e-3;
      const childRows = coverBy.get(toId)?.strings.filter((row) => row.coveredM > EPS) ?? [];
      const firstOnChild = childRows[0]?.stringId === string.id;
      hops.push({ stringId: string.id, fromId, toId, dark: !meets || !reached || !firstOnChild });
    }
  }
  return { trunks, cover, hops };
}

function trunkWalk(trunks: readonly SplitTrunk[], strings: readonly SplitTreeString[]): string[] {
  const ids = trunks.map((trunk) => trunk.id);
  const after = new Map<string, Set<string>>();
  const indeg = new Map(ids.map((id) => [id, 0]));
  const link = (before: string, next: string) => {
    if (before === next || !indeg.has(before) || !indeg.has(next)) return;
    const set = after.get(before) ?? new Set<string>();
    if (set.has(next)) return;
    set.add(next);
    after.set(before, set);
    indeg.set(next, (indeg.get(next) ?? 0) + 1);
  };
  for (const string of strings) {
    const path = string.trunkIds.filter((id, index) => string.trunkIds.indexOf(id) === index);
    for (let index = 0; index < path.length - 1; index += 1) link(path[index]!, path[index + 1]!);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const result: string[] = [];
  while (queue.length > 0) {
    queue.sort((left, right) => ids.indexOf(left) - ids.indexOf(right));
    const id = queue.shift()!;
    result.push(id);
    for (const next of after.get(id) ?? []) {
      const degree = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  for (const id of ids) if (!result.includes(id)) result.push(id);
  return result;
}

function startCornerId(trunk: SplitTrunk): string {
  return trunk.parentId ? `c-${trunk.parentId}` : "c-base";
}

function endCornerId(trunk: SplitTrunk): string {
  return `c-${trunk.id}`;
}

function midCornerId(trunkId: string, t: number): string {
  return `c-${trunkId}-t${Math.round(t * 1000)}`;
}

function cornerFor(trunk: SplitTrunk, t: number): string {
  if (t <= 1e-4) return startCornerId(trunk);
  if (t >= 1 - 1e-4) return endCornerId(trunk);
  return midCornerId(trunk.id, t);
}

/** The drawing: corners at the base, each fork and each tip, plus a run per covered piece. */
export function splitTreeLayout(spec: SplitTreeSpec & { pitchM: number }): PropLayout | null {
  const planned = splitTreeCoverage(spec);
  if (!planned || !(spec.pitchM > 0)) return null;
  const { trunks } = planned;
  const byId = new Map(trunks.map((trunk) => [trunk.id, trunk]));
  const strings = spec.strings ?? [];
  const segments: Segment[] = [];
  for (const row of planned.cover) {
    const trunk = byId.get(row.trunkId);
    if (!trunk || !(trunk.lengthM > EPS)) continue;
    let cursor = 0;
    const pieces: { t0: number; t1: number; stringId: string | null; lights: number | null }[] = [];
    for (const part of row.strings) {
      if (!(part.coveredM > EPS)) continue;
      const t1 = Math.min(1, (cursor + part.coveredM) / trunk.lengthM);
      pieces.push({ t0: cursor / trunk.lengthM, t1, stringId: part.stringId, lights: part.lights });
      cursor += part.coveredM;
    }
    const lastPiece = pieces[pieces.length - 1];
    const lastString = lastPiece?.stringId ? strings.find((string) => string.id === lastPiece.stringId) : null;
    const dust = Math.max(EPS, spec.pitchM * 0.5, lastString ? lastString.pitchMm / 1000 : 0);
    if (trunk.lengthM - cursor > dust) {
      pieces.push({ t0: cursor / trunk.lengthM, t1: 1, stringId: null, lights: pieces.length === 0 ? null : 0 });
    } else if (pieces.length === 0) {
      pieces.push({ t0: 0, t1: 1, stringId: null, lights: null });
    } else {
      pieces[pieces.length - 1]!.t1 = 1;
    }
    pieces.forEach((part, index) => {
      segments.push({
        stringId: part.stringId,
        trunkId: trunk.id,
        t0: part.t0,
        t1: part.t1,
        lights: part.lights,
        fromCorner: cornerFor(trunk, part.t0),
      toCorner: cornerFor(trunk, index === pieces.length - 1 ? 1 : part.t1),
    });
    });
  }
  const corners = new Map<string, LayoutCorner>();
  const put = (id: string, trunk: SplitTrunk, t: number) => {
    if (corners.has(id)) return;
    const x = toMetres(spec.units, trunk.x0 + (trunk.x1 - trunk.x0) * t);
    const y = toMetres(spec.units, trunk.from + (trunk.to - trunk.from) * t);
    corners.set(id, { id, x: round(x), y: round(y) });
  };
  for (const trunk of trunks) {
    put(startCornerId(trunk), trunk, 0);
    put(endCornerId(trunk), trunk, 1);
  }
  for (const segment of segments) {
    const trunk = byId.get(segment.trunkId)!;
    put(segment.fromCorner, trunk, segment.t0);
    put(segment.toCorner, trunk, segment.t1);
  }
  const runs = new Map<string, LayoutEdge[]>();
  const ensure = (id: string) => {
    const list = runs.get(id) ?? [];
    runs.set(id, list);
    return list;
  };
  const pieceCount = new Map<string, number>();
  for (const segment of segments) {
    const count = (pieceCount.get(segment.trunkId) ?? 0) + 1;
    pieceCount.set(segment.trunkId, count);
    const edgeId = count === 1 ? `e-${segment.trunkId}` : `e-${segment.trunkId}-${count}`;
    const trunk = byId.get(segment.trunkId)!;
    const label = splitTrunkLabel(trunk, trunks);
    const edge: LayoutEdge = {
      id: edgeId,
      from: segment.fromCorner,
      to: segment.toCorner,
      kind: "lit",
      name: label,
      wrapLengthM: Math.max(1e-6, round(trunk.lengthM * Math.max(EPS, segment.t1 - segment.t0))),
      ...(segment.lights != null ? { lockedLights: segment.lights } : {}),
    };
    const owner = segment.stringId ?? `sk-${segment.trunkId}`;
    ensure(owner).push(edge);
  }
  for (const string of strings) {
    const run = runs.get(string.id);
    if (!run || run.length < 2) continue;
    const withWires: LayoutEdge[] = [];
    run.forEach((edge, index) => {
      if (index > 0) {
        const previous = run[index - 1]!;
        if (previous.to !== edge.from) {
          withWires.push({ id: `w-${string.id}-${index}`, from: previous.to, to: edge.from, kind: "wire", name: "Dark jump" });
        }
      }
      withWires.push(edge);
    });
    runs.set(string.id, withWires);
  }
  const layoutStrings: LayoutString[] = [];
  const pushString = (id: string) => {
    const run = runs.get(id);
    if (!run || run.length === 0) return;
    layoutStrings.push({ id, startId: run[0]!.from, run });
  };
  for (const string of strings) pushString(string.id);
  for (const trunk of trunks) pushString(`sk-${trunk.id}`);
  if (layoutStrings.length === 0) return null;
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
    corners: [...corners.values()],
    run: layoutStrings[0]!.run,
    strings: layoutStrings,
  };
  return assignStableRunIds(layout);
}

const SECTION_COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

/**
 * Keep a section on its trunk when a rebuild splits that trunk into pieces.
 * A lit run with no section yet gets the trunk's section.
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
    if (index < 0) {
      next.push({
        id: `section.${trunk}`,
        name: edge.name ?? "Trunk",
        edgeIds: [],
        pinnedRanges: [],
        color: SECTION_COLOURS[next.length % SECTION_COLOURS.length],
      });
      index = next.length - 1;
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
