import type { BeadColor } from "./bead.ts";
import type { RangeDisplay, ReportedRail } from "./drift.ts";
import type { LiveSession } from "./live.ts";

export type LightReachability = "online" | "no-answer";

/**
 * A Light is one enrolled controller + one strip.
 */
export type Light = {
  id: string;
  name: string;
  controllerKind: string;
  stripKind: string;
  hostname: string;
  port: number;
  hostKey: string;
  mac: string | null;
  firmware: string | null;
  ledCount: number;
  rgbw: boolean;
  reachability: LightReachability;
  lastSeenAt: string | null;
  on: boolean | null;
  brightness: number | null;
  enrolledAt: string;
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

/** Live view: bead colour comes from the current snapshot, never a stored last colour. */
export type LightView = Light & {
  bead: BeadColor;
  displayHost: string;
  elementCount: number;
  driftLabel: string | null;
};

export type LightDetail = {
  light: LightView;
  elements: Element[];
  reported: ReportedRail[];
  display: RangeDisplay;
  snapshotAt: string | null;
  session: LiveSession | null;
  liveLeds: (string | null)[] | null;
  liveCaption: string | null;
};

export const emptyLightsPayload = {
  lights: [] as LightView[],
  elements: [] as Element[],
  unenrolled: [] as import("./discovery/types.ts").DiscoverRow[],
  note: "No Lights are enrolled.",
};

export type LightsPayload = {
  lights: LightView[];
  elements: Element[];
  unenrolled: import("./discovery/types.ts").DiscoverRow[];
  note?: string;
  sessions?: { lightId: string; kind: import("./live.ts").LiveSessionKind; label: string }[];
};
