import { describe, expect, it } from "vitest";
import {
  elementLength,
  firstFreeRange,
  rangesOverlap,
  reconcileDeclaredRangesForLedCount,
  validateDeclaredRanges,
} from "./range.ts";

describe("range model", () => {
  it("derives length from inclusive start / exclusive stop", () => {
    expect(elementLength(120, 180)).toBe(60);
    expect(rangesOverlap({ start: 120, stop: 185 }, { start: 180, stop: 300 })).toBe(
      true,
    );
    expect(rangesOverlap({ start: 0, stop: 120 }, { start: 120, stop: 180 })).toBe(
      false,
    );
  });
});

describe("validateDeclaredRanges", () => {
  it("blocks invert, overlap, and over-ledCount with a reason", () => {
    const invert = validateDeclaredRanges(
      [{ id: "a", label: "Peak", start: 180, stop: 120 }],
      300,
    );
    expect(invert[0]?.code).toBe("invert");
    expect(invert[0]?.message).toMatch(/inverted/);

    const over = validateDeclaredRanges(
      [{ id: "b", label: "Right run", start: 280, stop: 320 }],
      300,
    );
    expect(over[0]?.code).toBe("over-ledCount");
    expect(over[0]?.message).toMatch(/past the strip \(300 LEDs\)/);

    const overlap = validateDeclaredRanges(
      [
        { id: "p", label: "Peak", start: 120, stop: 185 },
        { id: "r", label: "Right run", start: 180, stop: 300 },
      ],
      300,
    );
    expect(overlap).toEqual([
      expect.objectContaining({
        code: "overlap",
        start: 180,
        stop: 185,
        message: "Peak overlaps Right run on LEDs 180–184.",
      }),
    ]);
  });

  it("accepts contiguous declared ranges that fill the strip", () => {
    expect(
      validateDeclaredRanges(
        [
          { id: "l", label: "Left run", start: 0, stop: 24 },
          { id: "r", label: "Right run", start: 24, stop: 60 },
        ],
        60,
      ),
    ).toEqual([]);
  });

  it("finds the first free span for a new Element", () => {
    expect(firstFreeRange([{ start: 0, stop: 24 }], 60)).toEqual({
      start: 24,
      stop: 60,
    });
    expect(firstFreeRange([{ start: 0, stop: 60 }], 60)).toBeNull();
  });
});

describe("reconcileDeclaredRangesForLedCount", () => {
  it("clips a tail that runs past a shorter strip and flags leftover coverage", () => {
    const result = reconcileDeclaredRangesForLedCount(
      [
        { id: "l", label: "Left run", start: 0, stop: 24 },
        { id: "r", label: "Right run", start: 24, stop: 60 },
      ],
      60,
      30,
    );
    expect(result.kind).toBe("shrink");
    expect(result.rewritten).toBe(true);
    expect(result.elements).toEqual([
      { id: "l", label: "Left run", start: 0, stop: 24 },
      { id: "r", label: "Right run", start: 24, stop: 30 },
    ]);
    expect(result.clipped).toEqual([
      expect.objectContaining({
        id: "r",
        label: "Right run",
        start: 24,
        previousStop: 60,
        stop: 30,
      }),
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.uncovered).toEqual([]);
    expect(result.notes.join(" ")).toMatch(/Right run 24–60 was clipped to 24–30/);
    expect(validateDeclaredRanges(result.elements, 30)).toEqual([]);
  });

  it("drops a range that starts past the new length", () => {
    const result = reconcileDeclaredRangesForLedCount(
      [
        { id: "d", label: "Door", start: 0, stop: 24 },
        { id: "p", label: "Peak", start: 40, stop: 60 },
      ],
      60,
      30,
    );
    expect(result.rewritten).toBe(true);
    expect(result.elements).toEqual([{ id: "d", label: "Door", start: 0, stop: 24 }]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ id: "p", label: "Peak", start: 40, stop: 60 }),
    ]);
    expect(result.uncovered).toEqual([{ start: 24, stop: 30 }]);
    expect(result.notes.join(" ")).toMatch(/Peak 40–60 was dropped/);
    expect(result.notes.join(" ")).toMatch(/LEDs 24–30 are not in an Element/);
  });

  it("flags grow without inventing Elements", () => {
    const declared = [{ id: "d", label: "Door", start: 0, stop: 60 }];
    const result = reconcileDeclaredRangesForLedCount(declared, 60, 150);
    expect(result.kind).toBe("grow");
    expect(result.rewritten).toBe(false);
    expect(result.elements).toEqual(declared);
    expect(result.uncovered).toEqual([{ start: 60, stop: 150 }]);
    expect(result.notes[0]).toMatch(/grew from 60 to 150/);
    expect(result.notes[0]).toMatch(/were not extended/);
    expect(result.notes).toContain("LEDs 60–150 are not in an Element.");
  });

  it("leaves same-length declarations untouched", () => {
    const declared = [{ id: "d", label: "Door", start: 0, stop: 60 }];
    const result = reconcileDeclaredRangesForLedCount(declared, 60, 60);
    expect(result.kind).toBe("same");
    expect(result.rewritten).toBe(false);
    expect(result.elements).toBe(declared);
    expect(result.notes).toEqual([]);
  });
});
