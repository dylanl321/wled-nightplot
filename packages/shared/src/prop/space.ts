/**
 * Where each light sits in the yard.
 *
 * The ground is metres: x along the house, y up, z out from the front wall.
 * An upright prop uses the drawing as that front wall, so a point saved with
 * only x and y still stands on the wall. A flat prop lays the drawing on
 * the ground. Nothing here is sent to a controller.
 */
import { cornerById, edgeLightCount, layoutStrings, type PropLayout } from "./layout.ts";
import { yardPlacements } from "./yard.ts";
import type { Prop, PropMount, PropYardPoint } from "./types.ts";

export type YardPose = {
  x: number;
  y: number;
  depth: number;
  facing: number;
  mount: PropMount;
  heightM: number;
};

/** A point with the optional fields filled in. Does not rewrite the saved point. */
export function yardPose(point: PropYardPoint | undefined): YardPose {
  return {
    x: point?.x ?? 0,
    y: point?.y ?? 0,
    depth: point?.depth ?? 0,
    facing: point?.facing ?? 0,
    mount: point?.mount ?? "upright",
    heightM: point?.heightM ?? 0,
  };
}

/**
 * The point to store. A write that only moves x and y keeps the rest.
 * Defaults are left off, so an older point stays `{ x, y }`.
 */
export function yardPointForStore(incoming: PropYardPoint, previous?: PropYardPoint): PropYardPoint {
  const depth = incoming.depth !== undefined ? incoming.depth : previous?.depth;
  const facing = incoming.facing !== undefined ? incoming.facing : previous?.facing;
  const mount = incoming.mount !== undefined ? incoming.mount : previous?.mount;
  const heightM = incoming.heightM !== undefined ? incoming.heightM : previous?.heightM;
  const point: PropYardPoint = { x: round3(incoming.x), y: round3(incoming.y) };
  if (depth !== undefined && depth !== 0) point.depth = round3(depth);
  if (facing !== undefined && facing !== 0) point.facing = round3(facing);
  if (mount === "flat") point.mount = "flat";
  if (heightM !== undefined && heightM !== 0) point.heightM = round3(heightM);
  return point;
}

export type LayoutLightPoint = {
  stringId: string;
  /** Path index on the string. A hidden run takes indexes and is not drawn. */
  index: number;
  edgeId: string;
  x: number;
  y: number;
};

/**
 * One point per lit light, in path order. Lights are spaced along the run.
 * The far corner belongs to the next run, so it is not a second light.
 */
export function layoutLightPoints(layout: PropLayout): LayoutLightPoint[] {
  const points: LayoutLightPoint[] = [];
  for (const string of layoutStrings(layout)) {
    let index = 0;
    for (const edge of string.run) {
      const count = edge.kind === "wire" ? 0 : edgeLightCount(layout, edge);
      if (edge.kind !== "lit" || count < 1) {
        index += count;
        continue;
      }
      const from = cornerById(layout, edge.from);
      const to = cornerById(layout, edge.to);
      if (!from || !to) {
        index += count;
        continue;
      }
      for (let light = 0; light < count; light += 1) {
        const along = light / count;
        points.push({
          stringId: string.id,
          index,
          edgeId: edge.id,
          x: from.x + (to.x - from.x) * along,
          y: from.y + (to.y - from.y) * along,
        });
        index += 1;
      }
    }
  }
  return points;
}

export type YardLight = LayoutLightPoint & {
  propId: string;
  z: number;
};

/** Turn one drawing point into a yard point. */
export function placeYardLight(local: { x: number; y: number }, pose: YardPose): { x: number; y: number; z: number } {
  const rad = (pose.facing * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  switch (pose.mount) {
    case "flat":
      return {
        x: round3(pose.x + local.x * cos - local.y * sin),
        y: round3(pose.heightM),
        z: round3(pose.depth + local.x * sin + local.y * cos),
      };
    case "upright":
      return {
        x: round3(pose.x + local.x * cos),
        // heightM is how high the prop stands. An older point has no heightM, so y is that height.
        y: round3((pose.heightM > 0 ? pose.heightM : pose.y) + local.y),
        z: round3(pose.depth + local.x * sin),
      };
    default: {
      const _never: never = pose.mount;
      return _never;
    }
  }
}

/** Every lit light in the yard, using each prop's saved point or its default slot. */
export function yardLightPositions(props: readonly Pick<Prop, "id" | "layout" | "yard">[]): YardLight[] {
  const placements = yardPlacements(props);
  const lights: YardLight[] = [];
  for (const prop of props) {
    if (!prop.layout) continue;
    const at = placements.find((row) => row.propId === prop.id)?.at;
    const pose = yardPose(at);
    for (const light of layoutLightPoints(prop.layout)) {
      lights.push({ propId: prop.id, ...light, ...placeYardLight(light, pose) });
    }
  }
  return lights;
}

export type YardView = "street" | "overhead" | "prop";

export type YardCamera = {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
};

/**
 * Street looks from the road at eye height (1.6 m). Overhead looks down.
 * This prop frames one prop, or the first prop when none is picked.
 * The eye stays above the ground.
 */
export function yardCamera(input: {
  view: YardView;
  lights: readonly { propId?: string; x: number; y: number; z: number }[];
  propId?: string | null;
  /** Included so Street fits the house as well as the lights. */
  house?: { footprint: readonly { x: number; z: number }[]; eaveM: number; ridgeM: number } | null;
}): YardCamera {
  const focusId = input.view === "prop" ? (input.propId ?? input.lights[0]?.propId ?? null) : null;
  const lights = focusId ? input.lights.filter((light) => light.propId === focusId) : input.lights;
  const box = lightBox(lights.length > 0 ? lights : input.lights);
  if (input.view !== "prop" && input.house && input.house.footprint.length > 0) {
    const peak = input.house.eaveM + input.house.ridgeM;
    for (const corner of input.house.footprint) {
      box.minX = Math.min(box.minX, corner.x);
      box.maxX = Math.max(box.maxX, corner.x);
      box.minZ = Math.min(box.minZ, corner.z);
      box.maxZ = Math.max(box.maxZ, corner.z);
      box.minY = Math.min(box.minY, 0);
      box.maxY = Math.max(box.maxY, peak);
    }
  }
  const center = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
    z: (box.minZ + box.maxZ) / 2,
  };
  box.minX -= 0.45;
  box.maxX += 0.45;
  box.minY -= 0.25;
  box.maxY += 0.45;
  box.minZ -= 0.45;
  box.maxZ += 0.45;
  const half = Math.tan((45 * Math.PI) / 180 / 2);
  const fit = Math.max(
    (box.maxX - box.minX) / 2,
    Math.max(box.maxY - 1.6, 1.6 - Math.min(box.minY, 1.6), 1),
    1,
  ) / half * 1.35;
  if (input.view === "overhead") {
    const dist = Math.max(18, fit * 1.8);
    return {
      position: { x: round3(center.x), y: round3(dist), z: round3(center.z + dist * 0.12) },
      target: { x: round3(center.x), y: 0, z: round3(center.z) },
    };
  }
  const eyeY = input.view === "prop" ? Math.max(1.6, center.y) : 1.6;
  const lookY = input.view === "street" ? round3(Math.min(Math.max(center.y, 1.2), box.maxY)) : round3(center.y);
  const target = { x: round3(center.x), y: lookY, z: round3(center.z) };
  if (input.view === "street") {
    // Front-left, so the front eave and the near gable end are both in view. Eye stays at 1.6 m.
    const azimuth = (40 * Math.PI) / 180;
    const half = (45 * Math.PI) / 180 / 2;
    let dist = Math.max(6, fit);
    let eye = { x: center.x, y: eyeY, z: box.minZ - dist };
    for (let step = 0; step < 12; step += 1) {
      eye = {
        x: center.x - Math.sin(azimuth) * dist,
        y: eyeY,
        z: center.z - Math.cos(azimuth) * dist,
      };
      if (eye.z < box.minZ && worstCorner(eye, target, box) < half * 0.9) break;
      dist *= 1.16;
    }
    return {
      position: { x: round3(eye.x), y: round3(eye.y), z: round3(eye.z) },
      target,
    };
  }
  const back = input.view === "prop" ? Math.max(1.6, fit * 0.65) : Math.max(4, fit);
  return {
    position: { x: round3(center.x), y: round3(eyeY), z: round3(box.minZ - back) },
    target,
  };
}

function worstCorner(
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  box: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
): number {
  const forward = unit3(target.x - eye.x, target.y - eye.y, target.z - eye.z);
  let worst = 0;
  for (const x of [box.minX, box.maxX]) {
    for (const y of [box.minY, box.maxY]) {
      for (const z of [box.minZ, box.maxZ]) {
        const to = unit3(x - eye.x, y - eye.y, z - eye.z);
        const angle = Math.acos(Math.min(1, forward.x * to.x + forward.y * to.y + forward.z * to.z));
        if (angle > worst) worst = angle;
      }
    }
  }
  return worst;
}

function unit3(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function lightBox(lights: readonly { x: number; y: number; z: number }[]): {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
} {
  if (lights.length === 0) return { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: 0, maxZ: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const light of lights) {
    minX = Math.min(minX, light.x);
    maxX = Math.max(maxX, light.x);
    minY = Math.min(minY, light.y);
    maxY = Math.max(maxY, light.y);
    minZ = Math.min(minZ, light.z);
    maxZ = Math.max(maxZ, light.z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

const DRAG_STEP_M = 0.1;

/** Move a prop on the ground. x is along the house, depth is out from the wall. */
export function dragOnGround(input: {
  point: PropYardPoint;
  from: { x: number; z: number };
  to: { x: number; z: number };
}): PropYardPoint {
  const x = snapStep(input.point.x + (input.to.x - input.from.x));
  const depth = snapStep((input.point.depth ?? 0) + (input.to.z - input.from.z));
  return yardPointForStore({ ...input.point, x, depth }, input.point);
}

/** Turn about the vertical, 45 degrees at a time. */
export function turnYardPoint(point: PropYardPoint, degrees = 45): PropYardPoint {
  const facing = snapStep((((point.facing ?? 0) + degrees) % 360 + 360) % 360);
  return yardPointForStore({ ...inputFacing(point, facing) }, point);
}

/** Stand the drawing up, or lay it on the ground. */
export function toggleYardMount(point: PropYardPoint): PropYardPoint {
  const mount = point.mount === "flat" ? "upright" : "flat";
  return yardPointForStore({ ...point, mount }, point);
}

function inputFacing(point: PropYardPoint, facing: number): PropYardPoint {
  return { ...point, facing };
}

function snapStep(value: number): number {
  return Math.round(value / DRAG_STEP_M) * DRAG_STEP_M;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}
