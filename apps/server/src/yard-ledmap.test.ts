import { mkdtempSync } from "node:fs";
import { once } from "node:events";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countLayout,
  defaultSections,
  layoutFromMeasurements,
  parseLedmapJson,
  type Element,
  type Prop,
} from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileBackupStore } from "./store/backup-store.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { FileLooksStore } from "./store/looks-store.ts";
import { createFixtureBox } from "./wled-fixture-box.ts";
import { createWledCfgReader, createWledCfgWriter } from "./wled/cfg.ts";
import { probeWled } from "./wled/client.ts";

/**
 * Yard check against a fixture box (a stand-in for WLED, not WLED): a Light
 * pushed with several motion maps compares every map file, so a difference in
 * a non-zero slot is a mismatch even when ledmap.json is right.
 * This is not Hardware Done.
 */
const servers: Server[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); });

const layout = layoutFromMeasurements({ units: "m", pitchM: 0.1, shape: "zigzag", params: { width: 1, height: 1, passes: 4 } })!;
const LIGHTS = countLayout(layout).total;
const style = { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" };

async function yardWithBush() {
  const box = createFixtureBox({ name: "Porch", ledCount: LIGHTS });
  const http = box.listen(0, "127.0.0.1");
  servers.push(http);
  await once(http, "listening");
  const port = (http.address() as { port: number }).port;
  const dir = mkdtempSync(join(tmpdir(), "nightplot-yard-ledmap-"));
  const store = new FileLightsStore(join(dir, "lights.json"));
  const app = createApp({
    store,
    backups: new FileBackupStore(join(dir, "backups")),
    looks: new FileLooksStore(join(dir, "looks.json")),
    probe: (target) => probeWled(target, fetch, 500),
    write: async () => true,
    readLive: async () => ({ source: "fixture", leds: [] }),
    readCfg: createWledCfgReader(),
    writeCfg: createWledCfgWriter(),
    collect: async () => [],
  });
  const enrolled = await app.request("/api/lights", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host: `127.0.0.1:${port}` }),
  });
  const lightId = ((await enrolled.json()) as { light: { id: string } }).light.id;
  const element: Element = { id: "el-bush", lightId, label: "Bush", start: 0, stop: LIGHTS };
  const prop: Prop = { id: "bush", lightId, label: "Bush", kind: "custom", elementIds: [element.id], layout, sections: defaultSections(layout) };
  store.replaceElements(lightId, [element]);
  store.replaceProps(lightId, [prop]);
  await app.request("/api/looks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      looks: [
        { id: "up", name: "Up", slot: 1, style, overrides: [{ propId: "bush", style: { ...style, motion: "up" } }] },
        { id: "plain", name: "Plain", slot: 2, style, overrides: [] },
        { id: "out", name: "Out", slot: 3, style, overrides: [{ propId: "bush", style: { ...style, motion: "outward" } }] },
      ],
      playlists: [],
      schedule: null,
    }),
  });
  const check = async () => {
    const body = (await (await app.request("/api/yard-check")).json()) as {
      rows: { lightId: string; ledmap: { status: string; detail: string } }[];
    };
    return body.rows.find((row) => row.lightId === lightId)!.ledmap;
  };
  const push = () => app.request("/api/looks/push", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lightIds: [lightId], includeSchedule: false }),
  });
  return { box, store, lightId, check, push, app };
}

describe("Yard check compares every light map file (fixture box)", () => {
  it("matches after a push, then reports a mismatch in a non-zero slot only", async () => {
    const { box, check, push } = await yardWithBush();
    expect((await push()).status).toBe(200);
    expect(box.ledmapSlots()).toEqual([0, 1, 2]);
    const clean = await check();
    expect(clean.status).toBe("match");
    expect(clean.detail).toMatch(/All 3 light maps/);

    // ledmap.json and ledmap1.json stay right; ledmap2.json is swapped for ledmap1's order.
    box.setLedmap(box.ledmap(1), 2);
    const drifted = await check();
    expect(drifted.status).toBe("mismatch");
    expect(drifted.detail).toMatch(/ledmap2\.json is what the last push wrote|ledmap2\.json differs/);
    expect(drifted.detail).not.toMatch(/ledmap1\.json/);

    // Pushing again repairs it.
    expect((await push()).status).toBe(200);
    expect((await check()).status).toBe("match");
  });

  it("the season file keeps every map the Light holds, and an older single string still loads", async () => {
    const { box, push, app, lightId } = await yardWithBush();
    await push();
    const exported = (await (await app.request("/api/season/export?includeDevices=1")).json()) as {
      document: { devices: { lightId: string; ledmapJson?: string; ledmaps?: { slot: number; json: string }[] }[] };
    };
    const device = exported.document.devices.find((row) => row.lightId === lightId)!;
    expect(device.ledmaps?.map((file) => file.slot)).toEqual([0, 1, 2]);
    expect(device.ledmaps?.[2]?.json).toBe(box.ledmap(2));
    // Slot 0 also travels as the string an older build reads.
    expect(device.ledmapJson).toBe(box.ledmap(0));
    // A file that is not on the controller is left out, not saved as an empty map.
    box.setLedmap(null, 1);
    const later = (await (await app.request("/api/season/export?includeDevices=1")).json()) as typeof exported;
    expect(later.document.devices.find((row) => row.lightId === lightId)?.ledmaps?.map((file) => file.slot)).toEqual([0, 2]);
    // An older season file (one string) reviews fine and reads as the base map.
    const old = { ...later.document, devices: later.document.devices.map((row) => ({ ...row, ledmaps: undefined, ledmapJson: "{\"map\":[0,1]}" })) };
    const review = await app.request("/api/season/review", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: old }),
    });
    expect(review.status).toBe(200);
  });

  it("a missing non-zero map file is a mismatch, not a match", async () => {
    const { box, check, push } = await yardWithBush();
    await push();
    box.setLedmap(null, 1);
    const missing = await check();
    expect(missing.status).toBe("mismatch");
    expect(missing.detail).toMatch(/ledmap1\.json is not on the controller/);
  });

  it("a map file that is not a map reads as unknown, not as a match", async () => {
    const { box, check, push } = await yardWithBush();
    await push();
    box.setLedmap("<html>nope</html>", 2);
    const unreadable = await check();
    expect(unreadable.status).toBe("unknown");
    expect(unreadable.detail).toMatch(/ledmap2\.json did not reread as a map/);
  });

  it("a Light with Looks that were never pushed reports the missing maps and no false match", async () => {
    const { box, check } = await yardWithBush();
    expect(box.ledmapSlots()).toEqual([]);
    const result = await check();
    expect(result.status).toBe("mismatch");
    expect(result.detail).toMatch(/ledmap\.json, ledmap1\.json, ledmap2\.json are not on the controller/);
  });

  it("a Light pushed before motion maps (one legacy record, base map only) says why it differs", async () => {
    const { box, store, lightId, check, push } = await yardWithBush();
    await push();
    const base = box.ledmap(0)!;
    box.setLedmap(null, 1);
    box.setLedmap(null, 2);
    const stored = store.findById(lightId)!;
    store.replace({ ...stored, lastLedmap: { digest: stored.lastLedmap![0]!.digest, at: stored.lastLedmap![0]!.at } as never });
    expect(parseLedmapJson(base)).not.toBeNull();
    const result = await check();
    expect(result.status).toBe("mismatch");
    expect(result.detail).toMatch(/record lists only ledmap\.json.*before motion maps/);
  });
});
