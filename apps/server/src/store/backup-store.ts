import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BackupData, BackupDocument, BackupReason, BackupSummary, ControllerReference, WledBackupFiles } from "@nightplot/shared";

const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_MANAGED_BACKUPS = 100;

export function backupDigest(data: BackupData): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export class FileBackupStore {
  constructor(private readonly directory: string) {}

  create(input: { at: string; reason: BackupReason; lightId?: string | null;
    lightName?: string | null; data: BackupData; controller?: ControllerReference | null;
    deviceFiles?: WledBackupFiles | null }): BackupDocument {
    if (this.list().length >= MAX_MANAGED_BACKUPS) {
      throw new Error("Backup storage is full. Download and clear an older backup first. Nothing was changed.");
    }
    const backup: BackupDocument = { version: 1, id: randomUUID(), at: input.at,
      reason: input.reason, lightId: input.lightId ?? null, lightName: input.lightName ?? null,
      data: input.data, controller: input.controller ?? null, deviceFiles: input.deviceFiles ?? null };
    mkdirSync(this.directory, { recursive: true });
    const path = this.path(backup.id);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(backup, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(tmp, path);
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
      .map((backup) => ({ id: backup.id, at: backup.at, reason: backup.reason,
        lightId: backup.lightId, lightName: backup.lightName,
        lightCount: backup.data.lights.length, segmentCount: backup.data.elements.length,
        productCount: backup.data.products.length, hasControllerReference: backup.controller !== null,
        hasDeviceFiles: Boolean(backup.deviceFiles?.cfgJson && backup.deviceFiles?.presetsJson) }))
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }

  read(id: string): BackupDocument | null {
    if (!BACKUP_ID.test(id)) return null;
    try {
      const value = JSON.parse(readFileSync(this.path(id), "utf8")) as BackupDocument;
      if (value.version !== 1 || value.id !== id || !value.data ||
        !Array.isArray(value.data.lights) || !Array.isArray(value.data.elements) ||
        !Array.isArray(value.data.products) || !Array.isArray(value.data.activity) ||
        typeof value.at !== "string" || typeof value.reason !== "string" ||
        (value.deviceFiles != null && (typeof value.deviceFiles.cfgJson !== "string" ||
          typeof value.deviceFiles.presetsJson !== "string"))) {
        throw new Error(`Invalid backup ${id}; it was not ignored or overwritten.`);
      }
      return value;
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
