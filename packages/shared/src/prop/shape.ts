/**
 * The shape reader. It turns a drawn prop into labels an effect can use
 * instead of light 1, 2, 3: which lights are border and which are inside,
 * where the corners, ends and junctions are, the sides of the outline, the
 * mirror lines, and a set of 0–1 fields per light (position, distance from
 * the centre, angle, distance along the wires, depth inside the outline,
 * height).
 *
 * Plain geometry over the layout. It reads the drawing and writes nothing.
 * Design: docs/shape-aware-effects.md.
 */

import { cornerById, drawnLengthM, layoutStrings, stringLights, type PropLayout, type RunKind } from "./layout.ts";

export type ShapeRole = "border" | "inside";

/** How many lit runs meet at a point: one is an end, two a corner or bend, three or more a junction. */
export type ShapePointKind = "end" | "corner" | "bend" | "junction";

/** A sharper turn than this, in degrees between the two runs, is a corner. 180 is straight on. */
export const SHAPE_CORNER_MAX_DEG = 150;

/** How close a mirrored light must land to a real one, in light spacings. */
export const SHAPE_MIRROR_MATCH_PITCH = 0.5;
/** Share of lights that must match for a mirror line to count. */
export const SHAPE_MIRROR_MIN_SCORE = 0.9;

export type ShapePoint = {
  id: string;
  /** Metres, on the drawing. */
  x: number;
  y: number;
  kind: ShapePointKind;
  /** Lit runs meeting here, counting a run that passes through as two. */
  degree: number;
  /** Corners of the layout welded into this point. Empty for a point where two runs cross. */
  cornerIds: string[];
  onBorder: boolean;
  /** The outline (or a lone path) turns sharply here. */
  isCorner: boolean;
  /** Angle between the two runs, measured about one light spacing out. Null unless exactly two runs meet. */
  angleDeg: number | null;
};

/** Every field is 0–1. */
export type ShapeFields = {
  /** Position across, scaled by the larger of width and height so a circle stays round. */
  x: number;
  /** Position up, on the same scale as `x`. */
  y: number;
  /** Straight-line distance from the centre. 1 is the farthest light. */
  r: number;
  /** Angle around the centre, clockwise from straight up. */
  a: number;
  /** Distance along the runs (dark runs included) from the start point. 1 is the farthest light. */
  d: number;
  /** Place on its own run, from the run's start corner, in metres. */
  along: number;
  /** Depth inside the outline. 0 is the border, 1 the deepest light. */
  ring: number;
  /** Height from the lowest light to the highest. */
  h: number;
};

export type ShapeLight = {
  stringId: string;
  edgeId: string;
  /** Stored light id, or null while the run is evenly spaced. */
  id: string | null;
  /** Place on its string, from 0 at the wire-in. */
  index: number;
  /** Metres, on the drawing. */
  x: number;
  y: number;
  role: ShapeRole;
  /** Light spacings from the outline, rounded. 0 on the border. */
  ringSteps: number;
  sideId: string | null;
  /** The link this light sits on, and metres from its `from` point. Null when the run was not found. */
  at: { from: string; to: string; offsetM: number } | null;
  fields: ShapeFields;
};

export type ShapeSide = {
  id: string;
  name: string;
  /** Layout run ids with lights on this side. */
  edgeIds: string[];
  /** Positions in `ShapeProfile.lights`. */
  lights: number[];
};

export type ShapeGroupKind = "border" | "inside" | "side" | "corners" | "corner" | "ends" | "centre";

export type ShapeGroup = {
  id: string;
  kind: ShapeGroupKind;
  name: string;
  /** Positions in `ShapeProfile.lights`, in string order. */
  lights: number[];
};

/** A closed area of the drawing, its points in order around it. */
export type ShapeFace = {
  pointIds: string[];
  areaM2: number;
};

export type ShapeMirrorAxis = "vertical" | "horizontal" | "diagonal-up" | "diagonal-down";

export type ShapeMirror = {
  axis: ShapeMirrorAxis;
  /** Share of lights whose mirror image lands on a light. */
  score: number;
};

/** A link between two points, for distances along the runs. */
export type ShapeLink = {
  from: string;
  to: string;
  lengthM: number;
  /** "wire" carries distance but no lights. */
  kind: RunKind;
  onBorder: boolean;
};

/** A person's correction, kept against run and light ids so a redraw keeps it. */
export type ShapeOverride =
  | { edgeId: string; role: ShapeRole }
  | { lightId: string; role: ShapeRole };

export type ShapeProfile = {
  pitchM: number;
  /** Metres. The middle of the lights' bounding box. */
  centre: { x: number; y: number };
  /** Junction nearest the centre, when one sits close to it. */
  centrePointId: string | null;
  /** Where `d` is measured from: the centre junction, else the first wire-in. */
  startPointId: string | null;
  lights: ShapeLight[];
  points: ShapePoint[];
  links: ShapeLink[];
  faces: ShapeFace[];
  sides: ShapeSide[];
  groups: ShapeGroup[];
  mirrors: ShapeMirror[];
};

export type ReadShapeOptions = {
  overrides?: readonly ShapeOverride[];
};

type Vec = { x: number; y: number };

type Segment = {
  edgeId: string;
  kind: RunKind;
  a: Vec;
  b: Vec;
  lengthM: number;
  cornerFrom: string;
  cornerTo: string;
};

type Piece = {
  edgeId: string;
  kind: RunKind;
  /** Metres from the run's start corner. */
  t0: number;
  t1: number;
  from: string;
  to: string;
  linkKey: string;
};

type LinkRow = ShapeLink & { key: string };

const EPS = 1e-9;
const SIDE_SLOPE_TAN = Math.tan((15 * Math.PI) / 180);

/** The same closeness rule the editor uses for corners that should meet. */
export function shapeWeldToleranceM(pitchM: number): number {
  return Math.min(0.05, Math.max(pitchM * 0.5, 0.02));
}

export function readPropShape(layout: PropLayout, options: ReadShapeOptions = {}): ShapeProfile {
  const pitch = layout.pitchM > 0 ? layout.pitchM : 0.1;
  const tol = shapeWeldToleranceM(pitch);
  const strings = layoutStrings(layout);

  // Points: corners welded within the tolerance, plus places where runs cross.
  const pointRows: { id: string; x: number; y: number; cornerIds: string[] }[] = [];
  const pointAt = (x: number, y: number, cornerId?: string): string => {
    let found = pointRows.find((row) => Math.hypot(row.x - x, row.y - y) <= tol + EPS);
    if (!found) {
      found = { id: `p${pointRows.length + 1}`, x, y, cornerIds: [] };
      pointRows.push(found);
    }
    if (cornerId && !found.cornerIds.includes(cornerId)) found.cornerIds.push(cornerId);
    return found.id;
  };

  const segments: Segment[] = [];
  for (const string of strings) {
    for (const edge of string.run) {
      const from = cornerById(layout, edge.from);
      const to = cornerById(layout, edge.to);
      if (!from || !to) continue;
      const lengthM = Math.hypot(to.x - from.x, to.y - from.y);
      pointAt(from.x, from.y, from.id);
      pointAt(to.x, to.y, to.id);
      if (lengthM < EPS) continue;
      segments.push({ edgeId: edge.id, kind: edge.kind, a: from, b: to, lengthM, cornerFrom: from.id, cornerTo: to.id });
    }
  }

  // Split each drawn run where another run touches or crosses it.
  const solid = segments.filter((segment) => segment.kind !== "wire");
  const pieces: Piece[] = [];
  const links = new Map<string, LinkRow>();
  const addPiece = (segment: Segment, t0: number, t1: number, from: string, to: string) => {
    if (from === to) return;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    const a = pointRows.find((row) => row.id === from)!;
    const b = pointRows.find((row) => row.id === to)!;
    const existing = links.get(key);
    if (!existing) {
      links.set(key, { key, from, to, lengthM: Math.hypot(b.x - a.x, b.y - a.y), kind: segment.kind, onBorder: false });
    } else if (existing.kind === "wire" && segment.kind !== "wire") {
      existing.kind = segment.kind;
    }
    pieces.push({ edgeId: segment.edgeId, kind: segment.kind, t0, t1, from, to, linkKey: key });
  };

  for (const segment of solid) {
    const cuts = [0, segment.lengthM];
    for (const other of solid) {
      if (other === segment) continue;
      for (const end of [other.a, other.b]) {
        const t = projectOnto(segment, end);
        if (t !== null && t > tol && t < segment.lengthM - tol && distanceToSegment(end, segment.a, segment.b) <= tol) cuts.push(t);
      }
      const cross = crossingT(segment, other);
      if (cross !== null && cross > tol && cross < segment.lengthM - tol) cuts.push(cross);
    }
    cuts.sort((left, right) => left - right);
    const merged: number[] = [];
    for (const cut of cuts) {
      if (merged.length === 0 || cut - merged[merged.length - 1]! > tol) merged.push(cut);
      else if (cut === segment.lengthM) merged[merged.length - 1] = cut;
    }
    if (merged[merged.length - 1] !== segment.lengthM) merged.push(segment.lengthM);
    const ids = merged.map((t, index) => {
      if (index === 0) return pointAt(segment.a.x, segment.a.y, segment.cornerFrom);
      if (index === merged.length - 1) return pointAt(segment.b.x, segment.b.y, segment.cornerTo);
      const at = lerp(segment, t);
      return pointAt(at.x, at.y);
    });
    for (let index = 0; index < merged.length - 1; index += 1) {
      addPiece(segment, merged[index]!, merged[index + 1]!, ids[index]!, ids[index + 1]!);
    }
  }
  for (const segment of segments) {
    if (segment.kind !== "wire") continue;
    addPiece(segment, 0, segment.lengthM, pointAt(segment.a.x, segment.a.y, segment.cornerFrom), pointAt(segment.b.x, segment.b.y, segment.cornerTo));
  }

  const pointById = new Map(pointRows.map((row) => [row.id, row]));
  const solidLinks = [...links.values()].filter((link) => link.kind !== "wire");
  const neighbours = new Map<string, string[]>();
  for (const link of solidLinks) {
    neighbours.set(link.from, [...(neighbours.get(link.from) ?? []), link.to]);
    neighbours.set(link.to, [...(neighbours.get(link.to) ?? []), link.from]);
  }
  for (const [id, list] of neighbours) {
    const at = pointById.get(id)!;
    list.sort((left, right) => angleOf(at, pointById.get(left)!) - angleOf(at, pointById.get(right)!));
  }

  // Faces. Walk each side of each run, turning as far left as possible; the
  // walk with no area inside it (clockwise, or a bare path) is the outside.
  const faces: ShapeFace[] = [];
  const seen = new Set<string>();
  for (const link of solidLinks) {
    for (const [u0, v0] of [[link.from, link.to], [link.to, link.from]] as const) {
      if (seen.has(`${u0}>${v0}`)) continue;
      const cycle: string[] = [];
      const halfEdges: [string, string][] = [];
      let u = u0;
      let v = v0;
      for (let guard = 0; guard < solidLinks.length * 2 + 2; guard += 1) {
        const key = `${u}>${v}`;
        if (seen.has(key)) break;
        seen.add(key);
        cycle.push(u);
        halfEdges.push([u, v]);
        const around = neighbours.get(v)!;
        const back = around.indexOf(u);
        const next = around[(back - 1 + around.length) % around.length]!;
        u = v;
        v = next;
      }
      const area = signedArea(cycle.map((id) => pointById.get(id)!));
      if (area > EPS) {
        faces.push({ pointIds: cycle, areaM2: area });
      } else {
        for (const [a, b] of halfEdges) links.get(a < b ? `${a}|${b}` : `${b}|${a}`)!.onBorder = true;
      }
    }
  }

  const borderLinks = solidLinks.filter((link) => link.onBorder);
  const borderNeighbours = new Map<string, string[]>();
  for (const link of borderLinks) {
    borderNeighbours.set(link.from, [...(borderNeighbours.get(link.from) ?? []), link.to]);
    borderNeighbours.set(link.to, [...(borderNeighbours.get(link.to) ?? []), link.from]);
  }

  // Points: kind by how many runs meet; a corner is a sharp turn of the outline or of a lone path.
  const walkPoint = (start: string, first: string, graph: Map<string, string[]>): Vec => {
    let previous = start;
    let current = first;
    let travelled = 0;
    let from = pointById.get(start)!;
    for (let guard = 0; guard < pointRows.length + 1; guard += 1) {
      const to = pointById.get(current)!;
      const step = Math.hypot(to.x - from.x, to.y - from.y);
      if (travelled + step >= pitch - EPS || current === start) {
        const need = Math.min(step, pitch - travelled);
        const ratio = step < EPS ? 0 : need / step;
        return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
      }
      travelled += step;
      const onward = (graph.get(current) ?? []).filter((id) => id !== previous);
      if ((graph.get(current) ?? []).length !== 2 || onward.length !== 1) return to;
      previous = current;
      from = to;
      current = onward[0]!;
    }
    return pointById.get(current)!;
  };
  const turnAt = (id: string, graph: Map<string, string[]>): number | null => {
    const around = graph.get(id) ?? [];
    if (around.length !== 2) return null;
    const at = pointById.get(id)!;
    const left = walkPoint(id, around[0]!, graph);
    const right = walkPoint(id, around[1]!, graph);
    const a = { x: left.x - at.x, y: left.y - at.y };
    const b = { x: right.x - at.x, y: right.y - at.y };
    const size = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    if (size < EPS) return null;
    return (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / size))) * 180) / Math.PI;
  };

  const points: ShapePoint[] = [];
  for (const row of pointRows) {
    const degree = (neighbours.get(row.id) ?? []).length;
    if (degree === 0) continue;
    const angleDeg = turnAt(row.id, neighbours);
    const borderAngle = turnAt(row.id, borderNeighbours);
    const onBorder = borderNeighbours.has(row.id);
    const sharp = (angle: number | null) => angle !== null && angle < SHAPE_CORNER_MAX_DEG;
    const kind: ShapePointKind = degree === 1 ? "end" : degree >= 3 ? "junction" : sharp(angleDeg) ? "corner" : "bend";
    points.push({
      id: row.id,
      x: row.x,
      y: row.y,
      kind,
      degree,
      cornerIds: [...row.cornerIds],
      onBorder,
      isCorner: onBorder ? sharp(borderAngle) : sharp(angleDeg),
      angleDeg: angleDeg === null ? null : round(angleDeg, 1),
    });
  }
  const shapePointById = new Map(points.map((point) => [point.id, point]));

  // Lights, each placed on the piece of its run it sits on.
  const marks = stringLights(layout);
  const piecesByEdge = new Map<string, Piece[]>();
  for (const piece of pieces) piecesByEdge.set(piece.edgeId, [...(piecesByEdge.get(piece.edgeId) ?? []), piece]);
  const overrides = options.overrides ?? [];
  const lightRows = marks.map((mark) => {
    const list = piecesByEdge.get(mark.edgeId) ?? [];
    const piece = list.find((row) => mark.alongM >= row.t0 - EPS && mark.alongM <= row.t1 + EPS) ?? list[0] ?? null;
    const link = piece ? links.get(piece.linkKey)! : null;
    let toBorder = Infinity;
    for (const border of borderLinks) {
      const a = pointById.get(border.from)!;
      const b = pointById.get(border.to)!;
      toBorder = Math.min(toBorder, distanceToSegment(mark, a, b));
    }
    let role: ShapeRole = (link?.onBorder || toBorder <= pitch * 0.5 + EPS) ? "border" : "inside";
    const byLight = mark.id ? overrides.find((row) => "lightId" in row && row.lightId === mark.id) : undefined;
    const byEdge = overrides.find((row) => "edgeId" in row && row.edgeId === mark.edgeId);
    if (byLight) role = byLight.role;
    else if (byEdge) role = byEdge.role;
    const ringSteps = role === "border" ? 0 : Number.isFinite(toBorder) ? Math.max(1, Math.round(toBorder / pitch)) : 1;
    return { mark, piece, link, role, ringSteps };
  });

  // Centre, start point and distances along the runs.
  const box = boundsOf(lightRows.length > 0 ? lightRows.map((row) => row.mark) : pointRows);
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const centreReach = Math.max(pitch * 2, span * 0.15);
  let centrePointId: string | null = null;
  let centreBest = Infinity;
  for (const point of points) {
    if (point.kind !== "junction") continue;
    const dist = Math.hypot(point.x - centre.x, point.y - centre.y);
    if (dist <= centreReach && dist < centreBest) {
      centreBest = dist;
      centrePointId = point.id;
    }
  }
  const firstStart = strings[0] ? cornerById(layout, strings[0].startId) : undefined;
  const wireIn = firstStart ? pointRows.find((row) => row.cornerIds.includes(firstStart.id))?.id ?? null : null;
  const startPointId = centrePointId ?? wireIn ?? points[0]?.id ?? null;
  const allLinks = [...links.values()];
  const distances = startPointId ? shortestDistances(allLinks, startPointId) : new Map<string, number>();
  const wireDistance = (row: (typeof lightRows)[number]): number => {
    if (!row.piece) return 0;
    const offset = row.mark.alongM - row.piece.t0;
    const length = row.piece.t1 - row.piece.t0;
    const viaFrom = (distances.get(row.piece.from) ?? Infinity) + offset;
    const viaTo = (distances.get(row.piece.to) ?? Infinity) + (length - offset);
    const best = Math.min(viaFrom, viaTo);
    return Number.isFinite(best) ? best : 0;
  };

  const scale = span > EPS ? span : 1;
  const height = box.maxY - box.minY;
  const radii = lightRows.map((row) => Math.hypot(row.mark.x - centre.x, row.mark.y - centre.y));
  const maxRadius = Math.max(EPS, ...radii);
  const wire = lightRows.map(wireDistance);
  const maxWire = Math.max(EPS, ...wire);
  const maxRing = Math.max(0, ...lightRows.map((row) => row.ringSteps));
  const runLength = new Map<string, number>();
  for (const string of strings) for (const edge of string.run) runLength.set(edge.id, drawnLengthM(layout, edge));

  const lights: ShapeLight[] = lightRows.map((row, index) => {
    const dx = row.mark.x - centre.x;
    const dy = row.mark.y - centre.y;
    const length = runLength.get(row.mark.edgeId) ?? 0;
    return {
      stringId: row.mark.stringId,
      edgeId: row.mark.edgeId,
      id: row.mark.id,
      index: row.mark.index,
      x: row.mark.x,
      y: row.mark.y,
      role: row.role,
      ringSteps: row.ringSteps,
      sideId: null,
      at: row.piece && row.link
        ? row.link.from === row.piece.from
          ? { from: row.link.from, to: row.link.to, offsetM: row.mark.alongM - row.piece.t0 }
          : { from: row.link.from, to: row.link.to, offsetM: row.piece.t1 - row.mark.alongM }
        : null,
      fields: {
        x: unit((row.mark.x - box.minX) / scale),
        y: unit((row.mark.y - box.minY) / scale),
        r: unit(radii[index]! / maxRadius),
        a: Math.hypot(dx, dy) < EPS ? 0 : unit(((Math.atan2(dx, dy) / (Math.PI * 2)) + 1) % 1),
        d: unit(wire[index]! / maxWire),
        along: length > EPS ? unit(row.mark.alongM / length) : 0,
        ring: maxRing > 0 ? unit(row.ringSteps / maxRing) : 0,
        h: height > EPS ? unit((row.mark.y - box.minY) / height) : 0,
      },
    };
  });

  // Sides: the outline cut at its corners, ends and junctions.
  const isBreak = (id: string) => {
    const point = shapePointById.get(id);
    return !point || point.isCorner || (borderNeighbours.get(id) ?? []).length !== 2;
  };
  const sideChains: LinkRow[][] = [];
  const usedLinks = new Set<string>();
  for (const link of borderLinks) {
    if (usedLinks.has(link.key)) continue;
    usedLinks.add(link.key);
    const chain = [link];
    for (const [tip, back] of [[link.to, link.from], [link.from, link.to]] as const) {
      let current = tip;
      let previous = back;
      while (!isBreak(current)) {
        const onward = (borderNeighbours.get(current) ?? []).find((id) => id !== previous);
        if (!onward) break;
        const key = current < onward ? `${current}|${onward}` : `${onward}|${current}`;
        if (usedLinks.has(key)) break;
        usedLinks.add(key);
        chain.push(links.get(key)!);
        previous = current;
        current = onward;
      }
    }
    sideChains.push(chain);
  }
  const sideRows = sideChains.map((chain) => {
    let sx = 0;
    let sy = 0;
    let mx = 0;
    let my = 0;
    let total = 0;
    let rising = 0;
    for (const link of chain) {
      const a = pointById.get(link.from)!;
      const b = pointById.get(link.to)!;
      sx += Math.abs(b.x - a.x);
      sy += Math.abs(b.y - a.y);
      mx += ((a.x + b.x) / 2) * link.lengthM;
      my += ((a.y + b.y) / 2) * link.lengthM;
      total += link.lengthM;
      rising += Math.sign((b.x - a.x) * (b.y - a.y)) * link.lengthM;
    }
    const mid = total > EPS ? { x: mx / total, y: my / total } : centre;
    // Within 15° of level or upright; anything between is a slope (a roof, a tree's side).
    const level = sy <= sx * SIDE_SLOPE_TAN;
    const upright = sx <= sy * SIDE_SLOPE_TAN;
    const offCentre = Math.abs(mid.x - centre.x) > Math.max(EPS, span * 0.1);
    const name = level
      ? (mid.y >= centre.y - EPS ? "Top" : "Bottom")
      : upright
        ? (mid.x >= centre.x - EPS ? "Right" : "Left")
        : offCentre
          ? (mid.x > centre.x ? "Right slope" : "Left slope")
          : (rising >= 0 ? "Rising slope" : "Falling slope");
    const angle = Math.hypot(mid.x - centre.x, mid.y - centre.y) < EPS ? 0 : ((Math.atan2(mid.x - centre.x, mid.y - centre.y) / (Math.PI * 2)) + 1) % 1;
    return { keys: new Set(chain.map((link) => link.key)), name, angle };
  });
  sideRows.sort((left, right) => left.angle - right.angle);
  const nameCount = new Map<string, number>();
  for (const row of sideRows) nameCount.set(row.name, (nameCount.get(row.name) ?? 0) + 1);
  const nameSeen = new Map<string, number>();
  const sides: ShapeSide[] = sideRows.map((row, index) => {
    const nth = (nameSeen.get(row.name) ?? 0) + 1;
    nameSeen.set(row.name, nth);
    const sideLights: number[] = [];
    const edgeIds: string[] = [];
    lightRows.forEach((light, at) => {
      if (light.link && row.keys.has(light.link.key)) {
        sideLights.push(at);
        if (!edgeIds.includes(light.mark.edgeId)) edgeIds.push(light.mark.edgeId);
        lights[at]!.sideId = `side.${index + 1}`;
      }
    });
    return { id: `side.${index + 1}`, name: (nameCount.get(row.name) ?? 0) > 1 ? `${row.name} ${nth}` : row.name, edgeIds, lights: sideLights };
  });

  // Groups.
  const groups: ShapeGroup[] = [];
  const pick = (test: (light: ShapeLight, index: number) => boolean) =>
    lights.flatMap((light, index) => (test(light, index) ? [index] : []));
  const near = (point: Vec, reach: number) => pick((light) => Math.hypot(light.x - point.x, light.y - point.y) <= reach + EPS);
  const zone = pitch * 2;
  groups.push({ id: "border", kind: "border", name: "Border", lights: pick((light) => light.role === "border") });
  const inside = pick((light) => light.role === "inside");
  if (inside.length > 0) groups.push({ id: "inside", kind: "inside", name: "Inside", lights: inside });
  for (const side of sides) groups.push({ id: side.id, kind: "side", name: side.name, lights: side.lights });
  const cornerPoints = points.filter((point) => point.isCorner);
  if (cornerPoints.length > 0) {
    const all = new Set<number>();
    const named = cornerPoints.map((point) => ({ point, name: placeName(point, centre, span) }));
    const cornerCount = new Map<string, number>();
    for (const row of named) cornerCount.set(row.name, (cornerCount.get(row.name) ?? 0) + 1);
    const cornerSeen = new Map<string, number>();
    const cornerGroups: ShapeGroup[] = named.map((row, index) => {
      const nth = (cornerSeen.get(row.name) ?? 0) + 1;
      cornerSeen.set(row.name, nth);
      const members = near(row.point, zone);
      for (const member of members) all.add(member);
      const label = (cornerCount.get(row.name) ?? 0) > 1 ? `${row.name} corner ${nth}` : `${row.name} corner`;
      return { id: `corner.${index + 1}`, kind: "corner", name: label.charAt(0).toUpperCase() + label.slice(1), lights: members };
    });
    groups.push({ id: "corners", kind: "corners", name: "Corners", lights: [...all].sort((a, b) => a - b) });
    groups.push(...cornerGroups);
  }
  const endPoints = points.filter((point) => point.kind === "end");
  if (endPoints.length > 0) {
    const all = new Set<number>();
    for (const point of endPoints) for (const member of near(point, zone)) all.add(member);
    groups.push({ id: "ends", kind: "ends", name: "Ends", lights: [...all].sort((a, b) => a - b) });
  }
  if (centrePointId) {
    groups.push({ id: "centre", kind: "centre", name: "Centre", lights: near(pointById.get(centrePointId)!, zone) });
  }

  return {
    pitchM: pitch,
    centre,
    centrePointId,
    startPointId,
    lights,
    points,
    links: allLinks.map(({ key: _key, ...link }) => link),
    faces,
    sides,
    groups,
    mirrors: findMirrors(lights, centre, pitch),
  };
}

/**
 * Metres along the runs from `pointId` to every light, dark runs included.
 * A light the runs never reach is null.
 */
export function shapeDistancesFrom(shape: ShapeProfile, pointId: string): (number | null)[] {
  const distances = shortestDistances(shape.links, pointId);
  const lengths = new Map(shape.links.map((link) => [`${link.from}|${link.to}`, link.lengthM]));
  return shape.lights.map((light) => {
    if (!light.at) return null;
    const length = lengths.get(`${light.at.from}|${light.at.to}`) ?? 0;
    const best = Math.min(
      (distances.get(light.at.from) ?? Infinity) + light.at.offsetM,
      (distances.get(light.at.to) ?? Infinity) + (length - light.at.offsetM),
    );
    return Number.isFinite(best) ? best : null;
  });
}

function shortestDistances(links: readonly ShapeLink[], start: string): Map<string, number> {
  const adjacent = new Map<string, { id: string; lengthM: number }[]>();
  for (const link of links) {
    adjacent.set(link.from, [...(adjacent.get(link.from) ?? []), { id: link.to, lengthM: link.lengthM }]);
    adjacent.set(link.to, [...(adjacent.get(link.to) ?? []), { id: link.from, lengthM: link.lengthM }]);
  }
  const distances = new Map<string, number>([[start, 0]]);
  const open = new Set<string>([start]);
  while (open.size > 0) {
    let current = "";
    let best = Infinity;
    for (const id of open) {
      const value = distances.get(id)!;
      if (value < best) {
        best = value;
        current = id;
      }
    }
    open.delete(current);
    for (const next of adjacent.get(current) ?? []) {
      const candidate = best + next.lengthM;
      if (candidate < (distances.get(next.id) ?? Infinity) - EPS) {
        distances.set(next.id, candidate);
        open.add(next.id);
      }
    }
  }
  return distances;
}

function findMirrors(lights: readonly ShapeLight[], centre: Vec, pitch: number): ShapeMirror[] {
  if (lights.length < 2) return [];
  const cell = pitch;
  const grid = new Map<string, Vec[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (const light of lights) {
    const key = keyOf(light.x, light.y);
    grid.set(key, [...(grid.get(key) ?? []), light]);
  }
  const reach = pitch * SHAPE_MIRROR_MATCH_PITCH + 1e-6;
  const hasLight = (x: number, y: number) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        for (const other of grid.get(`${cx + i},${cy + j}`) ?? []) {
          if (Math.hypot(other.x - x, other.y - y) <= reach) return true;
        }
      }
    }
    return false;
  };
  const axes: { axis: ShapeMirrorAxis; dir: Vec }[] = [
    { axis: "vertical", dir: { x: 0, y: 1 } },
    { axis: "horizontal", dir: { x: 1, y: 0 } },
    { axis: "diagonal-up", dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
    { axis: "diagonal-down", dir: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } },
  ];
  const found: ShapeMirror[] = [];
  for (const { axis, dir } of axes) {
    let hits = 0;
    for (const light of lights) {
      const px = light.x - centre.x;
      const py = light.y - centre.y;
      const dot = px * dir.x + py * dir.y;
      const mx = centre.x + 2 * dot * dir.x - px;
      const my = centre.y + 2 * dot * dir.y - py;
      if (hasLight(mx, my)) hits += 1;
    }
    const score = hits / lights.length;
    if (score >= SHAPE_MIRROR_MIN_SCORE) found.push({ axis, score: round(score, 3) });
  }
  return found.sort((left, right) => right.score - left.score);
}

function placeName(point: Vec, centre: Vec, span: number): string {
  const slack = Math.max(span * 0.1, EPS);
  const up = point.y > centre.y + slack ? "top" : point.y < centre.y - slack ? "bottom" : "";
  const across = point.x > centre.x + slack ? "right" : point.x < centre.x - slack ? "left" : "";
  return [up, across].filter(Boolean).join(" ") || "middle";
}

function boundsOf(rows: readonly Vec[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (rows.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const row of rows) {
    minX = Math.min(minX, row.x);
    minY = Math.min(minY, row.y);
    maxX = Math.max(maxX, row.x);
    maxY = Math.max(maxY, row.y);
  }
  return { minX, minY, maxX, maxY };
}

function lerp(segment: Segment, t: number): Vec {
  const ratio = t / segment.lengthM;
  return { x: segment.a.x + (segment.b.x - segment.a.x) * ratio, y: segment.a.y + (segment.b.y - segment.a.y) * ratio };
}

/** Metres along `segment` to the foot of `point`, or null when it falls off either end. */
function projectOnto(segment: Segment, point: Vec): number | null {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const t = ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / segment.lengthM;
  return t < 0 || t > segment.lengthM ? null : t;
}

/** Metres along `segment` where it properly crosses `other`, or null. */
function crossingT(segment: Segment, other: Segment): number | null {
  const rx = segment.b.x - segment.a.x;
  const ry = segment.b.y - segment.a.y;
  const sx = other.b.x - other.a.x;
  const sy = other.b.y - other.a.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < EPS) return null;
  const qx = other.a.x - segment.a.x;
  const qy = other.a.y - segment.a.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return t * segment.lengthM;
}

function distanceToSegment(point: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length < EPS) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function angleOf(from: Vec, to: Vec): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function signedArea(points: readonly Vec[]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    total += a.x * b.y - b.x * a.y;
  }
  return total / 2;
}

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
