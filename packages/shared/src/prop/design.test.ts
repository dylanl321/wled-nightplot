import { describe, expect, it } from "vitest";
import type { Element, Light } from "../lights.ts";
import { legacyOutputId } from "../outputs.ts";
import {
  attachmentForLegacy,
  compilePropDesign,
  designFromLegacy,
  lightsAlong,
  planPropPlacement,
  yardSetupSteps,
} from "./design.ts";
import { isProp } from "./types.ts";

const pitch = 100;

describe("light count from measurements", () => {
  it("counts a 40 ft roofline at 10 cm as 122 lights", () => {
    const built = compilePropDesign({
      kind: "roofline",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "roofline", length: 40 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.design.ledCount).toBe(122);
    expect(built.design.edges).toEqual([
      expect.objectContaining({ label: "Along the roof", ledCount: 122 }),
    ]);
    expect(lightsAlong(40 * 304.8, 100)).toBe(122);
  });

  it("counts a window from four sides without sharing corners twice", () => {
    const built = compilePropDesign({
      kind: "window",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "window", width: 4, height: 3 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.design.edges.map((edge) => edge.ledCount)).toEqual([12, 9, 12, 9]);
    expect(built.design.ledCount).toBe(42);
    expect(built.layout.corners).toHaveLength(4);
  });

  it("counts an arch from the two drawn chords", () => {
    const built = compilePropDesign({
      kind: "arch",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "arch", width: 4, height: 2 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.design.edges).toHaveLength(2);
    expect(built.design.ledCount).toBe(built.design.edges.reduce((sum, edge) => sum + edge.ledCount, 0));
    expect(built.layout.run).toHaveLength(2);
  });

  it("counts a cone tree as two slants", () => {
    const built = compilePropDesign({
      kind: "tree",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "tree", height: 6, base: 3 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const slant = Math.hypot((1.5 * 304.8), 6 * 304.8);
    const each = lightsAlong(slant, pitch);
    expect(each).toBe(19);
    expect(built.design.ledCount).toBe(38);
  });

  it("counts each stake and leaves the wire between them uncounted", () => {
    const built = compilePropDesign({
      kind: "stake-row",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "stake-row", stakes: 4, height: 2 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.design.edges).toHaveLength(4);
    expect(built.design.ledCount).toBe(24);
  });

  it("orders an 8-sided well house as tops, then each wall from the right, then one diagonal", () => {
    const built = compilePropDesign({
      kind: "wireframe",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "wireframe", sides: 8, side: 1, height: 1 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.wireframe?.sides).toBe(8);
    expect(built.wireframe?.path).toBeNull();
    expect(built.layout.run.map((edge) => edge.id).slice(0, 8)).toEqual([
      "top.0", "top.1", "top.2", "top.3", "top.4", "top.5", "top.6", "top.7",
    ]);
    expect(built.layout.run.map((edge) => edge.id).slice(8, 11)).toEqual(["right.7", "bottom.7", "left.7"]);
    expect(built.layout.run.filter((edge) => edge.id.startsWith("diag."))).toHaveLength(8);
    expect(built.layout.run.some((edge) => edge.id.startsWith("post."))).toBe(false);
    expect(built.design.edges).toHaveLength(40);
    expect(built.design.ledCount).toBe(built.design.edges.reduce((sum, edge) => sum + edge.ledCount, 0));
    expect(built.sections.map((section) => section.name)[0]).toBe("Front");
    expect(built.sections).toHaveLength(8);
    const top = built.layout.run.find((edge) => edge.id === "top.0");
    const right = built.layout.run.find((edge) => edge.id === "right.0");
    const leftOfNext = built.layout.run.find((edge) => edge.id === "left.1");
    expect(top && right && leftOfNext).toBeTruthy();
    expect(right?.from).not.toBe(leftOfNext?.from);
    expect(top?.to).not.toBe(leftOfNext?.to);
  });

  it("counts a 6 m line at 10 cm as 60 lights, one per spacing along that edge", () => {
    const built = compilePropDesign({
      kind: "roofline",
      unit: "m",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "roofline", length: 6 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.design.ledCount).toBe(60);
  });

  it("refuses custom draw", () => {
    const built = compilePropDesign({
      kind: "custom",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "custom" },
    });
    expect(built.ok).toBe(false);
  });
});

describe("prop migration", () => {
  const light = {
    id: "light-garage",
    outputs: [{ id: "out-1", index: 0, start: 0, ledCount: 60, stripKind: "ws281x", gpio: null, nativeType: null, nativeOrder: null, colorOrder: null }],
  } as Light;
  const elements: Element[] = [
    { id: "top", lightId: light.id, label: "Front · top", start: 0, stop: 10 },
    { id: "right", lightId: light.id, label: "Front · right", start: 10, stop: 20 },
  ];

  it("turns a light-tied prop into a design plus an attachment", () => {
    const legacy = {
      id: "prop-window",
      lightId: light.id,
      label: "Front",
      kind: "window" as const,
      elementIds: ["top", "right"],
    };
    expect(isProp(legacy)).toBe(true);
    const design = designFromLegacy(legacy, elements);
    expect(design.measurements).toEqual({ shape: "legacy" });
    expect(design.ledCount).toBe(20);
    expect(design.pitchMm).toBeNull();
    const attachment = attachmentForLegacy(legacy, elements, light);
    expect(attachment).toEqual({
      propId: "prop-window",
      lightId: light.id,
      outputId: "out-1",
      startIndex: 0,
      afterPropId: null,
    });
  });

  it("does not invent a light count when the saved ranges are missing", () => {
    const design = designFromLegacy({
      elementIds: ["missing"],
      wireframe: undefined,
    }, []);
    expect(design.ledCount).toBeNull();
  });

  it("uses the legacy output id when the light has no outputs yet", () => {
    const attachment = attachmentForLegacy(
      { id: "prop-window", lightId: light.id, elementIds: ["top"] },
      elements,
      { ...light, outputs: undefined },
    );
    expect(attachment?.outputId).toBe(legacyOutputId(light.id));
  });
});

describe("placement", () => {
  it("chains after another prop on the same output", () => {
    const first = compilePropDesign({
      kind: "roofline",
      unit: "m",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "roofline", length: 1 },
    });
    const second = compilePropDesign({
      kind: "roofline",
      unit: "m",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "roofline", length: 2 },
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const props = [
      { id: "a", label: "Eave", kind: "roofline" as const, elementIds: [], design: first.design, lightId: "light" },
      { id: "b", label: "Peak", kind: "roofline" as const, elementIds: [], design: second.design },
    ];
    const plan = planPropPlacement({
      prop: props[1]!,
      output: { id: "out", index: 0, start: 0, ledCount: 60 },
      lightName: "Garage",
      place: { startIndex: null, afterPropId: "a" },
      props,
      attachments: [{ propId: "a", lightId: "light", outputId: "out", startIndex: 0, afterPropId: null }],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.absoluteStart).toBe(10);
    expect(plan.summary).toContain("after Eave");
  });

  it("refuses a prop that does not fit the reported output", () => {
    const built = compilePropDesign({
      kind: "roofline",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "roofline", length: 40 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const plan = planPropPlacement({
      prop: { id: "roof", label: "Front roof", kind: "roofline", elementIds: [], design: built.design },
      output: { id: "out", index: 0, start: 0, ledCount: 60 },
      lightName: "Garage",
      place: { startIndex: 0, afterPropId: null },
      props: [],
      attachments: [],
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain("Nothing will be sent");
    expect(plan.message).toContain("122");
  });

  it("writes each section range with that section's name and colour", () => {
    const built = compilePropDesign({
      kind: "window",
      unit: "ft",
      pitchMm: pitch,
      ledProductId: null,
      measurements: { shape: "window", width: 4, height: 3 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const sections = built.sections.map((section, index) => index === 0 ? { ...section, name: "Sill", color: "#ff2d2d" } : section);
    const prop = {
      id: "window",
      label: "Front window",
      kind: "window" as const,
      elementIds: [],
      design: built.design,
      layout: built.layout,
      sections,
    };
    const plan = planPropPlacement({
      prop,
      output: { id: "out", index: 0, start: 0, ledCount: 200 },
      lightName: "Porch",
      place: { startIndex: 0, afterPropId: null },
      props: [prop],
      attachments: [],
      maxSegments: 2,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/can hold 2/);
    const allowed = planPropPlacement({
      prop,
      output: { id: "out", index: 0, start: 0, ledCount: 200 },
      lightName: "Porch",
      place: { startIndex: 0, afterPropId: null },
      props: [prop],
      attachments: [],
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    const sill = allowed.segments.filter((segment) => segment.label === "Front window · Sill");
    expect(sill.length).toBeGreaterThan(0);
    expect(sill.every((segment) => segment.color === "#ff2d2d")).toBe(true);
  });
});

describe("yard checklist", () => {
  it("marks exactly one next step, in order", () => {
    const empty = yardSetupSteps({ propCount: 0, unattachedCount: 0, lightCount: 0, looksReady: false, yardClear: false });
    expect(empty.map((step) => step.mark)).toEqual(["next", "later", "later", "later", "later"]);
    const designed = yardSetupSteps({ propCount: 2, unattachedCount: 2, lightCount: 0, looksReady: false, yardClear: false });
    expect(designed.map((step) => step.mark)).toEqual(["done", "next", "later", "later", "later"]);
    const connected = yardSetupSteps({ propCount: 2, unattachedCount: 1, lightCount: 1, looksReady: false, yardClear: false });
    expect(connected.find((step) => step.mark === "next")?.id).toBe("attach");
    const attached = yardSetupSteps({ propCount: 2, unattachedCount: 0, lightCount: 1, looksReady: false, yardClear: false });
    expect(attached.find((step) => step.mark === "next")?.id).toBe("looks");
    const scheduled = yardSetupSteps({ propCount: 2, unattachedCount: 0, lightCount: 1, looksReady: true, yardClear: false });
    expect(scheduled.find((step) => step.mark === "next")?.id).toBe("check");
    const clear = yardSetupSteps({ propCount: 2, unattachedCount: 0, lightCount: 1, looksReady: true, yardClear: true });
    expect(clear.every((step) => step.mark === "done")).toBe(true);
  });

  it("keeps connect done when controllers exist before any prop", () => {
    const steps = yardSetupSteps({ propCount: 0, unattachedCount: 0, lightCount: 3, looksReady: false, yardClear: false });
    expect(steps.find((step) => step.id === "design")?.mark).toBe("next");
    expect(steps.find((step) => step.id === "connect")?.mark).toBe("done");
  });
});
