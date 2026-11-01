import { applyCommand, emptyTrace, ensureStrings } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { drawRows, newDraft } from "./model";
import { splitRunLabel } from "./stage";

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
});
