/**
 * A simple house on the yard: a footprint, an eave, and a roof ridge.
 * Absent means there is no house. An older yard has none.
 */
import { yardPointForStore } from "./prop/space.ts";
import type { PropYardPoint } from "./prop/types.ts";

export type YardPoint2 = { x: number; z: number };

export type YardHouse = {
  footprint: YardPoint2[];
  /** Metres from the ground to the eave. */
  eaveM: number;
  /** Metres from the eave up to the ridge. 0 is a flat roof. */
  ridgeM: number;
};

export type YardScene = { version: 1; house: YardHouse | null };

const LIMIT = 10000;

function metres(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= LIMIT;
}

export function isYardHouse(value: unknown): value is YardHouse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<YardHouse>;
  if (!Array.isArray(row.footprint) || row.footprint.length < 3 || row.footprint.length > 12) return false;
  if (!row.footprint.every((point) => point && metres(point.x) && metres(point.z))) return false;
  if (!metres(row.eaveM) || (row.eaveM ?? 0) <= 0) return false;
  if (typeof row.ridgeM !== "number" || !Number.isFinite(row.ridgeM) || row.ridgeM < 0 || row.ridgeM > LIMIT) return false;
  return true;
}

/** A rectangular house in front of the point you tapped. The near edge is the street side. */
export function defaultHouse(at: YardPoint2): YardHouse {
  const x = Math.round(at.x * 10) / 10;
  const z = Math.round(at.z * 10) / 10;
  return {
    footprint: [
      { x: x - 4, z },
      { x: x + 4, z },
      { x: x + 4, z: z + 6 },
      { x: x - 4, z: z + 6 },
    ],
    eaveM: 2.5,
    ridgeM: 1.2,
  };
}

export type EaveEdge = { from: YardPoint2; to: YardPoint2; y: number };

export function houseEaves(house: YardHouse): EaveEdge[] {
  return house.footprint.map((from, index) => ({
    from,
    to: house.footprint[(index + 1) % house.footprint.length]!,
    y: house.eaveM,
  }));
}

/**
 * Pull a roofline onto the nearest eave when it is let go close by.
 * Null when it is not close, so the drop stays where it was.
 */
export function snapRoofline(point: PropYardPoint, house: YardHouse): PropYardPoint | null {
  const x = point.x;
  const z = point.depth ?? 0;
  let best: { dist: number; x: number; z: number; facing: number } | null = null;
  for (const edge of houseEaves(house)) {
    const dx = edge.to.x - edge.from.x;
    const dz = edge.to.z - edge.from.z;
    const length2 = dx * dx + dz * dz;
    if (length2 < 1e-6) continue;
    const t = Math.min(1, Math.max(0, ((x - edge.from.x) * dx + (z - edge.from.z) * dz) / length2));
    const px = edge.from.x + dx * t;
    const pz = edge.from.z + dz * t;
    const dist = Math.hypot(px - x, pz - z);
    if (dist > 0.75) continue;
    const facing = Math.round(Math.atan2(dz, dx) * 180 / Math.PI);
    if (!best || dist < best.dist) best = { dist, x: px, z: pz, facing };
  }
  if (!best) return null;
  return yardPointForStore({
    ...point,
    x: Math.round(best.x * 1000) / 1000,
    y: house.eaveM,
    depth: Math.round(best.z * 1000) / 1000,
    facing: best.facing,
    mount: "upright",
  }, point);
}
