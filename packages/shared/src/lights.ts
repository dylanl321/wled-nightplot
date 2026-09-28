import type { ApplyResult } from "./apply.ts";
import type { BeadColor } from "./bead.ts";
import type { RangeDisplay, ReportedRail } from "./drift.ts";
import type { LiveMatch, LiveSession } from "./live.ts";
import type { AllOffResult, DeleteCheck } from "./manage.ts";
import type { ProvisionRead, ProvisionWriteResult } from "./provision.ts";
import type { SafeRead, SafeWriteResult } from "./safe.ts";
import type { StripBead } from "./strip/types.ts";
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
  /** Last `/json/info` `leds.rgbw`. Inspect chrome uses `stripBead` / `stripChip`. */
  rgbw: boolean;
  reachability: LightReachability;
  lastSeenAt: string | null;
  on: boolean | null;
  brightness: number | null;
  enrolledAt: string;
  /**
   * Nightplot LED product catalog id, or null for manual Strip fields.
   * Bookkeeping only — not a WLED write, not Hardware Done.
   */
  ledProductId: string | null;
  lastSnapshot?: WledSnapshot | null;
  lastSnapshotAt?: string | null;
};

/** Missing or blank store values are manual fields. */
export function normalizeLightLedProductId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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
  /** rgb vs rgbw from attached product, else persisted strip driver. Not snapshot `rgbw`. */
  stripBead: StripBead;
  /** Driver chip caption (e.g. SK6812 RGBW). Not a hardcoded WS281x RGBW label. */
  stripChip: string;
  /**
   * Millimetres per node from the attached product.
   * Pitch for discrete and diffused; section length for COB.
   * Null when that recipe has no spacing — pages then show node count only.
   */
  spacingMm: number | null;
  /** Which catalog field `spacingMm` came from. */
  spacingKind: "pitch" | "section" | null;
  displayHost: string;
  elementCount: number;
  /** Null when `state.seg` is unknown. 0 is a known empty list. */
  segmentCount: number | null;
  driftLabel: string | null;
  /**
   * Declared Elements from the list’s existing range display.
   * `differs` is that compare — the list does not re-probe or read cfg.
   */
  declared: {
    id: string;
    label: string;
    start: number;
    stop: number;
    differs: boolean;
  }[];
};

export type LightDetail = {
  /** Frozen controller pixels without a live session that can restore them. */
  frozenPreview?: boolean;
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
  provision?: ProvisionRead | null;
  provisionWrite?: ProvisionWriteResult | null;
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
