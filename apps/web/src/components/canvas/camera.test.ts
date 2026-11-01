import { describe, expect, it } from "vitest";
import {
  boundsOf,
  clampPpm,
  fitCamera,
  gridLines,
  isTap,
  panBy,
  pinchStep,
  toScreen,
  toWorld,
  wheelFactor,
  wheelGesture,
  zoomLimited,
  zoomAt,
  zoomStep,
  type Camera,
} from "./camera";

const limits = { minPpm: 5, maxPpm: 500 };
const camera: Camera = { ppm: 50, ox: 100, oy: 300 };

function close(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe("camera", () => {
  it("maps world metres to screen with y up, and back", () => {
    expect(toScreen({ x: 2, y: 1 }, camera)).toEqual({ x: 200, y: 250 });
    close(toWorld({ x: 200, y: 250 }, camera), { x: 2, y: 1 });
  });

  it("zooms toward the pointer: the world point under it stays put", () => {
    const at = { x: 260, y: 140 };
    const before = toWorld(at, camera);
    const next = zoomAt(camera, 1.7, at, limits);
    expect(next.ppm).toBeCloseTo(85);
    close(toWorld(at, next), before);
  });

  it("clamps zoom and keeps the anchor at the limit", () => {
    const at = { x: 10, y: 20 };
    const before = toWorld(at, camera);
    const far = zoomAt(camera, 100, at, limits);
    expect(far.ppm).toBe(500);
    close(toWorld(at, far), before);
    expect(zoomAt(camera, 0.001, at, limits).ppm).toBe(5);
    expect(clampPpm(Number.NaN, limits)).toBe(5);
  });

  it("zoom buttons step about the centre of the view", () => {
    const size = { w: 400, h: 600 };
    const centre = toWorld({ x: 200, y: 300 }, camera);
    const inward = zoomStep(camera, 1, size, limits);
    const outward = zoomStep(inward, -1, size, limits);
    expect(inward.ppm).toBeCloseTo(62.5);
    close(toWorld({ x: 200, y: 300 }, inward), centre);
    expect(outward.ppm).toBeCloseTo(50);
  });

  it("pinch zooms about the old midpoint and carries it to the new one", () => {
    const before = [{ x: 100, y: 100 }, { x: 200, y: 100 }] as const;
    const after = [{ x: 120, y: 150 }, { x: 320, y: 150 }] as const;
    const anchor = toWorld({ x: 150, y: 100 }, camera);
    const next = pinchStep(camera, before, after, limits);
    expect(next.ppm).toBeCloseTo(100);
    close(toWorld({ x: 220, y: 150 }, next), anchor);
  });

  it("a pinch with fingers on one spot pans without a divide by zero", () => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }] as const;
    const moved = [{ x: 60, y: 70 }, { x: 60, y: 70 }] as const;
    const next = pinchStep(camera, same, moved, limits);
    expect(next.ppm).toBe(50);
    expect(next.ox).toBeCloseTo(110);
    expect(next.oy).toBeCloseTo(320);
  });

  it("pans by screen pixels", () => {
    expect(panBy(camera, 5, -7)).toEqual({ ppm: 50, ox: 105, oy: 293 });
  });

  it("fit centres the bounds inside the margin", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 2 };
    const size = { w: 456, h: 856 };
    const fitted = fitCamera(bounds, size, limits);
    expect(fitted.ppm).toBeCloseTo(100);
    close(toScreen({ x: 2, y: 1 }, fitted), { x: 228, y: 428 });
    const left = toScreen({ x: 0, y: 0 }, fitted);
    expect(left.x).toBeCloseTo(28);
  });

  it("fit keeps the zoom buttons' strip clear on the right", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 1 };
    const fitted = fitCamera(bounds, { w: 456, h: 856 }, limits, { rightInset: 56 });
    const right = toScreen({ x: 4, y: 0 }, fitted);
    expect(right.x).toBeCloseTo(456 - 56 - 28);
    expect(toScreen({ x: 0, y: 0 }, fitted).x).toBeCloseTo(28);
  });

  it("fit leaves room above the drawing for labels and the zoom controls", () => {
    const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 2 };
    const fitted = fitCamera(bounds, { w: 456, h: 856 }, limits, { rightInset: 56, pad: { top: 52, left: 24 } });
    const top = toScreen({ x: 2, y: 2 }, fitted);
    const left = toScreen({ x: 0, y: 1 }, fitted);
    expect(top.y).toBeGreaterThanOrEqual(52 + 28 - 1);
    expect(left.x).toBeGreaterThanOrEqual(24 + 28 - 1);
  });

  it("fit keeps a minimum span for a single point", () => {
    const fitted = fitCamera({ minX: 3, minY: 3, maxX: 3, maxY: 3 }, { w: 300, h: 300 }, limits, { minSpanM: 1 });
    expect(fitted.ppm).toBeCloseTo(244);
    close(toScreen({ x: 3, y: 3 }, fitted), { x: 150, y: 150 });
  });

  it("a mouse wheel zooms and a trackpad scroll pans", () => {
    expect(wheelGesture({ deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("zoom");
    expect(wheelGesture({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false, metaKey: false })).toBe("zoom");
    expect(wheelGesture({ deltaX: -4, deltaY: -6, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("pan");
    expect(wheelGesture({ deltaX: 0, deltaY: -8, deltaMode: 0, ctrlKey: true, metaKey: false })).toBe("zoom");
    expect(zoomLimited(4000, 1.1, { minPpm: 2, maxPpm: 4000 })).toBe("in");
    expect(zoomLimited(2, 0.5, { minPpm: 2, maxPpm: 4000 })).toBe("out");
    expect(zoomLimited(100, 1.1, { minPpm: 2, maxPpm: 4000 })).toBeNull();
  });

  it("a wheel down zooms out, up zooms in, and a trackpad pinch is stronger", () => {
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
    expect(wheelFactor(-1e6, 0, false)).toBe(2);
    expect(wheelFactor(3, 1, false)).toBeCloseTo(wheelFactor(48, 0, false));
  });

  it("tells a tap from a pan by the slop", () => {
    expect(isTap({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(false);
  });

  it("bounds of points, and none for an empty list", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: 1, y: -2 }, { x: -3, y: 4 }])).toEqual({ minX: -3, minY: -2, maxX: 1, maxY: 4 });
  });

  it("grid lines cover the view and stay capped when zoomed far out", () => {
    const near = gridLines({ ppm: 100, ox: 0, oy: 200 }, { w: 300, h: 200 }, 0.5);
    expect(near.xs[0]).toBe(0);
    expect(near.xs.at(-1)).toBe(3);
    expect(near.ys).toEqual([0, 0.5, 1, 1.5, 2]);
    const far = gridLines({ ppm: 1, ox: 0, oy: 1000 }, { w: 2000, h: 1000 }, 0.1, 120);
    expect(far.xs.length + far.ys.length).toBeLessThanOrEqual(124);
  });
});
