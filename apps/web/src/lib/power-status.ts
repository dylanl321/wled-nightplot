import type { BeadColor, LightReachability } from "@nightplot/shared";
import { brightnessPct, lastSeenLabel } from "@/lib/time";

export function lightPowerStatus(input: {
  reachability: LightReachability;
  on: boolean | null;
  brightness: number | null;
  lastSeenAt: string | null;
}): string {
  if (input.reachability === "no-answer") {
    return `No answer · ${lastSeenLabel(input.lastSeenAt)}`;
  }
  if (input.on === true) {
    const pct = brightnessPct(input.brightness);
    return `Online · on${pct !== null ? ` · ${pct}%` : ""}`;
  }
  if (input.on === false) {
    return "Online · off";
  }
  return "Online · unknown";
}

export function inspectPowerHow(input: {
  reachability: LightReachability;
  on: boolean | null;
  brightness: number | null;
}): string {
  if (input.reachability === "no-answer") {
    return "Not answering. Beads stay grey — the last colour is not shown.";
  }
  if (input.on === true) {
    const pct = brightnessPct(input.brightness);
    return `Answering. On${pct !== null ? ` at ${pct}%` : ""}.`;
  }
  if (input.on === false) {
    return "Answering. Off.";
  }
  return "Answering. Power unknown. Beads stay grey — not a last colour.";
}

/**
 * Paint beads from reported power. Missing `on` is unknown-grey even when the
 * payload still carries null (off) or a leftover colour.
 */
export function displayBead(light: {
  reachability: LightReachability;
  on: boolean | null;
  bead: BeadColor;
}): BeadColor {
  if (light.reachability === "no-answer" || light.on == null) return "unknown";
  return light.bead;
}
