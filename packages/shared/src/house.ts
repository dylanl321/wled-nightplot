/**
 * A simple house on the yard: a footprint, an eave, and a roof ridge.
 * Absent means there is no house. An older yard has none.
 */
import type { PropLayout } from "./prop/layout.ts";
import { layoutLightPoints, yardLightPositions, yardPointForStore, type YardLight } from "./prop/space.ts";
import type { Prop, PropYardPoint } from "./prop/types.ts";

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

/**
 * A house about the size of a few props. The near edge (smallest z) faces the street.
 * The ridge is tall enough that the roof is not a flat lid.
 */
export function defaultHouse(at: YardPoint2): YardHouse {
  const x = Math.round(at.x * 10) / 10;
  const z = Math.round(at.z * 10) / 10;
  return {
    footprint: [
      { x: x - 3, z },
      { x: x + 3, z },
      { x: x + 3, z: z + 4 },
      { x: x - 3, z: z + 4 },
    ],
    eaveM: 2.5,
    ridgeM: 2.4,
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

/** The street edge: the footprint side closest to the road (smallest z). */
export function frontEave(house: YardHouse): EaveEdge {
  const edges = houseEaves(house);
  return edges.reduce((best, edge) => {
    const z = (edge.from.z + edge.to.z) / 2;
    const bestZ = (best.from.z + best.to.z) / 2;
    return z < bestZ ? edge : best;
  });
}

/**
 * Where a roofline stands: centred on the front eave, upright, at eave height.
 * A saved point on the ground, or laid flat, is not used. The lights follow the edge.
 */
export function rooflinePoint(layout: PropLayout | undefined, house: YardHouse): PropYardPoint {
  const edge = frontEave(house);
  const dx = edge.to.x - edge.from.x;
  const dz = edge.to.z - edge.from.z;
  const facing = Math.atan2(dz, dx) * 180 / Math.PI;
  const lights = layout ? layoutLightPoints(layout) : [];
  const localMid = lights.length === 0 ? 0 : lights.reduce((sum, light) => sum + light.x, 0) / lights.length;
  const rad = (facing * Math.PI) / 180;
  const midX = (edge.from.x + edge.to.x) / 2;
  const midZ = (edge.from.z + edge.to.z) / 2;
  const cx = house.footprint.reduce((sum, point) => sum + point.x, 0) / house.footprint.length;
  const cz = house.footprint.reduce((sum, point) => sum + point.z, 0) / house.footprint.length;
  const ox = midX - cx;
  const oz = midZ - cz;
  const out = Math.hypot(ox, oz) || 1;
  // Just outside the wall, so the bulbs are not buried in it.
  const clear = 0.08;
  return yardPointForStore({
    x: midX - localMid * Math.cos(rad) + (ox / out) * clear,
    y: house.eaveM,
    depth: midZ - localMid * Math.sin(rad) + (oz / out) * clear,
    facing,
    mount: "upright",
  });
}

/**
 * Lights in the yard. A roofline is drawn on the front eave whenever a house
 * is there, even if the saved point says it is flat on the ground.
 * `yardLightPositions` alone never saw the house, so a flat roofline stayed at height 0.
 */
export function sceneLightPositions(
  props: readonly (Pick<Prop, "id" | "layout" | "yard"> & { kind?: Prop["kind"] })[],
  house: YardHouse | null | undefined,
): YardLight[] {
  const placed = props.map((prop) => {
    if (prop.kind === "roofline" && house) return { ...prop, yard: rooflinePoint(prop.layout, house) };
    return prop;
  });
  return yardLightPositions(placed);
}

/** A roofline always belongs on the eave. Kept so a drag saves the same place the view draws. */
export function snapRoofline(_point: PropYardPoint, house: YardHouse, layout?: PropLayout): PropYardPoint {
  return rooflinePoint(layout, house);
}

export type HouseTriangles = { walls: Float32Array; roof: Float32Array };

/** Walls up to the eave, then a gable. The roof is not a flat cap on the walls. */
export function houseTriangles(house: YardHouse): HouseTriangles {
  const walls: number[] = [];
  const eave = house.eaveM;
  for (const edge of houseEaves(house)) {
    quad(walls,
      [edge.from.x, 0, edge.from.z],
      [edge.to.x, 0, edge.to.z],
      [edge.to.x, eave, edge.to.z],
      [edge.from.x, eave, edge.from.z],
    );
  }
  const roof: number[] = [];
  const peak = eave + house.ridgeM;
  const footprint = house.footprint;
  if (footprint.length === 4) {
    const front = frontEave(house);
    const index = houseEaves(house).findIndex((edge) =>
      edge.from.x === front.from.x && edge.from.z === front.from.z &&
      edge.to.x === front.to.x && edge.to.z === front.to.z);
    if (index < 0) {
      const cx = footprint.reduce((sum, point) => sum + point.x, 0) / footprint.length;
      const cz = footprint.reduce((sum, point) => sum + point.z, 0) / footprint.length;
      const top: Vec3 = [cx, peak, cz];
      for (const edge of houseEaves(house)) {
        tri(roof, [edge.from.x, eave, edge.from.z], [edge.to.x, eave, edge.to.z], top);
      }
      return { walls: new Float32Array(walls), roof: new Float32Array(roof) };
    }
    const a = footprint[index]!;
    const b = footprint[(index + 1) % 4]!;
    const c = footprint[(index + 2) % 4]!;
    const d = footprint[(index + 3) % 4]!;
    const left: Vec3 = [(a.x + d.x) / 2, peak, (a.z + d.z) / 2];
    const right: Vec3 = [(b.x + c.x) / 2, peak, (b.z + c.z) / 2];
    quad(roof, [a.x, eave, a.z], [b.x, eave, b.z], right, left);
    quad(roof, [d.x, eave, d.z], [c.x, eave, c.z], right, left);
    tri(roof, [a.x, eave, a.z], [d.x, eave, d.z], left);
    tri(roof, [b.x, eave, b.z], [c.x, eave, c.z], right);
  } else {
    const cx = footprint.reduce((sum, point) => sum + point.x, 0) / footprint.length;
    const cz = footprint.reduce((sum, point) => sum + point.z, 0) / footprint.length;
    const top: Vec3 = [cx, peak, cz];
    for (const edge of houseEaves(house)) {
      tri(roof, [edge.from.x, eave, edge.from.z], [edge.to.x, eave, edge.to.z], top);
    }
  }
  return { walls: new Float32Array(walls), roof: new Float32Array(roof) };
}

type Vec3 = [number, number, number];

function tri(out: number[], a: Vec3, b: Vec3, c: Vec3) {
  out.push(...a, ...b, ...c);
}

function quad(out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  tri(out, a, b, c);
  tri(out, a, c, d);
}
