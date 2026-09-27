import type { ApplyResult } from "./apply.ts";
import type { BeadColor } from "./bead.ts";
import type { RangeDisplay, ReportedRail } from "./drift.ts";
import type { LiveMatch, LiveSession } from "./live.ts";
import type { AllOffResult, DeleteCheck } from "./manage.ts";
import type { SafeRead, SafeWriteResult } from "./safe.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export type LightReachability = "online" | "no-answer";

/** Where the enrolled display name last came from. */
export type LightNameSource = "info" | "cfg";

/**
 * A Light is one enrolled controller + one strip.
 */
export type Light = {
  id: string;
  name: string;
  /**
   * `cfg` after a successful Safe settings rename while `/json/info` still lags.
   * Cleared back to `info` when the snapshot name catches up or moves.
   */
  nameSource?: LightNameSource;
  /** `/json/info` name we last saw while preferring a cfg name. */
  staleInfoName?: string | null;
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
  lastSnapshot?: WledSnapshot | null;
  lastSnapshotAt?: string | null;
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
  segmentCount: number | null;
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
  /** Preview / Blink match counts. Never overwrite `reported` rails with this. */
  liveMatch?: LiveMatch | null;
  apply?: ApplyResult | null;
  deleteChecks?: DeleteCheck[] | null;
  safe?: SafeRead | null;
  safeWrite?: SafeWriteResult | null;
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
  allOff?: AllOffResult | null;
};
