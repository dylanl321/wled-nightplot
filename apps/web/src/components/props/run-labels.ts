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

export type ScreenRun = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** A selected run keeps its label. Others hide when they would cover it. */
  selected?: boolean;
};

export type LabelSide = "left" | "right" | "top" | "bottom";

export type LabelSpot = {
  badge: Point | null;
  caption: Point | null;
  /** Set when the run's midpoint is off the stage. The label is not drawn. */
  off: LabelSide | null;
};

/** The length caption is 104 px wide and centred on its point. */
export const CAPTION_HALF_W = 52;
export const CAPTION_HALF_H = 10;
const BADGE_R = 16;
const BADGE_OFFSET = 20;
const CAPTION_OFFSET = 36;
const EDGE_PAD = 8;

/** The stage rectangle, in screen pixels. */
export type LabelFrame = { w: number; h: number };

type Occupied = { x: number; y: number; r: number };

/**
 * Badge and length caption sit on the run's midpoint, a fixed offset to one
 * side, at every zoom. A run whose midpoint is off the stage is hidden.
 * When two labels would cover each other, the selected run stays and the
 * other is hidden. Labels are not pulled back onto the edge of the view.
 */
export function placeRunLabels(
  runs: readonly ScreenRun[],
  obstacles: readonly Point[] = [],
  gap = 28,
  frame?: LabelFrame,
): LabelSpot[] {
  const order = runs.map((run, index) => ({ run, index }))
    .sort((left, right) => Number(Boolean(right.run.selected)) - Number(Boolean(left.run.selected)) || left.index - right.index);
  const placed: Occupied[] = obstacles.map((point) => ({ x: point.x, y: point.y, r: 22 }));
  const spots: LabelSpot[] = runs.map(() => ({ badge: null, caption: null, off: null }));
  for (const item of order) {
    const run = item.run;
    const dx = run.bx - run.ax;
    const dy = run.by - run.ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const mx = (run.ax + run.bx) / 2;
    const my = (run.ay + run.by) / 2;
    const off = frame ? offSide(mx, my, frame) : null;
    if (off) {
      spots[item.index] = { badge: null, caption: null, off };
      continue;
    }
    const sides = [1, -1].map((side) => ({
      badge: { x: mx + nx * BADGE_OFFSET * side, y: my + ny * BADGE_OFFSET * side },
      caption: { x: mx + nx * CAPTION_OFFSET * side, y: my + ny * CAPTION_OFFSET * side },
    }));
    const clear = sides.find((side) => fits(side.badge, BADGE_R, placed, gap) && fits(side.caption, 28, placed, gap));
    const chosen = clear ?? (run.selected ? sides[0] : null);
    if (!chosen) continue;
    spots[item.index] = { badge: chosen.badge, caption: chosen.caption, off: null };
    placed.push({ ...chosen.badge, r: BADGE_R }, { ...chosen.caption, r: 28 });
  }
  return spots;
}

/** How many hidden runs sit past each edge. One chip per side is enough. */
export function labelsOffScreen(spots: readonly LabelSpot[]): { side: LabelSide; count: number }[] {
  const counts: Record<LabelSide, number> = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const spot of spots) {
    if (spot.off) counts[spot.off] += 1;
  }
  const sides: LabelSide[] = ["left", "right", "top", "bottom"];
  return sides.filter((side) => counts[side] > 0).map((side) => ({ side, count: counts[side] }));
}

function fits(point: Point, radius: number, placed: readonly Occupied[], gap: number): boolean {
  return placed.every((other) => Math.hypot(point.x - other.x, point.y - other.y) >= other.r + radius + Math.min(gap, 12));
}

function offSide(x: number, y: number, frame: LabelFrame): LabelSide | null {
  if (!(frame.w > 0) || !(frame.h > 0)) return null;
  const past = {
    left: EDGE_PAD - x,
    right: x - (frame.w - EDGE_PAD),
    top: EDGE_PAD - y,
    bottom: y - (frame.h - EDGE_PAD),
  };
  let side: LabelSide | null = null;
  let most = 0;
  const keys: LabelSide[] = ["left", "right", "top", "bottom"];
  for (const key of keys) {
    if (past[key] > most) {
      most = past[key];
      side = key;
    }
  }
  return side;
}
