/**
 * Design a prop from a shape and typed measurements. No controller, no
 * light indices. Custom draw is a placeholder until its interaction spec lands.
 * The #87 net is not involved here.
 */

import type { Element, Light, LightOutput } from "../lights.ts";
import { legacyOutputId } from "../outputs.ts";
import { countLayout, layoutFromMeasurements, layoutStrings, wellHouseEdgeLabel, wellHouseEdgeOrder, windowSideNames, type PropLayout } from "./layout.ts";
import { defaultSections, isLegacyWellHouseLayout, sectionIndexRanges } from "./sections.ts";
import { defaultWireframeSpec } from "./wireframe.ts";
import {
  isPropDesign,
  type Prop,
  type PropAttachment,
  type PropDesign,
  type PropEdge,
  type PropKind,
  type PropLengthUnit,
  type PropMeasurements,
  type PropSection,
  type PropSegmentDraft,
  type WireframeSpec,
} from "./types.ts";

export const DEFAULT_PITCH_MM = 100;
export const MM_PER_FOOT = 304.8;
export const MM_PER_METRE = 1000;

export type YardStepId = "design" | "connect" | "attach" | "looks" | "check";
export type YardStepMark = "done" | "next" | "later";

export type YardStep = {
  id: YardStepId;
  title: string;
  mark: YardStepMark;
};

const YARD_TITLES: Record<YardStepId, string> = {
  design: "Design your props",
  connect: "Connect controllers",
  attach: "Attach props to controllers",
  looks: "Pick looks & schedule",
  check: "Yard check",
};

export function yardSetupSteps(input: {
  propCount: number;
  unattachedCount: number;
  lightCount: number;
  looksReady: boolean;
  yardClear: boolean;
}): YardStep[] {
  const done: Record<YardStepId, boolean> = {
    design: input.propCount > 0,
    connect: input.lightCount > 0,
    attach: input.propCount > 0 && input.unattachedCount === 0 && input.lightCount > 0,
    looks: input.looksReady,
    check: input.yardClear,
  };
  const order: YardStepId[] = ["design", "connect", "attach", "looks", "check"];
  const next = order.find((id) => !done[id]) ?? null;
  return order.map((id) => ({
    id,
    title: YARD_TITLES[id],
    mark: done[id] ? "done" : id === next ? "next" : "later",
  }));
}

export function lengthToMm(value: number, unit: PropLengthUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value * (unit === "ft" ? MM_PER_FOOT : MM_PER_METRE);
}

/** Centre-to-centre spacing: length is count times pitch. At least one light when the length is positive. */
export function lightsAlong(lengthMm: number, pitchMm: number): number {
  if (!(lengthMm > 0) || !(pitchMm > 0)) return 0;
  return Math.max(1, Math.round(lengthMm / pitchMm));
}

export function compilePropDesign(input: {
  kind: PropKind;
  unit: PropLengthUnit;
  pitchMm: number;
  ledProductId: string | null;
  measurements: PropMeasurements;
}): { ok: true; design: PropDesign; layout: PropLayout; sections: PropSection[]; wireframe?: WireframeSpec } | { ok: false; message: string } {
  if (!(input.pitchMm > 0) || !Number.isFinite(input.pitchMm)) {
    return { ok: false, message: "Light spacing has to be greater than zero." };
  }
  if (input.measurements.shape === "custom") {
    return { ok: false, message: "Draw the prop, then save. Nothing was saved." };
  }
  if (input.measurements.shape === "legacy") {
    return { ok: false, message: "That shape is only for props saved before designing without a controller." };
  }
  if (input.measurements.shape !== input.kind && !(input.kind === "wireframe" && input.measurements.shape === "wireframe")) {
    return { ok: false, message: "The shape and the measurements do not match." };
  }
  const params = measurementParams(input.measurements);
  if (!params) return { ok: false, message: "Those measurements could not be saved." };
  const layout = layoutFromMeasurements({
    units: input.unit,
    pitchM: input.pitchMm / 1000,
    shape: input.measurements.shape,
    params,
  });
  if (!layout) return { ok: false, message: "Those measurements could not be saved." };
  const design = designFromLayout(layout, input.ledProductId, input.measurements);
  if (!isPropDesign(design)) return { ok: false, message: "Those measurements could not be saved." };
  if (input.measurements.shape === "wireframe") {
    return {
      ok: true,
      design,
      layout,
      sections: defaultSections(layout),
      wireframe: defaultWireframeSpec({ sides: input.measurements.sides, pitchMm: input.pitchMm }),
    };
  }
  return { ok: true, design, layout, sections: defaultSections(layout) };
}

export function designFromLayout(
  layout: PropLayout,
  ledProductId: string | null,
  measurements: PropMeasurements,
): PropDesign {
  const counted = countLayout(layout);
  const names = edgeNames(measurements, layout);
  const edges = counted.edges.filter((edge) => edge.kind === "lit").map((edge, index) => ({
    id: edge.id,
    label: names[index] ?? `Side ${index + 1}`,
    lengthMm: Math.round(edge.lengthM * 1000),
    ledCount: edge.lights,
  }));
  return {
    unit: layout.units,
    pitchMm: Math.round(layout.pitchM * 1000 * 1000) / 1000,
    ledProductId,
    measurements,
    ledCount: edges.reduce((sum, edge) => sum + edge.ledCount, 0),
    edges,
  };
}

function measurementParams(measurements: PropMeasurements): Record<string, number> | null {
  switch (measurements.shape) {
    case "roofline":
      return { length: measurements.length };
    case "window":
      return { width: measurements.width, height: measurements.height };
    case "arch":
      return { width: measurements.width, height: measurements.height };
    case "tree":
      return { height: measurements.height, base: measurements.base };
    case "stake-row":
      return { stakes: measurements.stakes, height: measurements.height };
    case "wireframe":
      return { sides: measurements.sides, side: measurements.side, height: measurements.height };
    case "custom":
    case "legacy":
      return null;
    default: {
      const _never: never = measurements;
      return _never;
    }
  }
}

function edgeNames(measurements: PropMeasurements, layout: PropLayout): string[] {
  switch (measurements.shape) {
    case "roofline":
      return ["Along the roof"];
    case "window":
      return windowSideNames(layout);
    case "arch":
      return ["Left side", "Right side"];
    case "tree":
      return ["Left side", "Right side"];
    case "stake-row":
      return Array.from({ length: measurements.stakes }, (_, index) => `Stake ${index + 1}`);
    case "wireframe":
      return layout.run.filter((edge) => edge.kind === "lit").map((edge) => wellHouseEdgeLabel(edge.id) ?? edge.id);
    case "custom":
    case "legacy":
      return [];
    default: {
      const _never: never = measurements;
      return _never;
    }
  }
}

function edgesFor(
  measurements: PropMeasurements,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  switch (measurements.shape) {
    case "roofline":
      return oneEdge("roof", "Along the roof", measurements.length, unit, pitchMm);
    case "window":
      return boxEdges(measurements.width, measurements.height, unit, pitchMm);
    case "arch":
      return archEdges(measurements.width, measurements.height, unit, pitchMm);
    case "tree":
      return treeEdges(measurements.height, measurements.base, unit, pitchMm);
    case "stake-row":
      return stakeEdges(measurements.stakes, measurements.height, unit, pitchMm);
    case "wireframe":
      return wellHouseEdges(measurements.sides, measurements.side, measurements.height, unit, pitchMm);
    case "custom":
      return { ok: false, message: "Custom draw is not ready yet. Pick a template shape." };
    case "legacy":
      return { ok: false, message: "That shape is only for props saved before designing without a controller." };
    default: {
      const _never: never = measurements;
      return _never;
    }
  }
}

function oneEdge(
  id: string,
  label: string,
  length: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const mm = lengthToMm(length, unit);
  if (mm === null) return { ok: false, message: "Enter a length greater than zero." };
  return { ok: true, edges: [edge(id, label, mm, lightsAlong(mm, pitchMm))] };
}

function boxEdges(
  width: number,
  height: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const widthMm = lengthToMm(width, unit);
  const heightMm = lengthToMm(height, unit);
  if (widthMm === null || heightMm === null) return { ok: false, message: "Enter a width and a height greater than zero." };
  return {
    ok: true,
    edges: [
      edge("top", "Top", widthMm, lightsAlong(widthMm, pitchMm)),
      edge("right", "Right", heightMm, lightsAlong(heightMm, pitchMm)),
      edge("bottom", "Bottom", widthMm, lightsAlong(widthMm, pitchMm)),
      edge("left", "Left", heightMm, lightsAlong(heightMm, pitchMm)),
    ],
  };
}

function archEdges(
  width: number,
  height: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const widthMm = lengthToMm(width, unit);
  const heightMm = lengthToMm(height, unit);
  if (widthMm === null || heightMm === null) return { ok: false, message: "Enter a width and a height greater than zero." };
  const halfMm = archLengthMm(widthMm, heightMm) / 2;
  const each = lightsAlong(halfMm, pitchMm);
  return {
    ok: true,
    edges: [
      edge("arch-left", "Left side", halfMm, each),
      edge("arch-right", "Right side", halfMm, each),
    ],
  };
}

function treeEdges(
  height: number,
  base: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const heightMm = lengthToMm(height, unit);
  const baseMm = lengthToMm(base, unit);
  if (heightMm === null || baseMm === null) return { ok: false, message: "Enter a height and a base width greater than zero." };
  const slant = Math.hypot(baseMm / 2, heightMm);
  const count = lightsAlong(slant, pitchMm);
  return {
    ok: true,
    edges: [
      edge("tree-left", "Left side", slant, count),
      edge("tree-right", "Right side", slant, count),
    ],
  };
}

function stakeEdges(
  stakes: number,
  height: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const heightMm = lengthToMm(height, unit);
  if (!Number.isInteger(stakes) || stakes < 1 || stakes > 64) {
    return { ok: false, message: "A stake row needs between 1 and 64 stakes." };
  }
  if (heightMm === null) return { ok: false, message: "Enter a stake height greater than zero." };
  const count = lightsAlong(heightMm, pitchMm);
  return {
    ok: true,
    edges: Array.from({ length: stakes }, (_, index) =>
      edge(`stake-${index + 1}`, `Stake ${index + 1}`, heightMm, count),
    ),
  };
}

function wellHouseEdges(
  sides: number,
  side: number,
  height: number,
  unit: PropLengthUnit,
  pitchMm: number,
): { ok: true; edges: PropEdge[] } | { ok: false; message: string } {
  const sideMm = lengthToMm(side, unit);
  const heightMm = lengthToMm(height, unit);
  if (!Number.isInteger(sides) || sides < 3 || sides > 16) {
    return { ok: false, message: "A well house needs between 3 and 16 sides." };
  }
  if (sideMm === null || heightMm === null) return { ok: false, message: "Enter a side length and a height greater than zero." };
  const diagMm = Math.hypot(sideMm, heightMm);
  const edges: PropEdge[] = [];
  for (const id of wellHouseEdgeOrder(sides)) {
    const role = id.split(".")[0] ?? "";
    const lengthMm = role === "left" || role === "right" ? heightMm : role === "diag" ? diagMm : sideMm;
    edges.push(edge(id, wellHouseEdgeLabel(id) ?? id, lengthMm, lightsAlong(lengthMm, pitchMm)));
  }
  return { ok: true, edges };
}

function edge(id: string, label: string, lengthMm: number, ledCount: number): PropEdge {
  return { id, label, lengthMm, ledCount };
}

/** Circular arch through the two bases and the crown. A flat rise is just the width. */
export function archLengthMm(widthMm: number, heightMm: number): number {
  if (!(widthMm > 0)) return 0;
  if (!(heightMm > 0)) return widthMm;
  const half = widthMm / 2;
  const radius = (heightMm * heightMm + half * half) / (2 * heightMm);
  const theta = 2 * Math.asin(Math.min(1, half / radius));
  return radius * theta;
}

export function designFromLegacy(
  prop: Pick<Prop, "elementIds" | "wireframe">,
  elements: readonly Element[],
): PropDesign {
  const owned = elements.filter((element) => prop.elementIds.includes(element.id));
  if (prop.elementIds.length > 0 && owned.length !== prop.elementIds.length) {
    return {
      unit: "ft",
      pitchMm: prop.wireframe?.pitchMm ?? null,
      ledProductId: null,
      measurements: { shape: "legacy" },
      ledCount: null,
      edges: [],
    };
  }
  const edges = owned.map((element) => edge(
    element.id,
    element.label,
    0,
    Math.max(0, element.stop - element.start),
  ));
  return {
    unit: "ft",
    pitchMm: prop.wireframe?.pitchMm ?? null,
    ledProductId: null,
    measurements: { shape: "legacy" },
    ledCount: edges.reduce((sum, item) => sum + item.ledCount, 0),
    edges,
  };
}

export function attachmentForLegacy(
  prop: Pick<Prop, "id" | "lightId" | "elementIds">,
  elements: readonly Element[],
  light: Pick<Light, "id" | "outputs"> | undefined,
): PropAttachment | null {
  if (!prop.lightId || !light || light.id !== prop.lightId) return null;
  const outputs = light.outputs ?? [];
  const owned = elements.filter((element) => prop.elementIds.includes(element.id));
  const start = owned.length > 0 ? Math.min(...owned.map((element) => element.start)) : 0;
  const pinned = owned.find((element) => element.outputId)?.outputId;
  const output = (pinned ? outputs.find((item) => item.id === pinned) : undefined) ??
    outputs.find((item) => start >= item.start && start < item.start + item.ledCount) ??
    outputs[0];
  if (!output) {
    return {
      propId: prop.id,
      lightId: prop.lightId,
      outputId: legacyOutputId(prop.lightId),
      startIndex: start,
      afterPropId: null,
    };
  }
  return {
    propId: prop.id,
    lightId: prop.lightId,
    outputId: output.id,
    startIndex: Math.max(0, start - output.start),
    afterPropId: null,
  };
}

/**
 * Old well-house templates stored a straight run of shared posts and two
 * diagonal passes. Those become the general path, with one section per wall.
 * Other props gain a section per lit edge when they have none. A traced path
 * is left as the operator drew it.
 */
export function migrateDesignedProp(prop: Prop): Prop {
  if (!prop.layout) {
    return prop.sections ? prop : prop;
  }
  let layout = prop.layout;
  let design = prop.design;
  let replaced = false;
  if (prop.kind === "wireframe" && isLegacyWellHouseLayout(layout)) {
    const params = design?.measurements.shape === "wireframe"
      ? { sides: design.measurements.sides, side: design.measurements.side, height: design.measurements.height }
      : layout.template?.params ?? null;
    const rebuilt = params
      ? layoutFromMeasurements({ units: layout.units, pitchM: layout.pitchM, shape: "wireframe", params })
      : null;
    if (rebuilt) {
      layout = { ...rebuilt, startOffsetM: layout.startOffsetM };
      replaced = true;
      if (design) design = designFromLayout(layout, design.ledProductId, design.measurements);
    }
  }
  if (!replaced && prop.sections) return prop;
  const sections = replaced || !prop.sections ? defaultSections(layout) : prop.sections;
  return {
    ...prop,
    layout,
    sections,
    ...(design ? { design } : {}),
  };
}

export function enrichStoredProp(
  prop: Prop,
  elements: readonly Element[],
  light: Pick<Light, "id" | "outputs"> | undefined,
): { prop: Prop; attachment: PropAttachment | null } {
  const design = prop.design ?? (prop.lightId ? designFromLegacy(prop, elements) : undefined);
  const next = migrateDesignedProp(design ? { ...prop, design } : prop);
  const attachment = next.lightId ? attachmentForLegacy(next, elements, light) : null;
  return { prop: next, attachment };
}

export type PlacementPlan =
  | { ok: true; absoluteStart: number; segments: PropSegmentDraft[]; summary: string }
  | { ok: false; message: string };

/**
 * One WLED segment per section range. A section with several ranges becomes
 * several segments that share its name and colour. Folding those into one
 * segment with a ledmap is a later slice.
 */
export function planPropPlacement(input: {
  prop: Prop;
  output: Pick<LightOutput, "id" | "index" | "start" | "ledCount">;
  lightName: string;
  place: { startIndex: number | null; afterPropId: string | null };
  props: readonly Prop[];
  attachments: readonly PropAttachment[];
  /** WLED `leds.maxseg` when the controller reported one. Unknown does not refuse. */
  maxSegments?: number | null;
  /** Ranges already saved on this controller, not counting this prop. */
  otherRangeCount?: number;
}): PlacementPlan {
  const count = input.prop.design?.ledCount;
  if (count === null || count === undefined) {
    return { ok: false, message: "This prop's light count is unknown. Nothing was planned." };
  }
  if (count < 1) return { ok: false, message: "This prop has no lights to place." };
  const resolved = resolveStartIndex({
    outputId: input.output.id,
    place: input.place,
    props: input.props,
    attachments: input.attachments,
    selfId: input.prop.id,
  });
  if (!resolved.ok) return resolved;
  if (resolved.startIndex + count > input.output.ledCount) {
    return {
      ok: false,
      message: `${input.lightName} has ${input.output.ledCount} lights on output ${input.output.index + 1}. ${input.prop.label} needs ${count}. Nothing will be sent.`,
    };
  }
  const absoluteStart = input.output.start + resolved.startIndex;
  const segments = segmentsForProp(input.prop, absoluteStart, input.output.id);
  if (segments.length === 0) return { ok: false, message: "This prop has no edges to write." };
  const others = input.otherRangeCount ?? 0;
  if (typeof input.maxSegments === "number" && others + segments.length > input.maxSegments) {
    return {
      ok: false,
      message: `${input.lightName} can hold ${input.maxSegments} ranges. ${input.prop.label} needs ${segments.length}${others > 0 ? `, and ${others} are already saved` : ""}. Nothing will be sent.`,
    };
  }
  const where = input.place.afterPropId
    ? `after ${input.props.find((row) => row.id === input.place.afterPropId)?.label ?? "the previous prop"}`
    : "from the first light";
  const extraStrings = input.prop.layout ? Math.max(0, layoutStrings(input.prop.layout).length - 1) : 0;
  const extra = extraStrings > 0
    ? ` ${extraStrings === 1 ? "Another string stays on the prop" : `${extraStrings} other strings stay on the prop`} until you attach it to an output.`
    : "";
  return {
    ok: true,
    absoluteStart,
    segments,
    summary: `${count} lights on ${input.lightName} · output ${input.output.index + 1}, ${where}.${extra}`,
  };
}

function segmentsForProp(prop: Prop, absoluteStart: number, outputId: string): PropSegmentDraft[] {
  if (prop.layout && prop.sections && prop.sections.length > 0) {
    const firstId = layoutStrings(prop.layout)[0]?.id ?? "s1";
    const reports = sectionIndexRanges(prop.layout, prop.sections);
    const fromSections: PropSegmentDraft[] = [];
    for (const report of reports) {
      for (const range of report.ranges) {
        if (range.stop <= range.start) continue;
        if ((range.stringId ?? firstId) !== firstId) continue;
        fromSections.push({
          label: `${prop.label} · ${report.name}`,
          start: absoluteStart + range.start,
          stop: absoluteStart + range.stop,
          outputId,
          ...(report.color ? { color: report.color } : {}),
        });
      }
    }
    if (fromSections.length > 0) return fromSections;
  }
  const edges = prop.design?.edges ?? [];
  const fromEdges: PropSegmentDraft[] = [];
  let cursor = absoluteStart;
  for (const item of edges) {
    if (item.ledCount < 1) continue;
    fromEdges.push({
      label: `${prop.label} · ${item.label}`,
      start: cursor,
      stop: cursor + item.ledCount,
      outputId,
    });
    cursor += item.ledCount;
  }
  return fromEdges;
}

function resolveStartIndex(input: {
  outputId: string;
  place: { startIndex: number | null; afterPropId: string | null };
  props: readonly Prop[];
  attachments: readonly PropAttachment[];
  selfId: string;
}): { ok: true; startIndex: number } | { ok: false; message: string } {
  if (input.place.afterPropId) {
    const followed = occupiedEnd({
      propId: input.place.afterPropId,
      outputId: input.outputId,
      props: input.props,
      attachments: input.attachments,
      seen: new Set([input.selfId]),
    });
    if (!followed.ok) return followed;
    return { ok: true, startIndex: followed.end };
  }
  if (input.place.startIndex === null || !Number.isInteger(input.place.startIndex) || input.place.startIndex < 0) {
    return { ok: false, message: "Choose where this prop starts on the output." };
  }
  return { ok: true, startIndex: input.place.startIndex };
}

function occupiedEnd(input: {
  propId: string;
  outputId: string;
  props: readonly Prop[];
  attachments: readonly PropAttachment[];
  seen: Set<string>;
}): { ok: true; end: number } | { ok: false; message: string } {
  if (input.seen.has(input.propId)) {
    return { ok: false, message: "Those props chain in a loop. Pick a start that does not circle back." };
  }
  input.seen.add(input.propId);
  const attachment = input.attachments.find((row) => row.propId === input.propId && row.outputId === input.outputId);
  if (!attachment) return { ok: false, message: "That prop is not on this output. Nothing was planned." };
  const count = input.props.find((row) => row.id === input.propId)?.design?.ledCount;
  if (count === null || count === undefined) {
    return { ok: false, message: "The prop you chose to follow has an unknown light count. Nothing was planned." };
  }
  const start = attachment.afterPropId
    ? occupiedEnd({ ...input, propId: attachment.afterPropId })
    : attachment.startIndex === null
      ? { ok: false as const, message: "The prop you chose to follow has no start. Nothing was planned." }
      : { ok: true as const, end: attachment.startIndex };
  if (!start.ok) return start;
  return { ok: true, end: start.end + count };
}

export function propAttachmentLabel(
  attachment: PropAttachment | null,
  lightName: string | null,
  outputIndex: number | null,
): string {
  if (!attachment || !lightName) return "Not attached";
  if (outputIndex === null) return `${lightName} · output unknown`;
  return `${lightName} · output ${outputIndex + 1}`;
}
