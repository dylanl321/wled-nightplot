import { describe, expect, it } from "vitest";
import { migrateDesignedProp } from "./design.ts";
import {
  edgeLightCount,
  formatPitch,
  isPropLayout,
  lockRunLights,
  migratePlacedLights,
  movePlacedLight,
  parsePitch,
  placeLight,
  removePlacedLight,
  setEdgeLength,
  spaceEvenly,
  splitRun,
  stringLights,
  type PlacedLight,
  type PropLayout,
} from "./layout.ts";
import { pathEdgeIndexRanges } from "./sections.ts";

function line(lights?: PlacedLight[]): PropLayout {
  const edge = {
    id: "e1",
    from: "c1",
    to: "c2",
    kind: "lit" as const,
    ...(lights ? { manualLights: true, lights, lockedLights: lights.length } : {}),
  };
  return {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 2, y: 0 }],
    run: [edge],
    strings: [{ id: "s1", startId: "c1", run: [edge] }],
  };
}

describe("placed lights", () => {
  it("leaves a saved prop with no hand-placed lights unchanged", () => {
    const layout = line();
    expect(migratePlacedLights(layout)).toBe(layout);
    const prop = {
      id: "roof",
      label: "Roof",
      kind: "custom" as const,
      elementIds: [],
      layout,
      sections: [{ id: "sec", name: "Roof", edgeIds: ["e1"], pinnedRanges: [] }],
    };
    expect(migrateDesignedProp(prop)).toBe(prop);
  });

  it("clamps a short run and keeps lockedLights equal to the list", () => {
    const layout = line([
      { id: "l1", alongM: 0.25 },
      { id: "l2", alongM: 1.8 },
    ]);
    const edited = setEdgeLength(layout, "e1", 1);
    const edge = edited.layout.run[0]!;
    expect(edge.manualLights).toBe(true);
    expect(edge.lockedLights).toBe(2);
    expect(edge.lights?.map((light) => light.alongM)).toEqual([0.25, 1]);
    expect(edgeLightCount(edited.layout, edge)).toBe(2);
    const migrated = migratePlacedLights({
      ...layout,
      run: [{ ...layout.run[0]!, lockedLights: 9, lights: [{ id: "l1", alongM: 5 }, { id: "l2", alongM: 0.4 }] }],
      strings: undefined,
    });
    expect(migrated.run[0]?.lockedLights).toBe(2);
    expect(migrated.run[0]?.lights?.map((light) => light.alongM)).toEqual([2, 0.4]);
    expect(migratePlacedLights(migrated)).toBe(migrated);
  });

  it("numbers lights from the wire-in, in order along the run", () => {
    const first = {
      id: "e1",
      from: "c1",
      to: "c2",
      kind: "lit" as const,
      manualLights: true,
      lockedLights: 2,
      lights: [{ id: "l2", alongM: 1.5 }, { id: "l1", alongM: 0.2 }],
    };
    const second = { id: "e2", from: "c2", to: "c3", kind: "lit" as const };
    const layout: PropLayout = {
      ...line(),
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 2, y: 0 }, { id: "c3", x: 3, y: 0 }],
      run: [first, second],
      strings: [{ id: "s1", startId: "c1", run: [first, second] }],
    };
    const marks = stringLights(layout);
    expect(marks.map((mark) => [mark.id, mark.index])).toEqual([["l1", 0], ["l2", 1], [null, 2], [null, 3], [null, 4], [null, 5], [null, 6], [null, 7], [null, 8], [null, 9], [null, 10], [null, 11]]);
    expect(marks[0]?.x).toBeCloseTo(0.2, 5);
    expect(marks[1]?.x).toBeCloseTo(1.5, 5);
  });

  it("keeps hand-placed lights on the piece that keeps the run id", () => {
    const layout = line([
      { id: "l1", alongM: 0.4 },
      { id: "l2", alongM: 1.6 },
    ]);
    const split = splitRun(layout, "e1", 1, 0);
    const runs = split.layout.strings?.[0]?.run ?? [];
    expect(runs[0]).toMatchObject({ id: "e1", manualLights: true, lockedLights: 2 });
    expect(runs[0]?.lights?.map((light) => light.id)).toEqual(["l1", "l2"]);
    expect(runs[0]?.lights?.[0]?.alongM).toBeCloseTo(0.4, 5);
    expect(runs[0]?.lights?.[1]?.alongM).toBeCloseTo(1, 5);
    expect(runs[1]?.manualLights).toBeUndefined();
    expect(runs[1]?.lights).toBeUndefined();
    expect(runs[1]?.lockedLights).toBeUndefined();
    expect(isPropLayout(split.layout)).toBe(true);
  });

  it("counts a locked run by its lights in section ranges, and a dark run cannot take one", () => {
    const lit = {
      id: "e1",
      from: "c1",
      to: "c2",
      kind: "lit" as const,
      manualLights: true,
      lockedLights: 3,
      lights: [
        { id: "l1", alongM: 0.2 },
        { id: "l2", alongM: 0.5 },
        { id: "l3", alongM: 1.2 },
      ],
    };
    const wire = { id: "e2", from: "c2", to: "c3", kind: "wire" as const };
    const next = { id: "e3", from: "c3", to: "c4", kind: "lit" as const };
    const layout: PropLayout = {
      ...line(),
      corners: [
        { id: "c1", x: 0, y: 0 },
        { id: "c2", x: 2, y: 0 },
        { id: "c3", x: 2.5, y: 0 },
        { id: "c4", x: 3.5, y: 0 },
      ],
      run: [lit, wire, next],
      strings: [{ id: "s1", startId: "c1", run: [lit, wire, next] }],
    };
    expect(pathEdgeIndexRanges(layout).map((range) => [range.edgeId, range.start, range.stop])).toEqual([
      ["e1", 0, 3],
      ["e2", 3, 3],
      ["e3", 3, 13],
    ]);
    expect(placeLight(layout, "e2", 0.2)).toBe(layout);
    const dirty = migratePlacedLights({
      ...layout,
      run: [{ ...wire, manualLights: true, lights: [{ id: "lx", alongM: 0.1 }] }, lit],
      strings: undefined,
    });
    expect(dirty.run[0]?.lights).toBeUndefined();
    expect(dirty.retiredIds).toContain("lx");
  });

  it("stores a move, an added light, and a removal, then spaces evenly", () => {
    const locked = lockRunLights(line(), "e1");
    const moved = movePlacedLight(locked, "e1", locked.run[0]!.lights![0]!.id, 1.7);
    expect(moved.run[0]?.lights?.[0]?.alongM).toBeCloseTo(1.7, 5);
    expect(moved.run[0]?.manualLights).toBe(true);
    const added = placeLight(moved, "e1", 0.3);
    expect(added.run[0]?.lights).toHaveLength(21);
    expect(added.run[0]?.lockedLights).toBe(21);
    const id = added.run[0]!.lights!.find((light) => Math.abs(light.alongM - 0.3) < 1e-6)!.id;
    const removed = removePlacedLight(added, "e1", id);
    expect(removed.run[0]?.lights).toHaveLength(20);
    expect(removed.retiredIds).toContain(id);
    const even = spaceEvenly(removed, "e1");
    expect(even.run[0]?.manualLights).toBeUndefined();
    expect(even.run[0]?.lights).toBeUndefined();
    expect(even.run[0]?.lockedLights).toBeUndefined();
    expect(edgeLightCount(even, even.run[0]!)).toBe(20);
  });

  it("shows 10 cm as 10 on a feet prop and does not rewrite the stored metres", () => {
    expect(formatPitch(0.1, "ft")).toBe("10");
    expect(formatPitch(0.1, "m")).toBe("10");
    expect(formatPitch(0.1 + 1e-12, "ft")).toBe("10");
    expect(parsePitch("10", "ft")).toBeCloseTo(0.1, 9);
    expect(parsePitch("10 cm", "m")).toBeCloseTo(0.1, 9);
    expect(parsePitch("0", "ft")).toBeNull();
  });
});
