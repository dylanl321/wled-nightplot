import { describe, expect, it } from "vitest";
import { defaultHouse, frontEave, houseTriangles, isYardHouse, sceneLightPositions, snapRoofline, type YardHouse } from "./house.ts";
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
      expect(Math.abs(light.z - frontZ)).toBeLessThan(0.2);
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

  it("builds a gable above the walls", () => {
    const house = defaultHouse({ x: 0, z: 0 });
    const mesh = houseTriangles(house);
    expect(Math.max(...ys(mesh.roof))).toBeCloseTo(house.eaveM + house.ridgeM, 3);
    expect(Math.min(...ys(mesh.roof))).toBeCloseTo(house.eaveM, 3);
    expect(Math.max(...ys(mesh.walls))).toBeCloseTo(house.eaveM, 3);
    expect(Math.min(...ys(mesh.walls))).toBeCloseTo(0, 3);
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
    const half = (45 * Math.PI) / 180 / 2;
    const forward = unit(sub(street.target, street.position));
    for (const sample of houseSamples(house)) {
      const angle = Math.acos(Math.min(1, dot(forward, unit(sub(sample, street.position)))));
      expect(angle).toBeLessThan(half);
    }
  });
});

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
