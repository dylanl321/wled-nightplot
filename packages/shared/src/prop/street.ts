/**
 * A street view of the yard: one eye at 1.6 m, looking at the front wall.
 * x runs along the wall, y is up, z is out from the wall (further from the
 * street is larger). z = 0 is the front wall, and there the picture matches
 * the flat drawing. Nothing here is sent to a controller.
 */

/** Metres from the ground to the eye. */
export const STREET_EYE_M = 1.6;
/** Metres from the eye to the front wall. The reference distance. */
export const STREET_FOCAL_M = 8;

export type FlatView = { s: number; ox: number; oy: number };

export type StreetPoint = {
  /** Screen x. */
  x: number;
  /** Screen y. */
  y: number;
  /** Pixels per metre, relative to the flat drawing's scale. 1 at z = 0. */
  scale: number;
  /** 1 at the front wall, a little less further back. */
  fade: number;
};

/**
 * Fit every light into the canvas. The horizon stays about 38% from the top,
 * and the lights use as much of the frame as that allows, up to about 80%.
 */
export function fitStreet(
  width: number,
  height: number,
  points: readonly { x: number; y: number; z: number }[],
  yaw = 0,
): FlatView {
  const horizon = height * 0.375;
  const samples = points.length > 0 ? points : [{ x: -1, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }];
  const probe = { s: 1, ox: 0, oy: STREET_EYE_M };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of samples) {
    const placed = streetProject(point, probe, yaw, 1);
    minX = Math.min(minX, placed.x);
    maxX = Math.max(maxX, placed.x);
    minY = Math.min(minY, placed.y);
    maxY = Math.max(maxY, placed.y);
  }
  const padX = Math.max(12, width * 0.08);
  const padY = Math.max(10, height * 0.06);
  const spanX = Math.max(0.2, maxX - minX);
  let scale = (width - padX * 2) / spanX;
  if (maxY > 0.02) scale = Math.min(scale, (height - padY - horizon) / maxY);
  if (minY < -0.02) scale = Math.min(scale, (horizon - padY) / -minY);
  const s = Math.max(4, scale);
  return {
    s,
    ox: width / 2 - ((minX + maxX) / 2) * s,
    oy: horizon + STREET_EYE_M * s,
  };
}

export function streetProject(
  point: { x: number; y: number; z: number },
  view: FlatView,
  yaw = 0,
  zoom = 1,
): StreetPoint {
  const turn = Math.cos(yaw);
  const side = Math.sin(yaw);
  const x = point.x * turn - point.z * side;
  const z = Math.max(-STREET_FOCAL_M + 0.5, point.x * side + point.z * turn);
  const persp = STREET_FOCAL_M / (STREET_FOCAL_M + z);
  const scale = persp * zoom;
  const horizon = view.oy - STREET_EYE_M * view.s * zoom;
  const ground = horizon + (view.oy - horizon) * persp;
  return {
    x: view.ox + x * view.s * scale,
    y: ground - point.y * view.s * scale,
    scale,
    fade: Math.min(1, Math.max(0.5, 0.55 + 0.45 * persp)),
  };
}
