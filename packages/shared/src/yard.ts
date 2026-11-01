/**
 * Yard check: reread every enrolled Light and compare it to Nightplot’s
 * expected outputs, last-pushed Looks / Schedule / sync, and live power.
 *
 * Unknown is not empty. A missing reread is not a match. A Light that was
 * never pushed is not “in sync”. Fixture / sim green is not Hardware Done.
 */

import { migrateLightOutputs } from "./outputs.ts";
import {
  buildManagedPresets,
  lookPushDigest,
  lookTargets,
  managedLookSlots,
  managedPresetSlotsMatch,
  type LastLookPush,
  type Look,
  type LookPlaylist,
} from "./look.ts";
import type { Element, Light } from "./lights.ts";
import type { Prop } from "./prop/types.ts";
import { compileWireframe, ledmapsMatch, parseLedmapJson } from "./prop/wireframe.ts";
import type { ProvisionRead } from "./provision.ts";
import {
  buildScheduleWrite,
  runPresetSlot,
  scheduleMatches,
  wledTimerDialect,
  type NightlySchedule,
} from "./schedule.ts";
import { parseWledUdpSync, udpSyncRole, type UdpSyncRole } from "./udp-sync.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export const YARD_CAPTION =
  "Each Light is listed by what it reported just now. Unreachable stays grey with last-seen. Unknown is not a match. Fix writes Looks, the nightly Schedule, and last-pushed sync, then rereads. A wireframe Prop also compares the ledmap. Sweep turns on the first Look. Not Hardware Done.";

export const YARD_SWEEP_CAPTION =
  "Sweep turns on the first Look on every reachable Light so you can walk the yard. It is not Apply and not Hardware Done.";

export type YardCompareStatus = "match" | "mismatch" | "unknown" | "not-pushed";

export type YardCompare = {
  status: YardCompareStatus;
  detail: string;
};

export type YardLitStatus = "lit" | "off" | "unknown";

export type YardPropRow = {
  id: string;
  label: string;
  kind: string;
};

export type YardCheckRow = {
  lightId: string;
  name: string;
  hostname: string;
  port: number;
  hostKey: string;
  mac: string | null;
  reachability: Light["reachability"];
  lastSeenAt: string | null;
  firmware: YardCompare & { enrolled: string | null; live: string | null };
  outputs: YardCompare & {
    expectedCount: number;
    liveCount: number | null;
    expectedLeds: number;
    liveLeds: number | null;
  };
  looks: YardCompare & { libraryChanged: boolean };
  schedule: YardCompare;
  sync: YardCompare;
  ledmap: YardCompare;
  lit: { status: YardLitStatus; detail: string; on: boolean | null; preset: number | null };
  props: YardPropRow[];
  canFix: boolean;
  canBlink: boolean;
  lastLookPushAt: string | null;
};

export type YardCheckResult = {
  rows: YardCheckRow[];
  checkedAt: string;
  caption: string;
};

export type YardUndoToken = {
  at: string;
  backupIds: string[];
  lightIds: string[];
};

export function yardFixSummary(rows: { status: string }[]): string {
  const matched = rows.filter((row) => row.status === "matched").length;
  if (rows.length === 0) return "No Lights needed a fix. Nothing was sent.";
  if (matched === rows.length) return `${matched} of ${rows.length} report the Looks again.`;
  return `${matched} of ${rows.length} report the Looks again. Check the Lights listed below.`;
}

export function yardSweepSummary(rows: { status: string }[]): string {
  const matched = rows.filter((row) => row.status === "matched").length;
  if (rows.length === 0) return "No Lights were reachable. Nothing was sent.";
  if (matched === rows.length) return `${matched} of ${rows.length} report the first Look on.`;
  return `${matched} of ${rows.length} report the first Look on. Check the Lights listed below.`;
}

export function yardHasDrift(row: Pick<YardCheckRow, "looks" | "schedule" | "sync" | "outputs" | "ledmap" | "reachability">): boolean {
  if (row.reachability !== "online") return false;
  return (
    isDriftStatus(row.looks.status) ||
    row.schedule.status === "mismatch" ||
    row.sync.status === "mismatch" ||
    row.outputs.status === "mismatch" ||
    row.ledmap.status === "mismatch"
  );
}

export function isDriftStatus(status: YardCompareStatus): boolean {
  return status === "mismatch" || status === "not-pushed";
}

export function compareFirmware(enrolled: string | null, live: string | null, reachable: boolean): YardCompare & {
  enrolled: string | null;
  live: string | null;
} {
  if (!reachable) {
    return {
      status: "unknown",
      detail: enrolled ? `Last enrolled firmware ${enrolled}. WLED did not answer.` : "Firmware is unknown. WLED did not answer.",
      enrolled,
      live: null,
    };
  }
  if (!live) {
    return { status: "unknown", detail: "Firmware was not reported. Not treating as a match.", enrolled, live };
  }
  if (!enrolled) {
    return { status: "unknown", detail: `Reports ${live}. Nightplot has no enrolled firmware to compare.`, enrolled, live };
  }
  if (enrolled === live) {
    return { status: "match", detail: live, enrolled, live };
  }
  return { status: "mismatch", detail: `Enrolled ${enrolled}; reports ${live}.`, enrolled, live };
}

export function compareOutputs(input: {
  light: Pick<Light, "id" | "ledCount" | "stripKind" | "outputs">;
  provision: ProvisionRead | null;
  snapshotLedCount: number | null;
  reachable: boolean;
}): YardCheckRow["outputs"] {
  const expected = migrateLightOutputs(input.light);
  const expectedLeds = expected.reduce((sum, output) => sum + output.ledCount, 0);
  if (!input.reachable) {
    return {
      status: "unknown",
      detail: `Nightplot expects ${expected.length} output${expected.length === 1 ? "" : "s"} · ${expectedLeds} LEDs. WLED did not answer.`,
      expectedCount: expected.length,
      liveCount: null,
      expectedLeds,
      liveLeds: null,
    };
  }
  const liveLeds = input.snapshotLedCount;
  if (!input.provision || input.provision.refuse) {
    if (liveLeds === null) {
      return {
        status: "unknown",
        detail: `Nightplot expects ${expected.length} output${expected.length === 1 ? "" : "s"} · ${expectedLeds} LEDs. Outputs were not read. Not treating as a match.`,
        expectedCount: expected.length,
        liveCount: null,
        expectedLeds,
        liveLeds: null,
      };
    }
    if (liveLeds !== expectedLeds) {
      return {
        status: "mismatch",
        detail: `Nightplot expects ${expectedLeds} LEDs; the controller reports ${liveLeds}. Output buses were not read.`,
        expectedCount: expected.length,
        liveCount: null,
        expectedLeds,
        liveLeds,
      };
    }
    return {
      status: "unknown",
      detail: `Reports ${liveLeds} LEDs. Output buses were not read. Not treating bus count as a match.`,
      expectedCount: expected.length,
      liveCount: null,
      expectedLeds,
      liveLeds,
    };
  }
  const liveCount = input.provision.outputs.length;
  const mismatches: string[] = [];
  if (liveLeds !== null && liveLeds !== expectedLeds) {
    mismatches.push(`Nightplot expects ${expectedLeds} LEDs; reports ${liveLeds}`);
  }
  for (const output of expected) {
    const bus = input.provision.outputs.find((row) => row.index === output.index);
    if (!bus) {
      mismatches.push(`output ${output.index + 1} is missing on the controller`);
      continue;
    }
    if (bus.settings.length !== null && bus.settings.length !== output.ledCount) {
      mismatches.push(`output ${output.index + 1} expects ${output.ledCount} LEDs; reports ${bus.settings.length}`);
    } else if (bus.settings.length === null) {
      mismatches.push(`output ${output.index + 1} length was not reported`);
    }
  }
  if (mismatches.length > 0) {
    const unreadOnly = mismatches.every((row) => row.includes("was not reported"));
    return {
      status: unreadOnly ? "unknown" : "mismatch",
      detail: `${mismatches.join(". ")}.`,
      expectedCount: expected.length,
      liveCount,
      expectedLeds,
      liveLeds,
    };
  }
  return {
    status: "match",
    detail: `${expected.length} output${expected.length === 1 ? "" : "s"} · ${expectedLeds} LEDs.`,
    expectedCount: expected.length,
    liveCount,
    expectedLeds,
    liveLeds,
  };
}

export function compareLooks(input: {
  lastPush: LastLookPush | null | undefined;
  currentDigest: string;
  expected: Record<string, unknown> | null;
  slots: readonly number[];
  readRaw: string | null;
  reachable: boolean;
}): YardCheckRow["looks"] {
  const libraryChanged = Boolean(input.lastPush && input.lastPush.digest !== input.currentDigest);
  const changedNote = libraryChanged ? " Looks library changed since last push." : "";
  if (!input.reachable) {
    return {
      status: "unknown",
      detail: `${input.lastPush ? "Looks were last pushed; WLED did not answer." : "Nightplot has not pushed Looks to this Light. WLED did not answer."}${changedNote}`,
      libraryChanged,
    };
  }
  if (!input.lastPush) {
    return {
      status: "not-pushed",
      detail: "Nightplot has not pushed Looks to this Light. That is not a match.",
      libraryChanged: false,
    };
  }
  if (input.readRaw === null || !input.expected) {
    return {
      status: "unknown",
      detail: `Looks were last pushed; presets.json did not reread. Not treating as a match.${changedNote}`,
      libraryChanged,
    };
  }
  const matched = managedPresetSlotsMatch(input.expected, input.readRaw, input.slots);
  if (matched === null) {
    return {
      status: "unknown",
      detail: `Looks were last pushed; presets.json did not reread as JSON. Not treating as a match.${changedNote}`,
      libraryChanged,
    };
  }
  if (!matched) {
    return {
      status: "mismatch",
      detail: `Managed Look preset slots differ from what Nightplot would write now.${changedNote}`,
      libraryChanged,
    };
  }
  return {
    status: "match",
    detail: libraryChanged
      ? "Managed Look slots still match the current library, which changed since the last recorded push."
      : "Managed Look slots match the last push.",
    libraryChanged,
  };
}

export function compareSchedule(input: {
  lastPush: LastLookPush | null | undefined;
  schedule: NightlySchedule | null;
  looks: readonly Look[];
  playlists: readonly LookPlaylist[];
  cfg: unknown;
  reachable: boolean;
  /** Live firmware if known, else enrolled. Picks WLED's sunset layout. */
  firmware?: string | null;
}): YardCompare {
  if (!input.reachable) {
    return {
      status: "unknown",
      detail: input.lastPush?.includeSchedule
        ? "Schedule was last pushed; WLED did not answer."
        : "Nightplot has not pushed a Schedule to this Light. WLED did not answer.",
    };
  }
  if (!input.schedule?.enabled) {
    return { status: "not-pushed", detail: "No nightly Schedule is saved in Nightplot." };
  }
  if (!input.lastPush?.includeSchedule) {
    return { status: "not-pushed", detail: "Nightplot has not pushed the nightly Schedule to this Light. That is not a match." };
  }
  const runSlot = runPresetSlot(input.schedule, input.looks, input.playlists);
  if (runSlot === null) {
    return { status: "unknown", detail: "The saved Schedule does not name a Look or playlist. Not treating as a match." };
  }
  if (input.cfg == null) {
    return { status: "unknown", detail: "Schedule was last pushed; /json/cfg did not reread. Not treating as a match." };
  }
  const planned = buildScheduleWrite(input.schedule, runSlot, wledTimerDialect(input.firmware));
  const matched = scheduleMatches(planned.expectedNtp, planned.expectedTimers, input.cfg);
  if (matched === null) {
    return { status: "unknown", detail: "Schedule was last pushed; timers or NTP were not reported. Not treating as a match." };
  }
  if (!matched) {
    return { status: "mismatch", detail: "Timers or NTP differ from the nightly Schedule Nightplot last pushed." };
  }
  return { status: "match", detail: "Timers and NTP match the nightly Schedule." };
}

export function compareSync(input: {
  lastPush: LastLookPush | null | undefined;
  cfg: unknown;
  reachable: boolean;
}): YardCompare {
  const udp = input.lastPush?.udp;
  if (!input.reachable) {
    return {
      status: "unknown",
      detail: udp
        ? `Sync group ${udp.group} was last pushed; WLED did not answer.`
        : "Nightplot has not pushed a sync group to this Light. WLED did not answer.",
    };
  }
  if (!udp) {
    return { status: "not-pushed", detail: "Nightplot has not pushed a WLED sync group to this Light." };
  }
  if (input.cfg == null) {
    return { status: "unknown", detail: `Sync group ${udp.group} was last pushed; /json/cfg did not reread. Not treating as a match.` };
  }
  const read = parseWledUdpSync(input.cfg);
  if (!read) {
    return { status: "unknown", detail: "This firmware did not report WLED sync settings. Not treating as a match." };
  }
  const role = udpSyncRole(read, udp.group);
  if (role !== udp.role) {
    return { status: "mismatch", detail: `Last push was group ${udp.group} ${udp.role}; reports ${role}.` };
  }
  return { status: "match", detail: `WLED sync group ${udp.group} (${udp.role}).` };
}

export function compareLedmap(input: {
  props: readonly Prop[];
  ledCount: number;
  liveRaw: string | null;
  reachable: boolean;
}): YardCompare {
  const wireframes = input.props.filter((prop) => prop.wireframe);
  if (wireframes.length === 0) {
    return { status: "match", detail: "No wireframe Prop. Ledmap is not compared." };
  }
  if (!input.reachable) {
    return { status: "unknown", detail: "A wireframe Prop expects a ledmap. WLED did not answer." };
  }
  if (input.liveRaw === null) {
    return { status: "unknown", detail: "A wireframe Prop expects a ledmap. /ledmap.json did not reread. Not treating as a match." };
  }
  const live = parseLedmapJson(input.liveRaw);
  if (live === null) {
    return { status: "unknown", detail: "A wireframe Prop expects a ledmap. /ledmap.json was not a map. Not treating as a match." };
  }
  const expected = compileWireframe(wireframes[0]!.wireframe!, input.ledCount).ledmap;
  const matched = ledmapsMatch(expected, live);
  if (matched === null) {
    return { status: "unknown", detail: "A wireframe Prop expects a ledmap. The controller map was not read. Not treating as a match." };
  }
  if (!matched) {
    return { status: "mismatch", detail: "Ledmap differs from the wireframe Nightplot would write now." };
  }
  return { status: "match", detail: "Ledmap matches the wireframe." };
}

export function compareLit(input: { reachable: boolean; on: boolean | null; preset: number | null }): YardCheckRow["lit"] {
  if (!input.reachable) {
    return { status: "unknown", detail: "Power is unknown. WLED did not answer.", on: null, preset: null };
  }
  if (input.on === null) {
    return { status: "unknown", detail: "Power was not reported. Not treating as off.", on: null, preset: input.preset };
  }
  if (input.on) {
    return {
      status: "lit",
      detail: input.preset ? `On · preset ${input.preset}.` : "On.",
      on: true,
      preset: input.preset,
    };
  }
  return { status: "off", detail: "Off.", on: false, preset: input.preset };
}

export function buildYardCheckRow(input: {
  light: Light;
  live: WledSnapshot | null;
  elements: readonly Element[];
  props: readonly Prop[];
  looks: readonly Look[];
  playlists: readonly LookPlaylist[];
  schedule: NightlySchedule | null;
  provision: ProvisionRead | null;
  presetsRaw: string | null;
  cfg: unknown;
  ledmapRaw?: string | null;
}): YardCheckRow {
  const reachable = input.light.reachability === "online" && input.live !== null;
  const lastPush = input.light.lastLookPush ?? null;
  const currentDigest = lookPushDigest({
    looks: input.looks,
    playlists: input.playlists,
    schedule: input.schedule,
    includeSchedule: Boolean(lastPush?.includeSchedule && input.schedule?.enabled),
    udp: lastPush?.udp ?? null,
  });
  const targets = lookTargets({
    ledCount: input.light.ledCount,
    elements: input.elements,
    props: input.props,
  });
  const expected = targets.length > 0
    ? buildManagedPresets({
        looks: input.looks,
        playlists: input.playlists,
        targets,
        rgbw: input.light.rgbw,
      })
    : null;
  const firmware = compareFirmware(input.light.firmware, input.live?.firmware ?? null, reachable);
  const outputs = compareOutputs({
    light: input.light,
    provision: input.provision,
    snapshotLedCount: input.live?.ledCount ?? null,
    reachable,
  });
  const looks = compareLooks({
    lastPush,
    currentDigest,
    expected,
    slots: managedLookSlots(input.looks, input.playlists),
    readRaw: input.presetsRaw,
    reachable,
  });
  const schedule = compareSchedule({
    lastPush,
    schedule: input.schedule,
    looks: input.looks,
    playlists: input.playlists,
    cfg: input.cfg,
    reachable,
    firmware: input.live?.firmware ?? input.light.firmware,
  });
  const sync = compareSync({ lastPush, cfg: input.cfg, reachable });
  const ledmap = compareLedmap({
    props: input.props,
    ledCount: input.light.ledCount,
    liveRaw: input.ledmapRaw ?? null,
    reachable,
  });
  const lit = compareLit({
    reachable,
    on: input.live?.on ?? null,
    preset: input.live?.preset ?? null,
  });
  const row: YardCheckRow = {
    lightId: input.light.id,
    name: input.light.name,
    hostname: input.light.hostname,
    port: input.light.port,
    hostKey: input.light.hostKey,
    mac: input.light.mac,
    reachability: input.light.reachability,
    lastSeenAt: input.light.lastSeenAt,
    firmware,
    outputs,
    looks,
    schedule,
    sync,
    ledmap,
    lit,
    props: input.props.map((prop) => ({ id: prop.id, label: prop.label, kind: prop.kind })),
    canFix: false,
    canBlink: reachable,
    lastLookPushAt: lastPush?.at ?? null,
  };
  row.canFix = reachable && (
    isDriftStatus(looks.status) ||
    schedule.status === "mismatch" ||
    (schedule.status === "not-pushed" && input.schedule?.enabled === true) ||
    sync.status === "mismatch" ||
    ledmap.status === "mismatch"
  );
  return row;
}

export function yardPushPlan(input: {
  lastPush: LastLookPush | null | undefined;
  scheduleEnabled: boolean;
}): { includeSchedule: boolean; udp: { group: number; role: UdpSyncRole } | null } {
  return {
    includeSchedule: Boolean(input.scheduleEnabled && (input.lastPush?.includeSchedule || !input.lastPush)),
    udp: input.lastPush?.udp ?? null,
  };
}

export function isYardUndoToken(value: unknown): value is YardUndoToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<YardUndoToken>;
  return (
    typeof row.at === "string" &&
    Array.isArray(row.backupIds) &&
    row.backupIds.every((id) => typeof id === "string" && id.length > 0) &&
    Array.isArray(row.lightIds) &&
    row.lightIds.every((id) => typeof id === "string" && id.length > 0)
  );
}
