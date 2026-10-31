/**
 * Sections sit on the prop path. A section names edges of `layout.run`;
 * its index ranges are derived from that path and move when light counts
 * change. Pinned ranges are typed by hand and stay put.
 *
 * Indexes are the path order from `countLayout` (ceil along the run).
 * A later compiler can turn `sectionIndexRanges` into a ledmap. This module
 * does not write WLED segments.
 */

import { rangesOverlap } from "../range.ts";
import { countLayout, cornerById, type PropLayout } from "./layout.ts";
import {
  isPropSection,
  type PropIndexRange,
  type PropSection,
} from "./types.ts";

const SECTION_COLOURS = ["#ffb000", "#3d8bfd", "#ff5a5a", "#3dd68c", "#c084fc", "#38bdf8", "#fb7185", "#fbbf24"];

export type PathEdgeRange = {
  edgeId: string;
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

export function pathEdgeIndexRanges(layout: PropLayout): PathEdgeRange[] {
  const counted = countLayout(layout);
  let cursor = 0;
  return counted.edges.map((edge) => {
    const start = cursor;
    const consumed = edge.lights + edge.hidden;
    cursor += consumed;
    return {
      edgeId: edge.id,
      start,
      stop: start + edge.lights,
      lights: edge.lights,
    };
  });
}

export function defaultSections(layout: PropLayout): PropSection[] {
  if (layout.template?.type === "wireframe" && layout.net && layout.run.some((edge) => edge.id.startsWith("top."))) {
    const sides = layout.net.sides;
    return Array.from({ length: sides }, (_, index) => ({
      id: `wall.${index}`,
      name: `Wall ${index + 1}`,
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
  return layout.run.filter((edge) => edge.kind === "lit").map((edge, index) => ({
    id: `section.${edge.id}`,
    name: `Section ${index + 1}`,
    edgeIds: [edge.id],
    pinnedRanges: [],
    color: SECTION_COLOURS[index % SECTION_COLOURS.length],
  }));
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
  const pathEnd = countLayout(layout).total;
  const reports = sections.map((section) => reportSection(section, byId, pathEnd));
  for (let index = 0; index < reports.length; index += 1) {
    for (let other = index + 1; other < reports.length; other += 1) {
      const left = reports[index]!;
      const right = reports[other]!;
      if (rangesOverlapAny(left.ranges, right.ranges)) {
        const warning = `${left.name} overlaps ${right.name}.`;
        left.warnings.push(warning);
        right.warnings.push(warning);
      }
    }
  }
  return reports.map((report) => ({ ...report, warnings: unique(report.warnings) }));
}

/**
 * Preview colours stored on the prop. Looks still resolve by Segment and
 * wireframe group; a later compiler should turn this plan into overrides.
 */
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
  const edge = layout.run.find((row) => row.id === edgeId);
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
    if (span.stop > span.start) derivedParts.push({ start: span.start, stop: span.stop });
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

function mergeRanges(ranges: readonly PropIndexRange[]): PropIndexRange[] {
  const sorted = ranges.filter((range) => range.stop > range.start)
    .map((range) => ({ start: range.start, stop: range.stop }))
    .sort((left, right) => left.start - right.start || left.stop - right.stop);
  const merged: PropIndexRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.stop) last.stop = Math.max(last.stop, range.stop);
    else merged.push({ ...range });
  }
  return merged;
}

function rangesOverlapAny(left: readonly PropIndexRange[], right: readonly PropIndexRange[]): boolean {
  return left.some((range) => right.some((other) => rangesOverlap(range, other)));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
