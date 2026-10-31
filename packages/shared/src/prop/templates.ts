import type { LightOutput } from "../lights.ts";
import { isWholeIndex, rangesOverlap } from "../range.ts";
import {
  isPropKind,
  type Prop,
  type PropKind,
  type PropSegmentDraft,
  type PropTap,
} from "./types.ts";

export type PropTapPairing = "polyline" | "pairs";

export type PropTemplate = {
  kind: PropKind;
  label: string;
  summary: string;
  minTaps: number;
  maxTaps: number | null;
  pairing: PropTapPairing;
  /** Operator copy for the next unused required tap. */
  tapRoles: string[];
  moreRole?: string;
};

export const PROP_TEMPLATES: readonly PropTemplate[] = [
  {
    kind: "roofline",
    label: "Roofline",
    summary: "Mark the start, each peak or valley, and the far end.",
    minTaps: 2,
    maxTaps: null,
    pairing: "polyline",
    tapRoles: ["Start", "Next peak or far end"],
    moreRole: "Next peak or far end",
  },
  {
    kind: "window",
    label: "Window",
    summary: "Walk the frame. Four sides from five corner taps.",
    minTaps: 5,
    maxTaps: 5,
    pairing: "polyline",
    tapRoles: [
      "Start of top",
      "Top-right corner",
      "Bottom-right corner",
      "Bottom-left corner",
      "End of left",
    ],
  },
  {
    kind: "arch",
    label: "Arch",
    summary: "Mark both bases. A third tap at the crown splits left and right.",
    minTaps: 2,
    maxTaps: 3,
    pairing: "polyline",
    tapRoles: ["Left base", "Crown or right base", "Right base"],
  },
  {
    kind: "tree",
    label: "Tree",
    summary: "Mark the base and the end of the wrap. A third tap splits trunk and wrap.",
    minTaps: 2,
    maxTaps: 3,
    pairing: "polyline",
    tapRoles: ["Base", "Crown or end of wrap", "End of wrap"],
  },
  {
    kind: "stake-row",
    label: "Stake row",
    summary: "Mark the start and end of each stake. Unused LEDs between stakes stay dark.",
    minTaps: 2,
    maxTaps: null,
    pairing: "pairs",
    tapRoles: ["Start of first stake", "End of this stake"],
    moreRole: "Start of next stake",
  },
  {
    kind: "custom",
    label: "Custom",
    summary: "Mark each corner or end along one run. Gaps belong in another Prop.",
    minTaps: 2,
    maxTaps: null,
    pairing: "polyline",
    tapRoles: ["Start", "Next corner or end"],
    moreRole: "Next corner or end",
  },
];

export function propTemplate(kind: PropKind): PropTemplate {
  switch (kind) {
    case "roofline":
    case "window":
    case "arch":
    case "tree":
    case "stake-row":
    case "custom": {
      const found = PROP_TEMPLATES.find((row) => row.kind === kind);
      if (found) return found;
      throw new Error(`Prop template ${kind} is missing`);
    }
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

export function propKindLabel(kind: PropKind): string {
  return propTemplate(kind).label;
}

export function nextTapRole(kind: PropKind, marked: number): string | null {
  const template = propTemplate(kind);
  if (template.maxTaps !== null && marked >= template.maxTaps) return null;
  if (template.pairing === "pairs") {
    if (marked === 0) return template.tapRoles[0] ?? "Start of first stake";
    if (marked % 2 === 1) return "End of this stake";
    return template.moreRole ?? "Start of next stake";
  }
  const role = template.tapRoles[marked];
  if (role) return role;
  return template.moreRole ?? null;
}

export function canFinishPropTaps(kind: PropKind, marked: number): boolean {
  const template = propTemplate(kind);
  if (marked < template.minTaps) return false;
  if (template.maxTaps !== null && marked > template.maxTaps) return false;
  if (template.pairing === "pairs") return marked % 2 === 0;
  return true;
}

export function nextPropLabel(kind: PropKind, existing: readonly Pick<Prop, "kind" | "label">[]): string {
  const base = propKindLabel(kind);
  const count = existing.filter((row) => row.kind === kind).length;
  return count === 0 ? base : `${base} ${count + 1}`;
}

export function parsePropTaps(value: unknown): PropTap[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null;
  const taps: PropTap[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return null;
    const index = (row as { index?: unknown }).index;
    if (typeof index !== "number" || !isWholeIndex(index) || index < 0) return null;
    taps.push({ index });
  }
  return taps;
}

export function parsePropKind(value: unknown): PropKind | null {
  return isPropKind(value) ? value : null;
}

/**
 * Split a declared exclusive range across outputs. A Prop may span outputs;
 * one Segment still sits on one output.
 */
export function splitRangeAcrossOutputs(
  start: number,
  stop: number,
  outputs: readonly LightOutput[],
): PropSegmentDraft[] {
  if (outputs.length === 0) return [{ label: "", start, stop }];
  const pieces: PropSegmentDraft[] = [];
  for (const output of [...outputs].sort((left, right) => left.start - right.start)) {
    const lo = Math.max(start, output.start);
    const hi = Math.min(stop, output.start + output.ledCount);
    if (hi > lo) pieces.push({ label: "", start: lo, stop: hi, outputId: output.id });
  }
  return pieces.length > 0 ? pieces : [{ label: "", start, stop }];
}

export function tapRefuseReason(
  kind: PropKind,
  taps: readonly PropTap[],
  ledCount: number,
): string | null {
  const template = propTemplate(kind);
  if (!Number.isInteger(ledCount) || ledCount < 1) {
    return "This Light has no LEDs to mark. Find the strip length first.";
  }
  if (taps.length === 0) return "Mark at least the start of this Prop.";
  if (template.maxTaps !== null && taps.length > template.maxTaps) {
    return `${template.label} uses ${template.maxTaps} marks. Extra taps were not used.`;
  }
  for (const tap of taps) {
    if (!isWholeIndex(tap.index) || tap.index < 0 || tap.index >= ledCount) {
      return "A mark sits past this strip. Walk back onto the lit run.";
    }
  }
  const built = buildSideRanges(kind, taps);
  if (!built.ok) return built.message;
  const overlap = overlappingSide(built.ranges);
  if (overlap) return overlap;
  if (!canFinishPropTaps(kind, taps.length)) {
    if (template.pairing === "pairs" && taps.length % 2 === 1) {
      return "Mark the end of this stake before finishing.";
    }
    const next = nextTapRole(kind, taps.length);
    return next ? `Mark ${next.toLowerCase()} before finishing.` : "This Prop still needs another mark.";
  }
  return null;
}

export function segmentsFromPropTaps(input: {
  kind: PropKind;
  label: string;
  taps: readonly PropTap[];
  ledCount: number;
  outputs?: readonly LightOutput[];
}): { ok: true; segments: PropSegmentDraft[] } | { ok: false; message: string } {
  const reason = tapRefuseReason(input.kind, input.taps, input.ledCount);
  if (reason) return { ok: false, message: reason };
  return draftSegments(input);
}

/** Sides already closed by the marks so far. Used to keep finished runs lit. */
export function partialSegmentsFromTaps(input: {
  kind: PropKind;
  label: string;
  taps: readonly PropTap[];
  ledCount: number;
  outputs?: readonly LightOutput[];
}): PropSegmentDraft[] {
  if (input.taps.length < 2) return [];
  const usable =
    propTemplate(input.kind).pairing === "pairs" && input.taps.length % 2 === 1
      ? input.taps.slice(0, -1)
      : input.taps;
  if (usable.length < 2) return [];
  const built = buildSideRanges(input.kind, usable);
  if (!built.ok) return [];
  return nameSegments(input.kind, input.label, built.ranges, input.outputs ?? []);
}

function draftSegments(input: {
  kind: PropKind;
  label: string;
  taps: readonly PropTap[];
  outputs?: readonly LightOutput[];
}): { ok: true; segments: PropSegmentDraft[] } | { ok: false; message: string } {
  const built = buildSideRanges(input.kind, input.taps);
  if (!built.ok) return built;
  return { ok: true, segments: nameSegments(input.kind, input.label, built.ranges, input.outputs ?? []) };
}

function nameSegments(
  kind: PropKind,
  label: string,
  ranges: readonly { start: number; stop: number }[],
  outputs: readonly LightOutput[],
): PropSegmentDraft[] {
  const names = sideNames(kind, ranges.length);
  const prefix = label.trim() || propKindLabel(kind);
  const segments: PropSegmentDraft[] = [];
  ranges.forEach((range, index) => {
    const name = names[index] ?? `run ${index + 1}`;
    for (const piece of splitRangeAcrossOutputs(range.start, range.stop, outputs)) {
      segments.push({
        label: `${prefix} · ${name}`,
        start: piece.start,
        stop: piece.stop,
        ...(piece.outputId ? { outputId: piece.outputId } : {}),
      });
    }
  });
  return segments;
}

function sideNames(kind: PropKind, count: number): string[] {
  switch (kind) {
    case "window":
      return ["top", "right", "bottom", "left"];
    case "arch":
      return count <= 1 ? ["arch"] : ["left", "right"];
    case "tree":
      return count <= 1 ? ["tree"] : ["trunk", "wrap"];
    case "stake-row":
      return Array.from({ length: count }, (_, index) => `stake ${index + 1}`);
    case "roofline":
    case "custom":
      return Array.from({ length: count }, (_, index) => `run ${index + 1}`);
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function buildSideRanges(
  kind: PropKind,
  taps: readonly PropTap[],
): { ok: true; ranges: { start: number; stop: number }[] } | { ok: false; message: string } {
  const template = propTemplate(kind);
  if (template.pairing === "pairs") return pairRanges(taps);
  if (template.pairing === "polyline") return polylineRanges(taps);
  const _never: never = template.pairing;
  return _never;
}

function overlappingSide(ranges: readonly { start: number; stop: number }[]): string | null {
  for (let index = 0; index < ranges.length; index += 1) {
    const left = ranges[index]!;
    for (let other = index + 1; other < ranges.length; other += 1) {
      const right = ranges[other]!;
      if (rangesOverlap(left, right)) {
        return "Those marks fold back over a side already marked. Walk forward along the strip.";
      }
    }
  }
  return null;
}

function pairRanges(
  taps: readonly PropTap[],
): { ok: true; ranges: { start: number; stop: number }[] } | { ok: false; message: string } {
  if (taps.length < 2) return { ok: false, message: "Mark the start and end of the first stake." };
  const ranges: { start: number; stop: number }[] = [];
  const complete = taps.length - (taps.length % 2);
  for (let index = 0; index < complete; index += 2) {
    const left = taps[index]!.index;
    const right = taps[index + 1]!.index;
    if (left === right) {
      return { ok: false, message: "A stake needs two different marks. Walk to the other end." };
    }
    ranges.push({ start: Math.min(left, right), stop: Math.max(left, right) + 1 });
  }
  return { ok: true, ranges };
}

/**
 * Each tap after the first is the last LED of the side just walked.
 * The next side starts on the following LED, so corners do not overlap.
 */
function polylineRanges(
  taps: readonly PropTap[],
): { ok: true; ranges: { start: number; stop: number }[] } | { ok: false; message: string } {
  if (taps.length < 2) return { ok: false, message: "Mark the start and at least one more corner or end." };
  const ranges: { start: number; stop: number }[] = [];
  let cursor = taps[0]!.index;
  for (let index = 1; index < taps.length; index += 1) {
    const dest = taps[index]!.index;
    if (dest === cursor) {
      return { ok: false, message: "That mark is the same LED. Walk to the next corner or end." };
    }
    if (dest > cursor) {
      ranges.push({ start: cursor, stop: dest + 1 });
      cursor = dest + 1;
    } else {
      ranges.push({ start: dest, stop: cursor + 1 });
      cursor = dest - 1;
    }
  }
  return { ok: true, ranges };
}
