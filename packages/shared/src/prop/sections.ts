/**
 * Sections sit on the prop path. A section names edges of `layout.run`;
 * its index ranges are derived from that path and move when light counts
 * change. Pinned ranges are typed by hand and stay put.
 *
 * Indexes are the path order from `countLayout` (ceil along the run).
 * Looks send each range as a WLED segment (`propSectionPlan` in look.ts). A
 * section that is more than one range is several segments; one effect across
 * them would need a ledmap, which is not written for sections.
 */

import { rangesOverlap } from "../range.ts";
import { cornerById, edgeLengthM, edgeLightCount, layoutStrings, lightsOnLength, windowSideNames, type LayoutEdge, type PropLayout } from "./layout.ts";
import {
  isPropSection,
  type PropIndexRange,
  type PropSection,
} from "./types.ts";

const SECTION_COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

export type PathEdgeRange = {
  edgeId: string;
  stringId: string;
  start: number;
  stop: number;
  lights: number;
};

export type SectionRangeReport = {
  sectionId: string;
  name: string;
  color: string | null;
  derived: PropIndexRange[];
  pinned: PropIndexRange[];
  /** Derived edges plus pinned ranges that sit on the path. For a later compiler. */
  ranges: PropIndexRange[];
  warnings: string[];
  errors: string[];
};

export type SectionColourPlan = {
  sectionId: string;
  name: string;
  color: string | null;
  ranges: PropIndexRange[];
};

function runLights(layout: PropLayout, edge: LayoutEdge): { lights: number; hidden: number } {
  if (edge.kind === "wire") return { lights: 0, hidden: 0 };
  const count = edgeLightCount(layout, edge);
  if (edge.kind === "hidden") return { lights: 0, hidden: count };
  return { lights: count, hidden: 0 };
}

export function pathEdgeIndexRanges(layout: PropLayout): PathEdgeRange[] {
  const ranges: PathEdgeRange[] = [];
  const strings = layoutStrings(layout);
  const named = strings.length > 1;
  for (const string of strings) {
    let cursor = 0;
    for (const edge of string.run) {
      const counted = runLights(layout, edge);
      const start = cursor;
      cursor += counted.lights + counted.hidden;
      ranges.push({
        edgeId: edge.id,
        stringId: named ? string.id : "s1",
        start,
        stop: start + counted.lights,
        lights: counted.lights,
      });
    }
  }
  return ranges;
}

const WALL_NAMES = ["Front", "Right", "Back", "Left"] as const;

/** Front, Right, Back, Left, then Wall 5… when a well house has more than four walls. */
export function wallSectionName(index: number): string {
  return WALL_NAMES[index] ?? `Wall ${index + 1}`;
}

export function defaultSections(layout: PropLayout): PropSection[] {
  if (layout.template?.type === "wireframe" && layout.net && layout.run.some((edge) => edge.id.startsWith("top."))) {
    const sides = layout.net.sides;
    return Array.from({ length: sides }, (_, index) => ({
      id: `wall.${index}`,
      name: wallSectionName(index),
      edgeIds: [
        `top.${index}`,
        `right.${index}`,
        `bottom.${index}`,
        `left.${index}`,
        index % 2 === 0 ? `diag.down.${index}` : `diag.up.${index}`,
      ],
      pinnedRanges: [],
      color: SECTION_COLOURS[index % SECTION_COLOURS.length],
    }));
  }
  if (layout.template?.type === "spiral" || layout.template?.type === "zigzag") {
    // One colour for the whole wrap. Fifty half turns as fifty sections is noise.
    const edgeIds = layout.run.filter((edge) => edge.kind === "lit").map((edge) => edge.id);
    if (edgeIds.length === 0) return [];
    return [{
      id: `section.${layout.template.type}`,
      name: layout.template.type === "spiral" ? "Spiral" : "Zigzag",
      edgeIds,
      pinnedRanges: [],
      color: SECTION_COLOURS[0],
    }];
  }
  const names = edgeSectionNames(layout);
  return layout.run.filter((edge) => edge.kind === "lit").map((edge, index) => ({
    id: `section.${edge.id}`,
    name: names[index] ?? `Side ${index + 1}`,
    edgeIds: [edge.id],
    pinnedRanges: [],
    color: SECTION_COLOURS[index % SECTION_COLOURS.length],
  }));
}

function edgeSectionNames(layout: PropLayout): string[] {
  const type = layout.template?.type;
  if (type === "window") return windowSideNames(layout);
  if (type === "roofline") return ["Along the roof"];
  if (type === "arch") return ["Left side", "Right side"];
  if (type === "tree") return ["Left side", "Right side", "Base"];
  if (type === "stake-row") {
    return layout.run.filter((edge) => edge.kind === "lit").map((_, index) => `Stake ${index + 1}`);
  }
  return layout.run.filter((edge) => edge.kind === "lit").map((_, index) => `Side ${index + 1}`);
}

export function sectionLightCount(ranges: readonly PropIndexRange[]): number {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.stop - range.start), 0);
}

/**
 * A saved well house from the straight-line template (`e1`, `e2`, …) used
 * shared posts and two diagonal passes. Those ids are not the path.
 */
export function isLegacyWellHouseLayout(layout: PropLayout): boolean {
  if (layout.source !== "template" || layout.template?.type !== "wireframe") return false;
  return !layout.run.some((edge) => edge.id.startsWith("top."));
}

export function sectionIndexRanges(layout: PropLayout, sections: readonly PropSection[]): SectionRangeReport[] {
  const spans = pathEdgeIndexRanges(layout);
  const byId = new Map(spans.map((span) => [span.edgeId, span]));
  const firstId = layoutStrings(layout)[0]?.id ?? "s1";
  const pathEnd = spans.filter((span) => span.stringId === firstId).reduce((max, span) => Math.max(max, span.stop), 0);
  const reports = sections.map((section) => reportSection(section, byId, pathEnd));
  for (let index = 0; index < reports.length; index += 1) {
    for (let other = index + 1; other < reports.length; other += 1) {
      const left = reports[index]!;
      const right = reports[other]!;
      if (rangesOverlapAny(left.ranges, right.ranges)) {
        const warning = `${left.name} overlaps ${right.name}.`;
        if (!left.warnings.includes(warning)) left.warnings.push(warning);
        if (!right.warnings.includes(warning)) right.warnings.push(warning);
      }
    }
  }
  return reports.map((report) => ({ ...report, warnings: unique(report.warnings) }));
}

/** Colours stored on the prop, by section. Looks use them as each section's default colour. */
export function sectionColourPlan(layout: PropLayout, sections: readonly PropSection[]): SectionColourPlan[] {
  return sectionIndexRanges(layout, sections).map((report) => ({
    sectionId: report.sectionId,
    name: report.name,
    color: report.color,
    ranges: report.ranges,
  }));
}

export function describeIndexRange(range: PropIndexRange): string {
  if (range.stop <= range.start) return "no LEDs";
  const last = range.stop - 1;
  if (last === range.start) return `LED ${range.start}`;
  return `LEDs ${range.start} through ${last}`;
}

export function describeIndexRanges(ranges: readonly PropIndexRange[]): string {
  const live = ranges.filter((range) => range.stop > range.start);
  if (live.length === 0) return "No LEDs in this section yet.";
  return live.map(describeIndexRange).join(", then ");
}

export function formatTypedRanges(ranges: readonly PropIndexRange[]): string {
  return ranges
    .filter((range) => range.stop > range.start)
    .map((range) => (range.stop - 1 === range.start ? String(range.start) : `${range.start}-${range.stop - 1}`))
    .join(", ");
}

export function parseTypedRanges(text: string, total: number): {
  ranges: PropIndexRange[];
  warnings: string[];
  errors: string[];
} {
  const trimmed = text.trim();
  if (!trimmed) return { ranges: [], warnings: [], errors: [] };
  const errors: string[] = [];
  const ranges: PropIndexRange[] = [];
  const last = Math.max(0, total) - 1;
  for (const token of trimmed.split(/[,;]+/)) {
    const part = token.trim();
    if (!part) continue;
    const pair = /^(\d+)\s*(?:-|–|—|through|to)\s*(\d+)$/i.exec(part);
    const single = /^(\d+)$/.exec(part);
    if (!pair && !single) {
      errors.push(`Could not read “${part}”. Use ranges like 10-16.`);
      continue;
    }
    const start = Number(pair ? pair[1] : single![1]);
    const inclusiveEnd = Number(pair ? pair[2] : single![1]);
    if (inclusiveEnd < start) {
      errors.push(`${start} through ${inclusiveEnd} runs backwards.`);
      continue;
    }
    if (total < 1 || start > last || inclusiveEnd > last) {
      const bound = total < 1 ? "This path has no LEDs yet." : `This path is LEDs 0 through ${last}.`;
      errors.push(`LED ${inclusiveEnd > last ? inclusiveEnd : start} is outside the path. ${bound}`);
      continue;
    }
    ranges.push({ start, stop: inclusiveEnd + 1 });
  }
  const warnings: string[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    for (let other = index + 1; other < ranges.length; other += 1) {
      const left = ranges[index]!;
      const right = ranges[other]!;
      if (rangesOverlap(left, right)) {
        warnings.push(`${describeIndexRange(left)} overlaps ${describeIndexRange(right)}.`);
      }
    }
  }
  return { ranges, warnings, errors };
}

export function parsePropSections(value: unknown): PropSection[] | null {
  if (!Array.isArray(value) || !value.every(isPropSection)) return null;
  if (new Set(value.map((section) => section.id)).size !== value.length) return null;
  return value.map((section) => ({
    id: section.id,
    name: section.name.trim(),
    edgeIds: [...section.edgeIds],
    pinnedRanges: section.pinnedRanges.map((range) => ({ start: range.start, stop: range.stop })),
    ...(section.color ? { color: section.color } : {}),
  }));
}

/** Lengthen or shorten one edge by moving its far corner. Shared corners on that wall follow. */
export function extendEdge(layout: PropLayout, edgeId: string, deltaM: number): PropLayout {
  const edge = layoutStrings(layout).flatMap((string) => string.run).find((row) => row.id === edgeId);
  if (!edge || edge.kind !== "lit" || !Number.isFinite(deltaM) || deltaM === 0) return layout;
  const from = cornerById(layout, edge.from);
  const to = cornerById(layout, edge.to);
  if (!from || !to) return layout;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 1e-9) return layout;
  const next = Math.max(layout.pitchM, length + deltaM);
  const scale = next / length;
  return {
    ...layout,
    corners: layout.corners.map((corner) => corner.id === to.id ? {
      ...corner,
      x: from.x + (to.x - from.x) * scale,
      y: from.y + (to.y - from.y) * scale,
    } : corner),
  };
}

function reportSection(
  section: PropSection,
  byId: Map<string, PathEdgeRange>,
  pathEnd: number,
): SectionRangeReport {
  const warnings: string[] = [];
  const errors: string[] = [];
  const derivedParts: PropIndexRange[] = [];
  for (const edgeId of section.edgeIds) {
    const span = byId.get(edgeId);
    if (!span) {
      warnings.push(`${section.name} names an edge that is not on this path.`);
      continue;
    }
    if (span.stop > span.start) {
      derivedParts.push(span.stringId === "s1"
        ? { start: span.start, stop: span.stop }
        : { start: span.start, stop: span.stop, stringId: span.stringId });
    }
  }
  const derived = mergeRanges(derivedParts);
  const pinned: PropIndexRange[] = [];
  for (const range of section.pinnedRanges) {
    if (range.start < 0 || range.stop > pathEnd) {
      const last = Math.max(0, pathEnd) - 1;
      errors.push(`${describeIndexRange(range)} is outside this path${pathEnd > 0 ? ` (LEDs 0 through ${last})` : ""}.`);
      continue;
    }
    pinned.push(range);
  }
  for (let index = 0; index < pinned.length; index += 1) {
    for (let other = index + 1; other < pinned.length; other += 1) {
      if (rangesOverlap(pinned[index]!, pinned[other]!)) {
        warnings.push(`${describeIndexRange(pinned[index]!)} overlaps ${describeIndexRange(pinned[other]!)}.`);
      }
    }
    if (derived.some((range) => rangesOverlap(range, pinned[index]!))) {
      warnings.push(`${describeIndexRange(pinned[index]!)} overlaps lights already on ${section.name}.`);
    }
  }
  return {
    sectionId: section.id,
    name: section.name,
    color: section.color ?? null,
    derived,
    pinned,
    ranges: mergeRanges([...derived, ...pinned]),
    warnings,
    errors,
  };
}

function sameString(left: PropIndexRange, right: PropIndexRange): boolean {
  return (left.stringId ?? "s1") === (right.stringId ?? "s1");
}

function mergeRanges(ranges: readonly PropIndexRange[]): PropIndexRange[] {
  const sorted = ranges.filter((range) => range.stop > range.start)
    .map((range) => ({ ...range }))
    .sort((left, right) => (left.stringId ?? "s1").localeCompare(right.stringId ?? "s1") || left.start - right.start || left.stop - right.stop);
  const merged: PropIndexRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && sameString(last, range) && range.start <= last.stop) last.stop = Math.max(last.stop, range.stop);
    else merged.push({ ...range });
  }
  return merged;
}

function rangesOverlapAny(left: readonly PropIndexRange[], right: readonly PropIndexRange[]): boolean {
  return left.some((range) => right.some((other) => sameString(range, other) && rangesOverlap(range, other)));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export type SectionReconcile = {
  sections: PropSection[];
  /** Names of sections made for lit edges that were in no section. */
  added: string[];
  /** Edge ids dropped because the path no longer has them. */
  dropped: string[];
};

/**
 * Bring sections in line with an edited path. Edge ids the path no longer
 * has are dropped. A lit edge in no section gets a section of its own, the
 * way a new prop's edges do, so a new edge is never silently left out.
 * Pinned ranges are left alone; the section report flags any that fall off.
 * Deleted run ids are never handed out again (`retiredIds`), so a section
 * cannot pick up a newly traced run by accident. Pass `before` (the path
 * before the edit) to add sections only for runs that are new.
 */
export function reconcileSections(layout: PropLayout, sections: readonly PropSection[], before?: PropLayout): SectionReconcile {
  // With the path as it was, only runs that are new get a section; a run the
  // operator left out of every section on purpose stays out.
  const known = before ? new Set(layoutStrings(before).flatMap((string) => string.run).map((edge) => edge.id)) : null;
  const edges = layoutStrings(layout).flatMap((string) => string.run);
  const lit = edges.filter((edge) => edge.kind === "lit");
  const present = new Set(edges.map((edge) => edge.id));
  const dropped: string[] = [];
  const kept = sections.map((section) => {
    const edgeIds = section.edgeIds.filter((id) => {
      if (present.has(id)) return true;
      dropped.push(id);
      return false;
    });
    return edgeIds.length === section.edgeIds.length ? section : { ...section, edgeIds };
  });
  const covered = new Set(kept.flatMap((section) => section.edgeIds));
  const ids = new Set(kept.map((section) => section.id));
  const added: PropSection[] = [];
  lit.forEach((edge, index) => {
    if (covered.has(edge.id) || known?.has(edge.id)) return;
    let id = `section.${edge.id}`;
    for (let n = 2; ids.has(id); n += 1) id = `section.${edge.id}.${n}`;
    ids.add(id);
    const names = new Set([...kept, ...added].map((section) => section.name));
    let name = `Side ${index + 1}`;
    for (let n = 2; names.has(name); n += 1) name = `Side ${index + 1} (${n})`;
    added.push({
      id,
      name,
      edgeIds: [edge.id],
      pinnedRanges: [],
      color: SECTION_COLOURS[(kept.length + added.length) % SECTION_COLOURS.length],
    });
  });
  return { sections: [...kept, ...added], added: added.map((section) => section.name), dropped };
}
