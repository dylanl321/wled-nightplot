import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Prop } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileBackupStore } from "./store/backup-store.ts";
import { FileLightsStore } from "./store/lights-store.ts";
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
        measurements: { shape: "roofline", length: 5.9 },
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
