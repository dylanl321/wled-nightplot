import { describe, expect, it } from "vitest";
import { defaultHouse, EAVE_OVERHANG_M, frontEave, houseTriangles, isYardHouse, sceneLightPositions, snapRoofline, type YardHouse } from "./house.ts";
import type { PropLayout } from "./prop/layout.ts";
import { yardCamera } from "./prop/space.ts";

const line: PropLayout = {
  source: "template",
  units: "m",
  pitchM: 0.1,
  startOffsetM: 0,
  corners: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
  run: [{ id: "e1", from: "a", to: "b", kind: "lit" }],
};

describe("house", () => {
  it("an older yard has no house, and a bad footprint is refused", () => {
    expect(isYardHouse(null)).toBe(false);
    expect(isYardHouse({ footprint: [{ x: 0, z: 0 }], eaveM: 2, ridgeM: 1 })).toBe(false);
    expect(isYardHouse(defaultHouse({ x: 0, z: 0 }))).toBe(true);
  });

  it("saves a roofline on the front eave", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const snapped = snapRoofline({ x: 1, y: 0.4, depth: 4, mount: "flat" }, house, line);
    expect(snapped.y).toBe(house.eaveM);
    expect(snapped.mount).toBeUndefined();
    expect(snapped.y).toBeGreaterThan(1);
  });

  it("draws a roofline's lights at eave height even when the saved point is flat on the ground", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const lights = sceneLightPositions([{
      id: "roof",
      kind: "roofline",
      layout: line,
      yard: { x: 9, y: 0, depth: 6, mount: "flat" },
    }], house);
    expect(lights.length).toBeGreaterThan(0);
    const front = frontEave(house);
    const frontZ = (front.from.z + front.to.z) / 2;
    for (const light of lights) {
      expect(light.y).toBeCloseTo(house.eaveM, 2);
      expect(light.z).toBeCloseTo(frontZ - EAVE_OVERHANG_M - 0.06, 2);
    }
    const minX = Math.min(front.from.x, front.to.x);
    const maxX = Math.max(front.from.x, front.to.x);
    expect(lights.every((light) => light.x >= minX - 0.2 && light.x <= maxX + 0.2)).toBe(true);
  });

  it("leaves an upright prop at heightM, and a roofline on the ground when there is no house", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const stood = sceneLightPositions([{
      id: "post",
      kind: "stake-row",
      layout: line,
      yard: { x: 4, y: 0, heightM: 1.7 },
    }], house);
    expect(stood[0]?.y).toBeCloseTo(1.7, 2);
    const grounded = sceneLightPositions([{
      id: "roof",
      kind: "roofline",
      layout: line,
      yard: { x: 1, y: 0, mount: "flat" },
    }], null);
    expect(grounded[0]?.y).toBe(0);
  });

  it("builds a centred gable along the long axis, with an even overhang", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const mesh = houseTriangles(house);
    expect(Math.max(...ys(mesh.roof))).toBeCloseTo(house.eaveM + house.ridgeM, 3);
    expect(Math.min(...ys(mesh.roof))).toBeCloseTo(house.eaveM, 3);
    expect(Math.max(...ys(mesh.walls))).toBeCloseTo(house.eaveM, 3);
    expect(Math.min(...ys(mesh.walls))).toBeCloseTo(0, 3);
    const roof = verts(mesh.roof);
    const peak = house.eaveM + house.ridgeM;
    const ridge = roof.filter((point) => Math.abs(point.y - peak) < 1e-3);
    expect(ridge.length).toBeGreaterThan(0);
    for (const point of ridge) expect(point.z).toBeCloseTo(2, 3);
    expect(Math.min(...ridge.map((point) => point.x))).toBeCloseTo(-3 - EAVE_OVERHANG_M, 2);
    expect(Math.max(...ridge.map((point) => point.x))).toBeCloseTo(3 + EAVE_OVERHANG_M, 2);
    const eave = roof.filter((point) => Math.abs(point.y - house.eaveM) < 1e-3);
    const front = Math.min(...eave.map((point) => point.z));
    const back = Math.max(...eave.map((point) => point.z));
    expect((front + back) / 2).toBeCloseTo(2, 2);
    expect(front).toBeCloseTo(0 - EAVE_OVERHANG_M, 2);
    expect(back).toBeCloseTo(4 + EAVE_OVERHANG_M, 2);
    const frontNormal = faceNormal(mesh.roof, 0);
    const backNormal = faceNormal(mesh.roof, 2);
    expect(frontNormal.y).toBeGreaterThan(0.4);
    expect(frontNormal.z).toBeLessThan(0);
    expect(backNormal.y).toBeGreaterThan(0.4);
    expect(backNormal.z).toBeGreaterThan(0);
    expect(faceNormal(mesh.ends, 0).x).toBeLessThan(-0.5);
    expect(faceNormal(mesh.ends, 1).x).toBeGreaterThan(0.5);
    const leftOver = -3 - Math.min(...eave.map((point) => point.x));
    const rightOver = Math.max(...eave.map((point) => point.x)) - 3;
    expect(leftOver).toBeCloseTo(EAVE_OVERHANG_M, 2);
    expect(rightOver).toBeCloseTo(leftOver, 2);
    expect(faceNormal(mesh.walls, 0).z).toBeLessThan(-0.5);
  });

  it("maps a roofline's metres onto the front eave, end to end", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const full: PropLayout = {
      ...line,
      corners: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 6, y: 0 }],
    };
    const lights = sceneLightPositions([{
      id: "roof",
      kind: "roofline",
      layout: full,
      yard: { x: 0, y: 0, mount: "flat" },
    }], house);
    const xs = lights.map((light) => light.x);
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThan(5.8);
    expect(span).toBeLessThan(6);
    expect(Math.min(...xs)).toBeCloseTo(-3, 2);
    expect(Math.max(...xs)).toBeGreaterThan(2.85);
    expect(Math.max(...xs)).toBeLessThan(3);
    expect(new Set(lights.map((light) => light.z.toFixed(3))).size).toBe(1);
    expect(lights[0]?.z).toBeCloseTo(-EAVE_OVERHANG_M - 0.06, 2);
    expect(lights.every((light) => light.y === house.eaveM)).toBe(true);
  });

  it("frames the house from eye height so the roof stays in view", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const lights = sceneLightPositions([{
      id: "roof",
      kind: "roofline",
      layout: line,
      yard: { x: 0, y: 0, mount: "flat" },
    }], house);
    const street = yardCamera({ view: "street", lights, house });
    expect(street.position.y).toBe(1.6);
    const frontZ = Math.min(...house.footprint.map((point) => point.z));
    expect(street.position.z).toBeLessThan(frontZ);
    expect(street.position.x).toBeLessThan(0);
    const overhead = yardCamera({ view: "overhead", lights, house });
    const drop = overhead.position.y - overhead.target.y;
    const run = Math.hypot(overhead.target.x - overhead.position.x, overhead.target.z - overhead.position.z);
    expect(Math.atan2(drop, run) * 180 / Math.PI).toBeGreaterThanOrEqual(70);
    const half = (45 * Math.PI) / 180 / 2;
    const forward = unit(sub(street.target, street.position));
    for (const sample of houseSamples(house)) {
      const angle = Math.acos(Math.min(1, dot(forward, unit(sub(sample, street.position)))));
      expect(angle).toBeLessThan(half);
    }
  });
});

function verts(data: Float32Array): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index < data.length; index += 3) {
    out.push({ x: data[index]!, y: data[index + 1]!, z: data[index + 2]! });
  }
  return out;
}

function faceNormal(data: Float32Array, triangle: number): { x: number; y: number; z: number } {
  const index = triangle * 9;
  const ax = data[index + 3]! - data[index]!;
  const ay = data[index + 4]! - data[index + 1]!;
  const az = data[index + 5]! - data[index + 2]!;
  const bx = data[index + 6]! - data[index]!;
  const by = data[index + 7]! - data[index + 1]!;
  const bz = data[index + 8]! - data[index + 2]!;
  const x = ay * bz - az * by;
  const y = az * bx - ax * bz;
  const z = ax * by - ay * bx;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function ys(data: Float32Array): number[] {
  const out: number[] = [];
  for (let index = 1; index < data.length; index += 3) out.push(data[index]!);
  return out;
}

function houseSamples(house: YardHouse): [number, number, number][] {
  const peak = house.eaveM + house.ridgeM;
  const samples: [number, number, number][] = [];
  for (const point of house.footprint) {
    samples.push([point.x, 0, point.z], [point.x, house.eaveM, point.z]);
  }
  const cx = house.footprint.reduce((sum, point) => sum + point.x, 0) / house.footprint.length;
  const cz = house.footprint.reduce((sum, point) => sum + point.z, 0) / house.footprint.length;
  samples.push([cx, peak, cz]);
  return samples;
}

function sub(a: { x: number; y: number; z: number } | [number, number, number], b: { x: number; y: number; z: number }): [number, number, number] {
  const ax = Array.isArray(a) ? a[0] : a.x;
  const ay = Array.isArray(a) ? a[1] : a.y;
  const az = Array.isArray(a) ? a[2] : a.z;
  return [ax - b.x, ay - b.y, az - b.z];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function unit(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}
