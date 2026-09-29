import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Light } from "@nightplot/shared";
import { FileLightsStore } from "./lights-store.ts";

const base: Light = {
  id: "light-garage",
  name: "Garage",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: "e8:9f:6d:7f:2a:04",
  firmware: "WLED 0.15.4",
  ledCount: 60,
  rgbw: false,
  reachability: "online",
  lastSeenAt: "2026-09-26T18:00:00.000Z",
  on: true,
  brightness: 128,
  enrolledAt: "2026-09-26T17:00:00.000Z",
  ledProductId: "led-ws281x-60-gpio16",
};

describe("lights store ledProductId", () => {
  it("refuses a backup when Segments reference missing Lights", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const file = join(dir, "lights.json");
    writeFileSync(file, JSON.stringify({ version: 1, lights: [], elements: [
      { id: "orphan", lightId: "missing", label: "Orphan", start: 0, stop: 1 },
    ] }));
    expect(() => new FileLightsStore(file).snapshotForBackup()).toThrow("backup refused");
  });

  it("persists a catalog id and treats a missing field as null", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const file = join(dir, "lights.json");
    const store = new FileLightsStore(file);
    store.upsert(base);
    expect(new FileLightsStore(file).findById(base.id)?.ledProductId).toBe(
      "led-ws281x-60-gpio16",
    );

    store.replace({ ...base, ledProductId: null });
    expect(new FileLightsStore(file).findById(base.id)?.ledProductId).toBeNull();

    writeFileSync(
      file,
      `${JSON.stringify({ version: 1, lights: [{ ...base, ledProductId: undefined }], elements: [] }, null, 2)}\n`,
    );
    expect(new FileLightsStore(file).findById(base.id)?.ledProductId).toBeNull();
  });

  it("tryLoadRaw treats a missing file as empty and refuses corrupt or invalid files", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const missing = join(dir, "missing.json");
    expect(new FileLightsStore(missing).tryLoadRaw()).toEqual({ ok: true, lights: [] });

    const valid = join(dir, "valid.json");
    const store = new FileLightsStore(valid);
    store.upsert(base);
    const loaded = store.tryLoadRaw();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.lights).toHaveLength(1);

    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{not-json");
    expect(new FileLightsStore(corrupt).tryLoadRaw()).toEqual({
      ok: false,
      error: "unreadable",
    });

    const invalid = join(dir, "invalid.json");
    writeFileSync(invalid, `${JSON.stringify({ version: 2, lights: [] })}\n`);
    expect(new FileLightsStore(invalid).tryLoadRaw()).toEqual({
      ok: false,
      error: "invalid",
    });
  });
});
