import { describe, expect, it } from "vitest";
import { compilePropDesign, migrateDesignedProp } from "./design.ts";
import { countLayout, layoutFromMeasurements, wellHouseEdgeOrder, type PropLayout } from "./layout.ts";
import {
  defaultSections,
  describeIndexRanges,
  extendEdge,
  parseTypedRanges,
  pathEdgeIndexRanges,
  sectionIndexRanges,
} from "./sections.ts";
import type { Prop } from "./types.ts";
import { defaultWireframeSpec } from "./wireframe.ts";

function chain(lengthsM: number[]): PropLayout {
  const corners = [{ id: "c1", x: 0, y: 0 }];
  const run = [];
  let x = 0;
  for (let index = 0; index < lengthsM.length; index += 1) {
    x += lengthsM[index]!;
    const id = `c${index + 2}`;
    corners.push({ id, x, y: 0 });
    run.push({ id: `e${index + 1}`, from: `c${index + 1}`, to: id, kind: "lit" as const });
  }
  return { source: "trace", units: "m", pitchM: 0.1, startOffsetM: 0, corners, run };
}

describe("path indexes", () => {
  it("derives each edge's indexes from the path for a generic prop", () => {
    const layout = chain([0.25, 0.25, 0.1]);
    const counted = countLayout(layout);
    const spans = pathEdgeIndexRanges(layout);
    expect(spans.map((span) => span.lights)).toEqual(counted.edges.map((edge) => edge.lights));
    expect(spans.map((span) => span.stop - span.start)).toEqual(spans.map((span) => span.lights));
    let cursor = 0;
    for (const span of spans) {
      expect(span.start).toBe(cursor);
      cursor = span.stop;
    }
    expect(cursor).toBe(counted.total);
    const section = {
      id: "ends",
      name: "Ends",
      edgeIds: ["e1", "e3"],
      pinnedRanges: [],
    };
    const report = sectionIndexRanges(layout, [section])[0]!;
    expect(report.ranges).toEqual([
      { start: spans[0]!.start, stop: spans[0]!.stop },
      { start: spans[2]!.start, stop: spans[2]!.stop },
    ]);
    expect(report.ranges.length).toBeGreaterThan(1);
    const covered = report.ranges.reduce((sum, range) => sum + (range.stop - range.start), 0);
    const span = report.ranges[report.ranges.length - 1]!.stop - report.ranges[0]!.start;
    expect(covered).toBeLessThan(span);
  });

  it("moves section ranges when an edge's light count changes and keeps a pinned range", () => {
    const layout = chain([1, 1, 1]);
    const sections = [{
      id: "span",
      name: "Span",
      edgeIds: ["e1", "e3"],
      pinnedRanges: [{ start: 0, stop: 2 }],
    }];
    const before = sectionIndexRanges(layout, sections)[0]!;
    const longer = extendEdge(layout, "e1", 0.5);
    expect(countLayout(longer).edges[0]!.lights).toBeGreaterThan(countLayout(layout).edges[0]!.lights);
    const after = sectionIndexRanges(longer, sections)[0]!;
    expect(after.derived).not.toEqual(before.derived);
    expect(after.pinned).toEqual([{ start: 0, stop: 2 }]);
    expect(after.ranges.some((range) => range.start === 0 && range.stop >= 2)).toBe(true);
  });
});

describe("well house template", () => {
  it("follows tops, then each wall from the right, then one alternating diagonal", () => {
    expect(wellHouseEdgeOrder(4)).toEqual([
      "top.0", "top.1", "top.2", "top.3",
      "right.3", "bottom.3", "left.3",
      "right.2", "bottom.2", "left.2",
      "right.1", "bottom.1", "left.1",
      "right.0", "bottom.0", "left.0",
      "diag.down.0", "diag.up.1", "diag.down.2", "diag.up.3",
    ]);
    const layout = layoutFromMeasurements({
      units: "m",
      pitchM: 0.1,
      shape: "wireframe",
      params: { sides: 4, side: 1, height: 1 },
    });
    expect(layout).toBeTruthy();
    if (!layout) return;
    expect(layout.run.map((edge) => edge.id)).toEqual(wellHouseEdgeOrder(4));
    const right = layout.run.find((edge) => edge.id === "right.0")!;
    const left = layout.run.find((edge) => edge.id === "left.1")!;
    expect(right.from).not.toBe(left.from);
    expect(right.to).not.toBe(left.to);
    const sections = defaultSections(layout);
    expect(sections.map((section) => section.name)).toEqual(["Wall 1", "Wall 2", "Wall 3", "Wall 4"]);
    const wall = sectionIndexRanges(layout, sections).find((section) => section.name === "Wall 1");
    expect(wall).toBeTruthy();
    expect(wall!.ranges.length).toBeGreaterThan(1);
    const covered = wall!.ranges.reduce((sum, range) => sum + (range.stop - range.start), 0);
    const span = wall!.ranges[wall!.ranges.length - 1]!.stop - wall!.ranges[0]!.start;
    expect(covered).toBeLessThan(span);
    expect(describeIndexRanges(wall!.ranges)).toMatch(/LEDs \d+ through \d+/);
    const stretched = extendEdge(layout, "top.0", 0.5);
    const again = sectionIndexRanges(stretched, sections).find((section) => section.name === "Wall 1");
    expect(again!.derived).not.toEqual(wall!.derived);
  });

  it("migrates a straight-line well house onto the general path and keeps the ledmap spec", () => {
    const legacy: PropLayout = {
      source: "template",
      template: { type: "wireframe", params: { sides: 4, side: 1, height: 1 } },
      net: { sides: 4, widthM: 1, heightM: 1 },
      units: "m",
      pitchM: 0.1,
      startOffsetM: 0,
      corners: [
        { id: "c1", x: 0, y: 0 },
        { id: "c2", x: 1, y: 0 },
      ],
      run: [{ id: "e1", from: "c1", to: "c2", kind: "lit" }],
    };
    const spec = defaultWireframeSpec({ sides: 4 });
    spec.locks = [{ role: "top.0.end", physicalIndex: 8 }];
    const prop: Prop = {
      id: "well",
      label: "Well house",
      kind: "wireframe",
      elementIds: [],
      layout: legacy,
      wireframe: spec,
      design: {
        unit: "m",
        pitchMm: 100,
        ledProductId: null,
        measurements: { shape: "wireframe", sides: 4, side: 1, height: 1 },
        ledCount: 1,
        edges: [{ id: "e1", label: "Side 1", lengthMm: 1000, ledCount: 1 }],
      },
    };
    const migrated = migrateDesignedProp(prop);
    expect(migrated.layout?.run.map((edge) => edge.id)).toEqual(wellHouseEdgeOrder(4));
    expect(migrated.sections?.map((section) => section.name)).toEqual(["Wall 1", "Wall 2", "Wall 3", "Wall 4"]);
    expect(migrated.wireframe?.locks).toEqual(spec.locks);
    expect(migrated.wireframe?.path).toBeNull();
    expect(migrateDesignedProp(migrated).layout?.run[0]?.id).toBe("top.0");
    expect(migrateDesignedProp(migrated).sections?.[0]?.id).toBe(migrated.sections?.[0]?.id);
  });
});

describe("typed ranges", () => {
  it("reads inclusive ranges, warns on overlap, and errors past the path", () => {
    const ok = parseTypedRanges("10-16, 50-66", 200);
    expect(ok.errors).toEqual([]);
    expect(ok.ranges).toEqual([
      { start: 10, stop: 17 },
      { start: 50, stop: 67 },
    ]);
    const overlap = parseTypedRanges("10-16, 14-20", 200);
    expect(overlap.errors).toEqual([]);
    expect(overlap.warnings.length).toBeGreaterThan(0);
    expect(overlap.ranges).toHaveLength(2);
    const past = parseTypedRanges("10-250", 40);
    expect(past.errors.length).toBeGreaterThan(0);
    expect(past.ranges).toEqual([]);
    expect(parseTypedRanges("", 40)).toEqual({ ranges: [], warnings: [], errors: [] });
    expect(parseTypedRanges("abc", 40).errors[0]).toMatch(/10-16/);
  });

  it("keeps a pinned range that overlaps the path as a warning, not an error", () => {
    const built = compilePropDesign({
      kind: "roofline",
      unit: "m",
      pitchMm: 100,
      ledProductId: null,
      measurements: { shape: "roofline", length: 2 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const [section] = built.sections;
    expect(section).toBeTruthy();
    const report = sectionIndexRanges(built.layout, [{
      ...section!,
      pinnedRanges: [{ start: 0, stop: 2 }],
    }])[0]!;
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((warning) => /overlaps/i.test(warning))).toBe(true);
    const outside = sectionIndexRanges(built.layout, [{
      ...section!,
      pinnedRanges: [{ start: 500, stop: 510 }],
    }])[0]!;
    expect(outside.errors.length).toBeGreaterThan(0);
    expect(outside.pinned).toEqual([]);
  });
});
