import { spansMatch } from "./apply.ts";
import type { RangeSpan } from "./range.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";
import { reportedColorsMatch, type SegmentColor } from "./segment-colors.ts";

/** Saved only after a confirmed Segment Apply, independent of lastSnapshot. */
export type LastApply = {
  at: string;
  mac: string;
  ledCount: number;
  ranges: RangeSpan[];
  color: string;
  colors?: SegmentColor[];
};

export type ApplyConflict = {
  at: string;
  rangesChanged: boolean;
  colorChanged: boolean;
};

/** Null also means insufficient evidence; it is never proof the controller matches. */
export function compareLastApply(baseline: LastApply | null | undefined,
  snapshot: WledSnapshot | null): ApplyConflict | null {
  if (!baseline || !snapshot || !baseline.mac || !snapshot.mac ||
    baseline.mac.toLowerCase() !== snapshot.mac.toLowerCase() ||
    baseline.ledCount !== snapshot.ledCount || !Number.isFinite(Date.parse(baseline.at)) ||
    !Array.isArray(baseline.ranges) || !baseline.ranges.every((range) =>
      Number.isInteger(range.start) && Number.isInteger(range.stop) && range.start >= 0 && range.stop > range.start) ||
    !/^#[0-9a-f]{6}$/i.test(baseline.color)) return null;
  const rangesChanged = snapshot.segments !== null && !spansMatch(baseline.ranges, snapshot.segments);
  // Off or info-only reads do not report a comparable colour.
  const colorChanged = baseline.colors ? reportedColorsMatch(baseline.ranges.map((range) => ({ ...range, label: "" })),
    baseline.colors, snapshot.segmentColors) === false :
    snapshot.segmentColor !== null && snapshot.segmentColor.toLowerCase() !== baseline.color.toLowerCase();
  return rangesChanged || colorChanged ? { at: baseline.at, rangesChanged, colorChanged } : null;
}
