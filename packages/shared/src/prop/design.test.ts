import { describe, expect, it } from "vitest";
import type { Element, Light } from "../lights.ts";
import { legacyOutputId } from "../outputs.ts";
import {
  attachmentForLegacy,
  attachmentStringId,
  compilePropDesign,
  designFromLayout,
  outputStartForAttachment,
  propStrings,
  unattachedStrings,
  designFromLegacy,
  lightsAlong,
  migrateDesignedProp,
  planPropPlacement,
  yardSetupSteps,
} from "./design.ts";
import type { PropLayout } from "./layout.ts";
import { isProp, isPropAttachment, type Prop, type PropAttachment } from "./types.ts";

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

  it("gives a repeated run id a new one and keeps the section on the first run", () => {
    const run = [
      { id: "e1", from: "c1", to: "c2", kind: "lit" as const, name: "near" },
      { id: "e1", from: "c2", to: "c3", kind: "wire" as const, name: "jump" },
    ];
    const prop = {
      id: "line",
      label: "Line",
      kind: "custom" as const,
      elementIds: [],
      layout: {
        source: "trace" as const,
        units: "m" as const,
        pitchM: 0.1,
        startOffsetM: 0,
        corners: [{ id: "c1", x: 0, y: 0 }, { id: "c2", x: 1, y: 0 }, { id: "c3", x: 2, y: 0 }],
        run,
        strings: [{ id: "s1", startId: "c1", run }],
      },
      sections: [{ id: "sec", name: "Near", edgeIds: ["e1"], pinnedRanges: [] }],
    };
    const migrated = migrateDesignedProp(prop);
    const runs = migrated.layout?.strings?.[0]?.run ?? migrated.layout?.run ?? [];
    expect(runs[0]).toMatchObject({ id: "e1", name: "near", kind: "lit" });
    expect(runs[1]?.id).not.toBe("e1");
    expect(runs[1]).toMatchObject({ name: "jump", kind: "wire" });
    expect(migrated.sections?.[0]?.edgeIds).toEqual(["e1"]);
    expect(migrateDesignedProp(migrated)).toBe(migrated);
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

function twoStringProp(id = "tree"): Prop {
  const s1 = [
    { id: "e1", from: "c1", to: "c2", kind: "lit" as const },
    { id: "e2", from: "c2", to: "c3", kind: "lit" as const },
  ];
  const s2 = [
    { id: "e3", from: "c4", to: "c5", kind: "lit" as const },
    { id: "e4", from: "c5", to: "c6", kind: "hidden" as const },
    { id: "e5", from: "c6", to: "c7", kind: "lit" as const },
  ];
  const layout: PropLayout = {
    source: "trace",
    units: "m",
    pitchM: 0.1,
    startOffsetM: 0,
    corners: [
      { id: "c1", x: 0, y: 0 }, { id: "c2", x: 0, y: 1 }, { id: "c3", x: -0.5, y: 1.5 },
      { id: "c4", x: 0.6, y: 0.2 }, { id: "c5", x: 0.6, y: 1.2 }, { id: "c6", x: 1, y: 1.2 }, { id: "c7", x: 1, y: 1.8 },
    ],
    run: s1,
    strings: [{ id: "s1", startId: "c1", run: s1 }, { id: "s2", startId: "c4", run: s2 }],
  };
  return {
    id,
    label: "Tree",
    kind: "custom",
    elementIds: [],
    layout,
    design: designFromLayout(layout, null, { shape: "custom" }),
    sections: [
      { id: "left", name: "Left", edgeIds: ["e1", "e2"], pinnedRanges: [] },
      { id: "right", name: "Right", edgeIds: ["e3", "e5"], pinnedRanges: [] },
    ],
  };
}

describe("attaching every string", () => {
  const tree = twoStringProp();
  const [one, two] = propStrings(tree).map((row) => row.ledCount!) as [number, number];
  const out = { id: "out", index: 0, start: 0, ledCount: 100 };

  it("counts each string's own lights", () => {
    expect(propStrings(tree).map((row) => row.id)).toEqual(["s1", "s2"]);
    expect(one + two).toBe(tree.design!.ledCount);
    expect(two).toBeGreaterThan(0);
  });

  it("checks fit per string, not for the whole prop", () => {
    // The whole tree would not fit 30 lights, but each string does.
    const small = { ...out, ledCount: Math.max(one, two) + 2 };
    expect(one + two).toBeGreaterThan(small.ledCount);
    for (const stringId of ["s1", "s2"]) {
      const plan = planPropPlacement({ prop: tree, output: small, lightName: "Yard", stringId, place: { startIndex: 0, afterPropId: null }, props: [tree], attachments: [] });
      expect(plan.ok).toBe(true);
    }
    const tooFar = planPropPlacement({ prop: tree, output: small, lightName: "Yard", stringId: "s2", place: { startIndex: small.ledCount - 1, afterPropId: null }, props: [tree], attachments: [] });
    expect(tooFar.ok).toBe(false);
    if (!tooFar.ok) expect(tooFar.message).toMatch(/string 2.*needs/);
  });

  it("writes only that string's segments, from that string's first light", () => {
    const first = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s1", place: { startIndex: 3, afterPropId: null }, props: [tree], attachments: [] });
    const second = planPropPlacement({ prop: tree, output: { ...out, id: "o2", index: 1, start: 100 }, lightName: "Yard", stringId: "s2", place: { startIndex: 7, afterPropId: null }, props: [tree], attachments: [] });
    if (!first.ok || !second.ok) throw new Error("expected both to fit");
    expect(first.segments.map((row) => row.label)).toEqual(["Tree · Left"]);
    expect(first.segments).toMatchObject([{ start: 3, stop: 3 + one }]);
    expect(second.segments.map((row) => row.label)).toEqual(["Tree · Right"]);
    expect(second.absoluteStart).toBe(107);
    expect(second.segments[0]!.start).toBe(107);
    expect(Math.max(...second.segments.map((row) => row.stop))).toBe(107 + two);
    expect(second.segments.every((row) => row.outputId === "o2")).toBe(true);
  });

  it("says which strings are still waiting, and stops once none are", () => {
    const waiting = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s1", place: { startIndex: 0, afterPropId: null }, props: [tree], attachments: [] });
    if (!waiting.ok) throw new Error(waiting.message);
    expect(waiting.summary).toMatch(/Another string stays on the prop/);
    const done = planPropPlacement({
      prop: tree, output: out, lightName: "Yard", stringId: "s1", place: { startIndex: 0, afterPropId: null }, props: [tree],
      attachments: [{ propId: "tree", lightId: "l", outputId: "out", startIndex: 50, afterPropId: null, stringId: "s2" }],
    });
    if (!done.ok) throw new Error(done.message);
    expect(done.summary).not.toMatch(/stays on the prop/);
  });

  it("lets a string follow another string of its own prop, counting that string's lights", () => {
    const attachments: PropAttachment[] = [{ propId: "tree", lightId: "l", outputId: "out", startIndex: 4, afterPropId: null, stringId: "s1" }];
    const plan = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s2", place: { startIndex: null, afterPropId: "tree", afterStringId: "s1" }, props: [tree], attachments });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.absoluteStart).toBe(4 + one);
    const defaulted = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s2", place: { startIndex: null, afterPropId: "tree" }, props: [tree], attachments });
    expect(defaulted.ok && defaulted.absoluteStart).toBe(4 + one);
  });

  it("follows the string that ends furthest when none is named, and a named one when it is", () => {
    const other = { ...twoStringProp("other"), label: "Other" };
    const attachments: PropAttachment[] = [
      { propId: "tree", lightId: "l", outputId: "out", startIndex: 0, afterPropId: null, stringId: "s1" },
      { propId: "tree", lightId: "l", outputId: "out", startIndex: 40, afterPropId: null, stringId: "s2" },
    ];
    const after = (afterStringId?: string) => planPropPlacement({
      prop: other, output: out, lightName: "Yard", stringId: "s1",
      place: { startIndex: null, afterPropId: "tree", ...(afterStringId ? { afterStringId } : {}) },
      props: [tree, other], attachments,
    });
    const furthest = after();
    expect(furthest.ok && furthest.absoluteStart).toBe(40 + two);
    const named = after("s1");
    expect(named.ok && named.absoluteStart).toBe(one);
  });

  it("refuses a loop between strings and an unknown string", () => {
    const attachments: PropAttachment[] = [
      { propId: "tree", lightId: "l", outputId: "out", startIndex: null, afterPropId: "tree", stringId: "s1", afterStringId: "s2" },
      { propId: "tree", lightId: "l", outputId: "out", startIndex: null, afterPropId: "tree", stringId: "s2", afterStringId: "s1" },
    ];
    expect(outputStartForAttachment({ attachment: attachments[0]!, props: [tree], attachments })).toBeNull();
    const missing = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s9", place: { startIndex: 0, afterPropId: null }, props: [tree], attachments: [] });
    expect(missing.ok).toBe(false);
  });

  it("reads an attachment saved before strings had ids as the first string", () => {
    const legacy: PropAttachment = { propId: "tree", lightId: "l", outputId: "out", startIndex: 12, afterPropId: null };
    expect(isPropAttachment(legacy)).toBe(true);
    expect(attachmentStringId(legacy, tree)).toBe("s1");
    expect(unattachedStrings(tree, [legacy]).map((row) => row.id)).toEqual(["s2"]);
    expect(outputStartForAttachment({ attachment: legacy, props: [tree], attachments: [legacy] })).toBe(12);
    // A follower of the old row lands after the first string only.
    const follower = planPropPlacement({ prop: tree, output: out, lightName: "Yard", stringId: "s2", place: { startIndex: null, afterPropId: "tree" }, props: [tree], attachments: [legacy] });
    expect(follower.ok && follower.absoluteStart).toBe(12 + one);
  });

  it("keeps a single-string prop exactly as before", () => {
    const built = compilePropDesign({ kind: "roofline", unit: "m", pitchMm: pitch, ledProductId: null, measurements: { shape: "roofline", length: 1 } });
    if (!built.ok) throw new Error("design");
    const roof: Prop = { id: "roof", label: "Roof", kind: "roofline", elementIds: [], design: built.design };
    expect(propStrings(roof)).toEqual([{ id: "s1", ledCount: built.design.ledCount }]);
    const plan = planPropPlacement({ prop: roof, output: out, lightName: "Yard", place: { startIndex: 2, afterPropId: null }, props: [roof], attachments: [] });
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.summary).toBe(`${built.design.ledCount} lights on Yard · output 1, from the first light.`);
  });

  it("rejects malformed string ids", () => {
    expect(isPropAttachment({ propId: "a", lightId: "l", outputId: "o", startIndex: 0, afterPropId: null, stringId: "" })).toBe(false);
    expect(isPropAttachment({ propId: "a", lightId: "l", outputId: "o", startIndex: 0, afterPropId: null, stringId: 3 })).toBe(false);
    expect(isPropAttachment({ propId: "a", lightId: "l", outputId: "o", startIndex: null, afterPropId: "b", afterStringId: "s2" })).toBe(true);
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
