import { applyCommand, emptyTrace, ensureStrings } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { drawRows, newDraft } from "./model";
import { boxesOverlap, hitCorner, hitRun, placeBesideRun, POINT_TOUCH_PX, pointHitSlop, View, type DrawProp } from "./stage";

describe("draw-it labels", () => {
  it("names a dark run and keeps the badge off the length caption", () => {
    let layout = ensureStrings(emptyTrace("m", 0.1));
    layout = applyCommand(layout, { type: "addPoint", stringId: "s1", x: 1, y: 0, kind: "lit" }).layout;
    layout = applyCommand(layout, { type: "addPoint", stringId: "s1", x: 1, y: 1, kind: "wire" }).layout;
    const rows = drawRows({ ...newDraft("Ridge"), shape: "draw", drawn: true, layout });
    expect(rows.map((row) => row.name)).toEqual(["A1", "A2 · dark"]);
    expect(rows[1]?.lights).toBe(0);
    const a1 = placeBesideRun(200, 200, 0, 1, 72, []);
    const captionMid = { x: a1.caption.x + a1.caption.w / 2, y: a1.caption.y + a1.caption.h / 2 };
    expect(Math.hypot(a1.badge.x - captionMid.x, a1.badge.y - captionMid.y)).toBeGreaterThan(a1.badge.r + a1.caption.h / 2);
    const a1Boxes = [a1.caption, { x: a1.badge.x - 11, y: a1.badge.y - 11, w: 22, h: 22 }];
    // A short second run shares the corner. Its badge stays on that run, not on A1.
    const a2 = placeBesideRun(142, 179, 1, 0, 72, a1Boxes);
    const a2Badge = { x: a2.badge.x - 11, y: a2.badge.y - 11, w: 22, h: 22 };
    expect(boxesOverlap(a2Badge, a1Boxes[0]!)).toBe(false);
    expect(boxesOverlap(a2Badge, a1Boxes[1]!)).toBe(false);
    const own = Math.hypot(a2.badge.x - 142, a2.badge.y - 179);
    const other = Math.hypot(a2.badge.x - 200, a2.badge.y - 200);
    expect(own).toBeLessThan(other);
    expect(own).toBeLessThan(50);
    const button = { x: 150, y: 214, w: 148, h: 44 };
    const clear = placeBesideRun(200, 200, 0, 1, 80, [button]);
    expect(boxesOverlap(clear.caption, button)).toBe(false);
    expect(boxesOverlap({ x: clear.badge.x - 11, y: clear.badge.y - 11, w: 22, h: 22 }, button)).toBe(false);
  });

  it("hits a dark run so the wire can be tapped", () => {
    const view = new View({ x: 0, y: 0, ppm: 100 }, 400, 400);
    const prop = {
      id: "p",
      name: "P",
      x: 0,
      y: 0,
      edges: [{ id: "wire", ax: 0, ay: 0, bx: 0, by: 1, lights: 0, color: null, wire: true, badge: "A2" }],
      start: { x: 0, y: 0 },
      lights: 0,
      box: { minX: 0, minY: 0, maxX: 0, maxY: 1 },
      corners: [],
    } satisfies DrawProp;
    expect(hitRun(view, prop, 200, 150)?.id).toBe("wire");
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
