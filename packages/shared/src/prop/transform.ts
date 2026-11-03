/**
 * Whole-drawing edits: reverse the wiring, mirror it, move the wire-in.
 * Run and corner ids are kept, so sections stay on the same runs. Light
 * numbers follow the new wiring order.
 */
import { layoutStrings, type LayoutEdge, type LayoutString, type PropLayout } from "./layout.ts";

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
