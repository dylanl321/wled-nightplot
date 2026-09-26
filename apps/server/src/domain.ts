import { randomUUID } from "node:crypto";
import {
  buildRangeDisplay,
  displayHost,
  normalizeHostKey,
  validateDeclaredRanges,
  type BeadColor,
  type DiscoverRow,
  type DiscoverVia,
  type Element,
  type HostPort,
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
  return {
    id: existing?.id ?? randomUUID(),
    name: snapshot.name,
    controllerKind: "wled",
    stripKind: "ws281x",
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
  extras: { elementCount: number; driftLabel: string | null } = {
    elementCount: 0,
    driftLabel: null,
  },
): LightView {
  return {
    ...light,
    displayHost: displayHost({ hostname: light.hostname, port: light.port }),
    bead: beadFor(light, live),
    elementCount: extras.elementCount,
    driftLabel: extras.driftLabel,
  };
}

export function lightDetail(
  light: Light,
  live: WledSnapshot | null,
  elements: Element[],
): LightDetail {
  const reachable = light.reachability === "online" && live !== null;
  const reported = reachable ? (live?.segments ?? []) : [];
  const issues = validateDeclaredRanges(elements, light.ledCount);
  const display = buildRangeDisplay(elements, reported, issues, { reachable });
  return {
    light: toLightView(light, live, {
      elementCount: elements.length,
      driftLabel: display.notes[0]?.text ?? null,
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
  if (live.on === false) return null;
  return live.segmentColor;
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
      bead: outcome.snapshot.on ? outcome.snapshot.segmentColor : null,
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
    port: 0,
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
