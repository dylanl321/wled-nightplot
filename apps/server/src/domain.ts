import { randomUUID } from "node:crypto";
import {
  beadForReportedOn,
  buildRangeDisplay,
  displayHost,
  knownStripKind,
  normalizeHostKey,
  resolveLightName,
  stripHonestyForLight,
  validateDeclaredRanges,
  type BeadColor,
  type DiscoverRow,
  type DiscoverVia,
  type Element,
  type HostPort,
  type LedProduct,
  type Light,
  type LightDetail,
  type LightView,
  type WledSnapshot,
} from "@nightplot/shared";
import type { ProbeOutcome } from "./wled/client.ts";

export function lightFromSnapshot(
  target: HostPort,
  snapshot: WledSnapshot,
  now: string,
  existing?: Light,
): Light {
  const resolved = resolveLightName({
    infoName: snapshot.name,
    existing,
  });
  return {
    id: existing?.id ?? randomUUID(),
    name: resolved.name,
    nameSource: resolved.nameSource,
    staleInfoName: resolved.staleInfoName,
    controllerKind: "wled",
    stripKind: knownStripKind(existing?.stripKind),
    hostname: target.hostname,
    port: target.port,
    hostKey: normalizeHostKey(target),
    mac: snapshot.mac,
    firmware: snapshot.firmware,
    ledCount: snapshot.ledCount,
    rgbw: snapshot.rgbw,
    reachability: "online",
    lastSeenAt: now,
    on: snapshot.on,
    brightness: snapshot.brightness,
    enrolledAt: existing?.enrolledAt ?? now,
    ledProductId: existing?.ledProductId ?? null,
    lastSnapshot: existing?.lastSnapshot ?? null,
    lastSnapshotAt: existing?.lastSnapshotAt ?? null,
  };
}

export function markUnreachable(light: Light): Light {
  return {
    ...light,
    reachability: "no-answer",
    on: null,
    brightness: null,
  };
}

export function toLightView(
  light: Light,
  live: WledSnapshot | null,
  extras: {
    elementCount: number;
    segmentCount: number | null;
    driftLabel: string | null;
    product?: LedProduct | null;
  } = {
    elementCount: 0,
    segmentCount: null,
    driftLabel: null,
  },
): LightView {
  const honesty = stripHonestyForLight({
    stripKind: light.stripKind,
    product: extras.product,
  });
  return {
    ...light,
    displayHost: displayHost({ hostname: light.hostname, port: light.port }),
    bead: beadFor(light, live),
    stripBead: honesty.bead,
    stripChip: honesty.chipLabel,
    elementCount: extras.elementCount,
    segmentCount: extras.segmentCount,
    driftLabel: extras.driftLabel,
  };
}

export function lightDetail(
  light: Light,
  live: WledSnapshot | null,
  elements: Element[],
  product: LedProduct | null = null,
): LightDetail {
  const reachable = light.reachability === "online" && live !== null;
  const reported = reachable ? (live?.segments ?? []) : [];
  const issues = validateDeclaredRanges(elements, light.ledCount);
  const display = buildRangeDisplay(elements, reported, issues, { reachable });
  return {
    light: toLightView(light, live, {
      elementCount: elements.length,
      segmentCount: reachable ? (live?.segments.length ?? 0) : null,
      driftLabel: display.notes[0]?.text ?? null,
      product,
    }),
    elements,
    reported: display.reported,
    display,
    snapshotAt: reachable ? light.lastSeenAt : null,
    session: null,
    liveLeds: null,
    liveCaption: null,
  };
}

function beadFor(light: Light, live: WledSnapshot | null): BeadColor {
  if (light.reachability === "no-answer" || !live) return "unknown";
  return beadForReportedOn(live.on, live.segmentColor);
}

export function rowFromProbe(
  target: HostPort,
  via: DiscoverVia,
  outcome: ProbeOutcome,
  now: string,
  enrolled: boolean,
): DiscoverRow {
  const key = normalizeHostKey(target);
  const base = {
    key,
    hostname: target.hostname,
    port: target.port,
    displayHost: displayHost(target),
    via,
    foundAt: now,
  };
  if (enrolled) {
    return {
      ...base,
      status: "already-added",
      reason: "Already added",
      reasonCode: "already-added",
      name: null,
      ledCount: null,
      firmware: null,
      mac: null,
      on: null,
      bead: null,
    };
  }
  if (outcome.kind === "found") {
    return {
      ...base,
      status: "found",
      reason: null,
      reasonCode: null,
      name: outcome.snapshot.name,
      ledCount: outcome.snapshot.ledCount,
      firmware: outcome.snapshot.firmware,
      mac: outcome.snapshot.mac,
      on: outcome.snapshot.on,
      bead: beadForReportedOn(outcome.snapshot.on, outcome.snapshot.segmentColor),
    };
  }
  return {
    ...base,
    status: "rejected",
    reason: outcome.reason,
    reasonCode: outcome.kind,
    name: null,
    ledCount: null,
    firmware: null,
    mac: null,
    on: null,
    bead: null,
  };
}

export function refusedRow(raw: string, via: DiscoverVia, now: string, reason: string): DiscoverRow {
  return {
    key: raw.trim().toLowerCase() || "refused",
    hostname: raw.trim(),
    port: null,
    displayHost: raw.trim(),
    via,
    status: "rejected",
    reason,
    reasonCode: "disallowed-address",
    name: null,
    ledCount: null,
    firmware: null,
    mac: null,
    on: null,
    bead: null,
    foundAt: now,
  };
}

export function needsPortRow(hostname: string, via: DiscoverVia, now: string): DiscoverRow {
  const host = hostname.trim();
  return {
    key: `${host.toLowerCase()}:needs-port:${via}`,
    hostname: host,
    port: null,
    displayHost: host,
    via,
    status: "rejected",
    reason: "Find did not report a port. Type host:port — typed address is the way in.",
    reasonCode: "missing-port",
    name: null,
    ledCount: null,
    firmware: null,
    mac: null,
    on: null,
    bead: null,
    foundAt: now,
  };
}
