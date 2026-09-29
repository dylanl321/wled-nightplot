import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  backupPersistRefuseMessage,
  buildNightplotDataBackup,
  controllerCaptureFrom,
  diffNightplotData,
  incompleteFromController,
  parseNightplotDataBackup,
  type BackupReason,
  type ControllerReferenceCapture,
  type Light,
  type NightplotBackupDiff,
  type NightplotBackupMeta,
  type NightplotDataBackup,
  type NightplotDataSnapshot,
  type WledSnapshot,
} from "@nightplot/shared";
import type { FileActivityStore } from "./activity-store.ts";
import type { FileBackupStore } from "./backup-store.ts";
import type { FileLedProductsStore } from "./led-products-store.ts";
import type { FileLightsStore } from "./lights-store.ts";

export type BackupStores = {
  lights: FileLightsStore;
  products: FileLedProductsStore;
  activity: FileActivityStore;
  backups: FileBackupStore;
};

export function collectNightplotSnapshot(
  stores: Pick<BackupStores, "lights" | "products" | "activity">,
): { ok: true; nightplot: NightplotDataSnapshot } | { ok: false; message: string } {
  const lights = stores.lights.tryExport();
  if (!lights.ok) {
    return {
      ok: false,
      message: lights.error === "unreadable"
        ? "Nightplot Lights could not be read for a backup."
        : "Nightplot Lights are not a valid backup source.",
    };
  }
  const activity = stores.activity.tryExport();
  if (!activity.ok) {
    return {
      ok: false,
      message: "Activity history is not a valid backup source.",
    };
  }
  return {
    ok: true,
    nightplot: {
      lights: lights.lights,
      elements: lights.elements,
      ledProducts: stores.products.list(),
      activity: activity.entries,
    },
  };
}

export function persistNightplotBackup(
  stores: BackupStores,
  input: {
    id: string;
    createdAt: string;
    reason: BackupReason;
    note?: string | null;
    controller?: ControllerReferenceCapture | null;
  },
): { ok: true; meta: NightplotBackupMeta; backup: NightplotDataBackup } | { ok: false; message: string } {
  try {
    const collected = collectNightplotSnapshot(stores);
    if (!collected.ok) return collected;
    const backup = buildNightplotDataBackup({
      id: input.id,
      createdAt: input.createdAt,
      reason: input.reason,
      note: input.note,
      nightplot: collected.nightplot,
      controller: input.controller ?? null,
      incomplete: incompleteFromController(input.controller ?? null),
    });
    return { ok: true, meta: stores.backups.create(backup), backup };
  } catch {
    return { ok: false, message: backupPersistRefuseMessage("The change") };
  }
}

export function captureControllerReference(
  light: Light,
  state: WledSnapshot | null,
  cfg: unknown,
  capturedAt: string,
): ControllerReferenceCapture {
  return controllerCaptureFrom({ light, state, cfg, capturedAt });
}

export function currentBackupDiff(
  stores: Pick<BackupStores, "lights" | "products" | "activity">,
  backup: NightplotDataBackup,
): { ok: true; diff: NightplotBackupDiff } | { ok: false; message: string } {
  const collected = collectNightplotSnapshot(stores);
  if (!collected.ok) return collected;
  return { ok: true, diff: diffNightplotData(collected.nightplot, backup.nightplot) };
}

export function restoreNightplotData(
  stores: BackupStores,
  backup: NightplotDataBackup,
  input: { id: string; createdAt: string },
):
  | { ok: true; safety: NightplotBackupMeta; restored: NightplotDataBackup }
  | { ok: false; message: string } {
  const parsed = parseNightplotDataBackup(backup);
  if (!parsed) {
    return { ok: false, message: "This is not a valid Nightplot data backup. Nothing was restored." };
  }
  const safety = persistNightplotBackup(stores, {
    id: input.id,
    createdAt: input.createdAt,
    reason: "pre-restore",
  });
  if (!safety.ok) {
    return { ok: false, message: backupPersistRefuseMessage("Restore") };
  }
  try {
    writeNightplotFilesAtomic(
      {
        lights: stores.lights.path,
        products: stores.products.path,
        activity: stores.activity.path,
      },
      parsed.nightplot,
    );
    return { ok: true, safety: safety.meta, restored: parsed };
  } catch {
    return {
      ok: false,
      message:
        `Restore did not finish. Nightplot data was not replaced. A safety backup is saved as ${safety.meta.id}.`,
    };
  }
}

export function writeNightplotFilesAtomic(
  paths: { lights: string; products: string; activity: string },
  nightplot: NightplotDataSnapshot,
): void {
  const files = [
    {
      path: paths.lights,
      body: `${JSON.stringify({ version: 1, lights: nightplot.lights, elements: nightplot.elements }, null, 2)}\n`,
    },
    {
      path: paths.products,
      body: `${JSON.stringify({ version: 1, products: nightplot.ledProducts }, null, 2)}\n`,
    },
    {
      path: paths.activity,
      body: `${JSON.stringify({ version: 1, entries: nightplot.activity }, null, 2)}\n`,
    },
  ];
  const staged: { tmp: string; dest: string }[] = [];
  try {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      const tmp = `${file.path}.restore-tmp`;
      writeFileSync(tmp, file.body, "utf8");
      staged.push({ tmp, dest: file.path });
    }
    for (const row of staged) {
      renameSync(row.tmp, row.dest);
    }
  } catch (error) {
    for (const row of staged) {
      try {
        unlinkSync(row.tmp);
      } catch {
        /* keep the first failure */
      }
    }
    throw error;
  }
}
