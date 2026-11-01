/**
 * The yard drawing: where each prop sits, in metres. A prop's own drawing
 * keeps its coordinates; its yard point is added to them.
 */
import { layoutStrings, type PropLayout } from "./layout.ts";
import type { Prop, PropYardPoint } from "./types.ts";

export type YardBox = { minX: number; minY: number; maxX: number; maxY: number };

export type YardPlacement = {
  propId: string;
  /** Where the drawing's origin sits. */
  at: PropYardPoint;
  /** True when the prop has no saved point and was given a default slot. */
  defaulted: boolean;
  /** The prop's footprint on the yard, in metres. */
  box: YardBox;
};

/** Gap between default slots, in metres. */
export const YARD_SLOT_GAP_M = 1;
/** A prop with no drawing still takes this much room. */
const EMPTY_SIZE_M = 1;

/** The drawing's own box, before any yard offset. */
export function layoutBox(layout: PropLayout | undefined): YardBox {
  const used = new Set<string>();
  if (layout) {
    for (const string of layoutStrings(layout)) {
      used.add(string.startId);
      for (const edge of string.run) {
        used.add(edge.from);
        used.add(edge.to);
      }
    }
  }
  const corners = (layout?.corners ?? []).filter((corner) => used.size === 0 || used.has(corner.id));
  if (corners.length === 0) return { minX: 0, minY: 0, maxX: EMPTY_SIZE_M, maxY: EMPTY_SIZE_M };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  if (maxX - minX < 0.1) maxX = minX + 0.1;
  if (maxY - minY < 0.1) maxY = minY + 0.1;
  return { minX, minY, maxX, maxY };
}

/**
 * Every prop's place on the yard. Saved points are kept. Props without one
 * go in a row to the right of everything placed, a slot gap apart, with
 * their bottom edge on y = 0, so they never land on top of each other.
 */
export function yardPlacements(props: readonly Pick<Prop, "id" | "layout" | "yard">[]): YardPlacement[] {
  const placed: YardPlacement[] = [];
  let right = -Infinity;
  for (const prop of props) {
    if (!prop.yard) continue;
    const own = layoutBox(prop.layout);
    const box = offset(own, prop.yard);
    right = Math.max(right, box.maxX);
    placed.push({ propId: prop.id, at: prop.yard, defaulted: false, box });
  }
  let cursor = Number.isFinite(right) ? right + YARD_SLOT_GAP_M : 0;
  const byId = new Map(placed.map((row) => [row.propId, row]));
  return props.map((prop) => {
    const saved = byId.get(prop.id);
    if (saved) return saved;
    const own = layoutBox(prop.layout);
    const at = { x: round(cursor - own.minX), y: round(-own.minY) };
    cursor += own.maxX - own.minX + YARD_SLOT_GAP_M;
    return { propId: prop.id, at, defaulted: true, box: offset(own, at) };
  });
}

export function yardBounds(placements: readonly YardPlacement[]): YardBox | null {
  if (placements.length === 0) return null;
  return placements.reduce<YardBox>(
    (all, row) => ({
      minX: Math.min(all.minX, row.box.minX),
      minY: Math.min(all.minY, row.box.minY),
      maxX: Math.max(all.maxX, row.box.maxX),
      maxY: Math.max(all.maxY, row.box.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

function offset(box: YardBox, at: PropYardPoint): YardBox {
  return { minX: box.minX + at.x, minY: box.minY + at.y, maxX: box.maxX + at.x, maxY: box.maxY + at.y };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}
