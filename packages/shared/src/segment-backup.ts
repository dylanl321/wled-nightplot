import { validateDeclaredRanges, type DraftRange } from "./range.ts";

export type SegmentBackup = {
  kind: "nightplot-segments";
  version: 1;
  exportedAt: string;
  source: { lightId: string; lightName: string; mac: string | null; ledCount: number };
  segments: { label: string; start: number; stop: number }[];
};

export function parseSegmentBackup(value: unknown): SegmentBackup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SegmentBackup>;
  const source = row.source;
  if (row.kind !== "nightplot-segments" || row.version !== 1 ||
    typeof row.exportedAt !== "string" || !Number.isFinite(Date.parse(row.exportedAt)) ||
    !source || typeof source.lightId !== "string" || !source.lightId ||
    typeof source.lightName !== "string" ||
    !(source.mac === null || typeof source.mac === "string") ||
    !Number.isInteger(source.ledCount) || source.ledCount < 1 ||
    !Array.isArray(row.segments) || row.segments.length > 512) return null;
  const segments: DraftRange[] = [];
  for (const segment of row.segments) {
    if (!segment || typeof segment !== "object" ||
      typeof segment.label !== "string" || !segment.label.trim() ||
      typeof segment.start !== "number" || typeof segment.stop !== "number") return null;
    segments.push({ label: segment.label, start: segment.start, stop: segment.stop });
  }
  if (validateDeclaredRanges(segments, source.ledCount).length) return null;
  return row as SegmentBackup;
}

export function backupNeedsControllerConfirmation(
  backup: SegmentBackup,
  target: { id: string; mac: string | null },
): boolean {
  if (backup.source.mac && target.mac) {
    return backup.source.mac.toLowerCase() !== target.mac.toLowerCase();
  }
  // If identity is unknown, only the same enrolled Light may restore without confirmation.
  return backup.source.lightId !== target.id;
}
