/**
 * A Prop is a named shape you can design before any controller is connected.
 * Attachment to a controller output is optional and stored separately.
 * Segments are generated when the prop is attached and Applied.
 */

import { isPropLayout, type PropLayout } from "./layout.ts";

export const PROP_KINDS = ["roofline", "window", "arch", "tree", "stake-row", "custom", "wireframe"] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const SHARED_POST_RULES = ["half", "left", "right", "own"] as const;
export type SharedPostRule = (typeof SHARED_POST_RULES)[number];

export const HIDDEN_REASONS = ["wire", "corner", "dead", "cut"] as const;
export type HiddenReason = (typeof HIDDEN_REASONS)[number];

export const WIREFRAME_GROUPS = ["outline", "tops", "bottoms", "posts", "diagonals"] as const;
export type WireframeGroupId = (typeof WIREFRAME_GROUPS)[number] | `face.${number}`;

export type WireframeLock = {
  /** Template role, e.g. `top.0.end`. Identity across re-draws. */
  role: string;
  physicalIndex: number;
};

export type WireframeHiddenSpan = {
  afterRole: string;
  count: number;
  reason: HiddenReason;
};

export type WireframePathPoint = {
  x: number;
  y: number;
  edgeId?: string;
};

export type WireframePath = {
  points: WireframePathPoint[];
  /** Role edges in pixel order. Empty uses the template wiring order. */
  edgeIds: string[];
};

export type WireframeSpec = {
  template: "polygon-prism-box-x";
  sides: number;
  pitchMm: number;
  path: WireframePath | null;
  locks: WireframeLock[];
  hidden: WireframeHiddenSpan[];
  sharedPostRule: SharedPostRule;
};

export const PROP_LENGTH_UNITS = ["ft", "m"] as const;
export type PropLengthUnit = (typeof PROP_LENGTH_UNITS)[number];

/** Numbers are in the prop's unit (feet or metres), not millimetres. */
export type PropMeasurements =
  | { shape: "roofline"; length: number }
  | { shape: "window"; width: number; height: number }
  | { shape: "arch"; width: number; height: number }
  | { shape: "tree"; height: number; base: number }
  | { shape: "stake-row"; stakes: number; height: number }
  | { shape: "wireframe"; sides: number; side: number; height: number }
  | { shape: "custom" }
  | { shape: "legacy" };

export type PropEdge = {
  id: string;
  label: string;
  /** 0 when the length was never measured (a migrated tap-built prop). */
  lengthMm: number;
  ledCount: number;
};

export type PropDesign = {
  unit: PropLengthUnit;
  /** Null when a migrated prop has no known spacing. Not a silent 10 cm. */
  pitchMm: number | null;
  ledProductId: string | null;
  measurements: PropMeasurements;
  /** Null only when a migrated prop's ranges are missing. Not the same as zero. */
  ledCount: number | null;
  edges: PropEdge[];
};

/**
 * Where a designed prop sits on a controller. Absent means not attached.
 * `startIndex` is the first light on that output, or null when this prop
 * starts after another prop on the same output.
 */
export type PropAttachment = {
  propId: string;
  lightId: string;
  outputId: string;
  startIndex: number | null;
  afterPropId: string | null;
};

export type Prop = {
  id: string;
  /**
   * Set while attached, including props saved before attachments existed.
   * Omitted on a design that is not attached.
   */
  lightId?: string;
  label: string;
  kind: PropKind;
  /** Generated range ids. Empty until attach/Apply. */
  elementIds: string[];
  /** Guess-then-lock wireframe. Required when kind is wireframe. */
  wireframe?: WireframeSpec;
  /** Present on props designed from measurements, and filled in for older rows on read. */
  design?: PropDesign;
  /** Corners and wiring order. Light counts are derived from this, not stored on it. */
  layout?: PropLayout;
  /**
   * Named groups of path edges. Index ranges are derived from the layout.
   * Pinned ranges are typed by hand and stay put when the path changes.
   */
  sections?: PropSection[];
};

/** Inclusive start, exclusive stop, in path-index order (the first light of the path is 0). */
export type PropIndexRange = {
  start: number;
  stop: number;
  /** Which string these lights belong to. Absent means the first string. */
  stringId?: string;
};

export type PropSection = {
  id: string;
  name: string;
  /** Edge ids on any string. Ranges move when those edges' light counts change. */
  edgeIds: string[];
  pinnedRanges: PropIndexRange[];
  /** Preview colour stored on the prop. Looks do not read this yet. */
  color?: string;
};

export type PropTap = {
  /** Inclusive zero-based LED index on the controller’s combined strip. */
  index: number;
};

export type PropSegmentDraft = {
  label: string;
  start: number;
  stop: number;
  outputId?: string;
  /** Section colour. Absent on older plans that used the palette. */
  color?: string;
};

export function isPropKind(value: unknown): value is PropKind {
  return typeof value === "string" && (PROP_KINDS as readonly string[]).includes(value);
}

export function isSharedPostRule(value: unknown): value is SharedPostRule {
  return typeof value === "string" && (SHARED_POST_RULES as readonly string[]).includes(value);
}

export function isHiddenReason(value: unknown): value is HiddenReason {
  return typeof value === "string" && (HIDDEN_REASONS as readonly string[]).includes(value);
}

export function isWireframeSpec(value: unknown): value is WireframeSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<WireframeSpec>;
  if (row.template !== "polygon-prism-box-x") return false;
  if (!Number.isInteger(row.sides) || (row.sides ?? 0) < 3 || (row.sides ?? 0) > 16) return false;
  if (typeof row.pitchMm !== "number" || !Number.isFinite(row.pitchMm) || row.pitchMm <= 0) return false;
  if (!isSharedPostRule(row.sharedPostRule)) return false;
  if (row.path !== null && row.path !== undefined && !isWireframePath(row.path)) return false;
  if (!Array.isArray(row.locks) || !row.locks.every(isWireframeLock)) return false;
  if (!Array.isArray(row.hidden) || !row.hidden.every(isWireframeHiddenSpan)) return false;
  return true;
}

function isWireframePath(value: unknown): value is WireframePath {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<WireframePath>;
  if (!Array.isArray(row.points) || !Array.isArray(row.edgeIds)) return false;
  if (!row.edgeIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  return row.points.every((point) => {
    if (!point || typeof point !== "object") return false;
    const rowPoint = point as Partial<WireframePathPoint>;
    if (typeof rowPoint.x !== "number" || !Number.isFinite(rowPoint.x)) return false;
    if (typeof rowPoint.y !== "number" || !Number.isFinite(rowPoint.y)) return false;
    if (rowPoint.edgeId !== undefined && (typeof rowPoint.edgeId !== "string" || !rowPoint.edgeId)) return false;
    return true;
  });
}

function isWireframeLock(value: unknown): value is WireframeLock {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WireframeLock>;
  return typeof row.role === "string" && row.role.length > 0 && Number.isInteger(row.physicalIndex) && (row.physicalIndex ?? -1) >= 0;
}

function isWireframeHiddenSpan(value: unknown): value is WireframeHiddenSpan {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WireframeHiddenSpan>;
  return (
    typeof row.afterRole === "string" &&
    row.afterRole.length > 0 &&
    Number.isInteger(row.count) &&
    (row.count ?? 0) > 0 &&
    isHiddenReason(row.reason)
  );
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPropMeasurements(value: unknown): value is PropMeasurements {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { shape?: unknown };
  switch (row.shape) {
    case "roofline":
      return isPositive((row as { length?: unknown }).length);
    case "window":
    case "arch":
      return isPositive((row as { width?: unknown }).width) && isPositive((row as { height?: unknown }).height);
    case "tree":
      return isPositive((row as { height?: unknown }).height) && isPositive((row as { base?: unknown }).base);
    case "stake-row": {
      const stakes = (row as { stakes?: unknown }).stakes;
      return Number.isInteger(stakes) && (stakes as number) >= 1 && (stakes as number) <= 64 &&
        isPositive((row as { height?: unknown }).height);
    }
    case "wireframe": {
      const sides = (row as { sides?: unknown }).sides;
      return Number.isInteger(sides) && (sides as number) >= 3 && (sides as number) <= 16 &&
        isPositive((row as { side?: unknown }).side) && isPositive((row as { height?: unknown }).height);
    }
    case "custom":
    case "legacy":
      return true;
    default:
      return false;
  }
}

function isPropEdge(value: unknown): value is PropEdge {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PropEdge>;
  return typeof row.id === "string" && row.id.length > 0 &&
    typeof row.label === "string" && row.label.length > 0 &&
    typeof row.lengthMm === "number" && Number.isFinite(row.lengthMm) && row.lengthMm >= 0 &&
    Number.isInteger(row.ledCount) && (row.ledCount ?? -1) >= 0;
}

export function isPropDesign(value: unknown): value is PropDesign {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropDesign>;
  const pitchOk = row.pitchMm === null || (typeof row.pitchMm === "number" && Number.isFinite(row.pitchMm) && row.pitchMm > 0);
  const countOk = row.ledCount === null || (Number.isInteger(row.ledCount) && (row.ledCount ?? -1) >= 0);
  return (row.unit === "ft" || row.unit === "m") &&
    pitchOk &&
    (row.ledProductId === null || (typeof row.ledProductId === "string" && row.ledProductId.length > 0)) &&
    isPropMeasurements(row.measurements) &&
    countOk &&
    Array.isArray(row.edges) &&
    row.edges.every(isPropEdge);
}

export function isPropAttachment(value: unknown): value is PropAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropAttachment>;
  const indexOk = row.startIndex === null || (Number.isInteger(row.startIndex) && (row.startIndex ?? -1) >= 0);
  const afterOk = row.afterPropId === null || (typeof row.afterPropId === "string" && row.afterPropId.length > 0);
  if (!indexOk || !afterOk) return false;
  if ((row.startIndex === null) === (row.afterPropId === null)) return false;
  return typeof row.propId === "string" && row.propId.length > 0 &&
    typeof row.lightId === "string" && row.lightId.length > 0 &&
    typeof row.outputId === "string" && row.outputId.length > 0;
}

export function isProp(value: unknown): value is Prop {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Prop>;
  const elementIds = row.elementIds;
  const idsOk = Array.isArray(elementIds) &&
    elementIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(elementIds).size === elementIds.length;
  const lightOk = row.lightId === undefined || (typeof row.lightId === "string" && row.lightId.length > 0);
  const base = typeof row.id === "string" && row.id.length > 0 &&
    typeof row.label === "string" && row.label.length > 0 &&
    isPropKind(row.kind) && idsOk && lightOk;
  if (!base) return false;
  const designed = row.design !== undefined;
  const legacy = typeof row.lightId === "string" && elementIds !== undefined && elementIds.length > 0;
  if (!designed && !legacy) return false;
  if (designed && !isPropDesign(row.design)) return false;
  if (row.layout !== undefined && !isPropLayout(row.layout)) return false;
  if (row.sections !== undefined && !isPropSectionList(row.sections)) return false;
  if (row.kind === "wireframe" || row.wireframe !== undefined) return isWireframeSpec(row.wireframe);
  return true;
}

export function isPropIndexRange(value: unknown): value is PropIndexRange {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropIndexRange>;
  if (row.stringId !== undefined && (typeof row.stringId !== "string" || row.stringId.length === 0)) return false;
  return Number.isInteger(row.start) && Number.isInteger(row.stop) &&
    (row.start ?? -1) >= 0 && (row.stop ?? 0) > (row.start ?? 0);
}

export function isPropSection(value: unknown): value is PropSection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropSection>;
  if (typeof row.id !== "string" || !row.id) return false;
  if (typeof row.name !== "string" || !row.name.trim()) return false;
  if (!Array.isArray(row.edgeIds) || !row.edgeIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (!Array.isArray(row.pinnedRanges) || !row.pinnedRanges.every(isPropIndexRange)) return false;
  if (row.color !== undefined && (typeof row.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(row.color))) return false;
  return true;
}

function isPropSectionList(value: unknown): value is PropSection[] {
  return Array.isArray(value) && value.every(isPropSection) &&
    new Set(value.map((section) => section.id)).size === value.length;
}
