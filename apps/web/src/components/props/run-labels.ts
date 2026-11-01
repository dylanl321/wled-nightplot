import type { Point } from "@/components/canvas/camera";

/** One colour per string, repeating after the sixth. */
export const STRING_COLOURS = ["#d4a574", "#7eb6d6", "#8fbf8f", "#d6a0c8", "#e0c36a", "#9aa4d6"] as const;

export function stringColour(index: number): string {
  const count = STRING_COLOURS.length;
  const at = ((index % count) + count) % count;
  return STRING_COLOURS[at]!;
}

/** A, B, C… so a badge can say which string it belongs to. */
export function stringLetter(index: number): string {
  if (index >= 0 && index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

export function runBadge(stringIndex: number, order: number): string {
  return `${stringLetter(stringIndex)}${order}`;
}

export type ScreenRun = { ax: number; ay: number; bx: number; by: number };

export type LabelSpot = { badge: Point; caption: Point };

/** The length caption is 104 px wide and centred on its point. */
export const CAPTION_HALF_W = 52;
export const CAPTION_HALF_H = 10;
const BADGE_HALF = 16;
const EDGE_PAD = 8;

/** The stage rectangle, in screen pixels, that labels must stay inside. */
export type LabelFrame = { w: number; h: number };

type Occupied = { x: number; y: number; r: number };

/**
 * A badge and a length caption for every run. Captions are always returned,
 * including on a short run. Spots stay off the line and away from each other
 * and from `obstacles` (a Wire in label, the zoom controls). When `frame` is
 * set, a label that would leave the stage is nudged back inside it.
 */
export function placeRunLabels(
  runs: readonly ScreenRun[],
  obstacles: readonly Point[] = [],
  gap = 28,
  frame?: LabelFrame,
): LabelSpot[] {
  const placed: Occupied[] = obstacles.map((point) => ({ x: point.x, y: point.y, r: 18 }));
  return runs.map((run) => {
    const dx = run.bx - run.ax;
    const dy = run.by - run.ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const ux = dx / len;
    const uy = dy / len;
    const mx = (run.ax + run.bx) / 2;
    const my = (run.ay + run.by) / 2;
    const badge = nudgeInside(pick({ x: mx + nx * 22, y: my + ny * 22 }, 14, BADGE_HALF, BADGE_HALF, gap, placed, frame, (dist, side, along) => ({
      x: mx + nx * dist * side + ux * along,
      y: my + ny * dist * side + uy * along,
    }), [22, 36, 52, 70], [0, 18, -18, 36, -36]), BADGE_HALF, BADGE_HALF, frame);
    placed.push({ ...badge, r: 14 });
    const awayX = badge.x - mx;
    const awayY = badge.y - my;
    const away = Math.hypot(awayX, awayY) || 1;
    const caption = nudgeInside(pick({ x: badge.x + (awayX / away) * 56, y: badge.y + (awayY / away) * 16 }, 32, CAPTION_HALF_W, CAPTION_HALF_H, gap, placed, frame, (extra, _side, slide) => ({
      x: badge.x + (awayX / away) * extra + ux * slide,
      y: badge.y + (awayY / away) * extra * 0.4 + uy * slide,
    }), [52, 70, 90], [0, 24, -24, 48]), CAPTION_HALF_W, CAPTION_HALF_H, frame);
    placed.push({ ...caption, r: 32 });
    return { badge, caption };
  });
}

/** Pull a centred label back so its box stays on the stage. */
export function nudgeInside(point: Point, halfW: number, halfH: number, frame?: LabelFrame): Point {
  if (!frame || !(frame.w > 0) || !(frame.h > 0)) return point;
  const minX = EDGE_PAD + halfW;
  const maxX = frame.w - EDGE_PAD - halfW;
  const minY = EDGE_PAD + halfH;
  const maxY = frame.h - EDGE_PAD - halfH;
  return {
    x: maxX < minX ? frame.w / 2 : Math.min(maxX, Math.max(minX, point.x)),
    y: maxY < minY ? frame.h / 2 : Math.min(maxY, Math.max(minY, point.y)),
  };
}

function pick(
  seed: Point,
  radius: number,
  halfW: number,
  halfH: number,
  gap: number,
  placed: readonly Occupied[],
  frame: LabelFrame | undefined,
  at: (dist: number, side: number, along: number) => Point,
  distances: readonly number[],
  alongs: readonly number[],
): Point {
  let chosen = seed;
  let best = score(seed, radius, halfW, halfH, placed, frame);
  for (const dist of distances) {
    for (const side of [1, -1]) {
      for (const along of alongs) {
        const next = at(dist, side, along);
        const room = score(next, radius, halfW, halfH, placed, frame);
        if (room > best) {
          best = room;
          chosen = next;
        }
        if (room >= gap) return next;
      }
    }
  }
  return chosen;
}

function score(point: Point, radius: number, halfW: number, halfH: number, placed: readonly Occupied[], frame?: LabelFrame): number {
  const room = clearance(point, radius, placed);
  if (!frame) return room;
  const kept = nudgeInside(point, halfW, halfH, frame);
  if (kept.x === point.x && kept.y === point.y) return room;
  return room - 10000;
}

function clearance(point: Point, radius: number, placed: readonly Occupied[]): number {
  if (placed.length === 0) return 999;
  return placed.reduce((min, other) => Math.min(min, Math.hypot(point.x - other.x, point.y - other.y) - other.r - radius), 999);
}
