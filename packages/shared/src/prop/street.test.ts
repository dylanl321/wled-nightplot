import { describe, expect, it } from "vitest";
import { STREET_EYE_M, fitStreet, streetProject } from "./street.ts";

const view = { s: 40, ox: 200, oy: 300 };

describe("street projection", () => {
  it("matches the front-on drawing at depth 0", () => {
    const point = streetProject({ x: 2, y: 3, z: 0 }, view);
    expect(point.x).toBeCloseTo(view.ox + 2 * view.s, 5);
    expect(point.y).toBeCloseTo(view.oy - 3 * view.s, 5);
    expect(point.scale).toBeCloseTo(1, 5);
    expect(point.fade).toBeCloseTo(1, 5);
  });

  it("draws a nearer prop bigger, and a further one smaller and closer to the horizon", () => {
    const near = streetProject({ x: 0, y: 1, z: -3 }, view);
    const wall = streetProject({ x: 0, y: 1, z: 0 }, view);
    const far = streetProject({ x: 0, y: 1, z: 6 }, view);
    const horizon = view.oy - STREET_EYE_M * view.s;
    expect(near.scale).toBeGreaterThan(wall.scale);
    expect(far.scale).toBeLessThan(wall.scale);
    expect(Math.abs(far.y - horizon)).toBeLessThan(Math.abs(wall.y - horizon));
    expect(Math.abs(near.y - horizon)).toBeGreaterThan(Math.abs(wall.y - horizon));
    expect(far.fade).toBeLessThan(wall.fade);
  });

  it("fits the lights under a horizon in the top third", () => {
    const lights = [
      { x: -3, y: 3, z: 0 },
      { x: 3, y: 3, z: 0 },
      { x: 0, y: 0, z: -4 },
      { x: 0, y: 1.6, z: -4 },
    ];
    const view = fitStreet(800, 600, lights);
    const horizon = view.oy - STREET_EYE_M * view.s;
    expect(horizon / 600).toBeGreaterThan(0.35);
    expect(horizon / 600).toBeLessThan(0.4);
    const placed = lights.map((point) => streetProject(point, view));
    const top = Math.min(...placed.map((point) => point.y));
    const bottom = Math.max(...placed.map((point) => point.y));
    expect((bottom - top) / 600).toBeGreaterThan(0.7);
    expect(top).toBeGreaterThan(8);
    expect(bottom).toBeLessThan(592);
    expect(Math.min(...placed.map((point) => point.x))).toBeGreaterThan(8);
    expect(Math.max(...placed.map((point) => point.x))).toBeLessThan(792);
  });
});
