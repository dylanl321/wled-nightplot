import type { ActivityEntry } from "./activity.ts";
import { macsMatch } from "./apply.ts";
import type { LedProduct } from "./strip/products.ts";
import type { Element, Light } from "./lights.ts";
import type { WledSnapshot } from "./wled/snapshot.ts";

export type BackupReason = "manual" | "pre-apply" | "pre-safe" | "pre-provision" |
  "pre-delete" | "pre-replacement" | "pre-catalog" | "pre-restore";

/** Whether this backup holds both native WLED files. Incomplete is an honest miss, not a restore source. */
export type DeviceCaptureStatus = "complete" | "incomplete" | "none";

export type BackupData = {
  lights: Light[];
  elements: Element[];
  products: LedProduct[];
  activity: ActivityEntry[];
};

/** Reference-only. Never sufficient to replay a full WLED configuration. */
export type ControllerReference = {
  hostKey: string;
  mac: string | null;
  ledCount: number;
  reported: Pick<WledSnapshot, "on" | "brightness" | "segments" | "segmentColor">;
  safeSettings?: Record<string, unknown>;
  stripSettings?: Record<string, unknown>;
};

/**
 * Opaque WLED Security & Updates exports (`/cfg.json` + `/presets.json`).
 * Passwords are excluded. Not a firmware image and not Hardware Done.
 */
export type WledBackupFiles = {
  cfgJson: string;
  presetsJson: string;
  lightId?: string;
  host?: string;
  mac?: string | null;
  firmware?: string | null;
  capturedAt?: string;
  secretsRemoved?: boolean;
};

export const WLED_NATIVE_BACKUP_CAPTION =
  "These are WLED's native configuration and presets files. Passwords are not included. This is not a firmware backup, not whole-device recovery, and not Hardware Done. Treat the files as private.";

export const WLED_NATIVE_RESTORE_CAPTION =
  "Uploads the saved configuration and presets to the chosen Light only. Nightplot data is not changed. This is not Apply and not Hardware Done. The box typically reboots after configuration restore. Passwords are not restored.";

export const WLED_SECRET_KEYS = new Set([
  "psk", "pwd", "password", "pass", "apikey", "api_key", "apitoken", "token",
]);

export type BackupDocument = {
  version: 1;
  id: string;
  at: string;
  reason: BackupReason;
  lightId: string | null;
  lightName: string | null;
  data: BackupData;
  controller: ControllerReference | null;
  deviceFiles?: WledBackupFiles | null;
  deviceCaptureStatus?: DeviceCaptureStatus;
  deviceCaptureError?: string | null;
};

export type BackupSummary = Pick<BackupDocument, "id" | "at" | "reason" | "lightId" | "lightName"> & {
  lightCount: number;
  segmentCount: number;
  productCount: number;
  hasControllerReference: boolean;
  hasDeviceFiles: boolean;
  deviceCaptureStatus: DeviceCaptureStatus;
  deviceCaptureError?: string | null;
  deviceMac?: string | null;
  deviceFirmware?: string | null;
  secretsRemoved?: boolean;
};

export type WledNativeIdentity = {
  lightId: string | null;
  host: string | null;
  mac: string | null;
  firmware: string | null;
  capturedAt: string | null;
  secretsRemoved: boolean;
};

export type WledRestoreReview = {
  ok: boolean;
  error?: "missing-device-files" | "identity-unknown" | "mac-mismatch";
  macMatch: boolean;
  firmwareMatch: boolean;
  requiresFirmwareConfirm: boolean;
  captured: WledNativeIdentity;
  live: { mac: string | null; firmware: string | null; host: string };
  message: string;
};

export function nativeFilesComplete(files: WledBackupFiles | null | undefined): boolean {
  return Boolean(files && files.cfgJson && files.presetsJson);
}

export function deviceCaptureOf(backup: Pick<BackupDocument, "deviceFiles" | "deviceCaptureStatus" | "deviceCaptureError">): {
  status: DeviceCaptureStatus;
  error: string | null;
} {
  if (backup.deviceCaptureStatus) {
    return { status: backup.deviceCaptureStatus, error: backup.deviceCaptureError ?? null };
  }
  return {
    status: nativeFilesComplete(backup.deviceFiles) ? "complete" : "none",
    error: backup.deviceCaptureError ?? null,
  };
}

export function capturedWledIdentity(backup: BackupDocument): WledNativeIdentity {
  const files = backup.deviceFiles;
  return {
    lightId: files?.lightId ?? backup.lightId,
    host: files?.host ?? backup.controller?.hostKey ?? null,
    mac: files?.mac ?? backup.controller?.mac ?? null,
    firmware: files?.firmware ?? null,
    capturedAt: files?.capturedAt ?? backup.at,
    secretsRemoved: Boolean(files?.secretsRemoved),
  };
}

export function stripWledBackupSecrets(raw: string): { text: string; secretsRemoved: boolean } {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WLED export was not a JSON object.");
  }
  const stripped = stripSecrets(parsed);
  if (!stripped.removed) return { text: raw, secretsRemoved: false };
  return { text: JSON.stringify(stripped.value), secretsRemoved: true };
}

export function buildWledBackupFiles(input: {
  cfgJson: string;
  presetsJson: string;
  light: Pick<Light, "id" | "hostname" | "port" | "mac" | "firmware">;
  liveMac?: string | null;
  liveFirmware?: string | null;
  capturedAt: string;
}): WledBackupFiles {
  const cfg = stripWledBackupSecrets(input.cfgJson);
  const presets = stripWledBackupSecrets(input.presetsJson);
  return {
    cfgJson: cfg.text,
    presetsJson: presets.text,
    lightId: input.light.id,
    host: `${input.light.hostname}:${input.light.port}`,
    mac: input.liveMac ?? input.light.mac,
    firmware: input.liveFirmware ?? input.light.firmware,
    capturedAt: input.capturedAt,
    secretsRemoved: cfg.secretsRemoved || presets.secretsRemoved,
  };
}

export function reviewWledNativeRestore(input: {
  backup: BackupDocument;
  light: Pick<Light, "id" | "name" | "hostname" | "port" | "mac" | "firmware">;
  liveMac: string | null;
  liveFirmware: string | null;
}): WledRestoreReview {
  const captured = capturedWledIdentity(input.backup);
  const live = {
    mac: input.liveMac ?? input.light.mac,
    firmware: input.liveFirmware ?? input.light.firmware,
    host: `${input.light.hostname}:${input.light.port}`,
  };
  if (!nativeFilesComplete(input.backup.deviceFiles)) {
    return {
      ok: false,
      error: "missing-device-files",
      macMatch: false,
      firmwareMatch: false,
      requiresFirmwareConfirm: false,
      captured,
      live,
      message: "This backup has no complete WLED configuration and presets files. Nothing was sent.",
    };
  }
  const macMatch = Boolean(captured.mac && live.mac && macsMatch(captured.mac, live.mac));
  const firmwareMatch = Boolean(captured.firmware && live.firmware && captured.firmware === live.firmware);
  const bothFirmware = Boolean(captured.firmware && live.firmware);
  if (!captured.mac || !live.mac) {
    return {
      ok: false,
      error: "identity-unknown",
      macMatch: false,
      firmwareMatch,
      requiresFirmwareConfirm: false,
      captured,
      live,
      message: "This export cannot be matched to a controller MAC. Nothing was sent.",
    };
  }
  if (!macMatch) {
    return {
      ok: false,
      error: "mac-mismatch",
      macMatch: false,
      firmwareMatch,
      requiresFirmwareConfirm: false,
      captured,
      live,
      message: "This export belongs to a different controller. Nothing was sent.",
    };
  }
  return {
    ok: true,
    macMatch: true,
    firmwareMatch,
    requiresFirmwareConfirm: bothFirmware && !firmwareMatch,
    captured,
    live,
    message: bothFirmware && !firmwareMatch
      ? "Firmware differs from the export. Confirm that before uploading. Passwords are not restored. This is not Hardware Done."
      : WLED_NATIVE_RESTORE_CAPTION,
  };
}

function stripSecrets(value: unknown): { value: unknown; removed: boolean } {
  if (Array.isArray(value)) {
    let removed = false;
    const next = value.map((item) => {
      const row = stripSecrets(item);
      removed = removed || row.removed;
      return row.value;
    });
    return { value: next, removed };
  }
  if (!value || typeof value !== "object") return { value, removed: false };
  const out: Record<string, unknown> = {};
  let removed = false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (WLED_SECRET_KEYS.has(key.toLowerCase()) && typeof child === "string" && child.length > 0) {
      removed = true;
      continue;
    }
    const row = stripSecrets(child);
    out[key] = row.value;
    removed = removed || row.removed;
  }
  return { value: out, removed };
}
