import { describe, expect, it } from "vitest";
import { labelsOffScreen, placeRunLabels, runBadge, stringColour, stringLetter } from "./run-labels";

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
  it("anchors the badge and the caption on the run midpoint", () => {
    const spots = placeRunLabels([{ ax: 0, ay: 100, bx: 200, by: 100 }]);
    const badge = spots[0]?.badge;
    const caption = spots[0]?.caption;
    expect(badge).toBeTruthy();
    expect(caption).toBeTruthy();
    expect(badge!.x).toBeCloseTo(100, 5);
    expect(caption!.x).toBeCloseTo(100, 5);
    expect(Math.abs(badge!.y - 100)).toBeCloseTo(20, 5);
    expect(Math.abs(caption!.y - 100)).toBeGreaterThan(Math.abs(badge!.y - 100));
  });

  it("hides the later label when two runs share a midpoint", () => {
    const spots = placeRunLabels([
      { ax: 0, ay: 0, bx: 200, by: 0 },
      { ax: 0, ay: 0, bx: 200, by: 0 },
    ]);
    expect(spots[0]?.badge).toBeTruthy();
    expect(spots[1]?.badge).toBeNull();
    expect(spots[1]?.off).toBeNull();
  });

  it("keeps the selected label and hides the one underneath it", () => {
    const spots = placeRunLabels([
      { ax: 0, ay: 0, bx: 200, by: 0 },
      { ax: 0, ay: 0, bx: 200, by: 0, selected: true },
    ]);
    expect(spots[0]?.badge).toBeNull();
    expect(spots[1]?.badge).toBeTruthy();
  });

  it("hides a run whose midpoint is off the stage instead of pinning it to the edge", () => {
    const frame = { w: 390, h: 380 };
    const spots = placeRunLabels(
      [
        { ax: 40, ay: 180, bx: 200, by: 180 },
        { ax: 420, ay: 190, bx: 500, by: 190 },
      ],
      [],
      28,
      frame,
    );
    expect(spots[0]?.badge).toBeTruthy();
    expect(spots[0]!.badge!.x).toBeGreaterThan(40);
    expect(spots[0]!.badge!.x).toBeLessThan(200);
    expect(spots[1]?.badge).toBeNull();
    expect(spots[1]?.off).toBe("right");
    expect(labelsOffScreen(spots)).toEqual([{ side: "right", count: 1 }]);
  });

  it("steps to the other side of a Wire in label", () => {
    const wire = { x: 40, y: -40 };
    const spots = placeRunLabels([{ ax: 0, ay: 0, bx: 80, by: 0 }], [wire]);
    expect(spots[0]?.badge).toBeTruthy();
    expect(spots[0]!.badge!.y).toBeGreaterThan(0);
  });
});
