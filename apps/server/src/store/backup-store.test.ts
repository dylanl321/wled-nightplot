import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileBackupStore, MAX_MANAGED_BACKUPS } from "./backup-store.ts";

describe("managed backup storage", () => {
  it("keeps at most 100 without silent deletion and rejects path-shaped IDs", () => {
    const store = new FileBackupStore(mkdtempSync(join(tmpdir(), "nightplot-backups-")));
    const data = { lights: [], elements: [], products: [], activity: [] };
    for (let index = 0; index < MAX_MANAGED_BACKUPS; index += 1) {
      store.create({ at: new Date(index * 1000).toISOString(), reason: "manual", data });
    }
    expect(store.list()).toHaveLength(MAX_MANAGED_BACKUPS);
    expect(() => store.create({ at: new Date().toISOString(), reason: "manual", data })).toThrow(/no eligible room/);
    expect(store.list()).toHaveLength(MAX_MANAGED_BACKUPS);
    expect(store.read("../../lights.json")).toBeNull();
    expect(store.remove("../../lights.json")).toBe(false);
    expect(store.remove(store.list()[0]!.id)).toBe(true);
    expect(store.list()).toHaveLength(MAX_MANAGED_BACKUPS - 1);
  });

  it("records an explicit incomplete device capture without inventing native files", () => {
    const store = new FileBackupStore(mkdtempSync(join(tmpdir(), "nightplot-backups-")));
    const created = store.create({
      at: new Date().toISOString(), reason: "pre-replacement",
      data: { lights: [], elements: [], products: [], activity: [] },
      deviceCaptureStatus: "incomplete",
      deviceCaptureError: "WLED did not return both native configuration and presets files.",
    });
    expect(created.deviceCaptureStatus).toBe("incomplete");
    expect(store.list()[0]).toMatchObject({
      deviceCaptureStatus: "incomplete",
      hasDeviceFiles: false,
      deviceCaptureError: "WLED did not return both native configuration and presets files.",
    });
  });

  it("does not silently ignore a corrupted backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "nightplot-backups-"));
    const store = new FileBackupStore(directory);
    const created = store.create({ at: new Date().toISOString(), reason: "manual",
      data: { lights: [], elements: [], products: [], activity: [] } });
    writeFileSync(join(directory, `${created.id}.json`), "broken JSON");
    expect(() => store.list()).toThrow();
    expect(() => store.create({ at: new Date().toISOString(), reason: "manual",
      data: { lights: [], elements: [], products: [], activity: [] } })).toThrow();
  });

  it("lists an earlier nightplot-data v1 file as Nightplot data, not a native WLED export", () => {
    const directory = mkdtempSync(join(tmpdir(), "nightplot-backups-"));
    const id = "03c75c3e-9846-458e-b458-8739f0bff750";
    writeFileSync(join(directory, `${id}.json`), `${JSON.stringify({
      kind: "nightplot-data", version: 1, id, createdAt: "2026-09-29T00:46:38.735Z",
      reason: "manual", nightplot: { lights: [], elements: [], ledProducts: [], activity: [] },
      controller: null,
    })}\n`);
    const store = new FileBackupStore(directory);
    expect(store.list()).toMatchObject([{ id, reason: "manual", hasDeviceFiles: false,
      deviceCaptureStatus: "none", lightCount: 0 }]);
  });

  it("rotates only unpinned older copies, preserving latest recovery and complete WLED copies", () => {
    const policy = { enabled: true, limit: 4 };
    const store = new FileBackupStore(mkdtempSync(join(tmpdir(), "nightplot-retention-")), () => policy);
    const data = { lights: [], elements: [], products: [], activity: [] };
    const add = (at: number, lightId?: string, device = false) => store.create({
      at: new Date(at * 1000).toISOString(), reason: "manual", lightId, data,
      deviceFiles: device ? { cfgJson: "{}", presetsJson: "{}" } : undefined,
    });
    const first = add(1);
    const device = add(2, "light-1", true);
    const pinned = add(3);
    store.setPinned(pinned.id, true);
    add(4);
    expect(store.rotationPreview().remove.map((row) => row.id)).toEqual([first.id]);
    add(5);
    expect(store.read(first.id)).toBeNull();
    expect(store.read(device.id)).not.toBeNull();
    expect(store.read(pinned.id)?.pinned).toBe(true);
    expect(store.list()).toHaveLength(4);
    policy.limit = 1;
    expect(store.rotationPreview().room).toBe(false);
    expect(() => add(6)).toThrow(/no eligible room/);
  });
});
