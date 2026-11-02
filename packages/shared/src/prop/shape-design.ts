/**
 * Designing Looks from a prop's shape. Sections made from what the shape
 * reader found (border, inside, each side), the WLED direction that makes an
 * effect travel a chosen way over the shape (toward the centre, clockwise,
 * upward), and copying one section's design onto sections of the same kind,
 * on this prop or on others. Everything here runs on stock WLED: a section is
 * a segment, and direction is `rev` and `mi`.
 */
import { lookIncludesProp, normalizeLook, type Look, type LookDirection, type LookOverride, type LookStyle, type ShapeMotion } from "../look.ts";
import { propStyle, sectionStyle, setPropMode } from "../look-design.ts";
import { layoutStrings } from "./layout.ts";
import { sectionIndexRanges } from "./sections.ts";
import { readPropShape, type ShapeLight, type ShapeProfile, type ShapeRole } from "./shape.ts";
import type { Prop, PropIndexRange, PropSection } from "./types.ts";

export const SHAPE_MOTION_LABELS: Record<ShapeMotion, string> = {
  wire: "Along the wire",
  inward: "Toward the centre",
  outward: "Out from the centre",
  clockwise: "Clockwise",
  counter: "Counter-clockwise",
  up: "Upward",
  down: "Downward",
};

/** The shape of a drawn prop, with the person's fixes. Null for a prop with no drawing or a wireframe. */
export function propShape(prop: Pick<Prop, "layout" | "shapeRoles" | "wireframe">): ShapeProfile | null {
  if (!prop.layout || prop.wireframe) return null;
  return readPropShape(prop.layout, { overrides: prop.shapeRoles ?? [] });
}

/** One line on what the reader found, such as "4 sides · 4 corners · a centre · 40 inside". */
export function shapeSummary(shape: ShapeProfile): string {
  const parts: string[] = [];
  const sides = shape.sides.length;
  if (sides > 0) parts.push(`${sides} side${sides === 1 ? "" : "s"}`);
  const corners = shape.points.filter((point) => point.isCorner).length;
  if (corners > 0) parts.push(`${corners} corner${corners === 1 ? "" : "s"}`);
  const ends = shape.points.filter((point) => point.kind === "end").length;
  if (ends > 0) parts.push(`${ends} end${ends === 1 ? "" : "s"}`);
  if (shape.centrePointId) parts.push("a centre");
  const inside = shape.lights.filter((light) => light.role === "inside").length;
  parts.push(inside > 0 ? `${inside} of ${shape.lights.length} lights inside` : `all ${shape.lights.length} lights on the border`);
  if (shape.mirrors.length > 0) parts.push(`mirrors ${shape.mirrors.map((row) => MIRROR_WORDS[row.axis]).join(" and ")}`);
  return parts.join(" · ");
}

const MIRROR_WORDS: Record<ShapeProfile["mirrors"][number]["axis"], string> = {
  vertical: "left to right",
  horizontal: "top to bottom",
  "diagonal-up": "on one diagonal",
  "diagonal-down": "on the other diagonal",
};

export type ShapeSectionPlan = "border-inside" | "parts";

export const SHAPE_SECTION_PLANS: { id: ShapeSectionPlan; label: string; detail: string }[] = [
  { id: "border-inside", label: "Border and inside", detail: "Two sections: the outline, and everything inside it." },
  { id: "parts", label: "Each side and part", detail: "One section per side of the outline, and one per run inside it." },
];

/**
 * Sections from the shape. A run that is all one group is named by its run
 * id, so the section follows a redraw. A run split between groups (a star's
 * crossing lines) gets typed ranges for just its own lights.
 */
export function sectionsFromShape(prop: Pick<Prop, "layout">, shape: ShapeProfile, plan: ShapeSectionPlan): PropSection[] {
  if (!prop.layout) return [];
  const firstString = layoutStrings(prop.layout)[0]?.id ?? "s1";
  const groups: { key: string; name: string; lights: ShapeLight[] }[] = [];
  const add = (key: string, name: string, light: ShapeLight) => {
    let row = groups.find((group) => group.key === key);
    if (!row) {
      row = { key, name, lights: [] };
      groups.push(row);
    }
    row.lights.push(light);
  };
  // A run that is mostly inside stays whole: its few border lights near a corner go with it.
  const share = new Map<string, { inside: number; all: number }>();
  for (const light of shape.lights) {
    const row = share.get(light.edgeId) ?? { inside: 0, all: 0 };
    row.all += 1;
    if (light.role === "inside") row.inside += 1;
    share.set(light.edgeId, row);
  }
  const roleOf = (light: ShapeLight): ShapeRole => {
    const row = share.get(light.edgeId)!;
    return row.inside * 2 > row.all ? "inside" : light.role;
  };
  const insideRuns = [...new Set(shape.lights.filter((light) => roleOf(light) === "inside").map((light) => light.edgeId))];
  for (const light of shape.lights) {
    const role = roleOf(light);
    if (plan === "border-inside") {
      add(role, role === "border" ? "Border" : "Inside", light);
    } else if (role === "border") {
      const side = shape.sides.find((row) => row.id === light.sideId);
      add(side ? side.id : "border", side ? side.name : "Border", light);
    } else {
      const at = insideRuns.indexOf(light.edgeId);
      add(`inside.${light.edgeId}`, insideRuns.length > 1 ? `Inside ${at + 1}` : "Inside", light);
    }
  }
  // Border lights that sit on an inside run near a corner belong to no side; keep them with the nearest side.
  const loose = groups.find((group) => group.key === "border");
  if (plan === "parts" && loose && groups.some((group) => group.key.startsWith("side."))) {
    for (const light of loose.lights) {
      const nearest = nearestSide(shape, light);
      const target = nearest ? groups.find((group) => group.key === nearest) : undefined;
      if (target) target.lights.push(light);
    }
    groups.splice(groups.indexOf(loose), 1);
  }
  const totals = new Map<string, number>();
  for (const light of shape.lights) totals.set(light.edgeId, (totals.get(light.edgeId) ?? 0) + 1);
  return groups.map((group, index) => {
    const byEdge = new Map<string, ShapeLight[]>();
    for (const light of group.lights) byEdge.set(light.edgeId, [...(byEdge.get(light.edgeId) ?? []), light]);
    const edgeIds: string[] = [];
    const pinned: PropIndexRange[] = [];
    for (const [edgeId, lights] of byEdge) {
      if (lights.length === totals.get(edgeId)) {
        edgeIds.push(edgeId);
        continue;
      }
      for (const range of indexRuns(lights)) {
        pinned.push(range.stringId === firstString ? { start: range.start, stop: range.stop } : range);
      }
    }
    return { id: `shape.${index + 1}`, name: group.name, edgeIds, pinnedRanges: pinned };
  });
}

function nearestSide(shape: ShapeProfile, light: ShapeLight): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const other of shape.lights) {
    if (!other.sideId) continue;
    const distance = Math.hypot(other.x - light.x, other.y - light.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other.sideId;
    }
  }
  return best;
}

function indexRuns(lights: readonly ShapeLight[]): (PropIndexRange & { stringId: string })[] {
  const sorted = [...lights].sort((a, b) => (a.stringId === b.stringId ? a.index - b.index : a.stringId < b.stringId ? -1 : 1));
  const out: (PropIndexRange & { stringId: string })[] = [];
  for (const light of sorted) {
    const last = out[out.length - 1];
    if (last && last.stringId === light.stringId && last.stop === light.index) last.stop += 1;
    else out.push({ start: light.index, stop: light.index + 1, stringId: light.stringId });
  }
  return out;
}

/** The shape's lights in a section, in wiring order. Empty when the section is not on the drawing. */
export function sectionShapeLights(prop: Pick<Prop, "layout" | "sections">, shape: ShapeProfile, sectionId: string): ShapeLight[] {
  if (!prop.layout) return [];
  const firstString = layoutStrings(prop.layout)[0]?.id ?? "s1";
  const report = sectionIndexRanges(prop.layout, prop.sections ?? []).find((row) => row.sectionId === sectionId);
  if (!report) return [];
  return shape.lights
    .filter((light) => report.ranges.some((range) => (range.stringId ?? firstString) === light.stringId && light.index >= range.start && light.index < range.stop))
    .sort((a, b) => (a.stringId === b.stringId ? a.index - b.index : a.stringId < b.stringId ? -1 : 1));
}

export type MotionFit = {
  dir: LookDirection;
  /** Null when the direction does exactly what was asked. Otherwise a plain reason. */
  note: string | null;
};

/**
 * The WLED direction that makes an effect travel the chosen way over these
 * lights. WLED runs an effect from the first light (`fwd`), from the last
 * (`rev`), from both ends to the middle (`mi`), or from the middle out (`mi`
 * and `rev`), so a section that goes toward the centre and away again (one
 * diagonal of an X) still gets it right.
 */
export function directionForMotion(lights: readonly ShapeLight[], motion: ShapeMotion): MotionFit {
  if (motion === "wire" || lights.length < 2) return { dir: "fwd", note: null };
  const goal = goalValues(lights, motion);
  const span = Math.max(...goal) - Math.min(...goal);
  if (span < 0.02) return { dir: "fwd", note: `These lights barely change ${MOTION_AXIS[motion]}, so it runs along the wire.` };
  const trend = trendOf(goal, span * 0.15);
  if (trend === "up") return { dir: "fwd", note: null };
  if (trend === "down") return { dir: "rev", note: null };
  if (trend === "valley") return { dir: "mirror-rev", note: null };
  if (trend === "peak") return { dir: "mirror", note: null };
  const first = goal[0]!;
  const last = goal[goal.length - 1]!;
  return {
    dir: last >= first ? "fwd" : "rev",
    note: "This section turns back on itself more than once, so one segment cannot follow it exactly. Split it into its parts to get it right.",
  };
}

const MOTION_AXIS: Record<ShapeMotion, string> = {
  wire: "",
  inward: "in distance from the centre",
  outward: "in distance from the centre",
  clockwise: "in angle around the centre",
  counter: "in angle around the centre",
  up: "in height",
  down: "in height",
};

/** Values that should rise as the light travels. */
function goalValues(lights: readonly ShapeLight[], motion: ShapeMotion): number[] {
  if (motion === "inward") return lights.map((light) => -light.fields.r);
  if (motion === "outward") return lights.map((light) => light.fields.r);
  if (motion === "up") return lights.map((light) => light.fields.h);
  if (motion === "down") return lights.map((light) => -light.fields.h);
  // Angle wraps at the top, so add up the small steps between lights.
  const sign = motion === "clockwise" ? 1 : -1;
  const out = [0];
  for (let index = 1; index < lights.length; index += 1) {
    let step = lights[index]!.fields.a - lights[index - 1]!.fields.a;
    if (step > 0.5) step -= 1;
    if (step < -0.5) step += 1;
    out.push(out[index - 1]! + sign * step);
  }
  return out;
}

type Trend = "up" | "down" | "valley" | "peak" | "mixed";

function trendOf(values: readonly number[], slack: number): Trend {
  // Turning points, ignoring wiggles smaller than `slack`.
  const turns: ("up" | "down")[] = [];
  let anchor = values[0]!;
  for (const value of values) {
    if (value > anchor + slack) {
      if (turns[turns.length - 1] !== "up") turns.push("up");
      anchor = value;
    } else if (value < anchor - slack) {
      if (turns[turns.length - 1] !== "down") turns.push("down");
      anchor = value;
    } else if (turns[turns.length - 1] === "up" ? value > anchor : turns[turns.length - 1] === "down" ? value < anchor : false) {
      anchor = value;
    }
  }
  if (turns.length === 1) return turns[0]!;
  if (turns.length === 2) return turns[0] === "down" ? "valley" : "peak";
  return "mixed";
}

export type SectionSignature = {
  role: ShapeRole;
  /** A straight run, a path that bends, or a closed loop. */
  form: "line" | "path" | "loop";
  lights: number;
};

/** What kind of piece a section is, so like can be matched with like. */
export function sectionSignature(lights: readonly ShapeLight[]): SectionSignature | null {
  if (lights.length === 0) return null;
  const border = lights.filter((light) => light.role === "border").length;
  const role: ShapeRole = border * 2 >= lights.length ? "border" : "inside";
  const first = lights[0]!;
  const last = lights[lights.length - 1]!;
  const reach = Math.max(...lights.map((light) => Math.hypot(light.x - first.x, light.y - first.y)));
  const closed = lights.length > 3 && Math.hypot(last.x - first.x, last.y - first.y) < reach * 0.25;
  let bent = false;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length > 1e-6) {
    for (const light of lights) {
      const off = Math.abs((light.x - first.x) * dy - (light.y - first.y) * dx) / length;
      if (off > Math.max(0.05, length * 0.05)) bent = true;
    }
  }
  return { role, form: closed ? "loop" : bent ? "path" : "line", lights: lights.length };
}

export type SimilarSection = {
  propId: string;
  propLabel: string;
  sectionId: string;
  sectionName: string;
  lights: number;
  sameProp: boolean;
};

/** Sections that are the same kind of piece as this one: same group, same form. Closest in size first. */
export function similarSections(props: readonly Prop[], source: { propId: string; sectionId: string }): SimilarSection[] {
  const sourceProp = props.find((prop) => prop.id === source.propId);
  const sourceShape = sourceProp ? propShape(sourceProp) : null;
  if (!sourceProp || !sourceShape) return [];
  const want = sectionSignature(sectionShapeLights(sourceProp, sourceShape, source.sectionId));
  if (!want) return [];
  const out: SimilarSection[] = [];
  for (const prop of props) {
    const shape = prop.id === sourceProp.id ? sourceShape : propShape(prop);
    if (!shape) continue;
    for (const section of prop.sections ?? []) {
      if (prop.id === source.propId && section.id === source.sectionId) continue;
      const have = sectionSignature(sectionShapeLights(prop, shape, section.id));
      if (!have || have.role !== want.role || have.form !== want.form) continue;
      out.push({ propId: prop.id, propLabel: prop.label, sectionId: section.id, sectionName: section.name, lights: have.lights, sameProp: prop.id === source.propId });
    }
  }
  return out.sort((a, b) => Number(b.sameProp) - Number(a.sameProp) || Math.abs(a.lights - want.lights) - Math.abs(b.lights - want.lights));
}

/** A style with its direction worked out for these lights, when it has a motion. */
export function styleForLights(style: LookStyle, lights: readonly ShapeLight[]): LookStyle {
  if (!style.motion || style.motion === "wire") return style;
  const fit = directionForMotion(lights, style.motion);
  const { dir: _dir, ...rest } = style;
  return fit.dir === "fwd" ? rest : { ...rest, dir: fit.dir };
}

/**
 * Give each target section this style in the Look, as its own style. Its
 * direction is worked out again on each target, so "toward the centre"
 * still points at the centre on a section wired the other way.
 */
export function applySectionDesign(
  look: Look,
  allPropIds: readonly string[],
  props: readonly Prop[],
  style: LookStyle,
  targets: readonly { propId: string; sectionId: string }[],
): Look {
  let next = look;
  for (const target of targets) {
    const prop = props.find((row) => row.id === target.propId);
    if (!prop) continue;
    const shape = propShape(prop);
    const lights = shape ? sectionShapeLights(prop, shape, target.sectionId) : [];
    const fitted = styleForLights(style, lights);
    if (!lookIncludesProp(next, prop.id)) next = setPropMode(next, allPropIds, prop, "follow");
    const others = next.overrides.filter((row) => !(row.propId === prop.id && row.sectionId === target.sectionId));
    const row: LookOverride = { propId: prop.id, sectionId: target.sectionId, style: { ...fitted } };
    next = { ...next, overrides: [...others, row] };
  }
  return normalizeLook(next);
}

export type SimilarProp = {
  propId: string;
  propLabel: string;
  /** Source section id → target section id. */
  pairs: { from: string; to: string; toName: string }[];
};

/**
 * Props whose sections line up with this prop's, piece for piece (a side
 * for a side, the inside for the inside). Matched by group and form, then by
 * name (Top for Top) where it can.
 */
export function similarProps(props: readonly Prop[], sourceId: string): SimilarProp[] {
  const source = props.find((prop) => prop.id === sourceId);
  const shape = source ? propShape(source) : null;
  if (!source || !shape || !source.sections?.length) return [];
  const wanted = source.sections.flatMap((section) => {
    const signature = sectionSignature(sectionShapeLights(source, shape, section.id));
    return signature ? [{ section, signature }] : [];
  });
  if (wanted.length === 0) return [];
  const out: SimilarProp[] = [];
  for (const prop of props) {
    if (prop.id === source.id) continue;
    const other = propShape(prop);
    if (!other || !prop.sections?.length) continue;
    const have = prop.sections.flatMap((section) => {
      const signature = sectionSignature(sectionShapeLights(prop, other, section.id));
      return signature ? [{ section, signature }] : [];
    });
    if (have.length !== wanted.length) continue;
    const used = new Set<string>();
    const pairs: SimilarProp["pairs"] = [];
    for (const want of wanted) {
      const fits = have.filter((row) => !used.has(row.section.id) && row.signature.role === want.signature.role && row.signature.form === want.signature.form);
      const pick = fits.find((row) => row.section.name === want.section.name) ?? fits[0];
      if (!pick) break;
      used.add(pick.section.id);
      pairs.push({ from: want.section.id, to: pick.section.id, toName: pick.section.name });
    }
    if (pairs.length === wanted.length) out.push({ propId: prop.id, propLabel: prop.label, pairs });
  }
  return out;
}

/** Copy this prop's design in the Look (its own style and each section's) onto similar props. */
export function applyPropDesign(look: Look, allPropIds: readonly string[], props: readonly Prop[], sourceId: string, targets: readonly SimilarProp[]): Look {
  const source = props.find((prop) => prop.id === sourceId);
  if (!source) return look;
  let next = look;
  for (const target of targets) {
    const prop = props.find((row) => row.id === target.propId);
    if (!prop) continue;
    const own = look.overrides.find((row) => row.propId === source.id && !row.sectionId && !row.wireframeGroup && !row.elementId);
    next = setPropMode(next, allPropIds, prop, own ? "own" : "follow");
    if (own) {
      next = { ...next, overrides: next.overrides.map((row) => (row.propId === prop.id && !row.sectionId && !row.wireframeGroup && !row.elementId ? { ...row, style: { ...own.style } } : row)) };
    }
    for (const pair of target.pairs) {
      const row = look.overrides.find((item) => item.propId === source.id && item.sectionId === pair.from);
      if (!row) {
        next = { ...next, overrides: next.overrides.filter((item) => !(item.propId === prop.id && item.sectionId === pair.to)) };
        continue;
      }
      if (row.off) {
        next = { ...next, overrides: [...next.overrides.filter((item) => !(item.propId === prop.id && item.sectionId === pair.to)), { propId: prop.id, sectionId: pair.to, style: { ...row.style }, off: true }] };
        continue;
      }
      next = applySectionDesign(next, allPropIds, props, sectionStyle(look, source, pair.from) ?? propStyle(look, source), [{ propId: prop.id, sectionId: pair.to }]);
    }
  }
  return normalizeLook(next);
}
