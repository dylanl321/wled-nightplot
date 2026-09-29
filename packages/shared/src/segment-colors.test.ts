import { describe, expect, it } from "vitest";
import { reportedColorsMatch, resolveApplyColors } from "./segment-colors.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

const report = { name: "WLED", firmware: "WLED 0.15.4", mac: "aa", ledCount: 30,
  rgbw: true, on: false, brightness: 100, segmentColor: null,
  segments: [{ start: 0, stop: 10 }],
  segmentColors: [{ start: 0, stop: 10, hex: "#112233", white: 70 }],
} satisfies WledSnapshot;

describe("Segment colour Apply", () => {
  it("preserves unset only at a unique exact fresh range, even while off", () => {
    const exact = [{ label: "One", start: 0, stop: 10 }];
    expect(resolveApplyColors(exact, report)).toEqual([{ hex: "#112233", white: 70 }]);
    expect(resolveApplyColors([{ ...exact[0]!, stop: 11 }], report)).toBeNull();
    expect(resolveApplyColors(exact, { ...report, segmentColors: null })).toBeNull();
    expect(resolveApplyColors(exact, { ...report, segmentColors: [...report.segmentColors, ...report.segmentColors] })).toBeNull();
  });
  it("uses explicit RGBW values and refuses unknown or differing readback", () => {
    const drafts = [{ label: "One", start: 0, stop: 10, color: { hex: "#abc123", white: 137 } }];
    const colors = resolveApplyColors(drafts, { ...report, segmentColors: null })!;
    expect(colors).toEqual([drafts[0]!.color]);
    expect(reportedColorsMatch(drafts, colors, null)).toBeNull();
    expect(reportedColorsMatch(drafts, colors, report.segmentColors)).toBe(false);
    expect(reportedColorsMatch(drafts, colors, [{ start: 0, stop: 10, hex: "#abc123", white: 137 }])).toBe(true);
  });
});
