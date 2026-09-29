import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACKUP_KEEP_AUTOMATIC_DEFAULT,
  BACKUP_KEEP_SAFETY_DEFAULT,
  backupRetentionClass,
  isBackupId,
  parseNightplotDataBackup,
  toBackupMeta,
  type NightplotBackupMeta,
  type NightplotDataBackup,
} from "@nightplot/shared";

export type BackupRead =
  | { ok: true; backup: NightplotDataBackup }
  | { ok: false; error: "not_found" | "invalid" };

export class FileBackupStore {
  constructor(
    private readonly dir: string,
    private readonly keepAutomatic = BACKUP_KEEP_AUTOMATIC_DEFAULT,
    private readonly keepSafety = BACKUP_KEEP_SAFETY_DEFAULT,
  ) {}

  get path(): string {
    return this.dir;
  }

  get retention(): { keepAutomatic: number; keepSafety: number } {
    return { keepAutomatic: this.keepAutomatic, keepSafety: this.keepSafety };
  }

  list(): { backups: NightplotBackupMeta[]; skippedInvalid: number } {
    mkdirSync(this.dir, { recursive: true });
    const backups: NightplotBackupMeta[] = [];
    let skippedInvalid = 0;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (!isBackupId(id)) {
        skippedInvalid += 1;
        continue;
      }
      const read = this.readId(id);
      if (!read.ok) {
        skippedInvalid += 1;
        continue;
      }
      backups.push(toBackupMeta(read.backup));
    }
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { backups, skippedInvalid };
  }

  get(id: string): BackupRead {
    if (!isBackupId(id)) return { ok: false, error: "invalid" };
    return this.readId(id);
  }

  create(backup: NightplotDataBackup): NightplotBackupMeta {
    const parsed = parseNightplotDataBackup(backup);
    if (!parsed) throw new Error("Nightplot backup failed validation.");
    mkdirSync(this.dir, { recursive: true });
    const dest = this.fileFor(parsed.id);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    renameSync(tmp, dest);
    this.prune(parsed.id);
    return toBackupMeta(parsed);
  }

  remove(id: string): boolean {
    if (!isBackupId(id)) return false;
    const dest = this.fileFor(id);
    try {
      unlinkSync(dest);
      return true;
    } catch (error) {
      if (isEnoent(error)) return false;
      throw error;
    }
  }

  private prune(keepId: string): void {
    const { backups } = this.list();
    const automatic = backups.filter((row) => backupRetentionClass(row.reason) === "automatic");
    const safety = backups.filter((row) => backupRetentionClass(row.reason) === "safety");
    const extra = [
      ...automatic.slice(this.keepAutomatic),
      ...safety.slice(this.keepSafety),
    ];
    for (const row of extra) {
      if (row.id === keepId) continue;
      this.remove(row.id);
    }
  }

  private readId(id: string): BackupRead {
    try {
      const parsed = parseNightplotDataBackup(JSON.parse(readFileSync(this.fileFor(id), "utf8")));
      if (!parsed || parsed.id !== id) return { ok: false, error: "invalid" };
      return { ok: true, backup: parsed };
    } catch (error) {
      if (isEnoent(error)) return { ok: false, error: "not_found" };
      return { ok: false, error: "invalid" };
    }
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
