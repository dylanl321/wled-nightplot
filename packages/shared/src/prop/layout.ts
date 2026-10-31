/**
 * A prop is one or more strings. Each string is an ordered polyline of runs.
 * Run order is the physical pixel order on that string. Two runs may share
 * the same corners (a backtrack). A wire run is a dark jump: no pixels.
 * Templates only prefill a starting path. `run` mirrors the first string so
 * older readers still see it.
 */

export const LAYOUT_PITCH_M = 0.1;
export const METRES_PER_FOOT = 0.3048;

export type LayoutSource = "template" | "trace" | "net";
export type LayoutUnits = "ft" | "m";
export type RunKind = "lit" | "wire" | "hidden";

export type LayoutCorner = {
  id: string;
  /** Metres. */
  x: number;
  y: number;
  physicalId?: string;
};

export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  kind: RunKind;
  lockedLengthM?: number;
  hiddenCount?: number;
  /** Present for a later arc. Phase 1 draws the straight chord. */
  arc?: { riseM: number };
};

export type LayoutFace = {
  id: string;
  name: string;
  cornerIds: string[];
};

/** One physical string. Indexes on this string start at 0, in `run` order. */
export type LayoutString = {
  id: string;
  /** Corner where this string's wire comes in. */
  startId: string;
  run: LayoutEdge[];
};

export type PropLayout = {
  source: LayoutSource;
  template?: { type: string; params: Record<string, number> };
  net?: { sides: number; widthM: number; heightM: number };
  units: LayoutUnits;
  /** Metres between lights. Default 0.10. */
  pitchM: number;
  /** Metres along the run before the first light. Default 0. */
  startOffsetM: number;
  corners: LayoutCorner[];
  /** First string, kept in step with `strings[0]` when strings are present. */
  run: LayoutEdge[];
  /**
   * Every string on the prop. Absent on older drawings: that drawing is one
   * string whose run is `run`.
   */
  strings?: LayoutString[];
  faces?: LayoutFace[];
  /** Known lights on the real string, when one has been measured. */
  stringLights?: number;
};

export type CountedEdge = {
  id: string;
  kind: RunKind;
  lengthM: number;
  /** Lights drawn on this edge. Hidden edges report 0 here. */
  lights: number;
  /** Hidden lights consumed and not drawn. */
  hidden: number;
};

export type LayoutCount = {
  total: number;
  edges: CountedEdge[];
};

export function isPropLayout(value: unknown): value is PropLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropLayout>;
  if (row.source !== "template" && row.source !== "trace" && row.source !== "net") return false;
  if (row.units !== "ft" && row.units !== "m") return false;
  if (typeof row.pitchM !== "number" || !(row.pitchM > 0)) return false;
  if (typeof row.startOffsetM !== "number" || row.startOffsetM < 0 || !Number.isFinite(row.startOffsetM)) return false;
  if (!Array.isArray(row.corners) || !Array.isArray(row.run)) return false;
  if (!row.corners.every(isCorner)) return false;
  const ids = new Set(row.corners.map((corner) => corner.id));
  if (ids.size !== row.corners.length) return false;
  if (!row.run.every((edge) => isEdge(edge, ids))) return false;
  if (row.strings !== undefined) {
    if (!Array.isArray(row.strings)) return false;
    for (const string of row.strings) {
      if (!string || typeof string !== "object") return false;
      const item = string as Partial<LayoutString>;
      if (typeof item.id !== "string" || typeof item.startId !== "string" || !ids.has(item.startId)) return false;
      if (!Array.isArray(item.run) || !item.run.every((edge) => isEdge(edge, ids))) return false;
    }
  }
  if (row.stringLights !== undefined && (!Number.isInteger(row.stringLights) || row.stringLights < 0)) return false;
  return true;
}

function isCorner(value: unknown): value is LayoutCorner {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LayoutCorner>;
  return typeof row.id === "string" && row.id.length > 0 &&
    typeof row.x === "number" && Number.isFinite(row.x) &&
    typeof row.y === "number" && Number.isFinite(row.y);
}

function isEdge(value: unknown, ids: Set<string>): value is LayoutEdge {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<LayoutEdge>;
  if (row.kind !== "lit" && row.kind !== "wire" && row.kind !== "hidden") return false;
  if (typeof row.id !== "string" || typeof row.from !== "string" || typeof row.to !== "string") return false;
  if (!ids.has(row.from) || !ids.has(row.to)) return false;
  if (row.lockedLengthM !== undefined && (!(row.lockedLengthM > 0) || !Number.isFinite(row.lockedLengthM))) return false;
  if (row.hiddenCount !== undefined && (!Number.isInteger(row.hiddenCount) || (row.hiddenCount ?? 0) < 0)) return false;
  return true;
}

export function emptyTrace(units: LayoutUnits, pitchM = LAYOUT_PITCH_M): PropLayout {
  return {
    source: "trace",
    units,
    pitchM,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }],
    run: [],
  };
}

export function gridSizeM(units: LayoutUnits): number {
  return units === "ft" ? METRES_PER_FOOT : 0.5;
}

export function cornerById(layout: PropLayout, id: string): LayoutCorner | undefined {
  return layout.corners.find((corner) => corner.id === id);
}

export function edgeLengthM(layout: PropLayout, edge: LayoutEdge): number {
  if (edge.kind === "hidden") return Math.max(0, edge.hiddenCount ?? 0) * layout.pitchM;
  const from = cornerById(layout, edge.from);
  const to = cornerById(layout, edge.to);
  if (!from || !to) return 0;
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Each lit or hidden edge is counted on its own: round(length ÷ pitch).
 * Equal lengths round the same way, so they get the same light count.
 * A corner is not a second light. A closed loop does not add one for the start.
 * A wire has no lights and does not join the edges beside it.
 * Hidden edges consume that count and are not drawn.
 */
export function countLayout(layout: PropLayout): LayoutCount {
  const edges: CountedEdge[] = [];
  let total = 0;
  for (const string of layoutStrings(layout)) {
    for (const edge of string.run) {
      const lengthM = edgeLengthM(layout, edge);
      const lights = edge.kind === "wire" ? 0 : lightsOnLength(lengthM, layout.pitchM);
      edges.push({
        id: edge.id,
        kind: edge.kind,
        lengthM,
        lights: edge.kind === "lit" ? lights : 0,
        hidden: edge.kind === "hidden" ? lights : 0,
      });
      if (edge.kind === "lit") total += lights;
    }
  }
  return { total, edges };
}

/** Round length ÷ pitch. Zero when either measurement is missing. Equal lengths round the same way. */
export function lightsOnLength(lengthM: number, pitchM: number): number {
  if (!(lengthM > 0) || !(pitchM > 0)) return 0;
  return Math.max(0, Math.round(lengthM / pitchM));
}

export function layoutStrings(layout: PropLayout): LayoutString[] {
  if (layout.strings && layout.strings.length > 0) return layout.strings;
  const startId = layout.run[0]?.from ?? layout.corners[0]?.id ?? "c1";
  return [{ id: "s1", startId, run: layout.run }];
}

export function ensureStrings(layout: PropLayout): PropLayout {
  const strings = layoutStrings(layout);
  return { ...layout, strings, run: strings[0]?.run ?? [] };
}

function writeStrings(layout: PropLayout, strings: LayoutString[]): PropLayout {
  return { ...layout, strings, run: strings[0]?.run ?? [] };
}

export function stringById(layout: PropLayout, stringId: string | null): LayoutString {
  const strings = layoutStrings(layout);
  return strings.find((string) => string.id === stringId) ?? strings[0]!;
}

export function stringEndId(string: LayoutString): string {
  return string.run.length > 0 ? string.run[string.run.length - 1]!.to : string.startId;
}

/** Continue the string from its end to a new point. Kind `wire` is a dark jump. */
export function continueToPoint(layout: PropLayout, stringId: string, x: number, y: number, kind: "lit" | "wire" = "lit"): PropLayout {
  const base = ensureStrings(layout);
  const cornerId = nextId(base, "c");
  const strings = (base.strings ?? []).map((string) => {
    if (string.id !== stringId) return string;
    const edge: LayoutEdge = { id: nextId(base, "e"), from: stringEndId(string), to: cornerId, kind };
    return { ...string, run: [...string.run, edge] };
  });
  return writeStrings({ ...base, corners: [...base.corners, { id: cornerId, x, y }] }, strings);
}

/**
 * Continue the string from its end to a corner that already exists.
 * A second run over the same corners is a backtrack: both are lit unless this one is dark.
 */
export function continueToCorner(layout: PropLayout, stringId: string, cornerId: string, kind: "lit" | "wire" = "lit"): PropLayout {
  const base = ensureStrings(layout);
  if (!base.corners.some((corner) => corner.id === cornerId)) return layout;
  const strings = (base.strings ?? []).map((string) => {
    if (string.id !== stringId) return string;
    const from = stringEndId(string);
    if (from === cornerId) return string;
    const edge: LayoutEdge = { id: nextId(base, "e"), from, to: cornerId, kind };
    return { ...string, run: [...string.run, edge] };
  });
  return writeStrings(base, strings);
}

/** A new string starts at its own wire-in point and counts its own lights from zero. */
export function addStringAt(layout: PropLayout, x: number, y: number, cornerId?: string): PropLayout {
  const base = ensureStrings(layout);
  const id = cornerId && base.corners.some((corner) => corner.id === cornerId) ? cornerId : nextId(base, "c");
  const corners = id === cornerId ? base.corners : [...base.corners, { id, x, y }];
  const string: LayoutString = { id: `s${(base.strings?.length ?? 0) + 1}`, startId: id, run: [] };
  return writeStrings({ ...base, corners }, [...(base.strings ?? []), string]);
}

export function layoutLightTotal(layout: PropLayout): number {
  return countLayout(layout).total;
}

export function scaleAboutStart(layout: PropLayout, factor: number): PropLayout {
  if (!Number.isFinite(factor) || factor <= 0) return layout;
  const start = startCorner(layout);
  return {
    ...layout,
    corners: layout.corners.map((corner) => ({
      ...corner,
      x: start.x + (corner.x - start.x) * factor,
      y: start.y + (corner.y - start.y) * factor,
    })),
    run: layout.run.map((edge) => edge.lockedLengthM == null ? edge : { ...edge, lockedLengthM: edge.lockedLengthM * factor }),
  };
}

export type LengthEdit = {
  layout: PropLayout;
  scaledAll: boolean;
  /** Metres the closing edge misses the start by, when every relevant edge is locked. */
  gapM: number | null;
};

export function setEdgeLength(layout: PropLayout, edgeId: string, lengthM: number): LengthEdit {
  const edge = layout.run.find((row) => row.id === edgeId);
  if (!edge || edge.kind !== "lit" || !(lengthM > 0)) return { layout, scaledAll: false, gapM: null };
  const current = edgeLengthM(layout, edge);
  const noneLocked = layout.run.every((row) => row.lockedLengthM == null);
  if (noneLocked && current > 0) {
    const scaled = scaleAboutStart(layout, lengthM / current);
    return { layout: lock(scaled, edgeId, lengthM), scaledAll: true, gapM: null };
  }
  const closed = isClosed(layout);
  const closing = closed && isClosingEdge(layout, edge);
  if (closing) {
    const previous = layout.run[layout.run.length - 2];
    if (previous?.lockedLengthM != null) {
      const gap = Math.abs(edgeLengthM(layout, edge) - lengthM);
      return { layout, scaledAll: false, gapM: gap > 0.005 ? gap : null };
    }
    return { layout: lock(moveClosingEdge(layout, edge, lengthM), edgeId, lengthM), scaledAll: false, gapM: null };
  }
  const moved = moveEdgeAndTail(layout, edge, lengthM);
  const gap = closed ? gapAfter(moved, edgeId) : null;
  return { layout: lock(moved, edgeId, lengthM), scaledAll: false, gapM: gap };
}

export function addCorner(layout: PropLayout, x: number, y: number): PropLayout {
  if (isClosed(layout)) return layout;
  const id = nextId(layout, "c");
  const from = runEndId(layout);
  const edgeId = nextId(layout, "e");
  return {
    ...layout,
    corners: [...layout.corners, { id, x, y }],
    run: [...layout.run, { id: edgeId, from, to: id, kind: "lit" }],
  };
}

export function moveCorner(layout: PropLayout, id: string, x: number, y: number): PropLayout {
  return {
    ...layout,
    corners: layout.corners.map((corner) => corner.id === id ? { ...corner, x, y } : corner),
    run: layout.run.map((edge) => edge.from === id || edge.to === id ? { ...edge, lockedLengthM: undefined } : edge),
  };
}

export function closeLoop(layout: PropLayout): PropLayout {
  if (layout.run.length < 1 || isClosed(layout)) return layout;
  const start = startCorner(layout);
  const end = runEndId(layout);
  if (end === start.id) return layout;
  return {
    ...layout,
    run: [...layout.run, { id: nextId(layout, "e"), from: end, to: start.id, kind: "lit" }],
  };
}

export function isClosed(layout: PropLayout): boolean {
  if (layout.run.length < 3) return false;
  const first = layout.run[0]!;
  const last = layout.run[layout.run.length - 1]!;
  return last.to === first.from && last.from !== last.to;
}

export function startCorner(layout: PropLayout): LayoutCorner {
  const id = layout.run[0]?.from ?? layout.corners[0]?.id;
  return layout.corners.find((corner) => corner.id === id) ?? layout.corners[0]!;
}

export type SnapGuide = "corner" | "angle" | "light" | "grid";

export function snapPoint(input: {
  point: { x: number; y: number };
  anchor: { x: number; y: number } | null;
  previousAngle: number | null;
  corners: readonly { id: string; x: number; y: number }[];
  excludeIds?: readonly string[];
  pitchM: number;
  gridM: number;
  snapOff: boolean;
  force45: boolean;
}): { x: number; y: number; guide: SnapGuide | null } {
  const { point } = input;
  if (input.snapOff && !input.force45) return { ...point, guide: null };
  const exclude = new Set(input.excludeIds ?? []);
  if (!input.snapOff && !input.force45) {
    const cornerRadius = input.pitchM * 0.5;
    let best: { x: number; y: number; dist: number } | null = null;
    for (const corner of input.corners) {
      if (exclude.has(corner.id)) continue;
      const dist = Math.hypot(corner.x - point.x, corner.y - point.y);
      if (dist <= cornerRadius && (!best || dist < best.dist)) best = { x: corner.x, y: corner.y, dist };
    }
    if (best) return { x: best.x, y: best.y, guide: "corner" };
  }
  if (!input.anchor) return gridOrRaw(point, input.gridM, input.pitchM * 0.45, input.snapOff);
  const angled = snapAngle(input.anchor, point, input.previousAngle, input.force45, input.pitchM * 0.45);
  const aimed = angled ?? { x: point.x, y: point.y, guide: null as SnapGuide | null };
  const lit = snapLightLength(input.anchor, aimed, input.pitchM);
  if (lit) return { ...lit, guide: "light" };
  if (angled) return { x: angled.x, y: angled.y, guide: "angle" };
  return gridOrRaw(point, input.gridM, input.pitchM * 0.45, input.snapOff);
}

export function lengthLabel(lengthM: number, units: LayoutUnits): { whole: string; extra: string | null } {
  const per = units === "ft" ? METRES_PER_FOOT : 1;
  const unitName = units === "ft" ? "ft" : "m";
  const amount = lengthM / per;
  const whole = Math.floor(amount + 1e-9);
  const cm = Math.round((amount - whole) * (units === "ft" ? 30.48 : 100));
  return {
    whole: `${whole} ${unitName}`,
    extra: cm > 0 ? `+${cm} cm` : null,
  };
}

export function gapLabel(gapM: number, units: LayoutUnits): string {
  if (units === "ft") return `misses by ${Math.max(1, Math.round(gapM / 0.0254))} in`;
  return `misses by ${Math.max(1, Math.round(gapM * 100))} cm`;
}

export function windowLayout(input: {
  widthM: number;
  heightM: number;
  units: LayoutUnits;
  pitchM: number;
  startCorner: 0 | 1 | 2 | 3;
  clockwise: boolean;
  params: Record<string, number>;
}): PropLayout {
  const canonical = [
    { x: 0, y: 0 },
    { x: input.widthM, y: 0 },
    { x: input.widthM, y: input.heightM },
    { x: 0, y: input.heightM },
  ];
  const ring = input.clockwise ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const at = ring.indexOf(input.startCorner);
  const order = [...ring.slice(at), ...ring.slice(0, at)];
  const corners = order.map((index, place) => ({ id: `c${place + 1}`, x: canonical[index]!.x, y: canonical[index]!.y }));
  const run = corners.map((corner, index) => ({
    id: `e${index + 1}`,
    from: corner.id,
    to: corners[(index + 1) % corners.length]!.id,
    kind: "lit" as const,
  }));
  return {
    source: "template",
    template: { type: "window", params: { ...input.params, start: input.startCorner, clockwise: input.clockwise ? 1 : 0 } },
    units: input.units,
    pitchM: input.pitchM,
    startOffsetM: 0,
    corners,
    run,
  };
}

/** Bottom, Right, Top, Left in the layout's wiring order. */
export function windowSideNames(layout: PropLayout): string[] {
  const clockwise = layout.template?.params.clockwise === 1;
  const start = layout.template?.params.start ?? 0;
  const ring = clockwise ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const at = Math.max(0, ring.indexOf(start));
  const order = [...ring.slice(at), ...ring.slice(0, at)];
  const side = (a: number, b: number) => {
    const key = [a, b].sort((left, right) => left - right).join("-");
    if (key === "0-1") return "Bottom";
    if (key === "1-2") return "Right";
    if (key === "2-3") return "Top";
    return "Left";
  };
  return order.map((corner, index) => side(corner, order[(index + 1) % order.length]!));
}

export function rooflineLayout(input: {
  lengthM: number;
  units: LayoutUnits;
  pitchM: number;
  /** When true, the controller end is the far end of the typed length. */
  startAtFarEnd: boolean;
  params: Record<string, number>;
}): PropLayout {
  const near = { id: "c1", x: 0, y: 0 };
  const far = { id: "c2", x: input.lengthM, y: 0 };
  const corners = input.startAtFarEnd ? [far, near] : [near, far];
  const ordered = corners.map((corner, index) => ({ ...corner, id: `c${index + 1}` }));
  return {
    source: "template",
    template: { type: "roofline", params: input.params },
    units: input.units,
    pitchM: input.pitchM,
    startOffsetM: 0,
    corners: ordered,
    run: [{ id: "e1", from: ordered[0]!.id, to: ordered[1]!.id, kind: "lit" }],
  };
}

export function layoutFromMeasurements(input: {
  units: LayoutUnits;
  pitchM: number;
  shape: "roofline" | "window" | "arch" | "tree" | "stake-row" | "wireframe";
  params: Record<string, number>;
}): PropLayout | null {
  const { units, pitchM, params } = input;
  const toM = (value: number) => value * (units === "ft" ? METRES_PER_FOOT : 1);
  switch (input.shape) {
    case "roofline":
      return rooflineLayout({ lengthM: toM(params.length ?? 0), units, pitchM, startAtFarEnd: false, params });
    case "window":
      return windowLayout({
        widthM: toM(params.width ?? 0),
        heightM: toM(params.height ?? 0),
        units,
        pitchM,
        startCorner: 0,
        clockwise: false,
        params,
      });
    case "arch":
      return polylineLayout("arch", units, pitchM, params, [
        { x: 0, y: 0 },
        { x: toM(params.width ?? 0) / 2, y: toM(params.height ?? 0) },
        { x: toM(params.width ?? 0), y: 0 },
      ], false);
    case "tree":
      return polylineLayout("tree", units, pitchM, params, [
        { x: 0, y: 0 },
        { x: toM(params.base ?? 0) / 2, y: toM(params.height ?? 0) },
        { x: toM(params.base ?? 0), y: 0 },
      ], false);
    case "stake-row":
      return stakeLayout(toM(params.height ?? 0), Math.round(params.stakes ?? 0), units, pitchM, params);
    case "wireframe":
      return wellHouseLayout(input);
    default: {
      const _never: never = input.shape;
      return _never;
    }
  }
}

function polylineLayout(
  type: string,
  units: LayoutUnits,
  pitchM: number,
  params: Record<string, number>,
  points: { x: number; y: number }[],
  close: boolean,
): PropLayout {
  const corners = points.map((point, index) => ({ id: `c${index + 1}`, ...point }));
  const run: LayoutEdge[] = [];
  for (let index = 0; index < corners.length - 1; index += 1) {
    run.push({ id: `e${index + 1}`, from: corners[index]!.id, to: corners[index + 1]!.id, kind: "lit" });
  }
  if (close && corners.length > 2) {
    run.push({ id: `e${corners.length}`, from: corners[corners.length - 1]!.id, to: corners[0]!.id, kind: "lit" });
  }
  return { source: "template", template: { type, params }, units, pitchM, startOffsetM: 0, corners, run };
}

function stakeLayout(heightM: number, stakes: number, units: LayoutUnits, pitchM: number, params: Record<string, number>): PropLayout | null {
  if (stakes < 1) return null;
  const gap = METRES_PER_FOOT;
  const corners: LayoutCorner[] = [];
  const run: LayoutEdge[] = [];
  for (let index = 0; index < stakes; index += 1) {
    const x = index * gap;
    const base = { id: `c${index * 2 + 1}`, x, y: 0 };
    const top = { id: `c${index * 2 + 2}`, x, y: heightM };
    corners.push(base, top);
    run.push({ id: `e-stake-${index + 1}`, from: base.id, to: top.id, kind: "lit" });
    if (index < stakes - 1) {
      const nextBase = `c${(index + 1) * 2 + 1}`;
      run.push({ id: `e-wire-${index + 1}`, from: top.id, to: nextBase, kind: "wire" });
    }
  }
  return { source: "template", template: { type: "stake-row", params }, units, pitchM, startOffsetM: 0, corners, run };
}

/**
 * Physical order of one well-house string.
 * Tops left to right, then each wall from the right (down its own right edge,
 * along the bottom right-to-left, up its own left edge), then one diagonal
 * per wall alternating down and up. Walls do not share a post.
 */
export function wellHouseEdgeOrder(sides: number): string[] {
  const count = Math.max(0, Math.round(sides));
  const tops = Array.from({ length: count }, (_, index) => `top.${index}`);
  const back: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    back.push(`right.${index}`, `bottom.${index}`, `left.${index}`);
  }
  const diagonals = Array.from({ length: count }, (_, index) => (
    index % 2 === 0 ? `diag.down.${index}` : `diag.up.${index}`
  ));
  return [...tops, ...back, ...diagonals];
}

export function wellHouseEdgeLabel(id: string): string | null {
  const match = /^(top|right|bottom|left|diag\.down|diag\.up)\.(\d+)$/.exec(id);
  if (!match) return null;
  const role = match[1] as "top" | "right" | "bottom" | "left" | "diag.down" | "diag.up";
  const wall = Number(match[2]) + 1;
  switch (role) {
    case "top":
      return `Wall ${wall} top`;
    case "right":
      return `Wall ${wall} right`;
    case "bottom":
      return `Wall ${wall} bottom`;
    case "left":
      return `Wall ${wall} left`;
    case "diag.down":
    case "diag.up":
      return `Wall ${wall} diagonal`;
    default: {
      const _never: never = role;
      return _never;
    }
  }
}

function wellHouseLayout(input: {
  units: LayoutUnits;
  pitchM: number;
  params: Record<string, number>;
}): PropLayout | null {
  const toM = (value: number) => value * (input.units === "ft" ? METRES_PER_FOOT : 1);
  const sides = Math.round(input.params.sides ?? 0);
  const side = toM(input.params.side ?? 0);
  const height = toM(input.params.height ?? 0);
  if (sides < 3 || sides > 16 || !(side > 0) || !(height > 0)) return null;
  const corners: LayoutCorner[] = [];
  const byId = new Map<string, LayoutEdge>();
  for (let index = 0; index < sides; index += 1) {
    const x = index * side;
    const tl = `w${index}-tl`;
    const tr = `w${index}-tr`;
    const br = `w${index}-br`;
    const bl = `w${index}-bl`;
    corners.push(
      { id: tl, x, y: height },
      { id: tr, x: x + side, y: height },
      { id: br, x: x + side, y: 0 },
      { id: bl, x, y: 0 },
    );
    byId.set(`top.${index}`, { id: `top.${index}`, from: tl, to: tr, kind: "lit" });
    byId.set(`right.${index}`, { id: `right.${index}`, from: tr, to: br, kind: "lit" });
    byId.set(`bottom.${index}`, { id: `bottom.${index}`, from: br, to: bl, kind: "lit" });
    byId.set(`left.${index}`, { id: `left.${index}`, from: bl, to: tl, kind: "lit" });
    if (index % 2 === 0) {
      byId.set(`diag.down.${index}`, { id: `diag.down.${index}`, from: tl, to: br, kind: "lit" });
    } else {
      byId.set(`diag.up.${index}`, { id: `diag.up.${index}`, from: bl, to: tr, kind: "lit" });
    }
  }
  const run = wellHouseEdgeOrder(sides).map((id) => byId.get(id)).filter((edge): edge is LayoutEdge => Boolean(edge));
  return {
    source: "template",
    template: { type: "wireframe", params: input.params },
    net: { sides, widthM: side, heightM: height },
    units: input.units,
    pitchM: input.pitchM,
    startOffsetM: 0,
    corners,
    run,
  };
}

function startIdOf(layout: PropLayout): string {
  return startCorner(layout).id;
}

function runEndId(layout: PropLayout): string {
  return layout.run.length > 0 ? layout.run[layout.run.length - 1]!.to : startIdOf(layout);
}

function isClosingEdge(layout: PropLayout, edge: LayoutEdge): boolean {
  if (!isClosed(layout)) return false;
  return edge.id === layout.run[layout.run.length - 1]!.id;
}

function lock(layout: PropLayout, edgeId: string, lengthM: number): PropLayout {
  return {
    ...layout,
    run: layout.run.map((edge) => edge.id === edgeId ? { ...edge, lockedLengthM: lengthM } : edge),
  };
}

function moveEdgeAndTail(layout: PropLayout, edge: LayoutEdge, lengthM: number): PropLayout {
  const from = cornerById(layout, edge.from);
  const to = cornerById(layout, edge.to);
  if (!from || !to) return layout;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = length > 1e-9 ? (to.x - from.x) / length : 1;
  const uy = length > 1e-9 ? (to.y - from.y) / length : 0;
  const nextTo = { x: from.x + ux * lengthM, y: from.y + uy * lengthM };
  const dx = nextTo.x - to.x;
  const dy = nextTo.y - to.y;
  const shift = tailIds(layout, edge.to);
  return {
    ...layout,
    corners: layout.corners.map((corner) => {
      if (corner.id === edge.to) return { ...corner, x: nextTo.x, y: nextTo.y };
      if (shift.has(corner.id)) return { ...corner, x: corner.x + dx, y: corner.y + dy };
      return corner;
    }),
  };
}

function tailIds(layout: PropLayout, afterId: string): Set<string> {
  const ids = new Set<string>();
  let seen = false;
  const start = startIdOf(layout);
  for (const edge of layout.run) {
    if (seen) {
      if (edge.to !== start) ids.add(edge.to);
      if (edge.from !== start && edge.from !== afterId) ids.add(edge.from);
    }
    if (edge.to === afterId || edge.from === afterId) seen = true;
  }
  ids.delete(start);
  ids.delete(afterId);
  return ids;
}

function moveClosingEdge(layout: PropLayout, edge: LayoutEdge, lengthM: number): PropLayout {
  const from = cornerById(layout, edge.from);
  const to = cornerById(layout, edge.to);
  if (!from || !to) return layout;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = length > 1e-9 ? (from.x - to.x) / length : -1;
  const uy = length > 1e-9 ? (from.y - to.y) / length : 0;
  return moveCorner(layout, edge.from, to.x + ux * lengthM, to.y + uy * lengthM);
}

function gapAfter(layout: PropLayout, editedId: string): number | null {
  const closing = layout.run[layout.run.length - 1];
  if (!closing?.lockedLengthM || closing.id === editedId) return null;
  const geometric = edgeLengthM(layout, closing);
  const gap = Math.abs(geometric - closing.lockedLengthM);
  return gap > 0.005 ? gap : null;
}

function gridOrRaw(
  point: { x: number; y: number },
  gridM: number,
  threshold: number,
  snapOff: boolean,
): { x: number; y: number; guide: SnapGuide | null } {
  if (snapOff || !(gridM > 0)) return { ...point, guide: null };
  const x = Math.round(point.x / gridM) * gridM;
  const y = Math.round(point.y / gridM) * gridM;
  if (Math.hypot(x - point.x, y - point.y) <= threshold) return { x, y, guide: "grid" };
  return { ...point, guide: null };
}

function snapAngle(
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  previous: number | null,
  force: boolean,
  threshold: number,
): { x: number; y: number } | null {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const angle = Math.atan2(dy, dx);
  const steps = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => deg * Math.PI / 180);
  const relative = previous == null ? [] : steps.map((step) => previous + step);
  const candidates = force ? (previous == null ? steps : relative) : [...steps, ...relative];
  let best = { diff: Infinity, angle: 0 };
  for (const candidate of candidates) {
    const diff = Math.abs(normalizeAngle(angle - candidate));
    if (diff < best.diff) best = { diff, angle: candidate };
  }
  const limit = force ? Math.PI : 12 * Math.PI / 180;
  const projected = { x: anchor.x + Math.cos(best.angle) * length, y: anchor.y + Math.sin(best.angle) * length };
  const miss = Math.hypot(projected.x - point.x, projected.y - point.y);
  if (!force && best.diff > limit && miss > threshold) return null;
  return projected;
}

function snapLightLength(
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  pitchM: number,
): { x: number; y: number } | null {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const steps = Math.max(1, Math.round(length / pitchM));
  const target = steps * pitchM;
  if (Math.abs(target - length) > pitchM * 0.35) return null;
  const scale = target / length;
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
}

function normalizeAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function nextId(layout: PropLayout, prefix: string): string {
  const used = new Set(layout.corners.map((corner) => corner.id));
  for (const string of layoutStrings(layout)) {
    used.add(string.id);
    for (const edge of string.run) used.add(edge.id);
  }
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
