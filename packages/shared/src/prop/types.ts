/**
 * A Prop is a named shape you can design before any controller is connected.
 * Attachment to a controller output is optional and stored separately.
 * Segments are generated when the prop is attached and Applied.
 */

import { isPropLayout, type PropLayout } from "./layout.ts";
import type { ShapeOverride } from "./shape.ts";
import { SPIRAL_MAX_TURNS, ZIGZAG_MAX_PASSES } from "./wraps.ts";

export const PROP_KINDS = ["roofline", "window", "arch", "tree", "stake-row", "custom", "wireframe", "spiral", "zigzag", "split-tree"] as const;
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
  /** `closed` adds a lit run along the base, so the tree is a triangle. */
  | { shape: "tree"; height: number; base: number; closed?: boolean }
  | { shape: "stake-row"; stakes: number; height: number }
  | { shape: "wireframe"; sides: number; side: number; height: number }
  /**
   * Wrapped around a post, tree, mailbox or plant. `around` is the
   * circumference at the bottom, `aroundTop` at the top (0 for a point,
   * absent for the same as the bottom), `gap` the rise from one wrap to the next.
   */
  | { shape: "spiral"; height: number; around: number; aroundTop?: number; gap: number }
  /** Folded back and forth over a bush. `passes` straight runs. */
  | { shape: "zigzag"; width: number; height: number; passes: number; direction: "vertical" | "horizontal" }
  /**
   * A trunk that forks, drawn as a street-facing elevation.
   * The main trunk stands on the ground. Branches leave it, and can fork again.
   * Lengths are in the prop's unit. `spacing` is the distance along the ground
   * between neighbouring tips. `levels` 1 is one fork; 2 lets those branches fork again.
   * Lights wrap up each trunk. Strings keep their own spacing in millimetres.
   */
  | {
      shape: "split-tree";
      /** Tips that reach the top. At least 2. */
      trunks: number;
      height: number;
      /** Height of the first fork, from the ground. */
      split: number;
      spacing: number;
      levels: 1 | 2;
      /** Around the main trunk at the ground, in the prop's unit. Branches get thinner from there. Absent on older saves. */
      around?: number;
      /** Up from one wrap to the next on the same side, in the prop's unit. Absent on older saves. */
      gap?: number;
      /** End heights, in the prop's unit, kept when that trunk id still exists. */
      trunkTo?: SplitTreeTrunkEnd[];
      /** Strings on the trunks. Absent until one is assigned. */
      strings?: SplitTreeString[];
      /**
       * The tree as placed by hand: where trunks meet and where tips end.
       * Absent on a tree that is still the even starting shape.
       */
      pose?: SplitPose;
    }
  | { shape: "custom" }
  | { shape: "legacy" };

/** How high one trunk ends, measured from the ground in the prop's unit. */
export type SplitTreeTrunkEnd = {
  id: string;
  to: number;
};

/**
 * One physical string on a split tree. Spacing and length stay metric.
 * `trunkIds` is the order the string is put up. A sibling is a back path down the far side. A hop that does not meet is a dark run.
 */
export type SplitTreeString = {
  id: string;
  ledProductId: string | null;
  /** Centre-to-centre spacing, millimetres. */
  pitchMm: number;
  /** Lights on the string. Null until the count is known. */
  ledCount: number | null;
  trunkIds: string[];
};

export const SPLIT_TREE_TRUNKS_MIN = 2;
export const SPLIT_TREE_TRUNKS_MAX = 16;

/** One joint of a split tree, in the prop's unit. `base` is on the ground. */
export type SplitPoseNode = {
  id: string;
  /** `base` for the ground joint, or the trunk whose end this is. */
  parentId: string | null;
  /** Across from the ground joint. Negative is to the left. */
  x: number;
  /** Up from the ground. */
  y: number;
};

/** Older saves only. The wrap now runs straight into the next branch, so this is read and ignored. */
export type SplitPoseMeet = {
  forkId: string;
  x: number;
  y: number;
};

/** Older saves only. A string now comes back down the back of the branch, so this is read and ignored. */
export type SplitPoseTurn = {
  stringId: string;
  fromId: string;
  toId: string;
  x: number;
  y: number;
};

/** A split tree someone has moved or forked. */
export type SplitPose = {
  nodes: SplitPoseNode[];
  /** Older saves only. Ignored. */
  meets?: SplitPoseMeet[];
  /** Older saves only. Ignored. */
  turns?: SplitPoseTurn[];
};

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
  /**
   * A person's fixes to what the shape reader guessed (a run that is really
   * border, or inside). Keyed by run and light ids, so a redraw keeps them.
   */
  shapeRoles?: ShapeOverride[];
  /**
   * Where the prop sits on the yard, in metres: the drawing's own origin
   * lands here. Absent means a default slot, so props never pile up.
   * Older points are only `x` and `y`.
   */
  yard?: PropYardPoint;
};

export const PROP_MOUNTS = ["upright", "flat"] as const;
export type PropMount = (typeof PROP_MOUNTS)[number];

/**
 * Where a prop sits, in metres. `x` runs along the front of the house.
 * `y` is up that front wall. `depth` is out from the wall, `facing` is
 * degrees about the vertical, and `mount` stands the drawing up or lays
 * it flat. A point saved before those existed is still just `x` and `y`.
 */
export type PropYardPoint = {
  x: number;
  y: number;
  /** Metres out from the front wall. Absent means 0. */
  depth?: number;
  /** Degrees about the vertical. 0 faces the street. Absent means 0. */
  facing?: number;
  /** Absent means upright. */
  mount?: PropMount;
  /** Extra metres off the ground. Absent means none. */
  heightM?: number;
};

const YARD_METRE_LIMIT = 10000;

function yardMetres(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= YARD_METRE_LIMIT;
}

export function isPropMount(value: unknown): value is PropMount {
  return value === "upright" || value === "flat";
}

export function isPropYardPoint(value: unknown): value is PropYardPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PropYardPoint>;
  if (!yardMetres(row.x) || !yardMetres(row.y)) return false;
  if (row.depth !== undefined && !yardMetres(row.depth)) return false;
  if (row.facing !== undefined && (typeof row.facing !== "number" || !Number.isFinite(row.facing) || Math.abs(row.facing) > 3600)) return false;
  if (row.mount !== undefined && !isPropMount(row.mount)) return false;
  if (row.heightM !== undefined && !yardMetres(row.heightM)) return false;
  return true;
}

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
  /** Colour stored on the prop. A Look sends it for this section unless an override names the section, the Prop, or its kind. */
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

function isSplitTreeMeasurements(row: { shape?: unknown }): boolean {
  const trunks = (row as { trunks?: unknown }).trunks;
  const levels = (row as { levels?: unknown }).levels;
  const height = (row as { height?: unknown }).height;
  const split = (row as { split?: unknown }).split;
  if (!Number.isInteger(trunks) || (trunks as number) < SPLIT_TREE_TRUNKS_MIN || (trunks as number) > SPLIT_TREE_TRUNKS_MAX) return false;
  if (levels !== 1 && levels !== 2) return false;
  if (!isPositive(height) || !isPositive(split) || !isPositive((row as { spacing?: unknown }).spacing)) return false;
  if ((split as number) >= (height as number)) return false;
  const around = (row as { around?: unknown }).around;
  const gap = (row as { gap?: unknown }).gap;
  if (around !== undefined && (!isPositive(around) || (around as number) > 100)) return false;
  if (gap !== undefined && (!isPositive(gap) || (gap as number) > 100)) return false;
  const ends = (row as { trunkTo?: unknown }).trunkTo;
  if (ends !== undefined && (!Array.isArray(ends) || ends.length > 32 || !ends.every(isSplitTreeTrunkEnd))) return false;
  const strings = (row as { strings?: unknown }).strings;
  if (strings !== undefined && (!Array.isArray(strings) || strings.length > 24 || !strings.every(isSplitTreeString))) return false;
  if (Array.isArray(strings)) {
    const ids = strings.map((item) => (item as SplitTreeString).id);
    if (new Set(ids).size !== ids.length) return false;
  }
  const pose = (row as { pose?: unknown }).pose;
  if (pose !== undefined && !isSplitPose(pose)) return false;
  return true;
}

function isSplitTreeTrunkEnd(value: unknown): value is SplitTreeTrunkEnd {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitTreeTrunkEnd>;
  return typeof row.id === "string" && row.id.length > 0 && row.id.length <= 32 && isPositive(row.to) && row.to < 10000;
}

function isSplitTreeString(value: unknown): value is SplitTreeString {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitTreeString>;
  if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 32) return false;
  if (row.ledProductId !== null && (typeof row.ledProductId !== "string" || row.ledProductId.length === 0 || row.ledProductId.length > 80)) return false;
  if (typeof row.pitchMm !== "number" || !(row.pitchMm > 0) || row.pitchMm > 10_000 || !Number.isFinite(row.pitchMm)) return false;
  if (row.ledCount !== null && (!Number.isInteger(row.ledCount) || (row.ledCount ?? -1) < 0 || (row.ledCount ?? 0) > 100_000)) return false;
  if (!Array.isArray(row.trunkIds) || row.trunkIds.length < 1 || row.trunkIds.length > 16) return false;
  return row.trunkIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 32);
}

const SPLIT_NODE_ID = /^(?:base|t0(?:\.\d+){0,6})$/;

function isSplitCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 10000;
}

function isSplitPose(value: unknown): value is SplitPose {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitPose>;
  if (!Array.isArray(row.nodes) || row.nodes.length < 3 || row.nodes.length > 48) return false;
  if (!row.nodes.every(isSplitPoseNode)) return false;
  const ids = row.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) return false;
  const have = new Set(ids);
  const base = row.nodes.find((node) => node.id === "base");
  const root = row.nodes.find((node) => node.id === "t0");
  if (!base || base.parentId !== null || !root || root.parentId !== "base") return false;
  for (const node of row.nodes) {
    if (node.id === "base") continue;
    if (!node.parentId || !have.has(node.parentId)) return false;
  }
  const tips = row.nodes.filter((node) => node.id !== "base" && !row.nodes!.some((other) => other.parentId === node.id));
  if (tips.length < SPLIT_TREE_TRUNKS_MIN || tips.length > SPLIT_TREE_TRUNKS_MAX) return false;
  if (row.meets !== undefined && (!Array.isArray(row.meets) || row.meets.length > 24 || !row.meets.every((meet) => isSplitPoseMeet(meet, have)))) return false;
  if (row.turns !== undefined && (!Array.isArray(row.turns) || row.turns.length > 24 || !row.turns.every((turn) => isSplitPoseTurn(turn, have)))) return false;
  return true;
}

function isSplitPoseNode(value: unknown): value is SplitPoseNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitPoseNode>;
  if (typeof row.id !== "string" || !SPLIT_NODE_ID.test(row.id)) return false;
  if (row.parentId !== null && (typeof row.parentId !== "string" || !SPLIT_NODE_ID.test(row.parentId))) return false;
  return isSplitCoord(row.x) && isSplitCoord(row.y);
}

function isSplitPoseMeet(value: unknown, ids: Set<string>): value is SplitPoseMeet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitPoseMeet>;
  return typeof row.forkId === "string" && ids.has(row.forkId) && isSplitCoord(row.x) && isSplitCoord(row.y);
}

function isSplitPoseTurn(value: unknown, ids: Set<string>): value is SplitPoseTurn {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<SplitPoseTurn>;
  return typeof row.stringId === "string" && row.stringId.length > 0 && row.stringId.length <= 32 &&
    typeof row.fromId === "string" && ids.has(row.fromId) &&
    typeof row.toId === "string" && ids.has(row.toId) &&
    isSplitCoord(row.x) && isSplitCoord(row.y);
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
    case "spiral": {
      const top = (row as { aroundTop?: unknown }).aroundTop;
      const topOk = top === undefined || (typeof top === "number" && Number.isFinite(top) && top >= 0);
      const height = (row as { height?: unknown }).height;
      const gap = (row as { gap?: unknown }).gap;
      return isPositive(height) && isPositive((row as { around?: unknown }).around) && isPositive(gap) && topOk &&
        height / gap >= 0.5 && height / gap <= SPIRAL_MAX_TURNS;
    }
    case "zigzag": {
      const passes = (row as { passes?: unknown }).passes;
      const direction = (row as { direction?: unknown }).direction;
      return isPositive((row as { width?: unknown }).width) && isPositive((row as { height?: unknown }).height) &&
        Number.isInteger(passes) && (passes as number) >= 1 && (passes as number) <= ZIGZAG_MAX_PASSES &&
        (direction === "vertical" || direction === "horizontal");
    }
    case "split-tree":
      return isSplitTreeMeasurements(row);
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
  if (row.yard !== undefined && !isPropYardPoint(row.yard)) return false;
  if (row.shapeRoles !== undefined && !isShapeOverrideList(row.shapeRoles)) return false;
  if (row.kind === "wireframe" || row.wireframe !== undefined) return isWireframeSpec(row.wireframe);
  return true;
}

const SHAPE_ROLE_MAX = 512;

export function isShapeOverrideList(value: unknown): value is ShapeOverride[] {
  if (!Array.isArray(value) || value.length > SHAPE_ROLE_MAX) return false;
  return value.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const item = row as Record<string, unknown>;
    if (item.role !== "border" && item.role !== "inside") return false;
    const keys = Object.keys(item).filter((key) => key !== "role");
    if (keys.length !== 1) return false;
    const id = item[keys[0]!];
    return (keys[0] === "edgeId" || keys[0] === "lightId") && typeof id === "string" && id.length > 0 && id.length <= 64;
  });
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
