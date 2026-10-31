/**
 * Polygon-prism box+X wireframe: first-guess path, role locks, hidden spans,
 * re-flow, and a WLED ledmap that packs each face into one virtual range.
 *
 * The Find-length census is the physical count. Even pitch along the path is
 * only a guess. Locks and hidden spans are the source of truth.
 */

import { isWholeIndex } from "../range.ts";
import {
  isHiddenReason,
  isSharedPostRule,
  isWireframeSpec,
  type HiddenReason,
  type PropSegmentDraft,
  type SharedPostRule,
  type WireframeHiddenSpan,
  type WireframeLock,
  type WireframePath,
  type WireframePathPoint,
  type WireframeSpec,
} from "./types.ts";

export const WIREFRAME_SIDES_MIN = 3;
export const WIREFRAME_SIDES_MAX = 16;
export const WIREFRAME_DEFAULT_SIDES = 8;
export const WIREFRAME_DEFAULT_PITCH_MM = 100;
export const WIREFRAME_FACE = 100;
export const WIREFRAME_LOCK_NUDGES = [1, 5] as const;

export type EdgeKind = "top" | "bottom" | "post" | "diag-down" | "diag-up";

export type NetEdge = {
  id: string;
  kind: EdgeKind;
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
};

export type NetFace = {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NetLayout = {
  sides: number;
  width: number;
  height: number;
  faces: NetFace[];
  edges: NetEdge[];
};

export type RoleOnPath = {
  id: string;
  edgeId: string;
  end: "start" | "end";
  pathParam: number;
};

export type PlacedPixel = {
  index: number;
  pathParam: number;
  visible: boolean;
  edgeId: string | null;
  faceIds: string[];
  hiddenReason?: HiddenReason;
};

export type CompiledFace = {
  id: string;
  index: number;
  physical: number[];
  virtualStart: number;
  virtualStop: number;
};

export type CompiledGroup = {
  id: string;
  label: string;
  physical: number[];
  virtualRanges: { start: number; stop: number }[];
};

export type CompiledWireframe = {
  spec: WireframeSpec;
  ledCount: number;
  pathEdgeIds: string[];
  pathLength: number;
  roles: RoleOnPath[];
  staleLocks: WireframeLock[];
  staleHidden: WireframeHiddenSpan[];
  pixels: PlacedPixel[];
  faces: CompiledFace[];
  groups: CompiledGroup[];
  ledmap: number[];
  ledmapDigest: string;
  segments: PropSegmentDraft[];
};

export function defaultWireframeSpec(input?: {
  sides?: number;
  pitchMm?: number;
  sharedPostRule?: SharedPostRule;
}): WireframeSpec {
  return {
    template: "polygon-prism-box-x",
    sides: clampSides(input?.sides ?? WIREFRAME_DEFAULT_SIDES),
    pitchMm: input?.pitchMm && input.pitchMm > 0 ? input.pitchMm : WIREFRAME_DEFAULT_PITCH_MM,
    path: null,
    locks: [],
    hidden: [],
    sharedPostRule: input?.sharedPostRule ?? "half",
  };
}

export function parseWireframeSpec(value: unknown): WireframeSpec | null {
  if (!isWireframeSpec(value)) return null;
  return {
    template: "polygon-prism-box-x",
    sides: clampSides(value.sides),
    pitchMm: value.pitchMm,
    path: value.path
      ? { points: value.path.points.map((point) => ({ ...point })), edgeIds: [...value.path.edgeIds] }
      : null,
    locks: value.locks.map((lock) => ({ ...lock })),
    hidden: value.hidden.map((span) => ({ ...span })),
    sharedPostRule: value.sharedPostRule,
  };
}

export function wireframeRefuseReason(spec: WireframeSpec, ledCount: number): string | null {
  if (!Number.isInteger(ledCount) || ledCount < 1) {
    return "This Light has no LEDs to map. Find the strip length first.";
  }
  if (spec.sides < WIREFRAME_SIDES_MIN || spec.sides > WIREFRAME_SIDES_MAX) {
    return `A box+X wireframe uses ${WIREFRAME_SIDES_MIN}–${WIREFRAME_SIDES_MAX} sides.`;
  }
  if (!(spec.pitchMm > 0)) return "Pitch must be a positive millimetre spacing.";
  const path = resolvePathEdgeIds(spec);
  if (path.length === 0) return "This wireframe has no edges to follow.";
  const used = new Set<number>();
  for (const lock of spec.locks) {
    if (!isWholeIndex(lock.physicalIndex) || lock.physicalIndex >= ledCount) {
      return "A lock sits past this strip. Walk back onto the lit run.";
    }
    if (used.has(lock.physicalIndex)) {
      return "Two locks sit on the same LED. Nudge one of them.";
    }
    used.add(lock.physicalIndex);
  }
  return null;
}

export function clampSides(value: number): number {
  if (!Number.isInteger(value)) return WIREFRAME_DEFAULT_SIDES;
  return Math.min(WIREFRAME_SIDES_MAX, Math.max(WIREFRAME_SIDES_MIN, value));
}

/**
 * Legacy ledmap order: one shared post per wall, then two diagonal passes.
 * The well house template uses `wellHouseEdgeOrder` (own left and right edges,
 * one diagonal per wall). This order stays until the ledmap compiler reads
 * the prop path.
 */
export function defaultWiringOrder(sides: number): string[] {
  const count = clampSides(sides);
  const tops = Array.from({ length: count }, (_, index) => `top.${index}`);
  const zigzag: string[] = [];
  for (let index = 0; index < count; index += 1) {
    zigzag.push(`post.${index}`, `bottom.${index}`);
  }
  const firstPass: string[] = [];
  const secondPass: string[] = [];
  for (let index = 0; index < count; index += 1) {
    firstPass.push(index % 2 === 0 ? `diag.down.${index}` : `diag.up.${index}`);
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    secondPass.push(index % 2 === 0 ? `diag.up.${index}` : `diag.down.${index}`);
  }
  return [...tops, ...zigzag, ...firstPass, ...secondPass];
}

export function edgeRole(edgeId: string, end: "start" | "end"): string {
  return `${edgeId}.${end}`;
}

export function parseEdgeId(id: string): { kind: EdgeKind; index: number } | null {
  const match = /^(top|bottom|post|diag\.down|diag\.up)\.(\d+)$/.exec(id);
  if (!match) return null;
  const raw = match[1]!;
  const index = Number(match[2]);
  switch (raw) {
    case "top":
      return { kind: "top", index };
    case "bottom":
      return { kind: "bottom", index };
    case "post":
      return { kind: "post", index };
    case "diag.down":
      return { kind: "diag-down", index };
    case "diag.up":
      return { kind: "diag-up", index };
    default: {
      const _never: never = raw as never;
      return _never;
    }
  }
}

export function buildNetLayout(sides: number): NetLayout {
  const count = clampSides(sides);
  const width = count * WIREFRAME_FACE;
  const height = WIREFRAME_FACE;
  const faces: NetFace[] = Array.from({ length: count }, (_, index) => ({
    id: `face.${index}`,
    index,
    x: index * WIREFRAME_FACE,
    y: 0,
    width: WIREFRAME_FACE,
    height: WIREFRAME_FACE,
  }));
  const edges: NetEdge[] = [];
  for (let index = 0; index < count; index += 1) {
    const left = index * WIREFRAME_FACE;
    const right = left + WIREFRAME_FACE;
    edges.push(segment(`top.${index}`, "top", index, left, 0, right, 0));
    edges.push(segment(`bottom.${index}`, "bottom", index, left, WIREFRAME_FACE, right, WIREFRAME_FACE));
    edges.push(segment(`diag.down.${index}`, "diag-down", index, left, 0, right, WIREFRAME_FACE));
    edges.push(segment(`diag.up.${index}`, "diag-up", index, left, WIREFRAME_FACE, right, 0));
    edges.push(segment(`post.${index}`, "post", index, left, 0, left, WIREFRAME_FACE));
  }
  return { sides: count, width, height, faces, edges };
}

function segment(
  id: string,
  kind: EdgeKind,
  index: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): NetEdge {
  return { id, kind, index, x1, y1, x2, y2, length: Math.hypot(x2 - x1, y2 - y1) };
}

export function snapToNet(
  layout: NetLayout,
  x: number,
  y: number,
  threshold = 14,
): { edgeId: string; t: number; x: number; y: number } | null {
  let best: { edgeId: string; t: number; x: number; y: number; dist: number } | null = null;
  for (const edge of layout.edges) {
    const hit = projectToSegment(x, y, edge);
    if (hit.dist > threshold) continue;
    if (!best || hit.dist < best.dist) best = { edgeId: edge.id, t: hit.t, x: hit.x, y: hit.y, dist: hit.dist };
  }
  if (!best) return null;
  return { edgeId: best.edgeId, t: best.t, x: best.x, y: best.y };
}

export function polylineToEdgeIds(layout: NetLayout, points: readonly WireframePathPoint[]): string[] {
  const edgeIds: string[] = [];
  for (const point of points) {
    const snapped = point.edgeId && layout.edges.some((edge) => edge.id === point.edgeId)
      ? point.edgeId
      : snapToNet(layout, point.x, point.y)?.edgeId;
    if (!snapped) continue;
    if (edgeIds[edgeIds.length - 1] === snapped) continue;
    edgeIds.push(snapped);
  }
  return edgeIds;
}

export function reattachWireframe(spec: WireframeSpec, nextPath: WireframePath | null): {
  spec: WireframeSpec;
  staleLocks: WireframeLock[];
  staleHidden: WireframeHiddenSpan[];
} {
  const next: WireframeSpec = { ...spec, path: nextPath };
  const roles = new Set(pathRoles(next).map((role) => role.id));
  const staleLocks = spec.locks.filter((lock) => !roles.has(lock.role));
  const staleHidden = spec.hidden.filter((span) => !roles.has(span.afterRole));
  return {
    spec: {
      ...next,
      locks: spec.locks.filter((lock) => roles.has(lock.role)),
      hidden: spec.hidden.filter((span) => roles.has(span.afterRole)),
    },
    staleLocks,
    staleHidden,
  };
}

export function compileWireframe(spec: WireframeSpec, ledCount: number): CompiledWireframe {
  const sides = clampSides(spec.sides);
  const layout = buildNetLayout(sides);
  const pathEdgeIds = resolvePathEdgeIds(spec, layout);
  const roles = pathRolesFromEdges(layout, pathEdgeIds);
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const pathLength = roles.at(-1)?.pathParam ?? 0;
  const staleLocks = spec.locks.filter((lock) => !roleById.has(lock.role));
  const staleHidden = spec.hidden.filter((span) => !roleById.has(span.afterRole));
  const activeLocks = spec.locks
    .filter((lock) => roleById.has(lock.role) && lock.physicalIndex >= 0 && lock.physicalIndex < ledCount)
    .slice()
    .sort((left, right) => left.physicalIndex - right.physicalIndex || (roleById.get(left.role)!.pathParam - roleById.get(right.role)!.pathParam));
  const hiddenRanges = resolveHiddenRanges(spec.hidden, roleById, pathLength, ledCount, activeLocks);
  const pixels = placePixels(ledCount, pathLength, activeLocks, roleById, hiddenRanges);
  assignEdges(pixels, layout, pathEdgeIds);
  const packed = packLedmap(pixels, sides, spec.sharedPostRule, pathEdgeIds);
  return {
    spec,
    ledCount,
    pathEdgeIds,
    pathLength,
    roles,
    staleLocks,
    staleHidden,
    pixels,
    faces: packed.faces,
    groups: packed.groups,
    ledmap: packed.ledmap,
    ledmapDigest: ledmapDigest(packed.ledmap),
    segments: packed.segments,
  };
}

export function predictedIndexForRole(compiled: CompiledWireframe, role: string): number | null {
  const found = compiled.roles.find((row) => row.id === role);
  if (!found || compiled.ledCount < 1) return null;
  const locked = compiled.spec.locks.find((lock) => lock.role === role);
  if (locked) return locked.physicalIndex;
  const nearest = compiled.pixels
    .filter((pixel) => pixel.visible)
    .reduce<{ index: number; delta: number } | null>((best, pixel) => {
      const delta = Math.abs(pixel.pathParam - found.pathParam);
      if (!best || delta < best.delta) return { index: pixel.index, delta };
      return best;
    }, null);
  return nearest?.index ?? null;
}

export function widenMarkerIndices(probeIndex: number, ledCount: number, widen: boolean): number[] {
  if (ledCount < 1) return [];
  const center = Math.max(0, Math.min(ledCount - 1, Math.trunc(probeIndex)));
  if (!widen) return [center];
  const set = new Set<number>();
  for (const candidate of [center - 1, center, center + 1]) {
    if (candidate >= 0 && candidate < ledCount) set.add(candidate);
  }
  return [...set].sort((left, right) => left - right);
}

export function hiddenSpanFromRange(
  start: number,
  stop: number,
  locks: readonly WireframeLock[],
  roles: readonly RoleOnPath[],
  reason: HiddenReason,
): WireframeHiddenSpan | null {
  const lo = Math.min(start, stop);
  const hi = Math.max(start, stop);
  const count = hi - lo;
  if (count < 1) return null;
  const before = [...locks]
    .filter((lock) => lock.physicalIndex < lo)
    .sort((left, right) => right.physicalIndex - left.physicalIndex)[0];
  const afterRole = before?.role ?? roles[0]?.id ?? null;
  if (!afterRole) return null;
  return { afterRole, count, reason };
}

export function faceElementId(propId: string, faceIndex: number): string {
  return `${propId}-face-${faceIndex}`;
}

export function postsElementId(propId: string): string {
  return `${propId}-posts`;
}

export function wireframeGroupForElement(propId: string, elementId: string): string | undefined {
  if (elementId === postsElementId(propId)) return "posts";
  const prefix = `${propId}-face-`;
  if (!elementId.startsWith(prefix)) return undefined;
  const index = Number(elementId.slice(prefix.length));
  if (!Number.isInteger(index) || index < 0) return undefined;
  return `face.${index}`;
}

export function segmentsForWireframeProp(input: {
  propId: string;
  label: string;
  compiled: CompiledWireframe;
}): { id: string; label: string; start: number; stop: number }[] {
  const prefix = input.label.trim() || "Wireframe";
  return input.compiled.segments.map((segment) => {
    const face = input.compiled.faces.find((row) => row.virtualStart === segment.start && row.virtualStop === segment.stop);
    const posts = input.compiled.spec.sharedPostRule === "own" && segment.label.endsWith("posts");
    return {
      id: face ? faceElementId(input.propId, face.index) : posts ? postsElementId(input.propId) : `${input.propId}-${segment.start}`,
      label: `${prefix} · ${segment.label}`,
      start: segment.start,
      stop: segment.stop,
    };
  });
}

export function formatLedmapJson(map: readonly number[]): string {
  return `${JSON.stringify({ map: [...map] })}\n`;
}

export function parseLedmapJson(raw: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { map?: unknown }).map)
        ? (parsed as { map: unknown[] }).map
        : null;
    if (!list || list.length === 0) return null;
    if (!list.every((entry) => Number.isInteger(entry) && (entry as number) >= 0)) return null;
    return list as number[];
  } catch {
    return null;
  }
}

export function ledmapDigest(map: readonly number[]): string {
  return `ledmap1:${fnv1a(JSON.stringify(map))}:${map.length.toString(36)}`;
}

export function ledmapsMatch(expected: readonly number[], live: readonly number[] | null): boolean | null {
  if (live === null) return null;
  if (expected.length !== live.length) return false;
  return expected.every((value, index) => value === live[index]);
}

function resolvePathEdgeIds(spec: WireframeSpec, layout?: NetLayout): string[] {
  const net = layout ?? buildNetLayout(spec.sides);
  const known = new Set(net.edges.map((edge) => edge.id));
  const drawn = spec.path?.edgeIds.filter((id) => known.has(id)) ?? [];
  if (drawn.length > 0) return drawn;
  if (spec.path?.points.length) {
    const fromPoints = polylineToEdgeIds(net, spec.path.points);
    if (fromPoints.length > 0) return fromPoints;
  }
  return defaultWiringOrder(spec.sides);
}

function pathRoles(spec: WireframeSpec): RoleOnPath[] {
  return pathRolesFromEdges(buildNetLayout(spec.sides), resolvePathEdgeIds(spec));
}

function pathRolesFromEdges(layout: NetLayout, edgeIds: readonly string[]): RoleOnPath[] {
  const byId = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const roles: RoleOnPath[] = [];
  let cursor = 0;
  const seen = new Set<string>();
  for (const edgeId of edgeIds) {
    const edge = byId.get(edgeId);
    if (!edge) continue;
    const startId = edgeRole(edgeId, "start");
    const endId = edgeRole(edgeId, "end");
    if (!seen.has(startId)) {
      roles.push({ id: startId, edgeId, end: "start", pathParam: cursor });
      seen.add(startId);
    }
    cursor += edge.length;
    if (!seen.has(endId)) {
      roles.push({ id: endId, edgeId, end: "end", pathParam: cursor });
      seen.add(endId);
    }
  }
  return roles;
}

function resolveHiddenRanges(
  hidden: readonly WireframeHiddenSpan[],
  roleById: Map<string, RoleOnPath>,
  pathLength: number,
  ledCount: number,
  locks: readonly WireframeLock[],
): { start: number; stop: number; reason: HiddenReason; afterRole: string }[] {
  const lockByRole = new Map(locks.map((lock) => [lock.role, lock.physicalIndex]));
  const ranges: { start: number; stop: number; reason: HiddenReason; afterRole: string }[] = [];
  for (const span of hidden) {
    const role = roleById.get(span.afterRole);
    if (!role) continue;
    const after = lockByRole.get(span.afterRole) ?? predictedPhysical(role.pathParam, pathLength, ledCount);
    const start = Math.min(ledCount, after + 1);
    const stop = Math.min(ledCount, start + span.count);
    if (stop > start) ranges.push({ start, stop, reason: span.reason, afterRole: span.afterRole });
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function predictedPhysical(pathParam: number, pathLength: number, ledCount: number): number {
  if (ledCount <= 1 || pathLength <= 0) return 0;
  return clampInt(Math.round((pathParam / pathLength) * (ledCount - 1)), 0, ledCount - 1);
}

function placePixels(
  ledCount: number,
  pathLength: number,
  locks: readonly WireframeLock[],
  roleById: Map<string, RoleOnPath>,
  hidden: readonly { start: number; stop: number; reason: HiddenReason }[],
): PlacedPixel[] {
  const hiddenAt = new Map<number, HiddenReason>();
  for (const span of hidden) {
    for (let index = span.start; index < span.stop; index += 1) hiddenAt.set(index, span.reason);
  }
  const lockAt = new Map<number, number>();
  for (const lock of locks) {
    const role = roleById.get(lock.role);
    if (role) lockAt.set(lock.physicalIndex, role.pathParam);
  }
  const anchors = [
    { physical: -1, pathParam: 0 },
    ...locks
      .map((lock) => ({ physical: lock.physicalIndex, pathParam: roleById.get(lock.role)?.pathParam ?? 0 }))
      .sort((left, right) => left.physical - right.physical),
    { physical: ledCount, pathParam: pathLength },
  ];
  const pixels: PlacedPixel[] = Array.from({ length: ledCount }, (_, index) => ({
    index,
    pathParam: 0,
    visible: !hiddenAt.has(index),
    edgeId: null,
    faceIds: [],
    ...(hiddenAt.get(index) ? { hiddenReason: hiddenAt.get(index) } : {}),
  }));
  for (let span = 0; span < anchors.length - 1; span += 1) {
    const left = anchors[span]!;
    const right = anchors[span + 1]!;
    const inner: number[] = [];
    for (let index = left.physical + 1; index < right.physical; index += 1) {
      if (pixels[index]?.visible) inner.push(index);
    }
    if (lockAt.has(right.physical) && pixels[right.physical]) {
      pixels[right.physical]!.pathParam = lockAt.get(right.physical)!;
    }
    const steps = inner.length + 1;
    inner.forEach((index, order) => {
      const t = (order + 1) / steps;
      pixels[index]!.pathParam = left.pathParam + (right.pathParam - left.pathParam) * t;
    });
  }
  if (locks.length === 0) {
    const visible = pixels.filter((pixel) => pixel.visible);
    visible.forEach((pixel, order) => {
      pixel.pathParam = visible.length <= 1 || pathLength <= 0
        ? 0
        : (pathLength * order) / (visible.length - 1);
    });
  }
  return pixels;
}

function assignEdges(pixels: PlacedPixel[], layout: NetLayout, pathEdgeIds: readonly string[]): void {
  const byId = new Map(layout.edges.map((edge) => [edge.id, edge]));
  const spans: { edgeId: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const edgeId of pathEdgeIds) {
    const edge = byId.get(edgeId);
    if (!edge) continue;
    spans.push({ edgeId, start: cursor, end: cursor + edge.length });
    cursor += edge.length;
  }
  for (const pixel of pixels) {
    if (!pixel.visible) continue;
    const span = spans.find((row, index) =>
      pixel.pathParam < row.end || index === spans.length - 1,
    ) ?? spans[0];
    if (!span) continue;
    pixel.edgeId = span.edgeId;
    pixel.faceIds = facesForEdge(span.edgeId, layout.sides);
  }
}

function facesForEdge(edgeId: string, sides: number): string[] {
  const parsed = parseEdgeId(edgeId);
  if (!parsed) return [];
  if (parsed.kind === "post") {
    const left = (parsed.index - 1 + sides) % sides;
    return [`face.${left}`, `face.${parsed.index % sides}`];
  }
  return [`face.${parsed.index % sides}`];
}

function packLedmap(
  pixels: PlacedPixel[],
  sides: number,
  rule: SharedPostRule,
  pathEdgeIds: readonly string[],
): {
  faces: CompiledFace[];
  groups: CompiledGroup[];
  ledmap: number[];
  segments: PropSegmentDraft[];
} {
  const postOwners = new Map<number, string | "posts" | "split-left" | "split-right">();
  const postPixels = pixels.filter((pixel) => pixel.visible && pixel.edgeId?.startsWith("post."));
  const byPost = new Map<string, PlacedPixel[]>();
  for (const pixel of postPixels) {
    const list = byPost.get(pixel.edgeId!) ?? [];
    list.push(pixel);
    byPost.set(pixel.edgeId!, list);
  }
  for (const [edgeId, list] of byPost) {
    const parsed = parseEdgeId(edgeId);
    if (!parsed) continue;
    const leftFace = `face.${(parsed.index - 1 + sides) % sides}`;
    const rightFace = `face.${parsed.index % sides}`;
    const ordered = list.slice().sort((left, right) => left.pathParam - right.pathParam);
    switch (rule) {
      case "left":
        for (const pixel of ordered) postOwners.set(pixel.index, leftFace);
        break;
      case "right":
        for (const pixel of ordered) postOwners.set(pixel.index, rightFace);
        break;
      case "own":
        for (const pixel of ordered) postOwners.set(pixel.index, "posts");
        break;
      case "half": {
        const mid = Math.ceil(ordered.length / 2);
        ordered.forEach((pixel, index) => {
          postOwners.set(pixel.index, index < mid ? "split-left" : "split-right");
        });
        break;
      }
      default: {
        const _never: never = rule;
        return _never;
      }
    }
  }

  const facePhysical: number[][] = Array.from({ length: sides }, () => []);
  const postPhysical: number[] = [];
  const used = new Set<number>();

  function takePixel(pixel: PlacedPixel, faceId: string): void {
    const owner = postOwners.get(pixel.index);
    if (pixel.edgeId?.startsWith("post.")) {
      if (owner === "posts") {
        if (!used.has(pixel.index)) {
          postPhysical.push(pixel.index);
          used.add(pixel.index);
        }
        return;
      }
      const parsed = parseEdgeId(pixel.edgeId);
      if (!parsed) return;
      const leftFace = `face.${(parsed.index - 1 + sides) % sides}`;
      const rightFace = `face.${parsed.index % sides}`;
      const assigned =
        owner === "split-left" ? leftFace : owner === "split-right" ? rightFace : owner;
      if (assigned !== faceId) return;
    } else if (!pixel.faceIds.includes(faceId)) {
      return;
    }
    if (used.has(pixel.index) && !pixel.edgeId?.startsWith("post.")) return;
    if (pixel.edgeId?.startsWith("post.") && used.has(pixel.index)) return;
    const faceIndex = Number(faceId.slice("face.".length));
    facePhysical[faceIndex]!.push(pixel.index);
    used.add(pixel.index);
  }

  for (let face = 0; face < sides; face += 1) {
    const want = [`top.${face}`, `post.${(face + 1) % sides}`, `bottom.${face}`, `post.${face}`, `diag.down.${face}`, `diag.up.${face}`];
    const orderedEdges = [
      ...want.filter((id) => pathEdgeIds.includes(id)),
      ...want.filter((id) => !pathEdgeIds.includes(id)),
    ];
    for (const edgeId of orderedEdges) {
      const onEdge = pixels
        .filter((pixel) => pixel.visible && pixel.edgeId === edgeId)
        .sort((left, right) => left.pathParam - right.pathParam);
      for (const pixel of onEdge) takePixel(pixel, `face.${face}`);
    }
  }

  const leftoverVisible = pixels.filter((pixel) => pixel.visible && !used.has(pixel.index));
  for (const pixel of leftoverVisible) {
    if (pixel.edgeId?.startsWith("post.")) {
      postPhysical.push(pixel.index);
      used.add(pixel.index);
    }
  }

  const ledmap: number[] = [];
  const faces: CompiledFace[] = [];
  const segments: PropSegmentDraft[] = [];
  for (let index = 0; index < sides; index += 1) {
    const physical = unique(facePhysical[index] ?? []);
    const virtualStart = ledmap.length;
    for (const pixel of physical) ledmap.push(pixel);
    const virtualStop = ledmap.length;
    faces.push({ id: `face.${index}`, index, physical, virtualStart, virtualStop });
    if (virtualStop > virtualStart) {
      segments.push({ label: `face ${index + 1}`, start: virtualStart, stop: virtualStop });
    }
  }
  if (rule === "own" && postPhysical.length > 0) {
    const virtualStart = ledmap.length;
    for (const pixel of unique(postPhysical)) ledmap.push(pixel);
    const virtualStop = ledmap.length;
    if (virtualStop > virtualStart) {
      segments.push({ label: "posts", start: virtualStart, stop: virtualStop });
    }
  }
  for (const pixel of pixels) {
    if (!ledmap.includes(pixel.index)) ledmap.push(pixel.index);
  }

  const virtualOf = new Map(ledmap.map((physical, virtual) => [physical, virtual]));
  const groups = buildGroups(pixels, sides, virtualOf);
  return { faces, groups, ledmap, segments };
}

function buildGroups(
  pixels: PlacedPixel[],
  sides: number,
  virtualOf: Map<number, number>,
): CompiledGroup[] {
  const pick = (test: (pixel: PlacedPixel) => boolean, id: string, label: string): CompiledGroup => {
    const physical = pixels.filter((pixel) => pixel.visible && test(pixel)).map((pixel) => pixel.index);
    return { id, label, physical, virtualRanges: virtualRangesFor(physical, virtualOf) };
  };
  const groups = [
    pick((pixel) => pixel.edgeId?.startsWith("top.") ?? false, "tops", "tops"),
    pick((pixel) => pixel.edgeId?.startsWith("bottom.") ?? false, "bottoms", "bottoms"),
    pick((pixel) => pixel.edgeId?.startsWith("post.") ?? false, "posts", "posts"),
    pick((pixel) => Boolean(pixel.edgeId?.startsWith("diag.")), "diagonals", "diagonals"),
    pick((pixel) => {
      const kind = pixel.edgeId ? parseEdgeId(pixel.edgeId)?.kind : null;
      return kind === "top" || kind === "bottom" || kind === "post";
    }, "outline", "outline"),
  ];
  for (let index = 0; index < sides; index += 1) {
    groups.push(pick((pixel) => pixel.faceIds.includes(`face.${index}`), `face.${index}`, `face ${index + 1}`));
  }
  return groups;
}

function virtualRangesFor(physical: readonly number[], virtualOf: Map<number, number>): { start: number; stop: number }[] {
  const virtual = physical.map((index) => virtualOf.get(index)).filter((value): value is number => value !== undefined).sort((left, right) => left - right);
  const ranges: { start: number; stop: number }[] = [];
  for (const index of virtual) {
    const last = ranges[ranges.length - 1];
    if (last && last.stop === index) last.stop = index + 1;
    else ranges.push({ start: index, stop: index + 1 });
  }
  return ranges;
}

function projectToSegment(x: number, y: number, edge: NetEdge): { t: number; x: number; y: number; dist: number } {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : clampUnit(((x - edge.x1) * dx + (y - edge.y1) * dy) / len2);
  const px = edge.x1 + dx * t;
  const py = edge.y1 + dy * t;
  return { t, x: px, y: py, dist: Math.hypot(x - px, y - py) };
}

function unique(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

