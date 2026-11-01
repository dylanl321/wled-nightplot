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
 * Project one yard point. `view` is the flat drawing's camera, which is the
 * picture at z = 0. `yaw` turns the eye a little left or right. `zoom` scales
 * the whole picture.
 */
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
