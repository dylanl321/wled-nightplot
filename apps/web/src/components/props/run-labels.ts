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

type Occupied = { x: number; y: number; r: number };

/**
 * A badge and a length caption for every run. Captions are always returned,
 * including on a short run. Spots stay off the line and away from each other
 * and from `obstacles` (a Wire in label, the zoom controls).
 */
export function placeRunLabels(runs: readonly ScreenRun[], obstacles: readonly Point[] = [], gap = 28): LabelSpot[] {
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
    const badge = pick({ x: mx + nx * 22, y: my + ny * 22 }, 14, gap, placed, (dist, side, along) => ({
      x: mx + nx * dist * side + ux * along,
      y: my + ny * dist * side + uy * along,
    }), [22, 36, 52, 70], [0, 18, -18, 36, -36]);
    placed.push({ ...badge, r: 14 });
    const awayX = badge.x - mx;
    const awayY = badge.y - my;
    const away = Math.hypot(awayX, awayY) || 1;
    const caption = pick({ x: badge.x + (awayX / away) * 56, y: badge.y + (awayY / away) * 16 }, 32, gap, placed, (extra, _side, slide) => ({
      x: badge.x + (awayX / away) * extra + ux * slide,
      y: badge.y + (awayY / away) * extra * 0.4 + uy * slide,
    }), [52, 70, 90], [0, 24, -24, 48]);
    placed.push({ ...caption, r: 32 });
    return { badge, caption };
  });
}

function pick(
  seed: Point,
  radius: number,
  gap: number,
  placed: readonly Occupied[],
  at: (dist: number, side: number, along: number) => Point,
  distances: readonly number[],
  alongs: readonly number[],
): Point {
  let chosen = seed;
  let best = clearance(seed, radius, placed);
  for (const dist of distances) {
    for (const side of [1, -1]) {
      for (const along of alongs) {
        const next = at(dist, side, along);
        const room = clearance(next, radius, placed);
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

function clearance(point: Point, radius: number, placed: readonly Occupied[]): number {
  if (placed.length === 0) return 999;
  return placed.reduce((min, other) => Math.min(min, Math.hypot(point.x - other.x, point.y - other.y) - other.r - radius), 999);
}
