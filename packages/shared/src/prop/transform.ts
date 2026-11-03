/**
 * Whole-drawing edits: reverse the wiring, mirror it, move the wire-in.
 * Run and corner ids are kept, so sections stay on the same runs. Light
 * numbers follow the new wiring order.
 */
import {
  clearEdgeLights,
  continueToCorner,
  continueToPoint,
  countLayout,
  ensureStrings,
  layoutStrings,
  setEdgeLights,
  type LayoutEdge,
  type LayoutString,
  type PropLayout,
} from "./layout.ts";

function cornerAt(layout: PropLayout, id: string) {
  return layout.corners.find((corner) => corner.id === id);
}

function edgeLength(layout: PropLayout, edge: LayoutEdge): number {
  const a = cornerAt(layout, edge.from);
  const b = cornerAt(layout, edge.to);
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
}

/** One run walked the other way. Hand-placed lights keep their spot on the run. */
function flipEdge(layout: PropLayout, edge: LayoutEdge): LayoutEdge {
  const next: LayoutEdge = { ...edge, from: edge.to, to: edge.from };
  if (edge.lights) {
    const len = edgeLength(layout, edge);
    next.lights = edge.lights.map((light) => ({ ...light, alongM: Math.max(0, len - light.alongM) })).reverse();
  }
  if (edge.arc) next.arc = { riseM: -edge.arc.riseM };
  return next;
}

function withStrings(layout: PropLayout, strings: LayoutString[]): PropLayout {
  return { ...layout, strings, run: strings[0]?.run ?? [] };
}

function endOf(string: LayoutString): string {
  return string.run.length > 0 ? string.run[string.run.length - 1]!.to : string.startId;
}

function reverseOne(layout: PropLayout, string: LayoutString): LayoutString {
  if (string.run.length === 0) return string;
  return { ...string, startId: endOf(string), run: [...string.run].reverse().map((edge) => flipEdge(layout, edge)) };
}

/** Wire it from the other end: light 1 becomes the last light. Every string on the prop. */
export function reverseLayout(layout: PropLayout): PropLayout {
  return withStrings(layout, layoutStrings(layout).map((string) => reverseOne(layout, string)));
}

/**
 * Mirror the drawing in place, about the middle of its box. "x" flips left
 * and right (a left-to-right prop becomes right-to-left), "y" flips up and
 * down. The wiring order is kept, so the wire-in moves with its corner.
 */
export function mirrorLayout(layout: PropLayout, axis: "x" | "y"): PropLayout {
  if (layout.corners.length === 0) return layout;
  const values = layout.corners.map((corner) => (axis === "x" ? corner.x : corner.y));
  const sum = Math.min(...values) + Math.max(...values);
  const corners = layout.corners.map((corner) => (axis === "x" ? { ...corner, x: sum - corner.x } : { ...corner, y: sum - corner.y }));
  const flip = (edge: LayoutEdge): LayoutEdge => (edge.arc ? { ...edge, arc: { riseM: -edge.arc.riseM } } : edge);
  const strings = layoutStrings(layout).map((string) => ({ ...string, run: string.run.map(flip) }));
  return withStrings({ ...layout, corners }, strings);
}

export type WireInMove =
  | { ok: true; layout: PropLayout }
  | { ok: false; reason: string };

/**
 * Make this corner the wire-in. The far end of a string reverses it. A
 * corner on a closed loop starts the loop there. A corner in the middle of
 * an open string cannot start it without cutting the string, so it is refused.
 */
export function setWireIn(layout: PropLayout, cornerId: string): WireInMove {
  const strings = layoutStrings(layout);
  const index = strings.findIndex((string) => string.startId === cornerId || string.run.some((edge) => edge.from === cornerId || edge.to === cornerId));
  if (index < 0) return { ok: false, reason: "That point is not on a string." };
  const string = strings[index]!;
  if (string.startId === cornerId) return { ok: false, reason: "That point is already the wire-in." };
  const end = endOf(string);
  let next: LayoutString;
  if (end === string.startId) {
    const at = string.run.findIndex((edge) => edge.from === cornerId);
    if (at < 0) return { ok: false, reason: "That point is not on this loop." };
    next = { ...string, startId: cornerId, run: [...string.run.slice(at), ...string.run.slice(0, at)] };
  } else if (end === cornerId) {
    next = reverseOne(layout, string);
  } else {
    return { ok: false, reason: "The wire-in can move to the other end of the string, or to any point on a closed loop. Reverse direction does the first." };
  }
  return { ok: true, layout: withStrings(layout, strings.map((row, i) => (i === index ? next : row))) };
}

export type RepeatDirection = "right" | "left" | "up" | "down";

/**
 * Repeat runs N more times, each copy one box width (or height) plus `gapM`
 * further on, added to the end of the string. Where a copy does not start
 * at the string's end, a dark jump gets there, so six identical walls are
 * one wall traced and five copies. Copies keep each run's lit or dark kind
 * and any typed light count. Runs from the first string only.
 */
export function repeatRuns(layout: PropLayout, edgeIds: readonly string[], count: number, gapM: number, direction: RepeatDirection): PropLayout {
  const base = ensureStrings(layout);
  const string = layoutStrings(base)[0];
  const times = Math.max(0, Math.min(50, Math.floor(count)));
  if (!string || times === 0) return layout;
  const picked = new Set(edgeIds);
  const edges = string.run.filter((edge) => picked.has(edge.id));
  if (edges.length === 0) return layout;
  const ids = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const pts = base.corners.filter((corner) => ids.has(corner.id));
  const w = Math.max(...pts.map((c) => c.x)) - Math.min(...pts.map((c) => c.x));
  const h = Math.max(...pts.map((c) => c.y)) - Math.min(...pts.map((c) => c.y));
  const step = direction === "right" || direction === "left" ? w + gapM : h + gapM;
  const sign = direction === "right" || direction === "up" ? 1 : -1;
  const horizontal = direction === "right" || direction === "left";
  let next = base;
  const sid = string.id;
  const tailOf = (l: PropLayout) => {
    const row = layoutStrings(l).find((x) => x.id === sid)!;
    return row.run.length > 0 ? row.run[row.run.length - 1]!.to : row.startId;
  };
  const at = (l: PropLayout, id: string) => l.corners.find((c) => c.id === id)!;
  const lastEdge = (l: PropLayout) => layoutStrings(l).find((x) => x.id === sid)!.run.at(-1)!;
  for (let k = 1; k <= times; k += 1) {
    const dx = horizontal ? sign * step * k : 0;
    const dy = horizontal ? 0 : sign * step * k;
    const copyOf = new Map<string, string>();
    const reach = (origId: string, kind: "lit" | "wire") => {
      const known = copyOf.get(origId);
      if (known) {
        if (tailOf(next) !== known) next = continueToCorner(next, sid, known, kind);
        return;
      }
      const o = at(base, origId);
      const tail = at(next, tailOf(next));
      if (Math.hypot(tail.x - (o.x + dx), tail.y - (o.y + dy)) < 1e-6) {
        copyOf.set(origId, tail.id);
        return;
      }
      next = continueToPoint(next, sid, o.x + dx, o.y + dy, kind);
      copyOf.set(origId, tailOf(next));
    };
    for (const edge of edges) {
      reach(edge.from, "wire");
      reach(edge.to, edge.kind === "lit" ? "lit" : "wire");
      const made = lastEdge(next);
      if (edge.kind === "lit" && made.kind === "lit") {
        const lights = edge.manualLights ? edge.lights?.length ?? edge.lockedLights : edge.lockedLights;
        if (lights != null) next = setEdgeLights(next, made.id, lights);
      }
    }
  }
  return next;
}

export type ScaleKeep = "spacing" | "count";

/**
 * Scale the drawing, or only the corners of some runs, by `fx` across and
 * `fy` up. The whole prop scales about its wire-in, so the wire-in stays
 * put; a selection scales about its own lower-left corner. "spacing" keeps
 * the light spacing, so a longer run gets more lights. "count" keeps every
 * lit run's light count, so the lights spread out. Hand-placed lights keep
 * their place along the run.
 */
export function scaleLayout(layout: PropLayout, fx: number, fy: number, keep: ScaleKeep, edgeIds?: readonly string[]): PropLayout {
  if (!(fx > 0) || !(fy > 0)) return layout;
  const base = ensureStrings(layout);
  const strings = layoutStrings(base);
  const all = strings.flatMap((string) => string.run);
  const chosen = edgeIds && edgeIds.length > 0 ? all.filter((edge) => edgeIds.includes(edge.id)) : all;
  const moving = new Set(chosen.flatMap((edge) => [edge.from, edge.to]));
  if (moving.size === 0) return layout;
  const pts = base.corners.filter((corner) => moving.has(corner.id));
  const wireIn = base.corners.find((corner) => corner.id === strings[0]?.startId);
  const origin = !edgeIds?.length && wireIn
    ? { x: wireIn.x, y: wireIn.y }
    : { x: Math.min(...pts.map((c) => c.x)), y: Math.min(...pts.map((c) => c.y)) };
  const before = new Map(countLayout(base).edges.map((row) => [row.id, row.lights]));
  const lengthOf = (l: PropLayout, edge: LayoutEdge) => {
    const a = l.corners.find((c) => c.id === edge.from);
    const b = l.corners.find((c) => c.id === edge.to);
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  };
  const corners = base.corners.map((corner) => (moving.has(corner.id)
    ? { ...corner, x: origin.x + (corner.x - origin.x) * fx, y: origin.y + (corner.y - origin.y) * fy }
    : corner));
  let next: PropLayout = { ...base, corners };
  // Runs that touch a moved corner change length.
  const touched = all.filter((edge) => moving.has(edge.from) || moving.has(edge.to));
  next = { ...next, strings: (next.strings ?? []).map((string) => ({ ...string, run: string.run.map((edge) => {
    if (!touched.includes(edge) || !edge.lights) return edge;
    const ratio = lengthOf(base, edge) > 0 ? lengthOf(next, edge) / lengthOf(base, edge) : 1;
    return { ...edge, lights: edge.lights.map((light) => ({ ...light, alongM: light.alongM * ratio })) };
  }) })) };
  next = { ...next, run: next.strings?.[0]?.run ?? [] };
  for (const edge of touched) {
    if (edge.kind !== "lit" || edge.manualLights) continue;
    if (keep === "count") next = setEdgeLights(next, edge.id, before.get(edge.id) ?? 0);
    else if (edge.lockedLights != null) next = clearEdgeLights(next, edge.id);
  }
  return next;
}
