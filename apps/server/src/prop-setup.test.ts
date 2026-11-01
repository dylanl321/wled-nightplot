import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Prop } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileBackupStore } from "./store/backup-store.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { FileYardSceneStore } from "./store/yard-scene-store.ts";
import { FileLooksStore } from "./store/looks-store.ts";
import { FileSettingsStore } from "./store/settings-store.ts";

const base = {
  name: "Garage",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 60,
  rgbw: false,
  on: true,
  brightness: 128,
  segmentColor: "#ffa000",
  segments: [{ start: 0, stop: 60 }],
};

describe("prop-first setup", () => {
  it("saves a prop with no controller, refuses a prop that does not fit, and Applies one that does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-props-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    let segments = base.segments.map((row) => ({ ...row }));
    const write = vi.fn(async (_target: unknown, body: { seg?: { start: number; stop: number }[] }) => {
      if (body.seg) {
        const next = body.seg.filter((row) => row.stop > row.start).map((row) => ({ start: row.start, stop: row.stop }));
        if (next.length > 0) segments = next;
      }
      return true;
    });
    const app = createApp({
      store,
      settings: new FileSettingsStore(join(dir, "settings.json")),
      backups: new FileBackupStore(join(dir, "backups")),
      probe: async () => ({ kind: "found", snapshot: { ...base, segments } }),
      collect: async () => [],
      write,
      readLive: async () => null,
      readCfg: async () => ({ id: { name: "Garage" }, hw: { led: { ins: [{ len: 60 }] } } }),
      writeCfg: async () => true,
      readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
      readLedmap: async () => null,
      writeLedmap: async () => {},
      now: () => new Date("2026-10-31T20:00:00.000Z"),
    });

    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    expect(enrolled.status).toBe(201);
    const light = (await enrolled.json() as { light: { id: string; outputs: { id: string }[] } }).light;

    const roof = await app.request("/api/props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Front roof",
        kind: "roofline",
        unit: "ft",
        pitchMm: 100,
        measurements: { shape: "roofline", length: 40 },
      }),
    });
    expect(roof.status).toBe(200);
    const roofProp = (await roof.json() as { prop: Prop }).prop;
    expect(roofProp.lightId).toBeUndefined();
    expect(roofProp.design?.ledCount).toBe(122);
    expect(store.loadAttachments()).toEqual([]);

    const refused = await app.request(`/api/props/${roofProp.id}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lightId: light.id, outputId: light.outputs[0]!.id, startIndex: 0, apply: true }),
    });
    expect(refused.status).toBe(422);
    expect((await refused.json() as { message: string }).message).toContain("Nothing will be sent");
    expect(write).not.toHaveBeenCalled();
    expect(store.loadAttachments()).toEqual([]);

    const fit = await app.request("/api/props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Short eave",
        kind: "roofline",
        unit: "m",
        pitchMm: 100,
        measurements: { shape: "roofline", length: 6 },
      }),
    });
    const fitProp = (await fit.json() as { prop: Prop }).prop;
    expect(fitProp.design?.ledCount).toBe(60);
    const applied = await app.request(`/api/props/${fitProp.id}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lightId: light.id, outputId: light.outputs[0]!.id, startIndex: 0, apply: true }),
    });
    const appliedBody = await applied.json() as { message?: string; apply?: { matched?: boolean } };
    expect(applied.status, JSON.stringify(appliedBody)).toBe(200);
    expect(appliedBody.apply?.matched).toBe(true);
    expect(store.loadAttachments()).toEqual([
      expect.objectContaining({ propId: fitProp.id, lightId: light.id, startIndex: 0 }),
    ]);
    expect(store.loadProps().find((prop) => prop.id === roofProp.id)?.lightId).toBeUndefined();
  });
});

describe("prop yard point", () => {
  function appWith(store: FileLightsStore, dir: string, looks?: FileLooksStore) {
    return createApp({
      store,
      ...(looks ? { looks } : {}),
      settings: new FileSettingsStore(join(dir, "settings.json")),
      backups: new FileBackupStore(join(dir, "backups")),
      probe: async () => ({ kind: "found", snapshot: base }),
      collect: async () => [],
      write: vi.fn(async () => true),
      readLive: async () => null,
      readCfg: async () => null,
      writeCfg: async () => true,
      readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
      readLedmap: async () => null,
      writeLedmap: async () => {},
      now: () => new Date("2026-11-01T02:00:00.000Z"),
    });
  }

  it("brings a deleted prop back with its id, drawing, sections and spot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-restore-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const app = appWith(store, dir);
    const created = await app.request("/api/props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Box", kind: "window", unit: "m", pitchMm: 100, measurements: { shape: "window", width: 2, height: 2 } }),
    });
    const prop = (await created.json() as { prop: Prop }).prop;
    await app.request(`/api/props/${prop.id}/yard`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ yard: { x: 3, y: 0 } }) });
    const before = store.loadProps().find((row) => row.id === prop.id)!;
    await app.request(`/api/props/${prop.id}`, { method: "DELETE" });
    expect(store.loadProps().some((row) => row.id === prop.id)).toBe(false);

    const restored = await app.request(`/api/props/${prop.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prop: before }),
    });
    expect(restored.status).toBe(200);
    const body = await restored.json() as { prop: Prop; message: string };
    expect(body.message).toContain("not attached");
    const back = store.loadProps().find((row) => row.id === prop.id)!;
    expect(back.layout).toEqual(before.layout);
    expect(back.sections).toEqual(before.sections);
    expect(back.yard).toEqual({ x: 3, y: 0 });

    const twice = await app.request(`/api/props/${prop.id}/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prop: before }),
    });
    expect(twice.status).toBe(409);
    const wrong = await app.request("/api/props/other/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prop: before }),
    });
    expect(wrong.status).toBe(400);
  });

  it("saves where a prop sits, reads it back, keeps it through a path save, and refuses a bad point", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-yard-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const app = appWith(store, dir);
    const created = await app.request("/api/props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Front roof", kind: "roofline", unit: "ft", pitchMm: 100, measurements: { shape: "roofline", length: 10 } }),
    });
    const prop = (await created.json() as { prop: Prop }).prop;
    expect(prop.yard).toBeUndefined();

    const moved = await app.request(`/api/props/${prop.id}/yard`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: 3.25, y: -1.5 } }),
    });
    expect(moved.status).toBe(200);
    const body = await moved.json() as { prop: Prop; message: string };
    expect(body.prop.yard).toEqual({ x: 3.25, y: -1.5 });
    expect(body.message).toContain("Nothing was sent");
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard).toEqual({ x: 3.25, y: -1.5 });

    const pathSave = await app.request(`/api/props/${prop.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: store.loadProps().find((row) => row.id === prop.id)!.layout }),
    });
    expect(pathSave.status).toBe(200);
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard).toEqual({ x: 3.25, y: -1.5 });

    const bad = await app.request(`/api/props/${prop.id}/yard`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: "far", y: 0 } }),
    });
    expect(bad.status).toBe(400);
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard).toEqual({ x: 3.25, y: -1.5 });

    const missing = await app.request("/api/props/nope/yard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: 0, y: 0 } }),
    });
    expect(missing.status).toBe(404);

    const placed = await app.request(`/api/props/${prop.id}/yard`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: 3.25, y: -1.5, depth: 4, facing: 90, mount: "flat", heightM: 0.4 } }),
    });
    expect(placed.status).toBe(200);
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard).toEqual({
      x: 3.25, y: -1.5, depth: 4, facing: 90, mount: "flat", heightM: 0.4,
    });

    const nudged = await app.request(`/api/props/${prop.id}/yard`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: 4, y: -1.5 } }),
    });
    expect(nudged.status).toBe(200);
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard).toEqual({
      x: 4, y: -1.5, depth: 4, facing: 90, mount: "flat", heightM: 0.4,
    });

    const sideways = await app.request(`/api/props/${prop.id}/yard`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ yard: { x: 4, y: -1.5, mount: "sideways" } }),
    });
    expect(sideways.status).toBe(400);
    expect(store.loadProps().find((row) => row.id === prop.id)?.yard?.depth).toBe(4);
  });
  it("renames a prop, keeps its place in the list, deletes it, and drops it from Looks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-rename-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const looks = new FileLooksStore(join(dir, "looks.json"));
    const app = appWith(store, dir, looks);
    const make = async (label: string) => {
      const res = await app.request("/api/props", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, kind: "roofline", unit: "m", pitchMm: 100, measurements: { shape: "roofline", length: 2 } }),
      });
      return (await res.json() as { prop: Prop }).prop;
    };
    const first = await make("X");
    const second = await make("Line");

    const renamed = await app.request(`/api/props/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "  Box  " }),
    });
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { prop: Prop }).prop.label).toBe("Box");
    expect(store.loadProps().map((row) => row.label)).toEqual(["Box", "Line"]);

    const blank = await app.request(`/api/props/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "   " }),
    });
    expect(blank.status).toBe(400);

    // A path save keeps the list order too.
    await app.request(`/api/props/${first.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ layout: store.loadProps()[0]!.layout }),
    });
    expect(store.loadProps().map((row) => row.label)).toEqual(["Box", "Line"]);

    looks.save({
      version: 1,
      looks: [{
        id: "look-1",
        name: "Half and half",
        slot: 1,
        style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ff0000" },
        overrides: [{ propId: second.id, style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#00ff00" } }],
      }],
      playlists: [],
      schedule: null,
    });
    // A prop made after the Look is off in it until it is ticked.
    const third = await make("Star");
    expect(looks.read().looks[0]!.propIds).toEqual([first.id, second.id]);
    expect(looks.read().looks[0]!.propIds).not.toContain(third.id);

    const deleted = await app.request(`/api/props/${second.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const body = await deleted.json() as { message: string };
    expect(body.message).toContain("Deleted Line");
    expect(body.message).toContain("1 Look");
    expect(body.message).toContain("Nothing was sent");
    expect(store.loadProps().map((row) => row.id)).toEqual([first.id, third.id]);
    expect(looks.read().looks[0]!.overrides).toEqual([]);
    expect(looks.read().looks[0]!.propIds).toEqual([first.id]);

    const again = await app.request(`/api/props/${second.id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("reads live colours for an attached prop and does not invent a missing read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-yard-live-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    let leds: (string | null)[] | null = ["#00ff00", "#000000"];
    const app = createApp({
      store,
      settings: new FileSettingsStore(join(dir, "settings.json")),
      backups: new FileBackupStore(join(dir, "backups")),
      probe: async () => ({ kind: "found", snapshot: base }),
      collect: async () => [],
      write: vi.fn(async () => true),
      readLive: async () => (leds ? { source: "controller", leds } : null),
      readCfg: async () => null,
      writeCfg: async () => true,
      readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
      readLedmap: async () => null,
      writeLedmap: async () => {},
      now: () => new Date("2026-11-01T02:00:00.000Z"),
    });
    const empty = await app.request("/api/yard/live");
    expect(await empty.json()).toMatchObject({ lights: [] });

    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const light = (await enrolled.json() as { light: { id: string; outputs: { id: string }[] } }).light;
    const made = await app.request("/api/props", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Eave", kind: "roofline", unit: "m", pitchMm: 100, measurements: { shape: "roofline", length: 1 } }),
    });
    const prop = (await made.json() as { prop: Prop }).prop;
    const attached = await app.request(`/api/props/${prop.id}/attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lightId: light.id, outputId: light.outputs[0]!.id, startIndex: 0, apply: false }),
    });
    expect(attached.status).toBe(200);
    const live = await app.request("/api/yard/live");
    const body = await live.json() as { lights: { lightId: string; leds: string[] | null }[]; caption: string };
    expect(body.lights).toEqual([{ lightId: light.id, leds: ["#00ff00", "#000000"] }]);
    expect(body.caption).toContain("missing read");
    leds = null;
    const missed = await app.request("/api/yard/live") as Response;
    expect((await missed.json() as { lights: { leds: null }[] }).lights[0]?.leds).toBeNull();
  });

  it("keeps a house beside the lights file, and a missing file is no house", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-house-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const scene = new FileYardSceneStore(join(dir, "yard-scene.json"));
    const app = createApp({
      store,
      yardScene: scene,
      settings: new FileSettingsStore(join(dir, "settings.json")),
      backups: new FileBackupStore(join(dir, "backups")),
      probe: async () => ({ kind: "found", snapshot: base }),
      collect: async () => [],
      write: vi.fn(async () => true),
      readLive: async () => null,
      readCfg: async () => null,
      writeCfg: async () => true,
      readNativeFiles: async () => ({ cfgJson: "{}", presetsJson: "{}" }),
      readLedmap: async () => null,
      writeLedmap: async () => {},
      now: () => new Date("2026-11-01T02:00:00.000Z"),
    });
    expect(await (await app.request("/api/yard-scene")).json()).toEqual({ version: 1, house: null });
    const house = { footprint: [{ x: -4, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 6 }, { x: -4, z: 6 }], eaveM: 2.5, ridgeM: 1.2 };
    const saved = await app.request("/api/yard-scene", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ house }),
    });
    expect(saved.status).toBe(200);
    expect(scene.read().house).toEqual(house);
    expect(store.load()).toEqual([]);
    const cleared = await app.request("/api/yard-scene", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ house: null }),
    });
    expect((await cleared.json() as { house: null }).house).toBeNull();
  });
});
