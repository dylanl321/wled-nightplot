import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNightplotDataBackup, type Light } from "@nightplot/shared";
import { FileActivityStore } from "./activity-store.ts";
import { FileBackupStore } from "./backup-store.ts";
import { collectNightplotSnapshot, persistNightplotBackup, restoreNightplotData } from "./backup-service.ts";
import { FileLedProductsStore } from "./led-products-store.ts";
import { FileLightsStore } from "./lights-store.ts";

const light: Light = {
  id: "porch",
  name: "Porch",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: null,
  firmware: null,
  ledCount: 60,
  rgbw: false,
  reachability: "no-answer",
  lastSeenAt: null,
  on: null,
  brightness: null,
  enrolledAt: "2026-09-28T00:00:00.000Z",
  ledProductId: null,
};

describe("Nightplot backup service", () => {
  it("takes a pre-restore safety copy and atomically restores Nightplot files only", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-restore-"));
    const lights = new FileLightsStore(join(dir, "lights.json"));
    const products = new FileLedProductsStore(join(dir, "led-products.json"));
    const activity = new FileActivityStore(join(dir, "activity.json"));
    const backups = new FileBackupStore(join(dir, "backups"));
    const stores = { lights, products, activity, backups };
    lights.upsert(light);
    lights.replaceElements("porch", [{ id: "el-1", lightId: "porch", label: "Eave", start: 0, stop: 20 }]);
    const snapshot = persistNightplotBackup(stores, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdAt: "2026-09-29T00:00:00.000Z",
      reason: "manual",
    });
    expect(snapshot.ok).toBe(true);
    lights.remove("porch");
    expect(lights.findById("porch")).toBeUndefined();
    if (!snapshot.ok) return;
    const restored = restoreNightplotData(stores, snapshot.backup, {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: "2026-09-29T00:01:00.000Z",
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.safety.reason).toBe("pre-restore");
    expect(lights.findById("porch")?.name).toBe("Porch");
    expect(lights.elementsFor("porch").map((row) => row.label)).toEqual(["Eave"]);
    const collected = collectNightplotSnapshot(stores);
    expect(collected.ok).toBe(true);
  });

  it("refuses to restore an invalid payload without writing Nightplot files", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-restore-bad-"));
    const lights = new FileLightsStore(join(dir, "lights.json"));
    const stores = {
      lights,
      products: new FileLedProductsStore(join(dir, "led-products.json")),
      activity: new FileActivityStore(join(dir, "activity.json")),
      backups: new FileBackupStore(join(dir, "backups")),
    };
    lights.upsert(light);
    const restored = restoreNightplotData(stores, {
      ...buildNightplotDataBackup({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        createdAt: "2026-09-29T00:00:00.000Z",
        reason: "manual",
        nightplot: { lights: [light], elements: [], ledProducts: [], activity: [] },
      }),
      version: 2,
    } as never, {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      createdAt: "2026-09-29T00:01:00.000Z",
    });
    expect(restored.ok).toBe(false);
    expect(lights.findById("porch")?.id).toBe("porch");
  });
});
