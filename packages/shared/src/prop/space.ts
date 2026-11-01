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
        y: round3(pose.y + pose.heightM + local.y),
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

function round3(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}
