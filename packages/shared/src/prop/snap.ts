import { METRES_PER_FOOT, type LayoutUnits } from "./layout.ts";

/** How close the pointer must be, in screen pixels, before a snap wins. */
export const SNAP_POINT_PX = 12;
export const SNAP_ALIGN_PX = 8;

export type SnapPoint = { id: string; x: number; y: number };

export type TraceGuide =
  | { kind: "point"; id: string; x: number; y: number }
  | { kind: "align"; axis: "x" | "y"; at: number }
  | { kind: "angle"; degrees: number }
  | { kind: "grid" };

export type SnapContext = {
  units: LayoutUnits;
  /** Screen pixels per metre. */
  ppm: number;
  /** The run grows from here. Angle snap uses it. */
  tail: { x: number; y: number } | null;
  points: readonly SnapPoint[];
  /** 15° steps. Otherwise 0/45/90 and the rest of that set. */
  shift: boolean;
  /** Hold to place the pointer exactly where it is. */
  alt: boolean;
  /** The Snap switch. Off means no guides and no movement. */
  enabled: boolean;
  /** A corner being dragged is not a snap target. */
  excludeId?: string | null;
};

export type SnapHit = { point: { x: number; y: number }; guides: TraceGuide[] };

/**
 * One snap for the preview, the placement, and a drag.
 * An existing point wins, then a horizontal or vertical alignment,
 * then an angle from the tail, then the grid.
 */
export function snap(raw: { x: number; y: number }, ctx: SnapContext): SnapHit {
  if (ctx.alt || !ctx.enabled || !(ctx.ppm > 0)) return { point: raw, guides: [] };
  const near = pointHit(raw, ctx);
  if (near) return near;
  const aligned = alignHit(raw, ctx);
  if (aligned) return aligned;
  const angled = angleHit(raw, ctx);
  if (angled) return angled;
  return gridHit(raw, ctx);
}

/**
 * Where the band ends. A typed length keeps that distance from the tail
 * and still turns toward the pointer. A typed angle replaces the turn.
 * Snapping to an existing point still wins, so a run can close.
 */
export function traceAim(
  raw: { x: number; y: number },
  tail: { x: number; y: number },
  lock: { metres: number | null; angleDeg: number | null },
  ctx: SnapContext,
): SnapHit {
  const snapped = snap(raw, ctx);
  if (!(lock.metres != null && lock.metres > 0)) return snapped;
  if (snapped.guides.some((guide) => guide.kind === "point")) return snapped;
  const angle = lock.angleDeg;
  const toward = angle == null ? snapped.point : {
    x: tail.x + Math.cos(angle * Math.PI / 180),
    y: tail.y + Math.sin(angle * Math.PI / 180),
  };
  const dx = toward.x - tail.x;
  const dy = toward.y - tail.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return { point: { x: tail.x + lock.metres, y: tail.y }, guides: snapped.guides.filter((guide) => guide.kind !== "grid") };
  const point = { x: tail.x + (dx / dist) * lock.metres, y: tail.y + (dy / dist) * lock.metres };
  return { point, guides: snapped.guides.filter((guide) => guide.kind !== "grid" && guide.kind !== "point") };
}

function pointHit(raw: { x: number; y: number }, ctx: SnapContext): SnapHit | null {
  let best: { id: string; x: number; y: number; d: number } | null = null;
  for (const point of ctx.points) {
    if (point.id === ctx.excludeId) continue;
    const d = Math.hypot((point.x - raw.x) * ctx.ppm, (point.y - raw.y) * ctx.ppm);
    if (d <= SNAP_POINT_PX && (!best || d < best.d)) best = { id: point.id, x: point.x, y: point.y, d };
  }
  if (!best) return null;
  return { point: { x: best.x, y: best.y }, guides: [{ kind: "point", id: best.id, x: best.x, y: best.y }] };
}

function alignHit(raw: { x: number; y: number }, ctx: SnapContext): SnapHit | null {
  let best: { axis: "x" | "y"; at: number; d: number } | null = null;
  for (const point of ctx.points) {
    const dx = Math.abs((point.x - raw.x) * ctx.ppm);
    const dy = Math.abs((point.y - raw.y) * ctx.ppm);
    if (dx <= SNAP_ALIGN_PX && dx > 0.4 && (!best || dx < best.d)) best = { axis: "x", at: point.x, d: dx };
    if (dy <= SNAP_ALIGN_PX && dy > 0.4 && (!best || dy < best.d)) best = { axis: "y", at: point.y, d: dy };
  }
  if (!best) return null;
  const point = best.axis === "x" ? { x: best.at, y: raw.y } : { x: raw.x, y: best.at };
  return { point, guides: [{ kind: "align", axis: best.axis, at: best.at }] };
}

function angleHit(raw: { x: number; y: number }, ctx: SnapContext): SnapHit | null {
  if (!ctx.tail) return null;
  const dx = raw.x - ctx.tail.x;
  const dy = raw.y - ctx.tail.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return null;
  const step = ctx.shift ? 15 : 45;
  const deg = Math.atan2(dy, dx) * 180 / Math.PI;
  const snapped = Math.round(deg / step) * step;
  let delta = Math.abs(deg - snapped);
  if (delta > 180) delta = 360 - delta;
  const limit = ctx.shift ? 6 : 10;
  if (delta > limit) return null;
  const rad = snapped * Math.PI / 180;
  const degrees = ((snapped % 360) + 360) % 360;
  return {
    point: { x: ctx.tail.x + Math.cos(rad) * dist, y: ctx.tail.y + Math.sin(rad) * dist },
    guides: [{ kind: "angle", degrees }],
  };
}

function gridHit(raw: { x: number; y: number }, ctx: SnapContext): SnapHit {
  const step = ctx.units === "ft" ? METRES_PER_FOOT : 0.25;
  const point = { x: Math.round(raw.x / step) * step, y: Math.round(raw.y / step) * step };
  const moved = Math.hypot((point.x - raw.x) * ctx.ppm, (point.y - raw.y) * ctx.ppm) > 0.5;
  return { point, guides: moved ? [{ kind: "grid" }] : [] };
}
