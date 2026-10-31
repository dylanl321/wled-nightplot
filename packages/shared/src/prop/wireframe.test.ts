import { describe, expect, it } from "vitest";
import {
  buildNetLayout,
  compileWireframe,
  defaultWiringOrder,
  defaultWireframeSpec,
  faceElementId,
  formatLedmapJson,
  hiddenSpanFromRange,
  ledmapDigest,
  ledmapsMatch,
  parseLedmapJson,
  parseWireframeSpec,
  polylineToEdgeIds,
  predictedIndexForRole,
  reattachWireframe,
  segmentsForWireframeProp,
  snapToNet,
  widenMarkerIndices,
  wireframeRefuseReason,
} from "./wireframe.ts";
import { isProp } from "./types.ts";

describe("polygon-prism box+X", () => {
  it("declares tops, zigzag posts/bottoms, then both diagonal passes", () => {
    const order = defaultWiringOrder(4);
    expect(order.slice(0, 4)).toEqual(["top.0", "top.1", "top.2", "top.3"]);
    expect(order.slice(4, 12)).toEqual([
      "post.0", "bottom.0", "post.1", "bottom.1", "post.2", "bottom.2", "post.3", "bottom.3",
    ]);
    expect(order.filter((id) => id.startsWith("diag."))).toHaveLength(8);
  });

  it("places the Find-length census along the default path when nothing is locked", () => {
    const compiled = compileWireframe(defaultWireframeSpec({ sides: 8, pitchMm: 100 }), 80);
    expect(compiled.ledCount).toBe(80);
    expect(compiled.pixels).toHaveLength(80);
    expect(compiled.pixels.every((pixel) => pixel.visible)).toBe(true);
    expect(compiled.faces).toHaveLength(8);
    expect(compiled.ledmap).toHaveLength(80);
    expect(new Set(compiled.ledmap).size).toBe(80);
    expect(compiled.staleLocks).toEqual([]);
    expect(compiled.segments.length).toBeGreaterThanOrEqual(8);
  });

  it("re-flows unlocked pixels after a role lock", () => {
    const spec = defaultWireframeSpec({ sides: 4, pitchMm: 100 });
    const guess = compileWireframe(spec, 40);
    const role = guess.roles.find((row) => row.id === "top.0.end");
    expect(role).toBeTruthy();
    const predicted = predictedIndexForRole(guess, "top.0.end");
    expect(predicted).toBeGreaterThan(0);
    spec.locks = [{ role: "top.0.end", physicalIndex: (predicted ?? 4) + 3 }];
    const locked = compileWireframe(spec, 40);
    expect(locked.pixels[spec.locks[0]!.physicalIndex]?.pathParam).toBeCloseTo(role!.pathParam, 5);
    const before = locked.pixels.filter((pixel) => pixel.index < spec.locks[0]!.physicalIndex && pixel.visible);
    expect(before.every((pixel) => pixel.pathParam <= role!.pathParam + 1e-6)).toBe(true);
  });

  it("keeps hidden pixels out of faces and parks them in the ledmap tail", () => {
    const spec = defaultWireframeSpec({ sides: 4, pitchMm: 100 });
    spec.locks = [{ role: "top.0.end", physicalIndex: 8 }];
    spec.hidden = [{ afterRole: "top.0.end", count: 4, reason: "wire" }];
    const compiled = compileWireframe(spec, 40);
    expect(compiled.pixels.slice(9, 13).every((pixel) => pixel.visible === false)).toBe(true);
    expect(compiled.pixels.slice(9, 13).every((pixel) => pixel.hiddenReason === "wire")).toBe(true);
    const hiddenPhysical = [9, 10, 11, 12];
    const facePixels = compiled.faces.flatMap((face) => face.physical);
    expect(hiddenPhysical.some((index) => facePixels.includes(index))).toBe(false);
    expect(compiled.ledmap.slice(-4)).toEqual(hiddenPhysical);
  });

  it("assigns shared posts by the Look/Prop rule without overlapping face ranges", () => {
    const left = compileWireframe({ ...defaultWireframeSpec({ sides: 4 }), sharedPostRule: "left" }, 32);
    const own = compileWireframe({ ...defaultWireframeSpec({ sides: 4 }), sharedPostRule: "own" }, 32);
    expect(own.segments.some((row) => row.label === "posts")).toBe(true);
    expect(left.segments.some((row) => row.label === "posts")).toBe(false);
    const used = new Set<number>();
    for (const face of left.faces) {
      for (const index of face.physical) {
        expect(used.has(index)).toBe(false);
        used.add(index);
      }
    }
  });

  it("flags stale locks when a re-draw drops a role, and reattaches the rest", () => {
    const spec = defaultWireframeSpec({ sides: 4 });
    spec.locks = [
      { role: "top.0.end", physicalIndex: 6 },
      { role: "diag.down.1.end", physicalIndex: 28 },
    ];
    spec.hidden = [{ afterRole: "top.0.end", count: 2, reason: "wire" }];
    spec.path = { points: [], edgeIds: ["top.0", "top.1", "top.2", "top.3"] };
    const compiled = compileWireframe(spec, 40);
    expect(compiled.staleLocks.map((lock) => lock.role)).toEqual(["diag.down.1.end"]);
    const next = reattachWireframe(spec, spec.path);
    expect(next.spec.locks.map((lock) => lock.role)).toEqual(["top.0.end"]);
    expect(next.staleLocks.map((lock) => lock.role)).toEqual(["diag.down.1.end"]);
    expect(next.spec.hidden).toHaveLength(1);
  });

  it("snaps a drawn polyline onto role edges", () => {
    const layout = buildNetLayout(4);
    const top = layout.edges.find((edge) => edge.id === "top.0")!;
    const post = layout.edges.find((edge) => edge.id === "post.1")!;
    const ids = polylineToEdgeIds(layout, [
      { x: top.x1 + 4, y: top.y1 + 1 },
      { x: top.x2 - 4, y: top.y2 },
      { x: post.x1, y: post.y1 + 8 },
    ]);
    expect(ids[0]).toBe("top.0");
    expect(ids).toContain("post.1");
    expect(snapToNet(layout, top.x1 + 10, top.y1, 14)?.edgeId).toBe("top.0");
  });

  it("widens the probe to three LEDs and builds a hidden span after the last lock", () => {
    expect(widenMarkerIndices(0, 10, true)).toEqual([0, 1]);
    expect(widenMarkerIndices(5, 10, true)).toEqual([4, 5, 6]);
    expect(widenMarkerIndices(5, 10, false)).toEqual([5]);
    const span = hiddenSpanFromRange(9, 13, [{ role: "top.0.end", physicalIndex: 8 }], [], "wire");
    expect(span).toEqual({ afterRole: "top.0.end", count: 4, reason: "wire" });
  });

  it("refuses a missing census and a lock past the strip", () => {
    expect(wireframeRefuseReason(defaultWireframeSpec(), 0)).toMatch(/Find the strip length/i);
    expect(wireframeRefuseReason({
      ...defaultWireframeSpec(),
      locks: [{ role: "top.0.end", physicalIndex: 80 }],
    }, 40)).toMatch(/past this strip/i);
  });

  it("round-trips a WLED ledmap file and keeps face Segments virtual", () => {
    const compiled = compileWireframe(defaultWireframeSpec({ sides: 4 }), 24);
    const json = formatLedmapJson(compiled.ledmap);
    expect(parseLedmapJson(json)).toEqual(compiled.ledmap);
    expect(ledmapsMatch(compiled.ledmap, parseLedmapJson(json))).toBe(true);
    expect(ledmapsMatch(compiled.ledmap, null)).toBeNull();
    expect(ledmapDigest(compiled.ledmap)).toMatch(/^ledmap1:/);
    const segments = segmentsForWireframeProp({
      propId: "prop-well",
      label: "Well house",
      compiled,
    });
    expect(segments[0]).toMatchObject({ id: faceElementId("prop-well", 0), start: 0 });
    expect(segments.every((row) => row.stop > row.start)).toBe(true);
  });

  it("keeps wireframe Props parseable and older Props valid", () => {
    expect(isProp({
      id: "p",
      lightId: "l",
      label: "Window",
      kind: "window",
      elementIds: ["a"],
    })).toBe(true);
    const spec = parseWireframeSpec(defaultWireframeSpec());
    expect(spec?.sides).toBe(8);
    expect(isProp({
      id: "p",
      lightId: "l",
      label: "Well house",
      kind: "wireframe",
      elementIds: ["p-face-0"],
      wireframe: spec,
    })).toBe(true);
    expect(isProp({
      id: "p",
      lightId: "l",
      label: "Well house",
      kind: "wireframe",
      elementIds: ["p-face-0"],
    })).toBe(false);
  });
});
