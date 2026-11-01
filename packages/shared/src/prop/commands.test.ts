import { describe, expect, it } from "vitest";
import { applyCommand, type LayoutCommand } from "./commands.ts";
import {
  countLayout,
  edgeLightCount,
  emptyTrace,
  ensureStrings,
  lightsOnLength,
  type LayoutEdge,
  type PropLayout,
} from "./layout.ts";

function drawing(layout: PropLayout) {
  return {
    corners: [...layout.corners].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    strings: (layout.strings ?? []).map((string) => ({ id: string.id, startId: string.startId, run: string.run })),
    retired: [...(layout.retiredIds ?? [])].sort(),
    units: layout.units,
    pitchM: layout.pitchM,
  };
}

function roundTrip(layout: PropLayout, command: LayoutCommand): PropLayout {
  const applied = applyCommand(layout, command);
  expect(applied.inverse, command.type).not.toBeNull();
  const undone = applyCommand(applied.layout, applied.inverse!);
  expect(drawing(undone.layout)).toEqual(drawing(layout));
  const redone = applyCommand(undone.layout, undone.inverse!);
  expect(drawing(redone.layout)).toEqual(drawing(applied.layout));
  return applied.layout;
}

function line(kind: LayoutEdge["kind"] = "lit", extra: Partial<LayoutEdge> = {}): PropLayout {
  const edge: LayoutEdge = { id: "e1", from: "c1", to: "c2", kind, ...extra };
  return ensureStrings({
    ...emptyTrace("m", 0.1),
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }],
    run: [edge],
    strings: [{ id: "s1", startId: "c1", run: [edge] }],
  });
}

describe("layout commands", () => {
  it("addPoint, joinPoint, removePoint, and setRunDark each undo back to the same drawing", () => {
    const start = line();
    const added = roundTrip(start, { type: "addPoint", stringId: "s1", x: 1, y: 1, kind: "lit" });
    expect(added.strings?.[0]?.run).toHaveLength(2);
    const joined = roundTrip(added, { type: "joinPoint", stringId: "s1", cornerId: "c1", kind: "wire" });
    expect(joined.strings?.[0]?.run[2]?.kind).toBe("wire");
    roundTrip(added, { type: "removePoint", cornerId: added.strings?.[0]?.run[1]?.to ?? "" });
    roundTrip(line("lit", { lockedLights: 4, lights: [{ id: "p1", alongM: 0.2 }], manualLights: true }), {
      type: "setRunDark",
      edgeId: "e1",
      dark: true,
    });
    roundTrip(line("wire"), { type: "setRunDark", edgeId: "e1", dark: false });
  });

  it("merges a lit run with a dark run into a lit run and clears light-count overrides", () => {
    const first: LayoutEdge = { id: "e1", from: "c1", to: "c2", kind: "lit", lockedLights: 7, name: "near" };
    const second: LayoutEdge = { id: "e2", from: "c2", to: "c3", kind: "wire" };
    const layout = ensureStrings({
      ...emptyTrace("m", 0.1),
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 2, y: 0 }],
      run: [first, second],
      strings: [{ id: "s1", startId: "c1", run: [first, second] }],
    });
    const applied = applyCommand(layout, { type: "removePoint", cornerId: "c2" });
    expect(applied.refused).toBeNull();
    expect(applied.merge).toEqual({ stringIndex: 0, firstOrder: 1, secondOrder: 2, lit: true });
    const edge = applied.layout.strings?.[0]?.run[0];
    expect(edge).toMatchObject({ id: "e1", from: "c1", to: "c3", kind: "lit", name: "near" });
    expect(edge?.lockedLights).toBeUndefined();
    expect(edge?.lights).toBeUndefined();
    expect(applied.layout.corners.map((corner) => corner.id)).toEqual(["c1", "c3"]);
    expect(drawing(applyCommand(applied.layout, applied.inverse!).layout)).toEqual(drawing(layout));
  });

  it("keeps a dark run dark when both runs were dark, and refuses the wire-in", () => {
    const first: LayoutEdge = { id: "e1", from: "c1", to: "c2", kind: "wire" };
    const second: LayoutEdge = { id: "e2", from: "c2", to: "c3", kind: "wire" };
    const layout = ensureStrings({
      ...emptyTrace("m", 0.1),
      corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 1, y: 1 }],
      run: [first, second],
      strings: [{ id: "s1", startId: "c1", run: [first, second] }],
    });
    const applied = applyCommand(layout, { type: "removePoint", cornerId: "c2" });
    expect(applied.merge?.lit).toBe(false);
    expect(applied.layout.strings?.[0]?.run[0]?.kind).toBe("wire");
    expect(applyCommand(layout, { type: "removePoint", cornerId: "c1" }).refused).toBe("wire-in");
    const lone = ensureStrings(emptyTrace("ft"));
    expect(applyCommand(lone, { type: "removePoint", cornerId: "c1" })).toMatchObject({ inverse: null, refused: null });
  });

  it("counts a placed run with lightsOnLength, the same number the sidebar reads", () => {
    const start = ensureStrings(emptyTrace("m", 0.1));
    const previewLights = lightsOnLength(1, 0.1);
    const applied = applyCommand(start, { type: "addPoint", stringId: "s1", x: 1, y: 0, kind: "lit" });
    const edge = applied.layout.strings?.[0]?.run[0];
    expect(edge).toBeTruthy();
    expect(previewLights).toBe(10);
    expect(edgeLightCount(applied.layout, edge!)).toBe(previewLights);
    expect(countLayout(applied.layout).edges[0]?.lights).toBe(previewLights);
    const dark = applyCommand(applied.layout, { type: "addPoint", stringId: "s1", x: 1, y: 1, kind: "wire" });
    const wire = dark.layout.strings?.[0]?.run[1];
    expect(edgeLightCount(dark.layout, wire!)).toBe(0);
    expect(countLayout(dark.layout).total).toBe(previewLights);
  });
});
