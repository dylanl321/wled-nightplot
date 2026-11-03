import { describe, expect, it } from "vitest";
import { countLayout, layoutStrings, stringLights, type PropLayout } from "./layout.ts";
import { mirrorLayout, repeatRuns, reverseLayout, scaleLayout, setWireIn } from "./transform.ts";

/** Up 1 m, across 2 m (dark), down 1 m: a little gate. */
function gate(): PropLayout {
  return {
    source: "drawn",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: 1 }, { id: "c3", x: 2, y: 1 }, { id: "c4", x: 2, y: 0 }],
    run: [
      { id: "e1", from: "c1", to: "c2", kind: "lit" },
      { id: "e2", from: "c2", to: "c3", kind: "wire" },
      { id: "e3", from: "c3", to: "c4", kind: "lit", manualLights: true, lockedLights: 2, lights: [{ id: "l1", alongM: 0.2 }, { id: "l2", alongM: 0.5 }] },
    ],
  } as PropLayout;
}

describe("reverseLayout", () => {
  it("wires from the other end and keeps run ids and hand-placed spots", () => {
    const out = reverseLayout(gate());
    const string = layoutStrings(out)[0]!;
    expect(string.startId).toBe("c4");
    expect(string.run.map((e) => `${e.id}:${e.from}>${e.to}`)).toEqual(["e3:c4>c3", "e2:c3>c2", "e1:c2>c1"]);
    const e3 = string.run[0]!;
    expect(e3.lights?.map((l) => [l.id, +l.alongM.toFixed(3)])).toEqual([["l2", 0.5], ["l1", 0.8]]);
    expect(countLayout(out).total).toBe(countLayout(gate()).total);
    // The first light is now the one nearest the old end.
    const first = stringLights(out)[0]!;
    expect(first.edgeId).toBe("e3");
    expect(first.y).toBeCloseTo(0.5, 6);
  });

  it("is its own inverse", () => {
    expect(reverseLayout(reverseLayout(gate()))).toEqual(reverseLayout(reverseLayout(gate())));
    expect(layoutStrings(reverseLayout(reverseLayout(gate())))[0]!.run.map((e) => e.from)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("mirrorLayout", () => {
  it("flips left and right in place, so a left-to-right prop runs right to left", () => {
    const out = mirrorLayout(gate(), "x");
    expect(out.corners.find((c) => c.id === "c1")).toMatchObject({ x: 2, y: 0 });
    expect(out.corners.find((c) => c.id === "c4")).toMatchObject({ x: 0, y: 0 });
    expect(layoutStrings(out)[0]!.startId).toBe("c1");
  });
  it("flips up and down", () => {
    const out = mirrorLayout(gate(), "y");
    expect(out.corners.find((c) => c.id === "c2")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("setWireIn", () => {
  it("moves to the far end by reversing", () => {
    const moved = setWireIn(gate(), "c4");
    expect(moved.ok && layoutStrings(moved.layout)[0]!.startId).toBe("c4");
  });
  it("starts a closed loop anywhere", () => {
    const loop = gate();
    loop.run.push({ id: "e4", from: "c4", to: "c1", kind: "lit" });
    const moved = setWireIn(loop, "c3");
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const string = layoutStrings(moved.layout)[0]!;
    expect(string.startId).toBe("c3");
    expect(string.run.map((e) => e.id)).toEqual(["e3", "e4", "e1", "e2"]);
  });
  it("refuses the middle of an open string", () => {
    const moved = setWireIn(gate(), "c2");
    expect(moved.ok).toBe(false);
  });
});

describe("repeatRuns", () => {
  it("adds copies after the end, joined by dark jumps", () => {
    const one = gate();
    const out = repeatRuns(one, ["e1", "e2", "e3"], 2, 1, "right");
    const run = layoutStrings(out)[0]!.run;
    // 3 runs, then per copy: a dark jump (2 m box + 1 m gap, from x=2 to x=3) and 3 runs.
    expect(run).toHaveLength(3 + 2 * 4);
    expect(run[3]!.kind).toBe("wire");
    const at = (id: string) => out.corners.find((c) => c.id === id)!;
    expect(at(run[4]!.from)).toMatchObject({ x: 3, y: 0 });
    expect(at(run[run.length - 1]!.to).x).toBeCloseTo(8, 6);
    expect(countLayout(out).total).toBe(countLayout(one).total * 3);
  });
  it("needs no jump when a copy starts where the string ends", () => {
    const wall: PropLayout = { ...gate(), run: gate().run.slice(0, 1) };
    // Up 1 m from (0,0): a copy upward with no gap starts at the top.
    const out = repeatRuns(wall, ["e1"], 1, 0, "up");
    const run = layoutStrings(out)[0]!.run;
    expect(run.map((e) => e.kind)).toEqual(["lit", "lit"]);
  });
});

describe("scaleLayout", () => {
  it("scales about the wire-in and keeps spacing, so lights follow length", () => {
    const one = gate();
    const out = scaleLayout(one, 2, 2, "spacing");
    expect(out.corners.find((c) => c.id === "c1")).toMatchObject({ x: 0, y: 0 });
    expect(out.corners.find((c) => c.id === "c3")).toMatchObject({ x: 4, y: 2 });
    const lit = countLayout(out).edges.find((e) => e.id === "e1")!;
    expect(lit.lights).toBe(countLayout(one).edges.find((e) => e.id === "e1")!.lights * 2);
  });
  it("keeps light counts when asked", () => {
    const one = gate();
    const out = scaleLayout(one, 0.5, 0.5, "count");
    expect(countLayout(out).total).toBe(countLayout(one).total);
  });
  it("scales only the picked runs' corners", () => {
    const out = scaleLayout(gate(), 1, 2, "spacing", ["e3"]);
    expect(out.corners.find((c) => c.id === "c3")).toMatchObject({ x: 2, y: 2 });
    expect(out.corners.find((c) => c.id === "c1")).toMatchObject({ x: 0, y: 0 });
  });
});
