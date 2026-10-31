/**
 * A Prop is a named, typed shape on one Light. It is made of one or more
 * Segments on any output. Gaps between those Segments are allowed.
 */

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

export type Prop = {
  id: string;
  lightId: string;
  label: string;
  kind: PropKind;
  /** Ordered Segment ids that make this Prop. */
  elementIds: string[];
  /** Guess-then-lock wireframe. Required when kind is wireframe. */
  wireframe?: WireframeSpec;
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

export function isProp(value: unknown): value is Prop {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Prop>;
  const base =
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.lightId === "string" &&
    row.lightId.length > 0 &&
    typeof row.label === "string" &&
    isPropKind(row.kind) &&
    Array.isArray(row.elementIds) &&
    row.elementIds.length > 0 &&
    row.elementIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(row.elementIds).size === row.elementIds.length;
  if (!base) return false;
  if (row.kind === "wireframe") return isWireframeSpec(row.wireframe);
  if (row.wireframe !== undefined) return isWireframeSpec(row.wireframe);
  return true;
}
