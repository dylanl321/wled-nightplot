import { describe, expect, it } from "vitest";
import type { LightOutput } from "../lights.ts";
import {
  canFinishPropTaps,
  nextPropLabel,
  nextTapRole,
  partialSegmentsFromTaps,
  segmentsFromPropTaps,
  splitRangeAcrossOutputs,
  tapRefuseReason,
} from "./templates.ts";

const twoOutputs: LightOutput[] = [
  {
    id: "out-a",
    index: 0,
    start: 0,
    ledCount: 40,
    stripKind: "ws281x",
    gpio: 16,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  },
  {
    id: "out-b",
    index: 1,
    start: 40,
    ledCount: 60,
    stripKind: "ws281x",
    gpio: 2,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  },
];

describe("window template", () => {
  it("turns five corner taps into top, right, bottom, left without overlapping", () => {
    const result = segmentsFromPropTaps({
      kind: "window",
      label: "Front window",
      taps: [{ index: 10 }, { index: 24 }, { index: 40 }, { index: 54 }, { index: 70 }],
      ledCount: 80,
    });
    expect(result).toEqual({
      ok: true,
      segments: [
        { label: "Front window · top", start: 10, stop: 25 },
        { label: "Front window · right", start: 25, stop: 41 },
        { label: "Front window · bottom", start: 41, stop: 55 },
        { label: "Front window · left", start: 55, stop: 71 },
      ],
    });
  });

  it("walks a window backward without inventing a count", () => {
    const result = segmentsFromPropTaps({
      kind: "window",
      label: "Kitchen",
      taps: [{ index: 70 }, { index: 54 }, { index: 40 }, { index: 24 }, { index: 10 }],
      ledCount: 80,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments.map((row) => `${row.start}–${row.stop}`)).toEqual([
      "54–71",
      "40–54",
      "24–40",
      "10–24",
    ]);
  });

  it("refuses four taps and names the missing corner", () => {
    expect(canFinishPropTaps("window", 4)).toBe(false);
    expect(nextTapRole("window", 4)).toBe("End of left");
    expect(
      tapRefuseReason("window", [{ index: 0 }, { index: 8 }, { index: 16 }, { index: 24 }], 60),
    ).toMatch(/end of left/i);
  });
});

describe("stake row", () => {
  it("keeps unused LEDs between stakes out of every Segment", () => {
    const result = segmentsFromPropTaps({
      kind: "stake-row",
      label: "Path",
      taps: [{ index: 4 }, { index: 11 }, { index: 20 }, { index: 27 }],
      ledCount: 40,
    });
    expect(result).toEqual({
      ok: true,
      segments: [
        { label: "Path · stake 1", start: 4, stop: 12 },
        { label: "Path · stake 2", start: 20, stop: 28 },
      ],
    });
  });

  it("refuses an unfinished last stake", () => {
    expect(canFinishPropTaps("stake-row", 3)).toBe(false);
    expect(
      tapRefuseReason("stake-row", [{ index: 0 }, { index: 6 }, { index: 12 }], 40),
    ).toMatch(/end of this stake/i);
  });
});

describe("roofline, arch, tree, custom", () => {
  it("makes one roofline run from two taps and more runs from extra peaks", () => {
    expect(
      segmentsFromPropTaps({
        kind: "roofline",
        label: "Eave",
        taps: [{ index: 0 }, { index: 29 }],
        ledCount: 60,
      }),
    ).toEqual({
      ok: true,
      segments: [{ label: "Eave · run 1", start: 0, stop: 30 }],
    });
    expect(
      segmentsFromPropTaps({
        kind: "roofline",
        label: "Eave",
        taps: [{ index: 0 }, { index: 19 }, { index: 39 }],
        ledCount: 60,
      }),
    ).toEqual({
      ok: true,
      segments: [
        { label: "Eave · run 1", start: 0, stop: 20 },
        { label: "Eave · run 2", start: 20, stop: 40 },
      ],
    });
  });

  it("keeps a two-tap arch as one Segment and splits on a crown", () => {
    expect(
      segmentsFromPropTaps({
        kind: "arch",
        label: "Drive",
        taps: [{ index: 2 }, { index: 21 }],
        ledCount: 40,
      }),
    ).toEqual({
      ok: true,
      segments: [{ label: "Drive · arch", start: 2, stop: 22 }],
    });
    expect(
      segmentsFromPropTaps({
        kind: "arch",
        label: "Drive",
        taps: [{ index: 2 }, { index: 11 }, { index: 21 }],
        ledCount: 40,
      }),
    ).toEqual({
      ok: true,
      segments: [
        { label: "Drive · left", start: 2, stop: 12 },
        { label: "Drive · right", start: 12, stop: 22 },
      ],
    });
  });

  it("splits a tree on a third tap", () => {
    const result = segmentsFromPropTaps({
      kind: "tree",
      label: "Maple",
      taps: [{ index: 0 }, { index: 9 }, { index: 29 }],
      ledCount: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments.map((row) => row.label)).toEqual(["Maple · trunk", "Maple · wrap"]);
  });

  it("names custom corners as runs", () => {
    const result = segmentsFromPropTaps({
      kind: "custom",
      label: "Porch",
      taps: [{ index: 5 }, { index: 9 }, { index: 17 }],
      ledCount: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segments).toEqual([
      { label: "Porch · run 1", start: 5, stop: 10 },
      { label: "Porch · run 2", start: 10, stop: 18 },
    ]);
  });
});

describe("outputs and honesty", () => {
  it("splits one side across two outputs of the same controller", () => {
    const result = segmentsFromPropTaps({
      kind: "roofline",
      label: "Ridge",
      taps: [{ index: 30 }, { index: 49 }],
      ledCount: 100,
      outputs: twoOutputs,
    });
    expect(result).toEqual({
      ok: true,
      segments: [
        { label: "Ridge · run 1", start: 30, stop: 40, outputId: "out-a" },
        { label: "Ridge · run 1", start: 40, stop: 50, outputId: "out-b" },
      ],
    });
  });

  it("splits a window side that crosses the output join", () => {
    const pieces = splitRangeAcrossOutputs(30, 50, twoOutputs);
    expect(pieces).toEqual([
      { label: "", start: 30, stop: 40, outputId: "out-a" },
      { label: "", start: 40, stop: 50, outputId: "out-b" },
    ]);
  });

  it("refuses the same LED twice and a mark past the strip", () => {
    expect(
      tapRefuseReason("custom", [{ index: 8 }, { index: 8 }], 20),
    ).toMatch(/same LED/);
    expect(
      tapRefuseReason("custom", [{ index: 0 }, { index: 20 }], 20),
    ).toMatch(/past this strip/);
  });

  it("lights finished sides while later corners are still unmarked", () => {
    expect(
      partialSegmentsFromTaps({
        kind: "window",
        label: "Front window",
        taps: [{ index: 10 }, { index: 24 }, { index: 40 }],
        ledCount: 80,
      }),
    ).toEqual([
      { label: "Front window · top", start: 10, stop: 25 },
      { label: "Front window · right", start: 25, stop: 41 },
    ]);
  });

  it("numbers a second window without asking for a count", () => {
    expect(nextPropLabel("window", [])).toBe("Window");
    expect(nextPropLabel("window", [{ kind: "window", label: "Front" }])).toBe("Window 2");
  });
});
