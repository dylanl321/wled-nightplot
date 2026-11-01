/**
 * Camera math for the Konva editor stage. Pure: no Konva, no DOM.
 *
 * The world is metres with y up. The camera is pixels per metre plus the
 * screen position of the world origin. The stage is drawn with
 * `x = ox`, `y = oy`, `scale = ppm`, and children place a world point at
 * `(x, -y)`, so a screen point is `(ox + x·ppm, oy − y·ppm)`.
 *
 * Mapping a pointer to the world in the running stage uses the inverted
 * stage transform (see `editor-stage.tsx`). The helpers here only decide
 * where the camera goes next.
 */

export type Camera = { ppm: number; ox: number; oy: number };
export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type ZoomLimits = { minPpm: number; maxPpm: number };

/** Konva shape name for a press that pans like empty space. */
export const BACKGROUND_NAME = "background";

/** A press that moves less than this (screen px) is a tap, not a pan. */
export const TAP_SLOP_PX = 6;
/** One press of Zoom in or Zoom out. */
export const ZOOM_STEP = 1.25;
export const DEFAULT_LIMITS: ZoomLimits = { minPpm: 2, maxPpm: 800 };
export const FIT_MARGIN: Point = { x: 28, y: 28 };
/** Screen px the zoom buttons take on the right edge (8 px gap + a 44 px button + 4). */
export const CONTROLS_INSET_PX = 56;

export function toScreen(point: Point, camera: Camera): Point {
  return { x: camera.ox + point.x * camera.ppm, y: camera.oy - point.y * camera.ppm };
}

export function toWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.ox) / camera.ppm, y: (camera.oy - point.y) / camera.ppm };
}

export function clampPpm(ppm: number, limits: ZoomLimits): number {
  if (!Number.isFinite(ppm)) return limits.minPpm;
  return Math.min(limits.maxPpm, Math.max(limits.minPpm, ppm));
}

/** Scale by `factor` while the world point under `at` (screen px) stays under it. */
export function zoomAt(camera: Camera, factor: number, at: Point, limits: ZoomLimits): Camera {
  const world = toWorld(at, camera);
  const ppm = clampPpm(camera.ppm * factor, limits);
  return { ppm, ox: at.x - world.x * ppm, oy: at.y + world.y * ppm };
}

/** Zoom about the centre of the view, for the Zoom in / Zoom out buttons. */
export function zoomStep(camera: Camera, direction: 1 | -1, size: Size, limits: ZoomLimits): Camera {
  const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
  return zoomAt(camera, factor, { x: size.w / 2, y: size.h / 2 }, limits);
}

/**
 * One frame of a two-finger pinch. The world point under the old midpoint
 * lands under the new midpoint, so the fingers both zoom and carry the pan.
 */
export function pinchStep(
  camera: Camera,
  before: readonly [Point, Point],
  after: readonly [Point, Point],
  limits: ZoomLimits,
): Camera {
  const d0 = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
  const d1 = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
  const m0 = midpoint(before[0], before[1]);
  const m1 = midpoint(after[0], after[1]);
  const world = toWorld(m0, camera);
  const ppm = d0 > 0 && d1 > 0 ? clampPpm(camera.ppm * (d1 / d0), limits) : camera.ppm;
  return { ppm, ox: m1.x - world.x * ppm, oy: m1.y + world.y * ppm };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, ox: camera.ox + dx, oy: camera.oy + dy };
}

/**
 * Centre `bounds` in `size` with a margin. A tiny or empty box keeps a
 * minimum span. `rightInset` keeps that many px on the right clear, so the
 * zoom buttons never sit on top of a corner.
 */
export type FitPad = { top?: number; right?: number; bottom?: number; left?: number };

export function fitCamera(
  bounds: Bounds,
  size: Size,
  limits: ZoomLimits,
  options: { margin?: Point; minSpanM?: number; rightInset?: number; pad?: FitPad } = {},
): Camera {
  const margin = options.margin ?? FIT_MARGIN;
  const pad = options.pad ?? {};
  const left = Math.max(0, pad.left ?? 0);
  const right = Math.max(0, (options.rightInset ?? 0) + (pad.right ?? 0));
  const top = Math.max(0, pad.top ?? 0);
  const bottom = Math.max(0, pad.bottom ?? 0);
  const minSpan = options.minSpanM ?? 0.5;
  const worldW = Math.max(bounds.maxX - bounds.minX, minSpan);
  const worldH = Math.max(bounds.maxY - bounds.minY, minSpan);
  const roomW = Math.max(40, size.w - left - right - margin.x * 2);
  const roomH = Math.max(40, size.h - top - bottom - margin.y * 2);
  const ppm = clampPpm(Math.min(roomW / worldW, roomH / worldH), limits);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const centerX = left + margin.x + roomW / 2;
  const centerY = top + margin.y + roomH / 2;
  return { ppm, ox: centerX - cx * ppm, oy: centerY + cy * ppm };
}

/**
 * Zoom factor for one wheel event. A trackpad pinch arrives as a wheel with
 * `ctrlKey`, in small steps, so it gets a stronger gain than a mouse notch.
 */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const gain = ctrlKey ? 0.01 : 0.002;
  return Math.min(2, Math.max(0.5, Math.exp(-px * gain)));
}

export function isTap(start: Point, end: Point, slop = TAP_SLOP_PX): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) < slop;
}

export function boundsOf(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** World grid lines visible in the view, capped so a far zoom never draws thousands. */
export function gridLines(camera: Camera, size: Size, stepM: number, cap = 120): { xs: number[]; ys: number[] } {
  if (!(stepM > 0) || size.w <= 0 || size.h <= 0) return { xs: [], ys: [] };
  const topLeft = toWorld({ x: 0, y: 0 }, camera);
  const bottomRight = toWorld({ x: size.w, y: size.h }, camera);
  let step = stepM;
  while ((bottomRight.x - topLeft.x) / step + (topLeft.y - bottomRight.y) / step > cap) step *= 2;
  const xs: number[] = [];
  for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) xs.push(round(x));
  const ys: number[] = [];
  for (let y = Math.floor(bottomRight.y / step) * step; y <= topLeft.y; y += step) ys.push(round(y));
  return { xs, ys };
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
