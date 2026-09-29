import { describe, expect, it } from "vitest";
import { compareLastApply, type LastApply } from "./apply-conflict.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

const baseline: LastApply = { at: "2026-09-26T18:00:00Z", mac: "aa:bb:cc:dd:ee:ff",
  ledCount: 60, ranges: [{ start: 0, stop: 20 }, { start: 20, stop: 60 }], color: "#ffa000" };
const read: WledSnapshot = { name: "WLED", firmware: "WLED 0.15.4", mac: baseline.mac,
  ledCount: 60, rgbw: false, on: true, brightness: 128, segmentColor: "#ffa000",
  segments: [{ start: 20, stop: 60 }, { start: 0, stop: 20 }] };

describe("last Apply conflict", () => {
  it("checks each saved RGBW channel by exact range even when WLED reorders the report", () => {
    const colors = [{ hex: "#112233", white: 90 }, { hex: "#445566", white: 0 }];
    const colored = { ...baseline, colors };
    const report = [
      { start: 20, stop: 60, ...colors[1]!, hasWhite: true },
      { start: 0, stop: 20, ...colors[0]!, hasWhite: true },
    ];
    expect(compareLastApply(colored, { ...read, segmentColor: null, segmentColors: report })).toBeNull();
    expect(compareLastApply(colored, { ...read, segmentColor: null,
      segmentColors: [{ ...report[0]!, white: 60 }, report[1]!] }))
      .toMatchObject({ rangesChanged: false, colorChanged: true });
    expect(compareLastApply(colored, { ...read, segmentColor: null, segmentColors: null })).toBeNull();
  });
  it("compares known ranges regardless of order and known colour", () => {
    expect(compareLastApply(baseline, read)).toBeNull();
    expect(compareLastApply(baseline, { ...read, segments: [{ start: 0, stop: 60 }] }))
      .toMatchObject({ rangesChanged: true, colorChanged: false });
    expect(compareLastApply(baseline, { ...read, segmentColor: "#0000ff" }))
      .toMatchObject({ rangesChanged: false, colorChanged: true });
  });
  it("does not claim a conflict from missing readback, power-off colour, or another controller", () => {
    expect(compareLastApply(baseline, { ...read, segments: null, segmentColor: null })).toBeNull();
    expect(compareLastApply(baseline, { ...read, on: false, segmentColor: null })).toBeNull();
    expect(compareLastApply(baseline, { ...read, mac: "other" })).toBeNull();
    expect(compareLastApply(null, read)).toBeNull();
  });
});
