import { applyCommand, emptyTrace, ensureStrings } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { drawRows, newDraft } from "./model";
import { hitCorner, POINT_TOUCH_PX, pointHitSlop, splitRunLabel, View, type DrawProp } from "./stage";

describe("draw-it labels", () => {
  it("names a dark run and keeps the badge off the length caption", () => {
    let layout = ensureStrings(emptyTrace("m", 0.1));
    layout = applyCommand(layout, { type: "addPoint", stringId: "s1", x: 1, y: 0, kind: "lit" }).layout;
    layout = applyCommand(layout, { type: "addPoint", stringId: "s1", x: 1, y: 1, kind: "wire" }).layout;
    const rows = drawRows({ ...newDraft("Ridge"), shape: "draw", drawn: true, layout });
    expect(rows.map((row) => row.name)).toEqual(["A1", "A2 · dark"]);
    expect(rows[1]?.lights).toBe(0);
    const { caption, badge } = splitRunLabel(200, 120, 0, -1, 72);
    const captionMid = { x: caption.x + caption.w / 2, y: caption.y + caption.h / 2 };
    expect(Math.hypot(badge.x - captionMid.x, badge.y - captionMid.y)).toBeGreaterThan(badge.r + caption.h / 2);
  });

  it("gives a finger a 44 px point target and prefers the nearest point", () => {
    expect(pointHitSlop(true) * 2).toBe(POINT_TOUCH_PX);
    expect(POINT_TOUCH_PX).toBeGreaterThanOrEqual(44);
    const view = new View({ x: 0, y: 0, ppm: 100 }, 400, 400);
    const prop = {
      id: "p",
      name: "P",
      x: 0,
      y: 0,
      edges: [],
      start: null,
      lights: 0,
      box: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
      corners: [
        { id: "near", x: 0, y: 0 },
        { id: "far", x: 0.3, y: 0 },
      ],
    } satisfies DrawProp;
    const slop = pointHitSlop(true);
    expect(hitCorner(view, prop, 210, 200, slop)).toBe("near");
    expect(hitCorner(view, prop, 225, 200, slop)).toBe("far");
    const alone = { ...prop, corners: [{ id: "near", x: 0, y: 0 }] };
    expect(hitCorner(view, alone, 222, 200, slop)).toBe("near");
    expect(hitCorner(view, alone, 223, 200, slop)).toBeNull();
    expect(hitCorner(view, prop, 200, 200, pointHitSlop(false))).toBe("near");
  });
});
