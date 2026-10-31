/**
 * A Prop is a named, typed shape on one Light. It is made of one or more
 * Segments on any output. Gaps between those Segments are allowed.
 */

export const PROP_KINDS = ["roofline", "window", "arch", "tree", "stake-row", "custom"] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export type Prop = {
  id: string;
  lightId: string;
  label: string;
  kind: PropKind;
  /** Ordered Segment ids that make this Prop. */
  elementIds: string[];
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

export function isProp(value: unknown): value is Prop {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Prop>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.lightId === "string" &&
    row.lightId.length > 0 &&
    typeof row.label === "string" &&
    isPropKind(row.kind) &&
    Array.isArray(row.elementIds) &&
    row.elementIds.length > 0 &&
    row.elementIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(row.elementIds).size === row.elementIds.length
  );
}
