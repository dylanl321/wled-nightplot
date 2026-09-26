export type LightReachability = "online" | "no-answer";

/**
 * A Light is one enrolled controller + one strip.
 * R0 does not persist Lights. This type is the seam for enrollment (R1+).
 */
export type Light = {
  id: string;
  name: string;
  controllerKind: string;
  stripKind: string;
  host: string;
  ledCount: number;
  reachability: LightReachability;
  lastSeenAt: string | null;
  /** `null` when we cannot honestly say. */
  on: boolean | null;
};

/**
 * An Element is a contiguous inclusive–exclusive range on a Light’s strip.
 */
export type Element = {
  id: string;
  lightId: string;
  label: string;
  start: number;
  stop: number;
};

export const emptyLightsPayload = {
  lights: [] as Light[],
  elements: [] as Element[],
  note: "No Lights are enrolled. Discover is not wired.",
};

export type LightsPayload = typeof emptyLightsPayload;
