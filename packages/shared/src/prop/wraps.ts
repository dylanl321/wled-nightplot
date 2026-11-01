/**
 * Shapes that wrap or fold: a spiral around a post, tree, mailbox or plant,
 * and a zigzag across a bush. Both are drawn front-on, in metres, y up, like
 * every other prop. Plus the install guide: which light number goes where,
 * so the string can be put up at the spacing the drawing assumes.
 */

import type { LayoutCorner, LayoutEdge, LayoutUnits, PropLayout, StringLight } from "./layout.ts";

/** Most turns a spiral can have. 8 ft at 1 in apart is 96. */
export const SPIRAL_MAX_TURNS = 200;
/** Most passes a zigzag can have. */
export const ZIGZAG_MAX_PASSES = 64;

export type SpiralInput = {
  /** Metres from the bottom wrap to the top wrap. */
  heightM: number;
  /** Metres around at the bottom (a tape around the post or the tree's base). */
  aroundM: number;
  /** Metres around at the top. 0 is a point, like a tree's tip. Same as `aroundM` for a post. */
  aroundTopM: number;
  /** Metres up from one wrap to the next, measured on the same side. */
  gapM: number;
};

export type ZigzagDirection = "vertical" | "horizontal";

export type ZigzagInput = {
  widthM: number;
  heightM: number;
  /** Straight passes. Vertical passes go up and down while moving across; horizontal passes go side to side while moving up. */
  passes: number;
  direction: ZigzagDirection;
};

/** Turns on a spiral: height ÷ gap, never more than SPIRAL_MAX_TURNS. Null when the sizes are not usable. */
export function spiralTurns(input: Pick<SpiralInput, "heightM" | "gapM">): number | null {
  if (!(input.heightM > 0) || !(input.gapM > 0)) return null;
  const turns = input.heightM / input.gapM;
  if (!Number.isFinite(turns) || turns < 0.5 || turns > SPIRAL_MAX_TURNS) return null;
  return turns;
}

/**
 * Real length along a spiral (a helix on a cylinder or a cone), by adding up
 * short straight steps. On a cylinder this is turns × √(around² + gap²).
 */
export function spiralLengthM(input: SpiralInput, fromT = 0, toT = 1): number {
  const turns = spiralTurns(input);
  if (turns === null) return 0;
  const steps = Math.max(8, Math.ceil(turns * 96 * Math.abs(toT - fromT)));
  let total = 0;
  let previous = helixPoint(input, turns, fromT);
  for (let step = 1; step <= steps; step += 1) {
    const point = helixPoint(input, turns, fromT + ((toT - fromT) * step) / steps);
    total += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    previous = point;
  }
  return total;
}

function helixPoint(input: SpiralInput, turns: number, t: number): { x: number; y: number; z: number } {
  const radius = radiusAt(input, t);
  const angle = 2 * Math.PI * turns * t;
  return { x: -radius * Math.cos(angle), y: input.heightM * t, z: radius * Math.sin(angle) };
}

function radiusAt(input: SpiralInput, t: number): number {
  const bottom = input.aroundM / (2 * Math.PI);
  const top = Math.max(0, input.aroundTopM) / (2 * Math.PI);
  return bottom + (top - bottom) * t;
}

/**
 * A spiral seen from the front. Each run is half a turn: the string starts on
 * the left edge, crosses the front to the right edge ("Wrap 1 front"), then
 * goes round the back to the left edge ("Wrap 1 back"). Each run keeps its
 * real length (`wrapLengthM`), so the light count is the string, not the drawing.
 */
export function spiralLayout(input: SpiralInput & { units: LayoutUnits; pitchM: number; params: Record<string, number> }): PropLayout | null {
  const turns = spiralTurns(input);
  if (turns === null || !(input.aroundM > 0) || input.aroundTopM < 0 || !(input.pitchM > 0)) return null;
  const halves = turns * 2;
  const stops: number[] = [];
  for (let k = 0; k <= Math.floor(halves + 1e-9); k += 1) stops.push(k / halves);
  if (1 - stops[stops.length - 1]! > 1e-6) stops.push(1);
  const widest = Math.max(radiusAt(input, 0), radiusAt(input, 1));
  const corners: LayoutCorner[] = stops.map((t, index) => {
    const point = helixPoint(input, turns, t);
    return { id: `c${index + 1}`, x: round(widest + point.x), y: round(point.y) };
  });
  const run: LayoutEdge[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const wrap = Math.floor(index / 2) + 1;
    run.push({
      id: `e${index + 1}`,
      from: corners[index]!.id,
      to: corners[index + 1]!.id,
      kind: "lit",
      name: `Wrap ${wrap} ${index % 2 === 0 ? "front" : "back"}`,
      wrapLengthM: Math.max(1e-6, spiralLengthM(input, stops[index]!, stops[index + 1]!)),
    });
  }
  return { source: "template", template: { type: "spiral", params: input.params }, units: input.units, pitchM: input.pitchM, startOffsetM: 0, corners, run };
}

/**
 * A zigzag over a bush, starting bottom-left. Vertical: up, down, up… while
 * moving right. Horizontal: right, left, right… while moving up. Each pass
 * is one straight run named "Pass n".
 */
export function zigzagLayout(input: ZigzagInput & { units: LayoutUnits; pitchM: number; params: Record<string, number> }): PropLayout | null {
  const passes = Math.round(input.passes);
  if (!(input.widthM > 0) || !(input.heightM > 0) || passes < 1 || passes > ZIGZAG_MAX_PASSES || !(input.pitchM > 0)) return null;
  const corners: LayoutCorner[] = [];
  for (let index = 0; index <= passes; index += 1) {
    const step = index / passes;
    const high = index % 2 === 1;
    const point = input.direction === "vertical"
      ? { x: input.widthM * step, y: high ? input.heightM : 0 }
      : { x: high ? input.widthM : 0, y: input.heightM * step };
    corners.push({ id: `c${index + 1}`, x: round(point.x), y: round(point.y) });
  }
  const run: LayoutEdge[] = [];
  for (let index = 0; index < passes; index += 1) {
    run.push({ id: `e${index + 1}`, from: corners[index]!.id, to: corners[index + 1]!.id, kind: "lit", name: `Pass ${index + 1}` });
  }
  return { source: "template", template: { type: "zigzag", params: input.params }, units: input.units, pitchM: input.pitchM, startOffsetM: 0, corners, run };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A light to find while installing. `number` counts from 1 at the wire-in, like counting by hand. */
export type GuideLight = {
  stringId: string;
  number: number;
  x: number;
  y: number;
  edgeId: string;
};

export type GuideHeight = GuideLight & {
  /** Metres above the bottom of the prop. */
  heightM: number;
};

export type GuideTurn = GuideLight & {
  /** The run that starts at this corner, such as "Wrap 3 front" or "Pass 2". */
  runName: string | null;
};

export type InstallGuide = {
  /** Every `everyLights`th light: 20, 40, 60… */
  counts: GuideLight[];
  /** The first light at or above each height step: 1 ft, 2 ft… */
  heights: GuideHeight[];
  /** The first light of each run after the first: where each wrap or pass begins. */
  turns: GuideTurn[];
};

/**
 * Where lights go, for putting the string up. Works on any drawing: counts
 * every N lights along each string, the first light at each height step
 * (a spiral rises evenly, so this is where to be at 1 ft, 2 ft…), and the
 * light that starts each run.
 */
export function installGuide(
  layout: PropLayout,
  lights: readonly StringLight[],
  options: { everyLights?: number; everyHeightM?: number },
): InstallGuide {
  const counts: GuideLight[] = [];
  const heights: GuideHeight[] = [];
  const turns: GuideTurn[] = [];
  const edgeString = new Map<string, string>();
  const runName = new Map<string, string | null>();
  const firstRun = new Set<string>();
  const strings = layout.strings && layout.strings.length > 0 ? layout.strings : [{ id: "s1", startId: layout.run[0]?.from ?? "", run: layout.run }];
  for (const string of strings) {
    const lit = string.run.filter((edge) => edge.kind === "lit");
    if (lit[0]) firstRun.add(lit[0].id);
    for (const edge of string.run) {
      edgeString.set(edge.id, string.id);
      runName.set(edge.id, edge.name ?? null);
    }
  }
  const byString = new Map<string, StringLight[]>();
  for (const light of lights) {
    const id = edgeString.get(light.edgeId) ?? "s1";
    const list = byString.get(id) ?? [];
    list.push(light);
    byString.set(id, list);
  }
  const bottom = layout.corners.length > 0 ? Math.min(...layout.corners.map((corner) => corner.y)) : 0;
  const every = options.everyLights && options.everyLights > 0 ? Math.round(options.everyLights) : 0;
  const step = options.everyHeightM && options.everyHeightM > 0 ? options.everyHeightM : 0;
  for (const [stringId, list] of byString) {
    let seenEdge: string | null = null;
    let nextHeight = step;
    for (const light of list) {
      const number = light.index + 1;
      const mark = { stringId, number, x: light.x, y: light.y, edgeId: light.edgeId };
      if (every && number % every === 0) counts.push(mark);
      if (light.edgeId !== seenEdge) {
        if (seenEdge !== null || !firstRun.has(light.edgeId)) turns.push({ ...mark, runName: runName.get(light.edgeId) ?? null });
        seenEdge = light.edgeId;
      }
      if (step) {
        const above = light.y - bottom;
        while (above + 1e-9 >= nextHeight && nextHeight <= 1000) {
          heights.push({ ...mark, heightM: nextHeight });
          nextHeight += step;
        }
      }
    }
  }
  return { counts, heights, turns };
}

/**
 * The space between wraps that uses up a string of `lights` at `pitchM`
 * (light to light), on this post or tree. Null when the string is too short
 * to make half a turn, or long enough to need more than SPIRAL_MAX_TURNS.
 * A pixel string's spacing is fixed, so on a spiral the wraps move, not the lights.
 */
export function spiralGapForLights(input: Omit<SpiralInput, "gapM">, lights: number, pitchM: number): number | null {
  if (!Number.isInteger(lights) || lights < 1 || !(pitchM > 0) || !(input.heightM > 0) || !(input.aroundM > 0)) return null;
  const target = lights * pitchM;
  const lengthAt = (gapM: number) => spiralLengthM({ ...input, gapM });
  let tight = input.heightM / SPIRAL_MAX_TURNS;
  let loose = input.heightM / 0.5;
  if (lengthAt(tight) < target || lengthAt(loose) > target) return null;
  for (let step = 0; step < 60; step += 1) {
    const mid = (tight + loose) / 2;
    if (lengthAt(mid) > target) tight = mid;
    else loose = mid;
  }
  return (tight + loose) / 2;
}
