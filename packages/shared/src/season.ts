/**
 * One-file season save / restore. The file holds Lights, outputs, Segments,
 * Props, setup profiles, Looks, playlist and Schedule. Optional native WLED
 * cfg/presets per Light are extras, not proof of Hardware Done.
 *
 * Older Nightplot backups and Lights-store shapes migrate in. Missing Looks
 * stay missing — restore does not invent a library.
 */

import { macsMatch, normalizeMac } from "./apply.ts";
import { parseBackupDocument, type WledBackupFiles } from "./backup.ts";
import { normalizeHostKey } from "./net/address.ts";
import {
  isLook,
  isLookPlaylist,
  isLooksDocument,
  normalizeLook,
  normalizePlaylist,
  type Look,
  type LookPlaylist,
  type LooksDocument,
} from "./look.ts";
import { type Element, type Light } from "./lights.ts";
import { withMigratedOutputs } from "./outputs.ts";
import { isProp, isPropAttachment, type Prop, type PropAttachment } from "./prop/types.ts";
import { isNightlySchedule } from "./schedule.ts";
import { isSetupProfile, type SetupProfile } from "./setup-profile.ts";

export const SEASON_KIND = "nightplot-season";
export const SEASON_VERSION = 1;

export const SEASON_CAPTION =
  "One file for next season: Lights, outputs, Segments, Props (including wireframe path, locks and hidden spans), setup profiles, Looks, playlist and Schedule. Optional WLED cfg/presets/ledmap are extras. Restore shows a diff, then can re-push to controllers matched by MAC. Looks in the file replace the library; a file without Looks leaves the current library. Not Hardware Done.";

export type SeasonDeviceFiles = {
  lightId: string;
  mac: string | null;
  hostname: string;
  port: number;
  firmware: string | null;
  cfgJson?: string;
  presetsJson?: string;
  /** Last read `/ledmap.json`. Missing is not an empty map. */
  ledmapJson?: string;
};

export type SeasonDocument = {
  version: typeof SEASON_VERSION;
  kind: typeof SEASON_KIND;
  at: string;
  lights: Light[];
  elements: Element[];
  props: Prop[];
  /** Missing on season files saved before attachment was separate. */
  attachments?: PropAttachment[];
  setupProfiles: SetupProfile[];
  looks: LooksDocument | null;
  devices: SeasonDeviceFiles[];
};

export type SeasonCountDiff = {
  current: number;
  incoming: number;
  added: string[];
  removed: string[];
  changed: string[];
};

export type SeasonDiff = {
  lights: SeasonCountDiff;
  segments: SeasonCountDiff;
  props: SeasonCountDiff;
  profiles: SeasonCountDiff;
  looks: SeasonCountDiff & { missingInFile: boolean };
  playlists: SeasonCountDiff;
  schedule: {
    current: boolean;
    incoming: boolean;
    changed: boolean;
    missingInFile: boolean;
  };
  devicesComplete: number;
  devicesIncomplete: number;
};

export type SeasonHostMatch = {
  hostname: string;
  port: number;
  hostKey: string;
  how: "season-host" | "enrolled-mac" | "found-mac" | "unresolved";
};

export type SeasonParseResult =
  | { ok: true; document: SeasonDocument; migratedFrom: "season" | "backup" | "lights-store" }
  | { ok: false; message: string };

export function seasonDigest(document: SeasonDocument): string {
  return JSON.stringify({
    lights: document.lights.map((light) => ({
      id: light.id,
      name: light.name,
      mac: light.mac,
      hostKey: light.hostKey,
      ledCount: light.ledCount,
      outputs: light.outputs,
    })),
    elements: document.elements,
    props: document.props,
    setupProfiles: document.setupProfiles,
    looks: document.looks,
    devices: document.devices.map((row) => ({
      lightId: row.lightId,
      mac: row.mac,
      hasFiles: Boolean(row.cfgJson && row.presetsJson),
      hasLedmap: Boolean(row.ledmapJson),
    })),
  });
}

export function parseSeasonDocument(value: unknown): SeasonParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "This is not a Nightplot season file. Nothing was read." };
  }
  const raw = value as Record<string, unknown>;
  const season = parseCurrentSeason(raw);
  if (season) return { ok: true, document: season, migratedFrom: "season" };
  const backup = parseBackupAsSeason(raw);
  if (backup) return backup;
  const store = parseLightsStoreAsSeason(raw);
  if (store) return store;
  return { ok: false, message: "This file is not a season save Nightplot understands. Nothing was read." };
}

export function diffSeason(current: SeasonDocument, incoming: SeasonDocument): SeasonDiff {
  return {
    lights: diffNamed(
      current.lights.map((row) => ({ id: row.id, name: row.name, key: lightKey(row) })),
      incoming.lights.map((row) => ({ id: row.id, name: row.name, key: lightKey(row) })),
    ),
    segments: diffNamed(
      current.elements.map((row) => ({ id: row.id, name: `${row.label} ${row.start}–${row.stop}`, key: elementKey(row) })),
      incoming.elements.map((row) => ({ id: row.id, name: `${row.label} ${row.start}–${row.stop}`, key: elementKey(row) })),
    ),
    props: diffNamed(
      current.props.map((row) => ({ id: row.id, name: row.label, key: propKey(row) })),
      incoming.props.map((row) => ({ id: row.id, name: row.label, key: propKey(row) })),
    ),
    profiles: diffNamed(
      current.setupProfiles.map((row) => ({ id: row.id, name: row.name, key: JSON.stringify(row) })),
      incoming.setupProfiles.map((row) => ({ id: row.id, name: row.name, key: JSON.stringify(row) })),
    ),
    looks: {
      ...diffNamed(
        (current.looks?.looks ?? []).map((row) => ({ id: row.id, name: row.name, key: lookKey(row) })),
        (incoming.looks?.looks ?? []).map((row) => ({ id: row.id, name: row.name, key: lookKey(row) })),
      ),
      missingInFile: incoming.looks === null,
    },
    playlists: diffNamed(
      (current.looks?.playlists ?? []).map((row) => ({ id: row.id, name: row.name, key: playlistKey(row) })),
      (incoming.looks?.playlists ?? []).map((row) => ({ id: row.id, name: row.name, key: playlistKey(row) })),
    ),
    schedule: {
      current: Boolean(current.looks?.schedule),
      incoming: Boolean(incoming.looks?.schedule),
      changed: JSON.stringify(current.looks?.schedule ?? null) !== JSON.stringify(incoming.looks?.schedule ?? null),
      missingInFile: incoming.looks === null,
    },
    devicesComplete: incoming.devices.filter((row) => row.cfgJson && row.presetsJson).length,
    devicesIncomplete: incoming.devices.filter((row) => !row.cfgJson || !row.presetsJson).length,
  };
}

/**
 * Prefer a live season host whose MAC still matches. If that host is gone,
 * use the enrolled Light or a Find row with the same MAC (changed DHCP).
 */
export function rematchSeasonHost(input: {
  season: Pick<Light, "hostname" | "port" | "mac">;
  seasonProbeMac: string | null;
  enrolledByMac: Pick<Light, "hostname" | "port"> | null;
  discoveredByMac: { hostname: string; port: number } | null;
}): SeasonHostMatch {
  const seasonHost = {
    hostname: input.season.hostname,
    port: input.season.port,
    hostKey: normalizeHostKey({ hostname: input.season.hostname, port: input.season.port }),
  };
  if (input.season.mac && input.seasonProbeMac && macsMatch(input.season.mac, input.seasonProbeMac)) {
    return { ...seasonHost, how: "season-host" };
  }
  if (input.enrolledByMac) {
    return {
      hostname: input.enrolledByMac.hostname,
      port: input.enrolledByMac.port,
      hostKey: normalizeHostKey(input.enrolledByMac),
      how: "enrolled-mac",
    };
  }
  if (input.discoveredByMac) {
    return {
      hostname: input.discoveredByMac.hostname,
      port: input.discoveredByMac.port,
      hostKey: normalizeHostKey(input.discoveredByMac),
      how: "found-mac",
    };
  }
  return { ...seasonHost, how: "unresolved" };
}

export function applyHostMatch(light: Light, match: SeasonHostMatch): Light {
  return {
    ...light,
    hostname: match.hostname,
    port: match.port,
    hostKey: match.hostKey,
  };
}

export function deviceFilesFromNative(input: {
  light: Pick<Light, "id" | "hostname" | "port" | "mac" | "firmware">;
  files: Pick<WledBackupFiles, "cfgJson" | "presetsJson"> | null;
  ledmapJson?: string | null;
}): SeasonDeviceFiles {
  return {
    lightId: input.light.id,
    mac: input.light.mac,
    hostname: input.light.hostname,
    port: input.light.port,
    firmware: input.light.firmware,
    ...(input.files?.cfgJson ? { cfgJson: input.files.cfgJson } : {}),
    ...(input.files?.presetsJson ? { presetsJson: input.files.presetsJson } : {}),
    ...(input.ledmapJson ? { ledmapJson: input.ledmapJson } : {}),
  };
}

function parseCurrentSeason(raw: Record<string, unknown>): SeasonDocument | null {
  if (raw.kind !== SEASON_KIND || raw.version !== SEASON_VERSION) return null;
  if (typeof raw.at !== "string" || !Array.isArray(raw.lights) || !Array.isArray(raw.elements)) return null;
  const lights = raw.lights.map((row) => withMigratedOutputs(row as Light));
  if (!lights.every(isSeasonLight)) return null;
  const elements = raw.elements as Element[];
  if (!elements.every(isSeasonElement)) return null;
  const props = Array.isArray(raw.props) ? (raw.props as Prop[]) : [];
  if (!props.every(isProp)) return null;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments.filter(isPropAttachment) : [];
  if (Array.isArray(raw.attachments) && attachments.length !== raw.attachments.length) return null;
  const setupProfiles = Array.isArray(raw.setupProfiles) ? (raw.setupProfiles as SetupProfile[]) : [];
  if (!setupProfiles.every(isSetupProfile)) return null;
  const looks = parseLooksField(raw.looks);
  if (looks === "invalid") return null;
  const devices = Array.isArray(raw.devices) ? raw.devices.filter(isSeasonDevice) : [];
  if (!idsUnique(lights.map((row) => row.id)) || !idsUnique(elements.map((row) => row.id))) return null;
  if (!elements.every((element) => lights.some((light) => light.id === element.lightId))) return null;
  if (!props.every((prop) => seasonPropFits(prop, lights, elements))) return null;
  return {
    version: SEASON_VERSION,
    kind: SEASON_KIND,
    at: raw.at,
    lights,
    elements,
    props,
    attachments,
    setupProfiles,
    looks,
    devices,
  };
}

function parseBackupAsSeason(raw: Record<string, unknown>): SeasonParseResult | null {
  let backup;
  try {
    backup = parseBackupDocument(raw);
  } catch {
    return null;
  }
  const looks = parseLooksField((backup.data as { looks?: unknown }).looks);
  if (looks === "invalid") {
    return { ok: false, message: "This backup’s Looks are a shape Nightplot does not understand. Nothing was read." };
  }
  const lights = backup.data.lights.map((light) => withMigratedOutputs(light));
  if (!lights.every(isSeasonLight) || !backup.data.elements.every(isSeasonElement)) {
    return { ok: false, message: "This backup’s Lights or Segments are a shape Nightplot does not understand. Nothing was read." };
  }
  const devices = backup.deviceFiles
    ? [{
        lightId: backup.lightId ?? backup.deviceFiles.lightId ?? "",
        mac: backup.deviceFiles.mac ?? null,
        hostname: backup.deviceFiles.host?.split(":")[0] ?? "",
        port: Number(backup.deviceFiles.host?.split(":")[1] ?? 80) || 80,
        firmware: backup.deviceFiles.firmware ?? null,
        cfgJson: backup.deviceFiles.cfgJson,
        presetsJson: backup.deviceFiles.presetsJson,
      } satisfies SeasonDeviceFiles]
    : [];
  return {
    ok: true,
    migratedFrom: "backup",
    document: {
      version: SEASON_VERSION,
      kind: SEASON_KIND,
      at: backup.at,
      lights,
      elements: backup.data.elements,
      props: backup.data.props ?? [],
      setupProfiles: [],
      looks,
      devices: devices.filter((row) => row.lightId),
    },
  };
}

function parseLightsStoreAsSeason(raw: Record<string, unknown>): SeasonParseResult | null {
  if (raw.version !== 1 || !Array.isArray(raw.lights) || (raw.elements !== undefined && !Array.isArray(raw.elements))) {
    return null;
  }
  if (raw.kind === SEASON_KIND) return null;
  const lights = (raw.lights as Light[]).map((light) => withMigratedOutputs(light));
  const elements = (raw.elements ?? []) as Element[];
  if (!lights.every(isSeasonLight) || !elements.every(isSeasonElement)) {
    return { ok: false, message: "This Lights file is a shape Nightplot does not understand. Nothing was read." };
  }
  const props = Array.isArray(raw.props) ? (raw.props as Prop[]) : [];
  if (!props.every(isProp)) {
    return { ok: false, message: "This Lights file has Props Nightplot does not understand. Nothing was read." };
  }
  return {
    ok: true,
    migratedFrom: "lights-store",
    document: {
      version: SEASON_VERSION,
      kind: SEASON_KIND,
      at: new Date(0).toISOString(),
      lights,
      elements,
      props,
      setupProfiles: [],
      looks: null,
      devices: [],
    },
  };
}

function parseLooksField(value: unknown): LooksDocument | null | "invalid" {
  if (value == null) return null;
  if (!isLooksDocument(value)) return "invalid";
  if (!value.looks.every(isLook) || !value.playlists.every(isLookPlaylist)) return "invalid";
  if (value.schedule != null && !isNightlySchedule(value.schedule)) return "invalid";
  return {
    version: 1,
    looks: value.looks.map(normalizeLook),
    playlists: value.playlists.map(normalizePlaylist),
    schedule: value.schedule ?? null,
  };
}

function isSeasonLight(value: unknown): value is Light {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Light>;
  return typeof row.id === "string" && !!row.id && typeof row.name === "string" &&
    typeof row.hostname === "string" && typeof row.port === "number" &&
    typeof row.hostKey === "string" && Number.isInteger(row.ledCount) &&
    (row.ledCount ?? 0) > 0 && (row.mac === null || typeof row.mac === "string");
}

function isSeasonElement(value: unknown): value is Element {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Element>;
  return typeof row.id === "string" && typeof row.lightId === "string" &&
    typeof row.label === "string" && typeof row.start === "number" && typeof row.stop === "number";
}

function isSeasonDevice(value: unknown): value is SeasonDeviceFiles {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SeasonDeviceFiles>;
  return typeof row.lightId === "string" && row.lightId.length > 0 &&
    typeof row.hostname === "string" && typeof row.port === "number" &&
    (row.mac === null || typeof row.mac === "string") &&
    (row.firmware === null || typeof row.firmware === "string") &&
    (row.cfgJson === undefined || typeof row.cfgJson === "string") &&
    (row.presetsJson === undefined || typeof row.presetsJson === "string") &&
    (row.ledmapJson === undefined || typeof row.ledmapJson === "string");
}

function diffNamed(
  current: { id: string; name: string; key: string }[],
  incoming: { id: string; name: string; key: string }[],
): SeasonCountDiff {
  const currentById = new Map(current.map((row) => [row.id, row]));
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const row of incoming) {
    const prior = currentById.get(row.id);
    if (!prior) added.push(row.name);
    else if (prior.key !== row.key) changed.push(row.name);
  }
  for (const row of current) {
    if (!incomingById.has(row.id)) removed.push(row.name);
  }
  return { current: current.length, incoming: incoming.length, added, removed, changed };
}

function lightKey(light: Light): string {
  return [light.name, light.mac ? normalizeMac(light.mac) : "", light.hostKey, light.ledCount, JSON.stringify(light.outputs ?? [])].join("|");
}

function seasonPropFits(prop: Prop, lights: { id: string }[], elements: Element[]): boolean {
  if (prop.lightId && !lights.some((light) => light.id === prop.lightId)) return false;
  if (prop.elementIds.length === 0) return !prop.lightId || lights.some((light) => light.id === prop.lightId);
  if (!prop.lightId) return false;
  return prop.elementIds.every((elementId) =>
    elements.some((element) => element.id === elementId && element.lightId === prop.lightId),
  );
}

function propKey(prop: Prop): string {
  return `${prop.id}:${prop.label}:${prop.kind}:${prop.elementIds.join(",")}:${JSON.stringify(prop.wireframe ?? null)}:${JSON.stringify(prop.design ?? null)}`;
}

function elementKey(element: Element): string {
  return `${element.lightId}:${element.label}:${element.start}:${element.stop}:${element.outputId ?? ""}`;
}

function lookKey(look: Look): string {
  return JSON.stringify({ name: look.name, slot: look.slot, style: look.style, overrides: look.overrides });
}

function playlistKey(row: LookPlaylist): string {
  return JSON.stringify({ name: row.name, slot: row.slot, lookIds: row.lookIds, durationTenths: row.durationTenths });
}

function idsUnique(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}
