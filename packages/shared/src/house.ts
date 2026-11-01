/**
 * A simple house on the yard: a footprint, an eave, and a roof ridge.
 * Absent means there is no house. An older yard has none.
 */
import type { PropLayout } from "./prop/layout.ts";
import { yardLightPositions, yardPointForStore, type YardLight } from "./prop/space.ts";
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

/** How far the roof sticks out past the walls, in metres. */
export const EAVE_OVERHANG_M = 0.32;

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
 * Where a roofline stands: on the outer lip of the front eave, upright, at eave height.
 * One metre of the drawing is one metre along that edge. A saved point on the ground is not used.
 */
export function rooflinePoint(layout: PropLayout | undefined, house: YardHouse): PropYardPoint {
  const edge = frontEave(house);
  const dx = edge.to.x - edge.from.x;
  const dz = edge.to.z - edge.from.z;
  const facing = Math.atan2(dz, dx) * 180 / Math.PI;
  const rad = (facing * Math.PI) / 180;
  const cx = house.footprint.reduce((sum, point) => sum + point.x, 0) / house.footprint.length;
  const cz = house.footprint.reduce((sum, point) => sum + point.z, 0) / house.footprint.length;
  const normal = outwardNormal(edge.from, edge.to, cx, cz);
  const lip = EAVE_OVERHANG_M + 0.06;
  const lipFrom = { x: edge.from.x + normal.x * lip, z: edge.from.z + normal.z * lip };
  const lipTo = { x: edge.to.x + normal.x * lip, z: edge.to.z + normal.z * lip };
  const corners = layout?.corners ?? [];
  const minLocal = corners.length === 0 ? 0 : Math.min(...corners.map((corner) => corner.x));
  const maxLocal = corners.length === 0 ? 0 : Math.max(...corners.map((corner) => corner.x));
  const midLocal = (minLocal + maxLocal) / 2;
  const midX = (lipFrom.x + lipTo.x) / 2;
  const midZ = (lipFrom.z + lipTo.z) / 2;
  return yardPointForStore({
    x: midX - midLocal * Math.cos(rad),
    y: house.eaveM,
    depth: midZ - midLocal * Math.sin(rad),
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

export type HouseTriangles = { walls: Float32Array; roof: Float32Array; ends: Float32Array; ridge: Float32Array };

/**
 * One house: a wall box, a triangular gable on each end, and two equal slopes.
 * The ridge runs along the longer axis and sits on the centre line.
 * The roof overhangs every wall by the same amount. Faces point outward.
 */
export function houseTriangles(house: YardHouse): HouseTriangles {
  const walls: number[] = [];
  const roof: number[] = [];
  const ends: number[] = [];
  const ridge: number[] = [];
  const eave = house.eaveM;
  const peak = eave + house.ridgeM;
  const footprint = house.footprint;
  const cx = footprint.reduce((sum, point) => sum + point.x, 0) / footprint.length;
  const cz = footprint.reduce((sum, point) => sum + point.z, 0) / footprint.length;
  const body: Vec3 = [cx, eave / 2, cz];
  for (const edge of houseEaves(house)) {
    quadOut(walls, "wall", body,
      [edge.from.x, 0, edge.from.z],
      [edge.to.x, 0, edge.to.z],
      [edge.to.x, eave, edge.to.z],
      [edge.from.x, eave, edge.from.z],
    );
  }
  if (footprint.length === 4) {
    const front = frontEave(house);
    const index = houseEaves(house).findIndex((edge) =>
      edge.from.x === front.from.x && edge.from.z === front.from.z &&
      edge.to.x === front.to.x && edge.to.z === front.to.z);
    if (index >= 0) {
      const a = footprint[index]!;
      const b = footprint[(index + 1) % 4]!;
      const c = footprint[(index + 2) % 4]!;
      const d = footprint[(index + 3) % 4]!;
      addGable(walls, roof, ends, ridge, a, b, c, d, eave, peak, body);
      return { walls: new Float32Array(walls), roof: new Float32Array(roof), ends: new Float32Array(ends), ridge: new Float32Array(ridge) };
    }
  }
  const top: Vec3 = [cx, peak, cz];
  for (const edge of houseEaves(house)) {
    tri(roof, [edge.from.x, eave, edge.from.z], [edge.to.x, eave, edge.to.z], top);
  }
  return { walls: new Float32Array(walls), roof: new Float32Array(roof), ends: new Float32Array(ends), ridge: new Float32Array(ridge) };
}

/**
 * Rectangle gable. `a`–`b` is the front. The overhang is the same on every side,
 * taken along the wall edges rather than a summed normal, so one end cannot stick out farther.
 */
function addGable(
  walls: number[],
  roof: number[],
  ends: number[],
  ridgeOut: number[],
  a: YardPoint2,
  b: YardPoint2,
  c: YardPoint2,
  d: YardPoint2,
  eave: number,
  peak: number,
  body: Vec3,
) {
  const along = unit2(b.x - a.x, b.z - a.z);
  const side = unit2(d.x - a.x, d.z - a.z);
  const oh = EAVE_OVERHANG_M;
  const corner = (point: YardPoint2, alongSign: number, sideSign: number): Vec3 => [
    point.x + along.x * oh * alongSign + side.x * oh * sideSign,
    eave,
    point.z + along.z * oh * alongSign + side.z * oh * sideSign,
  ];
  const a2 = corner(a, -1, -1);
  const b2 = corner(b, 1, -1);
  const c2 = corner(c, 1, 1);
  const d2 = corner(d, -1, 1);
  const frontLen = Math.hypot(b.x - a.x, b.z - a.z);
  const sideLen = Math.hypot(d.x - a.x, d.z - a.z);
  const up: Vec3 = [body[0], peak, body[2]];
  if (frontLen >= sideLen) {
    const midL = { x: (a.x + d.x) / 2, z: (a.z + d.z) / 2 };
    const midR = { x: (b.x + c.x) / 2, z: (b.z + c.z) / 2 };
    const ridgeDir = unit2(midR.x - midL.x, midR.z - midL.z);
    const ridgeL: Vec3 = [midL.x - ridgeDir.x * oh, peak, midL.z - ridgeDir.z * oh];
    const ridgeR: Vec3 = [midR.x + ridgeDir.x * oh, peak, midR.z + ridgeDir.z * oh];
    quadOut(roof, "roof", up, a2, b2, ridgeR, ridgeL);
    quadOut(roof, "roof", up, d2, c2, ridgeR, ridgeL);
    triOut(ends, body, [a.x, eave, a.z], [d.x, eave, d.z], [midL.x, peak, midL.z]);
    triOut(ends, body, [b.x, eave, b.z], [c.x, eave, c.z], [midR.x, peak, midR.z]);
    ridgeCap(ridgeOut, ridgeL, ridgeR, ridgeDir);
    quadOut(walls, "down", body, [a.x, eave, a.z], [b.x, eave, b.z], b2, a2);
    quadOut(walls, "down", body, [d.x, eave, d.z], [c.x, eave, c.z], c2, d2);
    quadOut(walls, "down", body, [a.x, eave, a.z], [d.x, eave, d.z], d2, a2);
    quadOut(walls, "down", body, [b.x, eave, b.z], [c.x, eave, c.z], c2, b2);
    return;
  }
  const midF = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const midB = { x: (d.x + c.x) / 2, z: (d.z + c.z) / 2 };
  const ridgeDir = unit2(midB.x - midF.x, midB.z - midF.z);
  const ridgeF: Vec3 = [midF.x - ridgeDir.x * oh, peak, midF.z - ridgeDir.z * oh];
  const ridgeB: Vec3 = [midB.x + ridgeDir.x * oh, peak, midB.z + ridgeDir.z * oh];
  quadOut(roof, "roof", up, a2, d2, ridgeB, ridgeF);
  quadOut(roof, "roof", up, b2, c2, ridgeB, ridgeF);
  triOut(ends, body, [a.x, eave, a.z], [b.x, eave, b.z], [midF.x, peak, midF.z]);
  triOut(ends, body, [d.x, eave, d.z], [c.x, eave, c.z], [midB.x, peak, midB.z]);
}

function outwardNormal(from: YardPoint2, to: YardPoint2, cx: number, cz: number): { x: number; z: number } {
  const side = unit2(to.z - from.z, -(to.x - from.x));
  const mx = (from.x + to.x) / 2;
  const mz = (from.z + to.z) / 2;
  const away = (mx + side.x - cx) * (mx - cx) + (mz + side.z - cz) * (mz - cz);
  const here = (mx - cx) * (mx - cx) + (mz - cz) * (mz - cz);
  return away < here ? { x: -side.x, z: -side.z } : side;
}

function ridgeCap(out: number[], from: Vec3, to: Vec3, along: { x: number; z: number }) {
  const perp = { x: -along.z, z: along.x };
  const half = 0.14;
  const y = from[1] + 0.04;
  const a: Vec3 = [from[0] - perp.x * half, y, from[2] - perp.z * half];
  const b: Vec3 = [to[0] - perp.x * half, y, to[2] - perp.z * half];
  const c: Vec3 = [to[0] + perp.x * half, y, to[2] + perp.z * half];
  const d: Vec3 = [from[0] + perp.x * half, y, from[2] + perp.z * half];
  quad(out, a, b, c, d);
}

function unit2(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

type Vec3 = [number, number, number];

function tri(out: number[], a: Vec3, b: Vec3, c: Vec3) {
  out.push(...a, ...b, ...c);
}

function quad(out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  tri(out, a, b, c);
  tri(out, a, c, d);
}

function quadOut(out: number[], kind: "wall" | "roof" | "down", center: Vec3, a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  const n = cross(sub(b, a), sub(c, a));
  const mid: Vec3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  const score = kind === "roof"
    ? n[1]
    : kind === "down"
      ? -n[1]
      : n[0] * (mid[0] - center[0]) + n[2] * (mid[2] - center[2]);
  if (score < 0) quad(out, a, d, c, b);
  else quad(out, a, b, c, d);
}

function triOut(out: number[], center: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const n = cross(sub(b, a), sub(c, a));
  const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const score = n[0] * (mid[0] - center[0]) + n[2] * (mid[2] - center[2]);
  if (score < 0) tri(out, a, c, b);
  else tri(out, a, b, c);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
