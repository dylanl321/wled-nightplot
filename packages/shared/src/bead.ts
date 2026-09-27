/**
 * Bead honesty: a colour is only shown when we have a current report.
 * `null` is known off. `"unknown"` is the same class as last-seen: grey,
 * never a last colour. That includes unreachable and missing `on` after an
 * info-only snapshot (skipped or hung `/json/state`).
 */
export type BeadColor = string | null | "unknown";

export function isUnknownBead(color: BeadColor): boolean {
  return color === "unknown";
}

export function isLitBead(color: BeadColor): color is string {
  return typeof color === "string" && color !== "unknown";
}

/**
 * Map reported power to a bead. Known off is `null`. Missing `on` is
 * `"unknown"` — not null-as-off.
 */
export function beadForReportedOn(
  on: boolean | null | undefined,
  segmentColor: string | null,
): BeadColor {
  if (on === true) return segmentColor;
  if (on === false) return null;
  return "unknown";
}
