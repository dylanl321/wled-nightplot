import { describe, expect, it } from "vitest";
import {
  elementLength,
  firstFreeRange,
  rangesOverlap,
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
