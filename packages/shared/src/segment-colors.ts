import type { DraftRange } from "./range.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export type SegmentColor = { hex: string; white: number };

/** Only a fresh, unique exact-range report can supply an unset colour. */
export function resolveApplyColors(ranges: readonly DraftRange[], snapshot: WledSnapshot): SegmentColor[] | null {
  const colors: SegmentColor[] = [];
  for (const range of ranges) {
    if (range.color) { colors.push(range.color); continue; }
    const matching = snapshot.segmentColors?.filter((reported) =>
      reported.start === range.start && reported.stop === range.stop);
    if (matching?.length === 1) { colors.push({ hex: matching[0]!.hex, white: matching[0]!.white }); continue; }
    // Legacy software fixtures before state.seg primary colours existed.
    if (snapshot.segmentColors === undefined && snapshot.segmentColor) {
      colors.push({ hex: snapshot.segmentColor, white: 0 }); continue;
    }
    return null;
  }
  return colors;
}

export function reportedColorsMatch(ranges: readonly DraftRange[], colors: readonly SegmentColor[],
  report: WledSnapshot["segmentColors"]): boolean | null {
  if (!report) return null;
  if (report.length !== ranges.length || colors.length !== ranges.length) return false;
  return ranges.every((range, index) => {
    const matching = report.filter((row) => row.start === range.start && row.stop === range.stop);
    if (matching.length !== 1) return false;
    const row = matching[0]!;
    const color = colors[index];
    return row.hex.toLowerCase() === color?.hex.toLowerCase() && row.white === color.white;
  });
}
