import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deviceCaptureOf,
  nativeFilesComplete,
  parseBackupDocument,
  type BackupData,
  type BackupDocument,
  type BackupReason,
  type BackupSummary,
  type ControllerReference,
  type DeviceCaptureStatus,
  type NightplotSettings,
  type WledBackupFiles,
} from "@nightplot/shared";

const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MANAGED_BACKUPS = 100;

export function backupDigest(data: BackupData): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export class FileBackupStore {
  constructor(private readonly directory: string, private readonly retention: () => NightplotSettings["backupRetention"] =
    () => ({ enabled: false, limit: 100 })) {}

  rotationPreview(policy = this.retention()): { remove: BackupSummary[]; room: boolean } {
    const rows = this.list();
    const toRemove = policy.enabled ? Math.max(0, rows.length - policy.limit + 1) : 0;
    if (toRemove === 0) return { remove: [], room: rows.length < MAX_MANAGED_BACKUPS };
    const protectedIds = new Set<string>();
    // Keep the newest Nightplot recovery copy, and the latest complete device export per Light.
    if (rows[0]) protectedIds.add(rows[0].id);
    const seenLights = new Set<string>();
    for (const row of rows) if (row.hasDeviceFiles && row.lightId && !seenLights.has(row.lightId)) {
      protectedIds.add(row.id);
      seenLights.add(row.lightId);
    }
    const eligible = [...rows].reverse().filter((row) => !row.pinned && !protectedIds.has(row.id));
    return { remove: eligible.slice(0, toRemove), room: eligible.length >= toRemove };
  }

  setPinned(id: string, pinned: boolean): BackupSummary | null {
    const backup = this.read(id);
    if (!backup) return null;
    const next = { ...backup, pinned };
    const tmp = `${this.path(id)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path(id));
    return this.list().find((row) => row.id === id) ?? null;
  }

  create(input: { at: string; reason: BackupReason; lightId?: string | null;
    lightName?: string | null; data: BackupData; controller?: ControllerReference | null;
    deviceFiles?: WledBackupFiles | null; deviceCaptureStatus?: DeviceCaptureStatus;
    deviceCaptureError?: string | null }): BackupDocument {
    const rotation = this.rotationPreview();
    if (!rotation.room) {
      throw new Error("Backup storage has no eligible room. Download and clear an older backup or change retention; nothing was changed.");
    }
    const deviceCaptureStatus = input.deviceCaptureStatus
      ?? (nativeFilesComplete(input.deviceFiles) ? "complete" : "none");
    const backup: BackupDocument = { version: 1, id: randomUUID(), at: input.at,
      reason: input.reason, lightId: input.lightId ?? null, lightName: input.lightName ?? null,
      data: input.data, controller: input.controller ?? null, deviceFiles: input.deviceFiles ?? null,
      deviceCaptureStatus, deviceCaptureError: input.deviceCaptureError ?? null };
    mkdirSync(this.directory, { recursive: true });
    const path = this.path(backup.id);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmp, path);
    // Publish the new recovery copy before clearing any older one. A failed
    // rename must never cost an existing backup; a failed prune refuses the
    // dependent WLED write while leaving the newly published copy available.
    for (const row of rotation.remove) unlinkSync(this.path(row.id));
    return backup;
  }

  list(): BackupSummary[] {
    let names: string[];
    try { names = readdirSync(this.directory); }
    catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    return names.filter((name) => name.endsWith(".json") && BACKUP_ID.test(name.slice(0, -5)))
      .map((name) => this.read(name.slice(0, -5))!)
      .map((backup) => {
        const capture = deviceCaptureOf(backup);
        return {
          id: backup.id, at: backup.at, reason: backup.reason,
          lightId: backup.lightId, lightName: backup.lightName,
          lightCount: backup.data.lights.length, segmentCount: backup.data.elements.length,
          productCount: backup.data.products.length, hasControllerReference: backup.controller !== null,
          hasDeviceFiles: nativeFilesComplete(backup.deviceFiles),
          deviceCaptureStatus: capture.status,
          deviceCaptureError: capture.error,
          deviceMac: backup.deviceFiles?.mac ?? backup.controller?.mac ?? null,
          deviceFirmware: backup.deviceFiles?.firmware ?? null,
          secretsRemoved: Boolean(backup.deviceFiles?.secretsRemoved),
          pinned: backup.pinned === true,
        };
      })
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }

  read(id: string): BackupDocument | null {
    if (!BACKUP_ID.test(id)) return null;
    try {
      return parseBackupDocument(JSON.parse(readFileSync(this.path(id), "utf8")), id);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  remove(id: string): boolean {
    if (!BACKUP_ID.test(id)) return false;
    try { unlinkSync(this.path(id)); return true; }
    catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  private path(id: string): string { return join(this.directory, `${id}.json`); }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
