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

  it("migrates a pre-fleet Light to one output without dropping Segments", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const file = join(dir, "lights.json");
    writeFileSync(
      file,
      `${JSON.stringify({
        version: 1,
        lights: [{ ...base }],
        elements: [{ id: "roof", lightId: base.id, label: "Roofline", start: 0, stop: 20 }],
      })}\n`,
    );
    const store = new FileLightsStore(file);
    const light = store.findById(base.id);
    expect(light?.outputs).toEqual([
      expect.objectContaining({ index: 0, start: 0, ledCount: 60, stripKind: "ws281x" }),
    ]);
    expect(store.elementsFor(base.id)).toEqual([
      expect.objectContaining({ id: "roof", start: 0, stop: 20 }),
    ]);
  });

  it("treats a missing props list as none and keeps a saved Prop", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const file = join(dir, "lights.json");
    writeFileSync(
      file,
      `${JSON.stringify({
        version: 1,
        lights: [{ ...base }],
        elements: [{ id: "top", lightId: base.id, label: "Front · top", start: 0, stop: 10 }],
      })}\n`,
    );
    const store = new FileLightsStore(file);
    expect(store.propsFor(base.id)).toEqual([]);
    store.replaceElements(base.id, [
      { id: "top", lightId: base.id, label: "Front · top", start: 0, stop: 10 },
      { id: "right", lightId: base.id, label: "Front · right", start: 10, stop: 20 },
    ]);
    store.replaceProps(base.id, [{
      id: "prop-window",
      lightId: base.id,
      label: "Front",
      kind: "window",
      elementIds: ["top", "right"],
    }]);
    expect(new FileLightsStore(file).propsFor(base.id)).toEqual([
      expect.objectContaining({ id: "prop-window", label: "Front", kind: "window" }),
    ]);
  });

  it("drops a Prop when replaceElements removes every Segment it named", () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-lights-"));
    const file = join(dir, "lights.json");
    const store = new FileLightsStore(file);
    store.upsert(base);
    store.replaceElements(base.id, [
      { id: "top", lightId: base.id, label: "Front · top", start: 0, stop: 10 },
    ]);
    store.replaceProps(base.id, [{
      id: "prop-window",
      lightId: base.id,
      label: "Front",
      kind: "window",
      elementIds: ["top"],
    }]);
    store.replaceElements(base.id, []);
    expect(store.propsFor(base.id)).toEqual([]);
  });
});
