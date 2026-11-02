import { describe, expect, it } from "vitest";
import { sampleShapeEffect } from "../effect/evaluate.ts";
import { layoutFromMeasurements, windowLayout, type LayoutEdge, type PropLayout } from "./layout.ts";
import { readPropShape, shapeDistancesFrom, type ShapeProfile } from "./shape.ts";

const PITCH = 0.1;

function drawn(corners: [string, number, number][], runs: [string, string, string, LayoutEdge["kind"]?][]): PropLayout {
  const run: LayoutEdge[] = runs.map(([id, from, to, kind]) => ({ id, from, to, kind: kind ?? "lit" }));
  return {
    source: "trace",
    units: "m",
    pitchM: PITCH,
    startOffsetM: 0,
    corners: corners.map(([id, x, y]) => ({ id, x, y })),
    run,
  };
}

/** The well: a square border with an X inside. */
function well(): PropLayout {
  return drawn(
    [["c1", 0, 0], ["c2", 1, 0], ["c3", 1, 1], ["c4", 0, 1]],
    [
      ["e1", "c1", "c2"],
      ["e2", "c2", "c3"],
      ["e3", "c3", "c4"],
      ["e4", "c4", "c1"],
      ["e5", "c1", "c3"],
      ["e6", "c2", "c4"],
    ],
  );
}

function group(shape: ShapeProfile, id: string) {
  return shape.groups.find((row) => row.id === id);
}

function inRange(shape: ShapeProfile) {
  for (const light of shape.lights) {
    for (const value of Object.values(light.fields)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  }
}

describe("readPropShape: the well", () => {
  const shape = readPropShape(well());

  it("finds the X's middle as the centre junction", () => {
    const centre = shape.points.find((point) => point.id === shape.centrePointId);
    expect(centre?.kind).toBe("junction");
    expect(centre?.degree).toBe(4);
    expect(centre?.x).toBeCloseTo(0.5, 6);
    expect(centre?.y).toBeCloseTo(0.5, 6);
    expect(shape.startPointId).toBe(shape.centrePointId);
  });

  it("puts the square on the border and the X inside", () => {
    for (const light of shape.lights.filter((row) => ["e1", "e2", "e3", "e4"].includes(row.edgeId))) {
      expect(light.role).toBe("border");
      expect(light.ringSteps).toBe(0);
    }
    const cross = shape.lights.filter((row) => row.edgeId === "e5" || row.edgeId === "e6");
    expect(cross.filter((row) => row.role === "inside").length).toBeGreaterThan(cross.length * 0.8);
    const deepest = Math.max(...cross.map((row) => row.ringSteps));
    expect(deepest).toBe(5);
    const middle = cross.reduce((best, row) => (row.fields.r < best.fields.r ? row : best));
    expect(middle.fields.ring).toBeGreaterThan(0.8);
  });

  it("names four sides clockwise from the top and four corners", () => {
    expect(shape.sides.map((side) => side.name)).toEqual(["Top", "Right", "Bottom", "Left"]);
    expect(shape.sides.find((side) => side.name === "Top")?.edgeIds).toEqual(["e3"]);
    const corners = shape.points.filter((point) => point.isCorner);
    expect(corners).toHaveLength(4);
    expect(group(shape, "corners")?.lights.length).toBeGreaterThan(0);
    expect(shape.groups.filter((row) => row.kind === "corner").map((row) => row.name).sort()).toEqual([
      "Bottom left corner",
      "Bottom right corner",
      "Top left corner",
      "Top right corner",
    ]);
    expect(group(shape, "centre")?.lights.length).toBeGreaterThan(0);
  });

  it("splits the drawing into four triangles", () => {
    expect(shape.faces).toHaveLength(4);
    for (const face of shape.faces) expect(face.areaM2).toBeCloseTo(0.25, 6);
  });

  it("sees all four mirror lines", () => {
    expect(shape.mirrors.map((row) => row.axis).sort()).toEqual(["diagonal-down", "diagonal-up", "horizontal", "vertical"]);
  });

  it("measures distance along the X from the middle", () => {
    const cross = shape.lights.filter((row) => row.edgeId === "e5");
    const nearMiddle = cross.reduce((best, row) => (row.fields.r < best.fields.r ? row : best));
    const nearCorner = cross.reduce((best, row) => (row.fields.r > best.fields.r ? row : best));
    expect(nearMiddle.fields.d).toBeLessThan(0.1);
    expect(nearCorner.fields.d).toBeGreaterThan(nearMiddle.fields.d);
    inRange(shape);
  });

  it("measures distance from any point", () => {
    const corner = shape.points.find((point) => point.cornerIds.includes("c1"))!;
    const metres = shapeDistancesFrom(shape, corner.id);
    const first = shape.lights.findIndex((row) => row.edgeId === "e1");
    expect(metres[first]).toBeCloseTo(shape.lights[first]!.fields.along * 1, 6);
  });

  it("keeps a person's fix by run id", () => {
    const fixed = readPropShape(well(), { overrides: [{ edgeId: "e5", role: "border" }] });
    expect(fixed.lights.filter((row) => row.edgeId === "e5").every((row) => row.role === "border")).toBe(true);
    expect(fixed.lights.filter((row) => row.edgeId === "e6").some((row) => row.role === "inside")).toBe(true);
  });
});

describe("readPropShape: other props", () => {
  it("reads a window as all border, four sides, two mirror lines", () => {
    const shape = readPropShape(windowLayout({
      widthM: 1.2,
      heightM: 0.8,
      units: "m",
      pitchM: PITCH,
      startCorner: 0,
      clockwise: false,
      params: {},
    }));
    expect(shape.lights.every((row) => row.role === "border")).toBe(true);
    expect(group(shape, "inside")).toBeUndefined();
    expect(shape.sides.map((side) => side.name)).toEqual(["Top", "Right", "Bottom", "Left"]);
    expect(shape.points.filter((point) => point.isCorner)).toHaveLength(4);
    expect(shape.mirrors.map((row) => row.axis).sort()).toEqual(["horizontal", "vertical"]);
    expect(shape.faces).toHaveLength(1);
    inRange(shape);
  });

  it("reads a roofline peak: two ends, one corner, two slopes, mirrored", () => {
    const shape = readPropShape(drawn(
      [["c1", 0, 0], ["c2", 2, 1], ["c3", 4, 0]],
      [["e1", "c1", "c2"], ["e2", "c2", "c3"]],
    ));
    expect(shape.points.map((point) => point.kind).sort()).toEqual(["corner", "end", "end"]);
    expect(shape.sides.map((side) => side.name).sort()).toEqual(["Left slope", "Right slope"]);
    expect(shape.mirrors.map((row) => row.axis)).toContain("vertical");
    expect(group(shape, "ends")?.lights.length).toBeGreaterThan(0);
    expect(shape.lights.every((row) => row.role === "border")).toBe(true);
  });

  it("reads a closed tree: a bottom and two slopes, height from the ground up", () => {
    const layout = layoutFromMeasurements({ units: "m", pitchM: PITCH, shape: "tree", params: { height: 2, base: 1.2, closed: 1 } })!;
    const shape = readPropShape(layout);
    expect(shape.sides.map((side) => side.name).sort()).toEqual(["Bottom", "Left slope", "Right slope"]);
    const base = shape.lights.filter((row) => shape.sides.find((side) => side.name === "Bottom")!.lights.includes(shape.lights.indexOf(row)));
    for (const light of base) expect(light.fields.h).toBeCloseTo(0, 6);
    expect(Math.max(...shape.lights.map((row) => row.fields.h))).toBeGreaterThan(0.9);
    expect(shape.mirrors.map((row) => row.axis)).toEqual(["vertical"]);
  });

  it("reads a star drawn as crossing lines per light, not per run", () => {
    const tips = Array.from({ length: 5 }, (_, index) => {
      const angle = Math.PI / 2 + (index * Math.PI * 2) / 5;
      return [`c${index + 1}`, 1 + Math.cos(angle), 1 + Math.sin(angle)] as [string, number, number];
    });
    const order = [0, 2, 4, 1, 3];
    const runs = order.map((from, index) => [`e${index + 1}`, `c${from + 1}`, `c${order[(index + 1) % 5]! + 1}`] as [string, string, string]);
    const shape = readPropShape(drawn(tips, runs));
    expect(shape.points.filter((point) => point.kind === "junction")).toHaveLength(5);
    expect(shape.faces).toHaveLength(6);
    for (const run of runs) {
      const on = shape.lights.filter((row) => row.edgeId === run[0]);
      expect(on.some((row) => row.role === "border")).toBe(true);
      expect(on.some((row) => row.role === "inside")).toBe(true);
    }
    expect(shape.points.filter((point) => point.isCorner)).toHaveLength(10);
    expect(shape.sides).toHaveLength(10);
    expect(shape.mirrors.map((row) => row.axis)).toContain("vertical");
  });

  it("welds a wireframe net's shared posts and puts the diagonals inside", () => {
    const layout = layoutFromMeasurements({ units: "m", pitchM: PITCH, shape: "wireframe", params: { sides: 4, side: 1, height: 1 } })!;
    const shape = readPropShape(layout);
    expect(shape.faces).toHaveLength(8);
    const diagonals = shape.lights.filter((row) => row.edgeId.startsWith("diag."));
    expect(diagonals.filter((row) => row.role === "inside").length).toBeGreaterThan(diagonals.length * 0.6);
    const posts = shape.lights.filter((row) => (row.edgeId === "right.0" || row.edgeId === "left.1") && row.y > 0.06 && row.y < 0.94);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((row) => row.role === "inside")).toBe(true);
    expect(shape.sides.map((side) => side.name).sort()).toEqual(["Bottom", "Left", "Right", "Top"]);
  });

  it("reads a curve traced in short pieces as bends, not corners", () => {
    const steps = 24;
    const corners = Array.from({ length: steps + 1 }, (_, index) => {
      const angle = Math.PI - (index * Math.PI) / steps;
      return [`c${index + 1}`, 1 + Math.cos(angle), Math.sin(angle)] as [string, number, number];
    });
    const runs = Array.from({ length: steps }, (_, index) => [`e${index + 1}`, `c${index + 1}`, `c${index + 2}`] as [string, string, string]);
    const shape = readPropShape(drawn(corners, runs));
    expect(shape.points.filter((point) => point.isCorner)).toHaveLength(0);
    expect(shape.points.filter((point) => point.kind === "end")).toHaveLength(2);
    expect(shape.sides).toHaveLength(1);
  });

  it("counts a dark run as distance with no lights", () => {
    const shape = readPropShape(drawn(
      [["c1", 0, 0], ["c2", 1, 0], ["c3", 3, 0], ["c4", 4, 0]],
      [["e1", "c1", "c2"], ["w1", "c2", "c3", "wire"], ["e2", "c3", "c4"]],
    ));
    expect(shape.lights.some((row) => row.edgeId === "w1")).toBe(false);
    const start = shape.points.find((point) => point.cornerIds.includes("c1"))!;
    expect(shape.startPointId).toBe(start.id);
    const metres = shapeDistancesFrom(shape, start.id);
    const firstAfterGap = shape.lights.findIndex((row) => row.edgeId === "e2");
    expect(metres[firstAfterGap]).toBeGreaterThan(3);
    expect(shape.links.find((link) => link.kind === "wire")?.lengthM).toBeCloseTo(2, 6);
  });

  it("returns an empty profile for an empty drawing", () => {
    const shape = readPropShape(drawn([], []));
    expect(shape.lights).toEqual([]);
    expect(shape.points).toEqual([]);
    expect(shape.mirrors).toEqual([]);
  });
});

describe("sampleShapeEffect", () => {
  it("paints the well's border and cross apart from the fields", () => {
    const shape = readPropShape(well());
    const frame = sampleShapeEffect({
      definition: {
        version: 1,
        id: "frame-and-cross",
        name: "Frame and cross",
        parameters: [],
        channels: { r: "1 - step(0.01, ring)", g: "0", b: "step(0.01, ring)" },
      },
      shape: shape.lights.map((light) => light.fields),
      timeSec: 0,
    });
    expect(frame?.nodeCount).toBe(shape.lights.length);
    shape.lights.forEach((light, index) => {
      const pixel = frame!.pixels[index]!;
      if (light.role === "border") expect([pixel.r, pixel.b]).toEqual([255, 0]);
      else expect([pixel.r, pixel.b]).toEqual([0, 255]);
    });
  });

  it("reads shape names as 0 when a frame has no shape", async () => {
    const { sampleEffect } = await import("../effect/evaluate.ts");
    const frame = sampleEffect({
      definition: { version: 1, id: "x-only", name: "x", parameters: [], channels: { r: "x + 0.5", g: "0", b: "0" } },
      nodeCount: 3,
      timeSec: 0,
    });
    expect(frame?.pixels.map((pixel) => pixel.r)).toEqual([128, 128, 128]);
  });
});
