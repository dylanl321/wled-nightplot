import { parseActivityEntry, type ActivityEntry } from "./activity.ts";
import { normalizeLightLedProductId, type Element, type Light } from "./lights.ts";
import { validateLedProduct, type LedProduct } from "./strip/products.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export const NIGHTPLOT_DATA_BACKUP_KIND = "nightplot-data" as const;
export const NIGHTPLOT_DATA_BACKUP_VERSION = 1 as const;
export const BACKUP_KEEP_AUTOMATIC_DEFAULT = 40;
export const BACKUP_KEEP_SAFETY_DEFAULT = 10;
export const BACKUP_NOTE_MAX = 200;

export const CONTROLLER_CAPTURE_CAPTION =
  "Controller state and cfg are a reference copy for download. Nightplot does not restore them to the box. This is not a firmware backup and not Hardware Done.";

export const RESTORE_NIGHTPLOT_CAPTION =
  "Restores Lights, Segments, LED products, and Activity on this Nightplot. Nothing is sent to a controller. Preview and Apply are not started.";

export const CONTROLLER_STATE_MISSING = "Controller state was not available.";
export const CONTROLLER_CFG_MISSING = "Controller cfg was not available.";

export type BackupReason =
  | "manual"
  | "pre-apply"
  | "pre-provision"
  | "pre-safe"
  | "pre-delete-light"
  | "pre-catalog"
  | "pre-restore";

export type BackupCompleteness = "complete" | "partial";
export type BackupRetentionClass = "manual" | "automatic" | "safety";
export type ControllerCaptureGap = "state" | "cfg";

export const BACKUP_REASONS: readonly BackupReason[] = [
  "manual",
  "pre-apply",
  "pre-provision",
  "pre-safe",
  "pre-delete-light",
  "pre-catalog",
  "pre-restore",
];

export type NightplotDataSnapshot = {
  lights: Light[];
  elements: Element[];
  ledProducts: LedProduct[];
  activity: ActivityEntry[];
};

export type ControllerReferenceCapture = {
  kind: "wled-reference";
  lightId: string;
  lightName: string;
  host: string;
  mac: string | null;
  firmware: string | null;
  capturedAt: string;
  state: WledSnapshot | null;
  cfg: unknown | null;
  missing: ControllerCaptureGap[];
};

export type NightplotDataBackup = {
  kind: typeof NIGHTPLOT_DATA_BACKUP_KIND;
  version: typeof NIGHTPLOT_DATA_BACKUP_VERSION;
  id: string;
  createdAt: string;
  reason: BackupReason;
  note: string | null;
  completeness: BackupCompleteness;
  incomplete: string[];
  nightplot: NightplotDataSnapshot;
  controller: ControllerReferenceCapture | null;
};

export type NightplotBackupCounts = {
  lights: number;
  elements: number;
  ledProducts: number;
  activity: number;
};

export type NightplotBackupMeta = {
  id: string;
  createdAt: string;
  reason: BackupReason;
  reasonLabel: string;
  note: string | null;
  completeness: BackupCompleteness;
  incomplete: string[];
  counts: NightplotBackupCounts;
  hasControllerCapture: boolean;
  controllerCaption: string | null;
};

export type BackupNamedChange = { id: string; name: string };

export type NightplotBackupDiff = {
  lights: {
    wouldAdd: BackupNamedChange[];
    wouldRemove: BackupNamedChange[];
    wouldChange: BackupNamedChange[];
  };
  elements: {
    current: number;
    backup: number;
    wouldAdd: number;
    wouldRemove: number;
    wouldChange: number;
  };
  ledProducts: {
    wouldAdd: BackupNamedChange[];
    wouldRemove: BackupNamedChange[];
    wouldChange: BackupNamedChange[];
  };
  activity: { current: number; backup: number };
  summary: string;
};

const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBackupId(value: string): boolean {
  return BACKUP_ID.test(value);
}

export function backupReasonLabel(reason: BackupReason): string {
  switch (reason) {
    case "manual":
      return "Saved backup";
    case "pre-apply":
      return "Before Apply";
    case "pre-provision":
      return "Before Strip Apply";
    case "pre-safe":
      return "Before Safe settings";
    case "pre-delete-light":
      return "Before removing a Light";
    case "pre-catalog":
      return "Before catalog change";
    case "pre-restore":
      return "Before restore";
  }
}

export function backupRetentionClass(reason: BackupReason): BackupRetentionClass {
  if (reason === "manual") return "manual";
  if (reason === "pre-restore") return "safety";
  return "automatic";
}

export function backupPersistRefuseMessage(action: string): string {
  return `Could not save the required Nightplot backup. ${action} was not sent.`;
}

export function normalizeBackupNote(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const note = value.trim();
  if (!note) return null;
  return note.slice(0, BACKUP_NOTE_MAX);
}

export function parseStoredElement(value: unknown): Element | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Element>;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.lightId !== "string" ||
    !row.lightId ||
    typeof row.label !== "string" ||
    typeof row.start !== "number" ||
    !Number.isFinite(row.start) ||
    typeof row.stop !== "number" ||
    !Number.isFinite(row.stop)
  ) {
    return null;
  }
  return {
    id: row.id,
    lightId: row.lightId,
    label: row.label,
    start: row.start,
    stop: row.stop,
  };
}

export function parseStoredLight(value: unknown): Light | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.name !== "string") return null;
  if (typeof row.controllerKind !== "string" || !row.controllerKind) return null;
  if (typeof row.stripKind !== "string" || !row.stripKind) return null;
  if (typeof row.hostname !== "string" || !row.hostname) return null;
  if (!Number.isInteger(row.port) || (row.port as number) < 1 || (row.port as number) > 65535) {
    return null;
  }
  if (typeof row.hostKey !== "string" || !row.hostKey) return null;
  if (!(row.mac === null || typeof row.mac === "string")) return null;
  if (!(row.firmware === null || typeof row.firmware === "string")) return null;
  if (!Number.isInteger(row.ledCount) || (row.ledCount as number) < 0) return null;
  if (typeof row.rgbw !== "boolean") return null;
  if (row.reachability !== "online" && row.reachability !== "no-answer") return null;
  if (!(row.lastSeenAt === null || typeof row.lastSeenAt === "string")) return null;
  if (!(row.on === null || typeof row.on === "boolean")) return null;
  if (!(row.brightness === null || typeof row.brightness === "number")) return null;
  if (typeof row.enrolledAt !== "string" || !Number.isFinite(Date.parse(row.enrolledAt))) return null;

  const light: Light = {
    id: row.id,
    name: row.name,
    controllerKind: row.controllerKind,
    stripKind: row.stripKind,
    hostname: row.hostname,
    port: row.port as number,
    hostKey: row.hostKey,
    mac: row.mac as string | null,
    firmware: row.firmware as string | null,
    ledCount: row.ledCount as number,
    rgbw: row.rgbw,
    reachability: row.reachability,
    lastSeenAt: row.lastSeenAt as string | null,
    on: row.on as boolean | null,
    brightness: row.brightness as number | null,
    enrolledAt: row.enrolledAt,
    ledProductId: normalizeLightLedProductId(row.ledProductId),
  };
  if (row.nameSource === "info" || row.nameSource === "cfg") light.nameSource = row.nameSource;
  if (row.staleInfoName === null || typeof row.staleInfoName === "string") {
    light.staleInfoName = row.staleInfoName as string | null;
  }
  if (row.lastSnapshot === null || (row.lastSnapshot && typeof row.lastSnapshot === "object")) {
    light.lastSnapshot = row.lastSnapshot as Light["lastSnapshot"];
  }
  if (row.lastSnapshotAt === null || typeof row.lastSnapshotAt === "string") {
    light.lastSnapshotAt = row.lastSnapshotAt as string | null;
  }
  return light;
}

export function parseStoredLedProduct(value: unknown): LedProduct | null {
  if (!value || typeof value !== "object") return null;
  const issue = validateLedProduct(value as LedProduct);
  if (issue) return null;
  const row = value as LedProduct;
  if (typeof row.id !== "string" || !row.id) return null;
  return row;
}

export function parseControllerCapture(value: unknown): ControllerReferenceCapture | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ControllerReferenceCapture>;
  if (row.kind !== "wled-reference") return null;
  if (typeof row.lightId !== "string" || !row.lightId) return null;
  if (typeof row.lightName !== "string") return null;
  if (typeof row.host !== "string" || !row.host) return null;
  if (!(row.mac === null || typeof row.mac === "string")) return null;
  if (!(row.firmware === null || typeof row.firmware === "string")) return null;
  if (typeof row.capturedAt !== "string" || !Number.isFinite(Date.parse(row.capturedAt))) return null;
  if (!(row.state === null || (row.state && typeof row.state === "object"))) return null;
  if (!(row.cfg === null || (row.cfg && typeof row.cfg === "object"))) return null;
  if (!Array.isArray(row.missing)) return null;
  const missing: ControllerCaptureGap[] = [];
  for (const gap of row.missing) {
    if (gap !== "state" && gap !== "cfg") return null;
    if (!missing.includes(gap)) missing.push(gap);
  }
  return {
    kind: "wled-reference",
    lightId: row.lightId,
    lightName: row.lightName,
    host: row.host,
    mac: row.mac,
    firmware: row.firmware,
    capturedAt: row.capturedAt,
    state: row.state as WledSnapshot | null,
    cfg: row.cfg,
    missing,
  };
}

export function parseNightplotDataSnapshot(value: unknown): NightplotDataSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NightplotDataSnapshot>;
  if (!Array.isArray(row.lights) || !Array.isArray(row.elements) ||
    !Array.isArray(row.ledProducts) || !Array.isArray(row.activity)) {
    return null;
  }
  const lights: Light[] = [];
  for (const light of row.lights) {
    const parsed = parseStoredLight(light);
    if (!parsed) return null;
    lights.push(parsed);
  }
  const elements: Element[] = [];
  for (const element of row.elements) {
    const parsed = parseStoredElement(element);
    if (!parsed) return null;
    elements.push(parsed);
  }
  const ledProducts: LedProduct[] = [];
  for (const product of row.ledProducts) {
    const parsed = parseStoredLedProduct(product);
    if (!parsed) return null;
    ledProducts.push(parsed);
  }
  const activity: ActivityEntry[] = [];
  for (const entry of row.activity) {
    const parsed = parseActivityEntry(entry);
    if (!parsed) return null;
    activity.push(parsed);
  }
  return { lights, elements, ledProducts, activity };
}

export function parseNightplotDataBackup(value: unknown): NightplotDataBackup | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NightplotDataBackup>;
  if (row.kind !== NIGHTPLOT_DATA_BACKUP_KIND || row.version !== NIGHTPLOT_DATA_BACKUP_VERSION) {
    return null;
  }
  if (typeof row.id !== "string" || !isBackupId(row.id)) return null;
  if (typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) return null;
  if (!BACKUP_REASONS.includes(row.reason as BackupReason)) return null;
  if (!(row.note === null || typeof row.note === "string")) return null;
  if (row.completeness !== "complete" && row.completeness !== "partial") return null;
  if (!Array.isArray(row.incomplete) || !row.incomplete.every((item) => typeof item === "string")) {
    return null;
  }
  if (row.completeness === "complete" && row.incomplete.length > 0) return null;
  if (row.completeness === "partial" && row.incomplete.length === 0) return null;
  const nightplot = parseNightplotDataSnapshot(row.nightplot);
  if (!nightplot) return null;
  let controller: ControllerReferenceCapture | null = null;
  if (row.controller !== null && row.controller !== undefined) {
    controller = parseControllerCapture(row.controller);
    if (!controller) return null;
  }
  return {
    kind: NIGHTPLOT_DATA_BACKUP_KIND,
    version: NIGHTPLOT_DATA_BACKUP_VERSION,
    id: row.id,
    createdAt: row.createdAt,
    reason: row.reason as BackupReason,
    note: typeof row.note === "string" ? row.note.slice(0, BACKUP_NOTE_MAX) || null : null,
    completeness: row.completeness,
    incomplete: row.incomplete,
    nightplot,
    controller,
  };
}

export function backupCounts(nightplot: NightplotDataSnapshot): NightplotBackupCounts {
  return {
    lights: nightplot.lights.length,
    elements: nightplot.elements.length,
    ledProducts: nightplot.ledProducts.length,
    activity: nightplot.activity.length,
  };
}

export function toBackupMeta(backup: NightplotDataBackup): NightplotBackupMeta {
  return {
    id: backup.id,
    createdAt: backup.createdAt,
    reason: backup.reason,
    reasonLabel: backupReasonLabel(backup.reason),
    note: backup.note,
    completeness: backup.completeness,
    incomplete: backup.incomplete,
    counts: backupCounts(backup.nightplot),
    hasControllerCapture: backup.controller !== null,
    controllerCaption: backup.controller ? CONTROLLER_CAPTURE_CAPTION : null,
  };
}

export function controllerCaptureFrom(input: {
  light: Pick<Light, "id" | "name" | "hostname" | "port" | "mac" | "firmware">;
  state: WledSnapshot | null;
  cfg: unknown;
  capturedAt: string;
}): ControllerReferenceCapture {
  const missing: ControllerCaptureGap[] = [];
  const cfg = input.cfg && typeof input.cfg === "object" ? input.cfg : null;
  if (!input.state) missing.push("state");
  if (!cfg) missing.push("cfg");
  return {
    kind: "wled-reference",
    lightId: input.light.id,
    lightName: input.light.name,
    host: `${input.light.hostname}:${input.light.port}`,
    mac: input.light.mac,
    firmware: input.light.firmware,
    capturedAt: input.capturedAt,
    state: input.state,
    cfg,
    missing,
  };
}

export function incompleteFromController(capture: ControllerReferenceCapture | null): string[] {
  if (!capture) return [];
  return capture.missing.map((gap) =>
    gap === "state" ? CONTROLLER_STATE_MISSING : CONTROLLER_CFG_MISSING,
  );
}

export function buildNightplotDataBackup(input: {
  id: string;
  createdAt: string;
  reason: BackupReason;
  note?: string | null;
  nightplot: NightplotDataSnapshot;
  controller?: ControllerReferenceCapture | null;
  incomplete?: string[];
}): NightplotDataBackup {
  const incomplete = (input.incomplete ?? incompleteFromController(input.controller ?? null))
    .filter((row) => row.trim().length > 0);
  const backup: NightplotDataBackup = {
    kind: NIGHTPLOT_DATA_BACKUP_KIND,
    version: NIGHTPLOT_DATA_BACKUP_VERSION,
    id: input.id,
    createdAt: input.createdAt,
    reason: input.reason,
    note: normalizeBackupNote(input.note),
    completeness: incomplete.length > 0 ? "partial" : "complete",
    incomplete,
    nightplot: input.nightplot,
    controller: input.controller ?? null,
  };
  const parsed = parseNightplotDataBackup(backup);
  if (!parsed) throw new Error("Nightplot backup failed validation.");
  return parsed;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function lightCompare(light: Light): unknown {
  return {
    id: light.id,
    name: light.name,
    hostKey: light.hostKey,
    hostname: light.hostname,
    port: light.port,
    mac: light.mac,
    ledCount: light.ledCount,
    stripKind: light.stripKind,
    ledProductId: light.ledProductId,
  };
}

function elementCompare(element: Element): unknown {
  return {
    id: element.id,
    lightId: element.lightId,
    label: element.label,
    start: element.start,
    stop: element.stop,
  };
}

function productCompare(product: LedProduct): unknown {
  return {
    id: product.id,
    label: product.label,
    driverId: product.driverId,
    formFactor: product.formFactor,
    notes: product.notes,
    defaultLength: product.defaultLength ?? null,
    defaultGpio: product.defaultGpio ?? null,
    pitchMm: product.pitchMm ?? null,
    sectionLengthMm: product.sectionLengthMm ?? null,
  };
}

function namedMap<T extends { id: string }>(
  rows: T[],
  nameOf: (row: T) => string,
): Map<string, { row: T; name: string }> {
  const map = new Map<string, { row: T; name: string }>();
  for (const row of rows) map.set(row.id, { row, name: nameOf(row) });
  return map;
}

function namedDiff<T extends { id: string }>(
  current: T[],
  backup: T[],
  nameOf: (row: T) => string,
  compare: (row: T) => unknown,
): {
  wouldAdd: BackupNamedChange[];
  wouldRemove: BackupNamedChange[];
  wouldChange: BackupNamedChange[];
} {
  const now = namedMap(current, nameOf);
  const then = namedMap(backup, nameOf);
  const wouldAdd: BackupNamedChange[] = [];
  const wouldRemove: BackupNamedChange[] = [];
  const wouldChange: BackupNamedChange[] = [];
  for (const [id, item] of then) {
    if (!now.has(id)) wouldAdd.push({ id, name: item.name });
  }
  for (const [id, item] of now) {
    const previous = then.get(id);
    if (!previous) {
      wouldRemove.push({ id, name: item.name });
      continue;
    }
    if (stableJson(compare(item.row)) !== stableJson(compare(previous.row))) {
      wouldChange.push({ id, name: item.name });
    }
  }
  return { wouldAdd, wouldRemove, wouldChange };
}

export function diffNightplotData(
  current: NightplotDataSnapshot,
  backup: NightplotDataSnapshot,
): NightplotBackupDiff {
  const lights = namedDiff(current.lights, backup.lights, (row) => row.name, lightCompare);
  const ledProducts = namedDiff(
    current.ledProducts,
    backup.ledProducts,
    (row) => row.label,
    productCompare,
  );
  const nowElements = namedMap(current.elements, (row) => row.label);
  const thenElements = namedMap(backup.elements, (row) => row.label);
  let wouldAdd = 0;
  let wouldRemove = 0;
  let wouldChange = 0;
  for (const [id, item] of thenElements) {
    if (!nowElements.has(id)) wouldAdd += 1;
    else if (stableJson(elementCompare(item.row)) !==
      stableJson(elementCompare(nowElements.get(id)!.row))) {
      wouldChange += 1;
    }
  }
  for (const id of nowElements.keys()) {
    if (!thenElements.has(id)) wouldRemove += 1;
  }
  const activity = { current: current.activity.length, backup: backup.activity.length };
  const summary = [
    summarizeNamed("Lights", lights),
    summarizeElements(current.elements.length, backup.elements.length, {
      wouldAdd,
      wouldRemove,
      wouldChange,
    }),
    summarizeNamed("LED products", ledProducts),
    activity.current === activity.backup
      ? `Activity count matches (${activity.backup}).`
      : `Activity ${activity.backup} in this backup, ${activity.current} now.`,
    RESTORE_NIGHTPLOT_CAPTION,
  ].join(" ");
  return {
    lights,
    elements: {
      current: current.elements.length,
      backup: backup.elements.length,
      wouldAdd,
      wouldRemove,
      wouldChange,
    },
    ledProducts,
    activity,
    summary,
  };
}

function summarizeNamed(
  noun: string,
  change: { wouldAdd: BackupNamedChange[]; wouldRemove: BackupNamedChange[]; wouldChange: BackupNamedChange[] },
): string {
  if (change.wouldAdd.length === 0 && change.wouldRemove.length === 0 && change.wouldChange.length === 0) {
    return `${noun} match.`;
  }
  const parts: string[] = [];
  if (change.wouldAdd.length) parts.push(`add ${change.wouldAdd.length}`);
  if (change.wouldRemove.length) parts.push(`remove ${change.wouldRemove.length}`);
  if (change.wouldChange.length) parts.push(`change ${change.wouldChange.length}`);
  return `${noun} would ${parts.join(", ")}.`;
}

function summarizeElements(
  current: number,
  backup: number,
  change: { wouldAdd: number; wouldRemove: number; wouldChange: number },
): string {
  if (change.wouldAdd === 0 && change.wouldRemove === 0 && change.wouldChange === 0 && current === backup) {
    return "Segments match.";
  }
  const parts: string[] = [];
  if (change.wouldAdd) parts.push(`add ${change.wouldAdd}`);
  if (change.wouldRemove) parts.push(`remove ${change.wouldRemove}`);
  if (change.wouldChange) parts.push(`change ${change.wouldChange}`);
  if (parts.length === 0) return `Segments ${backup} in this backup, ${current} now.`;
  return `Segments would ${parts.join(", ")}.`;
}
