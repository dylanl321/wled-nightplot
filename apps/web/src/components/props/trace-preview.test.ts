import { applyCommand, countLayout, edgeLightCount, emptyTrace, ensureStrings, lightsOnLength } from "@nightplot/shared";
import { describe, expect, it } from "vitest";
import { mergeToast, previewRun, previewTotals } from "./trace-preview";

describe("trace preview", () => {
  it("uses the same light count the committed run and the sidebar show", () => {
    const start = ensureStrings(emptyTrace("m", 0.1));
    const from = { x: 0, y: 0 };
    const to = { x: 1.3, y: 0 };
    const preview = previewRun({ from, to, pitchM: 0.1, kind: "lit", units: "m" });
    expect(preview.lights).toBe(lightsOnLength(1.3, 0.1));
    expect(preview.dots).toHaveLength(preview.lights);
    expect(preview.countText).toBe(`${preview.lights} lights`);
    const applied = applyCommand(start, { type: "addPoint", stringId: "s1", x: to.x, y: to.y, kind: "lit" });
    const edge = applied.layout.strings?.[0]?.run[0];
    expect(edge).toBeTruthy();
    expect(edgeLightCount(applied.layout, edge!)).toBe(preview.lights);
    expect(countLayout(applied.layout).total).toBe(preview.lights);
    expect(countLayout(applied.layout).edges[0]?.lights).toBe(preview.lights);
    expect(previewTotals(start, preview, "lit")).toBe(`${preview.lights} lights · 1.30 m of strip · 1.30 m of wire`);
  });

  it("says a dark run is wire only and adds no lights", () => {
    const start = ensureStrings(emptyTrace("ft", 0.1));
    const preview = previewRun({ from: { x: 0, y: 0 }, to: { x: 1.2192, y: 0 }, pitchM: 0.1, kind: "wire", units: "ft" });
    expect(preview.lights).toBe(0);
    expect(preview.dots).toEqual([]);
    expect(preview.countText).toBe("dark · wire only");
    expect(preview.lengthText).toBe("4'");
    expect(previewTotals(start, preview, "wire")).toContain("0 lights");
  });

  it("names the merged runs in the toast", () => {
    expect(mergeToast({ stringIndex: 0, firstOrder: 2, secondOrder: 3, lit: true })).toBe("Merged A2+A3 — now lit");
    expect(mergeToast({ stringIndex: 0, firstOrder: 1, secondOrder: 2, lit: false })).toBe("Merged A1+A2 — dark");
  });
});
