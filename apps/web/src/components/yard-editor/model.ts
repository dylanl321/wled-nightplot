/**
 * The one-page yard editor's rules, without React: which shapes a new prop
 * can start from, how a draft prop changes, how lights are counted, and how
 * a Look switches props and sections. Everything here works on the stored
 * types (`Prop`, `PropLayout`, `Look`) so Save sends exactly what the
 * editor shows.
 */
import {
  clearEdgeLights,
  continueToCorner,
  continueToPoint,
  countLayout,
  deleteRun,
  edgeLengthM,
  emptyTrace,
  ensureStrings,
  layoutFromMeasurements,
  layoutStrings,
  METRES_PER_FOOT,
  moveCorner,
  propShapeChanged,
  sectionIndexRanges,
  installGuide,
  setEdgeLength,
  spiralGapForLights,
  setEdgeLights,
  setPitchM,
  splitRun,
  spreadLights,
  windowSideNames,
  type LayoutEdge,
  type LayoutUnits,
  type Prop,
  type PropKind,
  type PropLayout,
  type PropMeasurements,
  type PropSection,
  type InstallGuide,
} from "@nightplot/shared";

/** The tiles in "Start from". `draw` traces a path by hand. */
export type ShapeId = "line" | "window" | "triangle" | "tree" | "arch" | "spiral" | "spiralTree" | "zigzag" | "draw";

export const SHAPES: readonly { id: ShapeId; title: string; svg: string }[] = [
  { id: "line", title: "Line", svg: "M3 16 L31 8" },
  { id: "window", title: "Window", svg: "M6 3 H28 V21 H6 Z" },
  { id: "triangle", title: "Triangle", svg: "M5 21 L17 3 L29 21 Z" },
  { id: "tree", title: "Mini tree", svg: "M7 21 L17 3 L27 21 M17 21v-2" },
  { id: "arch", title: "Arch", svg: "M4 21 C4 2, 30 2, 30 21" },
  { id: "spiral", title: "Post wrap", svg: "M12 22 L22 19 L12 16 L22 13 L12 10 L22 7 L12 4 M12 22 V2 M22 22 V2" },
  { id: "spiralTree", title: "Spiral tree", svg: "M6 21 L28 18 L9 15 L25 12 L12 9 L22 6 L17 3" },
  { id: "zigzag", title: "Zigzag", svg: "M4 21 L9 5 L14 21 L19 5 L24 21 L29 5" },
  { id: "draw", title: "Draw it", svg: "M4 19 L12 9 L20 15 L30 5" },
];

/**
 * A size field on a template shape, in the order the panel shows them.
 * `passes` and `horizontal` are counts, not lengths: units do not convert them.
 */
export type SizeKey = "length" | "width" | "height" | "base" | "around" | "aroundTop" | "gap" | "passes" | "horizontal";

/** Sizes that are not lengths. */
export const PLAIN_SIZES: ReadonlySet<SizeKey> = new Set<SizeKey>(["passes", "horizontal"]);
const SIZE_KEYS: readonly SizeKey[] = ["length", "width", "height", "base", "around", "aroundTop", "gap", "passes", "horizontal"];

/** Starting sizes, in the unit named. Round numbers in each unit. */
const DEFAULT_SIZES: Record<Exclude<ShapeId, "draw">, Record<LayoutUnits, Partial<Record<SizeKey, number>>>> = {
  line: { m: { length: 4 }, ft: { length: 13 } },
  window: { m: { width: 1.5, height: 1.2 }, ft: { width: 5, height: 4 } },
  triangle: { m: { base: 2, height: 2 }, ft: { base: 6, height: 6 } },
  tree: { m: { base: 1, height: 1.5 }, ft: { base: 3, height: 5 } },
  arch: { m: { width: 3, height: 2 }, ft: { width: 10, height: 6 } },
  // A 4×4 post is 3.5 in a side: 14 in around. Wraps 4 in apart.
  spiral: { m: { height: 2.4, around: 0.35, aroundTop: 0.35, gap: 0.1 }, ft: { height: 8, around: 14 / 12, aroundTop: 14 / 12, gap: 4 / 12 } },
  // A 6 ft tree about 3 ft wide at the bottom, to a point. Wraps 6 in apart.
  spiralTree: { m: { height: 1.8, around: 2.8, aroundTop: 0, gap: 0.15 }, ft: { height: 6, around: 9.5, aroundTop: 0, gap: 0.5 } },
  zigzag: { m: { width: 1.2, height: 1, passes: 8 }, ft: { width: 4, height: 3, passes: 8 } },
};

/**
 * Field order and label for each template shape. `small` sizes are typed in
 * inches (or cm), the way a tape round a post reads. `plain` is a count.
 */
export const SIZE_FIELDS: Record<Exclude<ShapeId, "draw">, { key: SizeKey; label: string; small?: true; plain?: true }[]> = {
  line: [{ key: "length", label: "Length" }],
  window: [{ key: "width", label: "Width" }, { key: "height", label: "Height" }],
  triangle: [{ key: "base", label: "Width" }, { key: "height", label: "Height" }],
  tree: [{ key: "base", label: "Width" }, { key: "height", label: "Height" }],
  arch: [{ key: "width", label: "Width" }, { key: "height", label: "Height" }],
  spiral: [
    { key: "height", label: "Height" },
    { key: "gap", label: "Wrap every", small: true },
    { key: "around", label: "Around, bottom", small: true },
    { key: "aroundTop", label: "Around, top", small: true },
  ],
  spiralTree: [
    { key: "height", label: "Height" },
    { key: "gap", label: "Wrap every", small: true },
    { key: "around", label: "Around, bottom" },
    { key: "aroundTop", label: "Around, top" },
  ],
  zigzag: [{ key: "width", label: "Width" }, { key: "height", label: "Height" }, { key: "passes", label: "Passes", plain: true }],
};

/** Zigzag up and down (false) or side to side (true). */
export function setZigzagDirection(draft: Draft, horizontal: boolean): Draft {
  if (draft.shape !== "zigzag") return draft;
  return setSize({ ...draft, sizes: { ...draft.sizes, horizontal: horizontal ? 1 : 0 } }, "passes", draft.sizes.passes ?? 8);
}

/** Spirals: a pixel string's spacing is fixed, so a typed count moves the wraps. */
export function isSpiral(shape: ShapeId | null | undefined): shape is "spiral" | "spiralTree" {
  return shape === "spiral" || shape === "spiralTree";
}

export const SHAPE_TITLES: Record<ShapeId, string> = Object.fromEntries(SHAPES.map((row) => [row.id, row.title])) as Record<ShapeId, string>;

/**
 * A prop being built or edited on its own canvas. `drawn` is true once the
 * path no longer follows the template (a corner was dragged, a run traced,
 * split or deleted), so template sizes stop applying. `count` is a typed
 * total that is spread over the runs whenever the shape changes.
 */
export type Draft = {
  id: string | null;
  label: string;
  shape: ShapeId | null;
  drawn: boolean;
  /** Template sizes in the layout's unit. */
  sizes: Partial<Record<SizeKey, number>>;
  layout: PropLayout | null;
  sections: PropSection[];
  count: number | null;
  /** Kept from a stored prop whose kind this editor does not offer (stake row, well house). */
  keepKind?: PropKind;
};

export function shapeOfProp(prop: Pick<Prop, "kind" | "design" | "layout">): ShapeId {
  const m = prop.design?.measurements;
  switch (prop.kind) {
    case "roofline":
      return "line";
    case "window":
      return "window";
    case "arch":
      return "arch";
    case "tree":
      return m?.shape === "tree" && m.closed ? "triangle" : prop.layout?.template?.params.closed === 1 ? "triangle" : "tree";
    case "spiral": {
      const top = m?.shape === "spiral" ? m.aroundTop : prop.layout?.template?.params.aroundTop;
      return top === 0 ? "spiralTree" : "spiral";
    }
    case "zigzag":
      return "zigzag";
    default:
      return "draw";
  }
}

export function kindOfShape(shape: ShapeId): PropKind {
  switch (shape) {
    case "line":
      return "roofline";
    case "window":
      return "window";
    case "arch":
      return "arch";
    case "triangle":
    case "tree":
      return "tree";
    case "spiral":
    case "spiralTree":
      return "spiral";
    case "zigzag":
      return "zigzag";
    case "draw":
      return "custom";
  }
}

/** Template params for `layoutFromMeasurements`, in the layout's unit. */
function templateParams(shape: Exclude<ShapeId, "draw">, sizes: Partial<Record<SizeKey, number>>): Record<string, number> {
  switch (shape) {
    case "line":
      return { length: sizes.length ?? 0 };
    case "window":
      return { width: sizes.width ?? 0, height: sizes.height ?? 0 };
    case "arch":
      return { width: sizes.width ?? 0, height: sizes.height ?? 0 };
    case "triangle":
      return { base: sizes.base ?? 0, height: sizes.height ?? 0, closed: 1 };
    case "tree":
      return { base: sizes.base ?? 0, height: sizes.height ?? 0 };
    case "spiral":
    case "spiralTree":
      return { height: sizes.height ?? 0, around: sizes.around ?? 0, aroundTop: sizes.aroundTop ?? sizes.around ?? 0, gap: sizes.gap ?? 0 };
    case "zigzag":
      return { width: sizes.width ?? 0, height: sizes.height ?? 0, passes: Math.round(sizes.passes ?? 0), horizontal: sizes.horizontal === 1 ? 1 : 0 };
  }
}

function templateShape(shape: Exclude<ShapeId, "draw">): "roofline" | "window" | "arch" | "tree" | "spiral" | "zigzag" {
  return shape === "line" ? "roofline" : shape === "triangle" ? "tree" : shape === "spiralTree" ? "spiral" : shape;
}

export function measurementsOf(draft: Draft): PropMeasurements {
  if (!draft.shape || draft.shape === "draw" || draft.keepKind) return { shape: "custom" };
  const s = draft.sizes;
  switch (draft.shape) {
    case "line":
      return { shape: "roofline", length: s.length ?? 0 };
    case "window":
      return { shape: "window", width: s.width ?? 0, height: s.height ?? 0 };
    case "arch":
      return { shape: "arch", width: s.width ?? 0, height: s.height ?? 0 };
    case "triangle":
      return { shape: "tree", base: s.base ?? 0, height: s.height ?? 0, closed: true };
    case "tree":
      return { shape: "tree", base: s.base ?? 0, height: s.height ?? 0 };
    case "spiral":
    case "spiralTree":
      return { shape: "spiral", height: s.height ?? 0, around: s.around ?? 0, aroundTop: s.aroundTop ?? s.around ?? 0, gap: s.gap ?? 0 };
    case "zigzag":
      return { shape: "zigzag", width: s.width ?? 0, height: s.height ?? 0, passes: Math.round(s.passes ?? 0), direction: s.horizontal === 1 ? "horizontal" : "vertical" };
  }
}

/** A draft ready for a clean canvas. */
export function newDraft(label: string): Draft {
  return { id: null, label, shape: null, drawn: false, sizes: {}, layout: null, sections: [], count: null };
}

/** Open a stored prop on its own canvas. */
export function draftFromProp(prop: Prop, units: LayoutUnits, pitchM: number): Draft {
  const shape = shapeOfProp(prop);
  const layout = prop.layout ?? emptyTrace(units, pitchM);
  const params = layout.template?.params ?? {};
  const sizes: Partial<Record<SizeKey, number>> = {};
  for (const key of SIZE_KEYS) if (typeof params[key] === "number") sizes[key] = params[key];
  const offered = prop.kind !== "stake-row" && prop.kind !== "wireframe";
  const drawn = shape === "draw" || !layout.template || (prop.design?.measurements ? propShapeChanged(prop) : false) || cornersMoved(layout, shape, sizes);
  return {
    id: prop.id,
    label: prop.label,
    shape,
    drawn,
    sizes,
    layout,
    sections: prop.sections ?? [],
    count: null,
    ...(offered ? {} : { keepKind: prop.kind }),
  };
}

function cornersMoved(layout: PropLayout, shape: ShapeId, sizes: Partial<Record<SizeKey, number>>): boolean {
  if (shape === "draw") return true;
  const fresh = layoutFromMeasurements({ units: layout.units, pitchM: layout.pitchM, shape: templateShape(shape), params: { ...(layout.template?.params ?? {}), ...templateParams(shape, sizes) } });
  if (!fresh) return true;
  return fresh.corners.some((corner) => {
    const have = layout.corners.find((row) => row.id === corner.id);
    return !have || Math.abs(have.x - corner.x) > 0.002 || Math.abs(have.y - corner.y) > 0.002;
  });
}

/** Re-apply a typed total after the shape changed, so the runs still add up to it. */
function withCount(draft: Draft): Draft {
  if (!draft.layout || draft.count == null) return draft;
  return { ...draft, layout: spreadLights(clearAllLocks(draft.layout), draft.count) };
}

function clearAllLocks(layout: PropLayout): PropLayout {
  let next = layout;
  for (const edge of litEdges(layout)) if (edge.lockedLights != null) next = clearEdgeLights(next, edge.id);
  return next;
}

/** Keep section edges that still exist. */
function keepSections(sections: PropSection[], layout: PropLayout): PropSection[] {
  const ids = new Set(litEdges(layout).map((edge) => edge.id));
  return sections.map((section) => ({ ...section, edgeIds: section.edgeIds.filter((id) => ids.has(id)) }));
}

/**
 * Pick a tile. A template keeps the current width and height when there is
 * a shape already, so "make it a square" is Window on a 2 × 2 triangle.
 * Picking a shape clears sections, as the panel says.
 */
export function startFrom(draft: Draft, shape: ShapeId, units: LayoutUnits, pitchM: number): Draft {
  const pitch = draft.layout?.pitchM ?? pitchM;
  const unit = draft.layout?.units ?? units;
  if (shape === "draw") {
    return { ...draft, shape: "draw", drawn: true, sizes: {}, layout: null, sections: [], keepKind: undefined, count: draft.count };
  }
  const sizes = { ...DEFAULT_SIZES[shape][unit] };
  const had = draft.layout && draft.layout.corners.length > 1 && draft.shape && draft.shape !== "draw" ? footprint(draft.layout) : null;
  if (had) {
    const w = roundSize(had.w, unit);
    const h = roundSize(had.h, unit);
    if (shape === "line") sizes.length = Math.max(w, h) || sizes.length;
    else if (isSpiral(shape)) {
      // A spiral's width is the post, not the last shape's: keep only the height.
      if (h > 0) sizes.height = h;
    } else {
      const wideKey: SizeKey = shape === "window" || shape === "arch" || shape === "zigzag" ? "width" : "base";
      if (w > 0) sizes[wideKey] = w;
      if (h > 0) sizes.height = h;
    }
  }
  const layout = layoutFromMeasurements({ units: unit, pitchM: pitch, shape: templateShape(shape), params: templateParams(shape, sizes) });
  return withCount({ ...draft, shape, drawn: false, sizes, layout, sections: [], keepKind: undefined });
}

function footprint(layout: PropLayout): { w: number; h: number } {
  const xs = layout.corners.map((c) => c.x);
  const ys = layout.corners.map((c) => c.y);
  const toU = layout.units === "ft" ? 1 / METRES_PER_FOOT : 1;
  return { w: (Math.max(...xs) - Math.min(...xs)) * toU, h: (Math.max(...ys) - Math.min(...ys)) * toU };
}

function roundSize(value: number, units: LayoutUnits): number {
  void units;
  return Math.round(value * 1000) / 1000;
}

/** Type a template size. The template is drawn again and sections keep their edges. */
export function setSize(draft: Draft, key: SizeKey, value: number): Draft {
  if (!draft.shape || draft.shape === "draw" || draft.drawn || !(value > 0) || !draft.layout) return draft;
  const sizes = { ...draft.sizes, [key]: value };
  const layout = layoutFromMeasurements({
    units: draft.layout.units,
    pitchM: draft.layout.pitchM,
    shape: templateShape(draft.shape),
    params: { ...(draft.layout.template?.params ?? {}), ...templateParams(draft.shape, sizes) },
  });
  if (!layout) return draft;
  const kept = { ...layout, ...(draft.layout.retiredIds ? { retiredIds: draft.layout.retiredIds } : {}) };
  return withCount({ ...draft, sizes, layout: kept, sections: keepSections(draft.sections, kept) });
}

/** Back to the template sizes after a hand edit. */
export function resetToTemplate(draft: Draft): Draft {
  if (!draft.shape || draft.shape === "draw" || !draft.layout) return draft;
  const sizes = Object.keys(draft.sizes).length ? draft.sizes : { ...DEFAULT_SIZES[draft.shape][draft.layout.units] };
  const layout = layoutFromMeasurements({ units: draft.layout.units, pitchM: draft.layout.pitchM, shape: templateShape(draft.shape), params: templateParams(draft.shape, sizes) });
  if (!layout) return draft;
  return withCount({ ...draft, drawn: false, sizes, layout, sections: keepSections(draft.sections, layout) });
}

/** Feet or metres. Sizes convert, the drawing does not move. */
export function setUnits(draft: Draft, units: LayoutUnits): Draft {
  if (!draft.layout || draft.layout.units === units) return draft;
  const factor = units === "ft" ? 1 / METRES_PER_FOOT : METRES_PER_FOOT;
  const sizes: Partial<Record<SizeKey, number>> = {};
  for (const [key, value] of Object.entries(draft.sizes) as [SizeKey, number][]) sizes[key] = PLAIN_SIZES.has(key) ? value : roundSize(value * factor, units);
  const params = draft.layout.template ? { ...draft.layout.template.params, ...sizes } : undefined;
  const layout: PropLayout = { ...draft.layout, units, ...(params && draft.layout.template ? { template: { ...draft.layout.template, params } } : {}) };
  return { ...draft, sizes, layout };
}

/** Type how many lights the whole prop has. Spacing follows. */
export function setCount(draft: Draft, total: number): Draft {
  if (!draft.layout || !Number.isInteger(total) || total < 1) return draft;
  if (isSpiral(draft.shape) && !draft.drawn) return fitSpiral(draft, total) ?? draft;
  return withCount({ ...draft, count: total });
}

/**
 * Space a spiral's wraps so it uses exactly `total` lights at the spacing it
 * has. Null when that many lights cannot make between half a turn and 200
 * turns on this post or tree.
 */
export function fitSpiral(draft: Draft, total: number): Draft | null {
  if (!draft.layout || !isSpiral(draft.shape)) return null;
  const toM = draft.layout.units === "ft" ? METRES_PER_FOOT : 1;
  const s = draft.sizes;
  const gapM = spiralGapForLights({
    heightM: (s.height ?? 0) * toM,
    aroundM: (s.around ?? 0) * toM,
    aroundTopM: (s.aroundTop ?? s.around ?? 0) * toM,
  }, total, draft.layout.pitchM);
  if (gapM == null) return null;
  return setSize({ ...draft, count: null }, "gap", gapM / toM);
}

/** Install marks: every `every`th light, and the light at each foot (or 25 cm) of height on a spiral. */
export function guideFor(draft: Draft, every: number): InstallGuide | null {
  if (!draft.layout) return null;
  const step = draft.layout.units === "ft" ? METRES_PER_FOOT : 0.25;
  return installGuide(draft.layout, { everyLights: every, everyHeightM: isSpiral(draft.shape) ? step : undefined });
}

/** Type the spacing. Counts come from length again. */
export function setSpacing(draft: Draft, pitchM: number): Draft {
  if (!draft.layout) return draft;
  const layout = setPitchM(clearAllLocks(draft.layout), pitchM);
  return { ...draft, count: null, layout };
}

export function litEdges(layout: PropLayout): LayoutEdge[] {
  return layoutStrings(layout).flatMap((string) => string.run).filter((edge) => edge.kind === "lit");
}

/** One row per lit run, in wiring order, with its name, length and lights. */
export function runRows(draft: Draft): { edge: LayoutEdge; name: string; lengthM: number; lights: number; typed: boolean }[] {
  const layout = draft.layout;
  if (!layout) return [];
  const counted = new Map(countLayout(layout).edges.map((row) => [row.id, row]));
  const names = runNames(draft);
  return litEdges(layout).map((edge, index) => ({
    edge,
    name: edge.name ?? names[index] ?? `Run ${index + 1}`,
    lengthM: counted.get(edge.id)?.lengthM ?? edgeLengthM(layout, edge),
    lights: counted.get(edge.id)?.lights ?? 0,
    typed: edge.lockedLights != null && draft.count == null,
  }));
}

function runNames(draft: Draft): string[] {
  if (!draft.layout || draft.drawn) return [];
  switch (draft.shape) {
    case "line":
      return ["Along the roof"];
    case "window":
      return windowSideNames(draft.layout).map((name) => (name === "Bottom" || name === "Top" ? name : `${name} side`));
    case "arch":
    case "tree":
      return ["Left side", "Right side"];
    case "triangle":
      return ["Left side", "Right side", "Base"];
    default:
      return [];
  }
}

export function lightTotal(layout: PropLayout | null): number {
  return layout ? countLayout(layout).total : 0;
}

export function totalLengthM(layout: PropLayout | null): number {
  return layout ? litEdges(layout).reduce((sum, edge) => sum + edgeLengthM(layout, edge), 0) : 0;
}

/** Spacing the panel shows: the typed total sets it, otherwise the layout's own. */
export function spacingM(draft: Draft): number {
  if (!draft.layout) return 0;
  return draft.layout.pitchM;
}

/**
 * Which template size a run's length is, so typing a window side keeps the
 * window square. Null means the run's far end moves along the run.
 */
export function sizeForRun(draft: Draft, edgeId: string): SizeKey | null {
  if (draft.drawn || !draft.layout || !draft.shape) return null;
  const index = litEdges(draft.layout).findIndex((edge) => edge.id === edgeId);
  if (index < 0) return null;
  if (draft.shape === "line") return "length";
  if (draft.shape === "window") {
    const names = windowSideNames(draft.layout);
    return names[index] === "Bottom" || names[index] === "Top" ? "width" : "height";
  }
  if (draft.shape === "triangle" && index === 2) return "base";
  return null;
}

/** Type a run's length (metres). */
export function setRunLength(draft: Draft, edgeId: string, lengthM: number): Draft {
  if (!draft.layout || !(lengthM > 0)) return draft;
  const key = sizeForRun(draft, edgeId);
  if (key) {
    const value = draft.layout.units === "ft" ? lengthM / METRES_PER_FOOT : lengthM;
    return setSize(draft, key, roundSize(value, draft.layout.units));
  }
  const edited = setEdgeLength(draft.layout, edgeId, lengthM).layout;
  const layout = clearEdgeLights(edited, edgeId);
  return withCount({ ...draft, drawn: true, layout });
}

/** Type how many lights sit on one run. The total stops being fixed. */
export function setRunLights(draft: Draft, edgeId: string, lights: number): Draft {
  if (!draft.layout || !Number.isInteger(lights) || lights < 0) return draft;
  let layout = draft.layout;
  if (draft.count != null) {
    // Freeze every run at what it shows now, then change this one.
    for (const row of runRows(draft)) layout = setEdgeLights(layout, row.edge.id, row.lights);
  }
  return { ...draft, count: null, layout: setEdgeLights(layout, edgeId, lights) };
}

export function countRunFromLength(draft: Draft, edgeId: string): Draft {
  if (!draft.layout) return draft;
  return { ...draft, layout: clearEdgeLights(draft.layout, edgeId) };
}

export function dragCorner(draft: Draft, cornerId: string, x: number, y: number): Draft {
  if (!draft.layout) return draft;
  return withCount({ ...draft, drawn: true, layout: moveCorner(draft.layout, cornerId, x, y) });
}

/** Add a point on a run. Sections that held the run hold both halves. */
export function addPoint(draft: Draft, edgeId: string, x: number, y: number): { draft: Draft; newEdgeId: string | null } {
  if (!draft.layout) return { draft, newEdgeId: null };
  const before = new Set(litEdges(draft.layout).map((edge) => edge.id));
  const split = splitRun(draft.layout, edgeId, x, y);
  if (!split.cornerId) return { draft, newEdgeId: null };
  const added = litEdges(split.layout).find((edge) => !before.has(edge.id))?.id ?? null;
  const sections = draft.sections.map((section) => (added && section.edgeIds.includes(edgeId) ? { ...section, edgeIds: [...section.edgeIds, added] } : section));
  return { draft: withCount({ ...draft, drawn: true, layout: split.layout, sections }), newEdgeId: added };
}

/** Draw it: the first tap is the wire-in. */
export function placeWireIn(draft: Draft, x: number, y: number, units: LayoutUnits, pitchM: number): Draft {
  const layout = emptyTrace(units, pitchM);
  return { ...draft, shape: "draw", drawn: true, layout: { ...layout, corners: [{ id: "c1", x, y }] }, sections: [] };
}

/** Trace: a run from the last corner to a new point, or back to a corner. Returns the new run's id. */
export function traceTo(draft: Draft, target: { x: number; y: number } | { cornerId: string }): { draft: Draft; newEdgeId: string | null } {
  if (!draft.layout) return { draft, newEdgeId: null };
  const base = ensureStrings(draft.layout);
  const stringId = layoutStrings(base)[0]?.id ?? "s1";
  const before = new Set(litEdges(base).map((edge) => edge.id));
  const layout = "cornerId" in target ? continueToCorner(base, stringId, target.cornerId) : continueToPoint(base, stringId, target.x, target.y);
  const added = litEdges(layout).find((edge) => !before.has(edge.id))?.id ?? null;
  return { draft: withCount({ ...draft, drawn: true, layout }), newEdgeId: added };
}

export function removeRun(draft: Draft, edgeId: string): Draft {
  if (!draft.layout) return draft;
  const layout = deleteRun(draft.layout, edgeId);
  return withCount({ ...draft, drawn: true, layout, sections: keepSections(draft.sections, layout) });
}

// ---------- sections ----------

export const SECTION_PALETTE = ["#e05a4f", "#4fb36a", "#4f8de0", "#e0b84f", "#b36ae0", "#4fd0e0"];

export function addSection(draft: Draft): { draft: Draft; id: string } {
  let n = draft.sections.length + 1;
  const taken = new Set(draft.sections.map((s) => s.id));
  while (taken.has(`section-${n}`)) n += 1;
  const id = `section-${n}`;
  const names = new Set(draft.sections.map((s) => s.name));
  let k = draft.sections.length + 1;
  while (names.has(`Section ${k}`)) k += 1;
  const section: PropSection = { id, name: `Section ${k}`, edgeIds: [], pinnedRanges: [], color: SECTION_PALETTE[draft.sections.length % SECTION_PALETTE.length] };
  return { draft: { ...draft, sections: [...draft.sections, section] }, id };
}

/** Tap a run while a section is open: in or out. A run is in one section at most. */
export function toggleRunInSection(draft: Draft, sectionId: string, edgeId: string): Draft {
  const order = draft.layout ? litEdges(draft.layout).map((edge) => edge.id) : [];
  const sections = draft.sections.map((section) => {
    if (section.id !== sectionId) return { ...section, edgeIds: section.edgeIds.filter((id) => id !== edgeId) };
    const has = section.edgeIds.includes(edgeId);
    const edgeIds = has ? section.edgeIds.filter((id) => id !== edgeId) : [...section.edgeIds, edgeId];
    return { ...section, edgeIds: edgeIds.sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
  });
  return { ...draft, sections };
}

export function updateSection(draft: Draft, sectionId: string, patch: Partial<Pick<PropSection, "name" | "color">>): Draft {
  return { ...draft, sections: draft.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)) };
}

export function deleteSection(draft: Draft, sectionId: string): Draft {
  return { ...draft, sections: draft.sections.filter((section) => section.id !== sectionId) };
}

export function sectionOfEdge(sections: readonly PropSection[], edgeId: string): PropSection | undefined {
  return sections.find((section) => section.edgeIds.includes(edgeId));
}

/** 1-based light ranges for a section ("1–40, 61–70"), and the WLED 0-based ones. */
export function sectionRangeText(layout: PropLayout | null, sections: readonly PropSection[], sectionId: string): { human: string; wled: string; empty: boolean } {
  if (!layout) return { human: "no lights", wled: "", empty: true };
  const report = sectionIndexRanges(layout, sections).find((row) => row.sectionId === sectionId);
  const ranges = (report?.ranges ?? []).filter((range) => range.stop > range.start);
  if (ranges.length === 0) return { human: "no lights", wled: "", empty: true };
  const human = ranges.map((r) => (r.stop - r.start === 1 ? `${r.start + 1}` : `${r.start + 1}–${r.stop}`)).join(", ");
  const wled = ranges.map((r) => (r.stop - r.start === 1 ? `${r.start}` : `${r.start}–${r.stop - 1}`)).join(", ");
  return { human, wled, empty: false };
}

// ---------- naming ----------

const AUTO_NAME = /^(New prop|Line|Window|Triangle|Mini tree|Arch|Post wrap|Spiral tree|Zigzag|Drawing) \d+$/;

export function isAutoName(label: string): boolean {
  return AUTO_NAME.test(label);
}

/** "Triangle 2": the shape's name and the first number no prop uses. */
export function nextName(shape: ShapeId | null, taken: readonly string[]): string {
  const base = !shape ? "New prop" : shape === "draw" ? "Drawing" : SHAPE_TITLES[shape];
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** After a tile is picked, an automatic name follows the shape; a typed name stays. */
export function renameForShape(label: string, shape: ShapeId, taken: readonly string[]): string {
  if (!isAutoName(label)) return label;
  if (label.split(" ").slice(0, -1).join(" ") === (shape === "draw" ? "Drawing" : SHAPE_TITLES[shape])) return label;
  return nextName(shape, taken.filter((name) => name !== label));
}

