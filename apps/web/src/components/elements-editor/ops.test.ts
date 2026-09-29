import { describe, expect, it } from "vitest";
import type { Element } from "@nightplot/shared";
import {
  assignHues,
  boundaryX,
  bounds,
  carve,
  carveNew,
  combineElements,
  drawnRange,
  duplicateElement,
  edgeHit,
  edgeAt,
  neighbourAt,
  moveEdge,
  extendOk,
  gapAt,
  gaps,
  hitFromSvg,
  nudgeElement,
  pieces,
  resizedStart,
  resizedStop,
  shiftedRange,
  splitElement,
  STRIP,
} from "./ops";

function el(id: string, start: number, stop: number, label = id): Element {
  return { id, lightId: "light-1", label, start, stop };
}

function ids(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

describe("element editor ops", () => {
  it("recognizes boundary LEDs and prefers the end of a one-LED Segment", () => {
    expect(edgeAt(10, el("a", 10, 20))).toBe("start");
    expect(edgeAt(19, el("a", 10, 20))).toBe("end");
    expect(edgeAt(15, el("a", 10, 20))).toBeNull();
    expect(edgeAt(10, el("a", 10, 11))).toBe("end");
  });

  it("moves shared edges in both directions and leaves at least one LED on either side", () => {
    const els = [el("a", 0, 10), el("b", 10, 20)];
    expect(neighbourAt(els[0]!, "end", els)?.id).toBe("b");
    const right = moveEdge(els, "a", "end", 99, false, 30);
    expect(right.value).toBe(19);
    expect(right.els.map(({ start, stop }) => [start, stop])).toEqual([[0, 19], [19, 20]]);
    const left = moveEdge(els, "b", "start", -99, false, 30);
    expect(left.value).toBe(1);
    expect(left.els.map(({ start, stop }) => [start, stop])).toEqual([[0, 1], [1, 20]]);
    expect(els).toEqual([el("a", 0, 10), el("b", 10, 20)]);
  });

  it("detaches without moving the neighbour and clamps at neighbours and strip ends", () => {
    const els = [el("a", 0, 10), el("b", 10, 20)];
    expect(moveEdge(els, "a", "end", 11, true, 30).value).toBe(10);
    const detached = moveEdge(els, "a", "end", 8, true, 30);
    expect(detached.els[1]).toEqual(els[1]);
    expect(detached.nb).toBeNull();
    expect(detached.value).toBe(8);
    expect(moveEdge(els, "a", "start", -1, false, 30).value).toBe(0);
    expect(moveEdge(els, "b", "end", 99, false, 30).value).toBe(30);
    expect(moveEdge(els, "b", "start", 8, true, 30).value).toBe(10);
    expect(moveEdge([el("a", 0, 1), el("b", 1, 2)], "a", "end", 2, false, 2).value).toBe(1);
  });

  it("splits a range into per-row pieces", () => {
    expect(pieces(90, 130)).toEqual([
      { r: 0, a: 90, b: 100 },
      { r: 1, a: 100, b: 130 },
    ]);
  });

  it("maps a pointer into the bead and the boundary", () => {
    const center = hitFromSvg(boundaryX(12, 0) + STRIP.pitch / 2 - 0.01, 44, 300);
    expect(center.idx).toBe(12);
    expect(center.b).toBe(12);
    expect(center.r).toBe(0);
    expect(hitFromSvg(boundaryX(12, 0), 44, 300).b).toBe(12);
  });

  it("hits the end grip before the start grip", () => {
    const element = el("a", 10, 20);
    const end = hitFromSvg(boundaryX(20, 0), 44, 100);
    expect(edgeHit(end, element, 100)).toBe("end");
    const start = hitFromSvg(boundaryX(10, 0), 44, 100);
    expect(edgeHit(start, element, 100)).toBe("start");
    expect(edgeHit(hitFromSvg(boundaryX(15, 0), 44, 100), element, 100)).toBeNull();
  });

  it("carves a cover in the middle, at the start, at the end, and in full", () => {
    const nextId = ids();
    const elements = [el("a", 0, 30, "Left"), el("b", 40, 70, "Mid")];
    expect(carve(elements, { start: 10, stop: 20 }, nextId)).toEqual([
      el("a", 0, 10, "Left"),
      el("n1", 20, 30, "Left 2"),
      el("b", 40, 70, "Mid"),
    ]);
    expect(carve(elements, { start: 0, stop: 10 }, ids())).toEqual([
      el("a", 10, 30, "Left"),
      el("b", 40, 70, "Mid"),
    ]);
    expect(carve(elements, { start: 20, stop: 30 }, ids())).toEqual([
      el("a", 0, 20, "Left"),
      el("b", 40, 70, "Mid"),
    ]);
    expect(carve(elements, { start: 0, stop: 30 }, ids())).toEqual([el("b", 40, 70, "Mid")]);
  });

  it("names what a new Segment took", () => {
    const made = carveNew([el("a", 0, 30, "Left")], { start: 10, stop: 20 }, "light-1", ids());
    expect(made.taken).toEqual(["Left"]);
    expect(made.elements.map((item) => [item.label, item.start, item.stop])).toEqual([
      ["Left", 0, 10],
      ["Left 2", 20, 30],
      ["Segment 3", 10, 20],
    ]);
  });

  it("refuses combine when an unselected Segment sits in the span", () => {
    const elements = [el("a", 0, 10, "A"), el("b", 10, 20, "B"), el("c", 20, 30, "C")];
    const refused = combineElements(elements, ["a", "c"]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.between.map((item) => item.label)).toEqual(["B"]);
    const merged = combineElements(elements, ["a", "b"]);
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.elements).toEqual([el("c", 20, 30, "C"), el("a", 0, 20, "A")]);
    }
  });

  it("refuses duplicate when no free run is long enough", () => {
    const elements = [el("a", 0, 8, "A"), el("b", 10, 20, "B")];
    const missed = duplicateElement(elements, "a", 20, ids());
    expect(missed).toEqual({ ok: false, length: 8, largest: 2 });
    const placed = duplicateElement([el("a", 0, 4, "A")], "a", 20, ids());
    expect(placed.ok).toBe(true);
    if (placed.ok) expect(placed.elements[1]).toMatchObject({ label: "A copy", start: 4, stop: 8 });
  });

  it("clamps a nudge at neighbours and at the strip ends", () => {
    const strip = [el("a", 0, 10), el("b", 10, 20), el("c", 20, 30)];
    expect(nudgeElement(strip[0]!, strip, 30, -5)).toEqual({ start: 0, stop: 10 });
    expect(nudgeElement(strip[2]!, strip, 30, 5)).toEqual({ start: 20, stop: 30 });
    expect(nudgeElement(strip[1]!, strip, 30, 1)).toEqual({ start: 10, stop: 20 });
    expect(nudgeElement(strip[1]!, strip, 30, 1, "end")).toEqual({ start: 10, stop: 20 });
    expect(nudgeElement(strip[1]!, strip, 30, -1, "start")).toEqual({ start: 10, stop: 20 });
    expect(nudgeElement(el("solo", 5, 8), [el("solo", 5, 8)], 30, -1, "start")).toEqual({
      start: 4,
      stop: 8,
    });
  });

  it("clamps a drag to neighbours and snaps the dragged value", () => {
    const original = el("b", 10, 20);
    const elements = [el("a", 0, 10), original, el("c", 20, 40)];
    expect(resizedStart(original, 0, elements, 40, false)).toBe(10);
    expect(resizedStop(original, 40, elements, 40, false)).toBe(20);
    expect(shiftedRange(original, 15, 18, elements, 40, false)).toEqual({ start: 10, stop: 20 });
    expect(resizedStop(el("solo", 0, 10), 14, [el("solo", 0, 10)], 40, true)).toBe(15);
    expect(drawnRange(3, 8, gapAt(3, elements, 40))).toEqual({ start: 3, stop: 9 });
  });

  it("allows an extend only when the union stays clear of other Segments", () => {
    const elements = [el("a", 0, 10), el("b", 20, 30)];
    expect(extendOk(elements, elements[0]!, { start: 10, stop: 20 })).toBe(true);
    expect(extendOk(elements, elements[0]!, { start: 10, stop: 25 })).toBe(false);
  });

  it("splits only on a boundary strictly inside the Segment", () => {
    expect(splitElement([el("a", 0, 10, "Door")], "a", 4, ids())).toEqual([
      el("a", 0, 4, "Door"),
      el("n1", 4, 10, "Door 2"),
    ]);
    expect(splitElement([el("a", 0, 10)], "a", 0, ids())).toBeNull();
    expect(splitElement([el("a", 0, 10)], "a", 10, ids())).toBeNull();
  });

  it("keeps a stored hue and gives a new Segment the next free one", () => {
    const hues = assignHues([{ id: "a" }, { id: "b" }], { a: "#4fd3c1" });
    expect(hues.a).toBe("#4fd3c1");
    expect(hues.b).toBe("#e8ae66");
    expect(assignHues([{ id: "a" }, { id: "b" }], { a: "#d4a574", b: "#7ee0d0" }))
      .toEqual({ a: "#e8ae66", b: "#4fd3c1" });
    expect(assignHues([{ id: "a" }, { id: "b" }], { a: "#7ee0d0", b: "#d4a574" }))
      .toEqual({ a: "#4fd3c1", b: "#e8ae66" });
  });

  it("reports the free runs between Segments", () => {
    expect(gaps([el("a", 0, 10), el("b", 15, 20)], 30)).toEqual([
      { start: 10, stop: 15 },
      { start: 20, stop: 30 },
    ]);
    expect(bounds(el("b", 10, 15), [el("a", 0, 10), el("b", 10, 15), el("c", 20, 30)], 30)).toEqual({
      lo: 10,
      hi: 20,
    });
  });
});
