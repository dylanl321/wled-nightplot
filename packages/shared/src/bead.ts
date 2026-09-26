/**
 * Bead honesty: a colour is only shown when we have a current report.
 * `null` is off. `"unknown"` is unreachable — grey, never the last colour.
 */
export type BeadColor = string | null | "unknown";

export function isUnknownBead(color: BeadColor): boolean {
  return color === "unknown";
}

export function isLitBead(color: BeadColor): color is string {
  return typeof color === "string" && color !== "unknown";
}
