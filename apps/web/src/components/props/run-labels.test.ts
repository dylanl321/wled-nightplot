import { describe, expect, it } from "vitest";
import { CAPTION_HALF_W, placeRunLabels, runBadge, stringColour, stringLetter } from "./run-labels";

describe("string badges", () => {
  it("prefixes the run with the string letter", () => {
    expect(stringLetter(0)).toBe("A");
    expect(stringLetter(1)).toBe("B");
    expect(runBadge(0, 1)).toBe("A1");
    expect(runBadge(1, 3)).toBe("B3");
    expect(stringColour(0)).not.toBe(stringColour(1));
    expect(stringColour(6)).toBe(stringColour(0));
  });
});

describe("placeRunLabels", () => {
  it("gives every run a caption, including one too short to read on the line", () => {
    const spots = placeRunLabels([{ ax: 0, ay: 0, bx: 8, by: 0 }]);
    expect(spots).toHaveLength(1);
    expect(spots[0]?.caption).toBeTruthy();
    expect(Math.hypot(spots[0]!.badge.x - spots[0]!.caption.x, spots[0]!.badge.y - spots[0]!.caption.y)).toBeGreaterThan(20);
  });

  it("keeps two labels on the same line apart", () => {
    const spots = placeRunLabels([
      { ax: 0, ay: 0, bx: 200, by: 0 },
      { ax: 0, ay: 8, bx: 200, by: 8 },
    ]);
    const gap = Math.hypot(spots[0]!.badge.x - spots[1]!.badge.x, spots[0]!.badge.y - spots[1]!.badge.y);
    expect(gap).toBeGreaterThanOrEqual(28);
    const captions = Math.hypot(spots[0]!.caption.x - spots[1]!.caption.x, spots[0]!.caption.y - spots[1]!.caption.y);
    expect(captions).toBeGreaterThanOrEqual(28);
  });

  it("nudges a caption that would leave the stage back inside", () => {
    const frame = { w: 390, h: 380 };
    const spots = placeRunLabels(
      [
        { ax: 8, ay: 180, bx: 200, by: 180 },
        { ax: 360, ay: 190, bx: 384, by: 190 },
      ],
      [],
      28,
      frame,
    );
    for (const spot of spots) {
      expect(spot.caption.x).toBeGreaterThanOrEqual(8 + CAPTION_HALF_W);
      expect(spot.caption.x).toBeLessThanOrEqual(frame.w - 8 - CAPTION_HALF_W);
      expect(spot.caption.y).toBeGreaterThanOrEqual(8);
      expect(spot.caption.y).toBeLessThanOrEqual(frame.h - 8);
      expect(spot.badge.x).toBeGreaterThanOrEqual(8);
      expect(spot.badge.x).toBeLessThanOrEqual(frame.w - 8);
    }
  });

  it("stays off a Wire in label", () => {
    const wire = { x: 40, y: 0 };
    const spots = placeRunLabels([{ ax: 0, ay: 0, bx: 80, by: 0 }], [wire]);
    expect(Math.hypot(spots[0]!.badge.x - wire.x, spots[0]!.badge.y - wire.y)).toBeGreaterThanOrEqual(28);
  });
});
