import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { LightDetail, LooksDocument } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { FileLooksStore } from "./store/looks-store.ts";
import { createFixtureBox } from "./wled-fixture-box.ts";
import { createWledProbe } from "./wled/client.ts";
import { createWledLiveReader, createWledWriter } from "./wled/live.ts";

const closers: (() => void)[] = [];
afterEach(() => { while (closers.length) closers.pop()!(); });

async function setup() {
  const box = createFixtureBox({ ledCount: 60 });
  const server = box.listen();
  await once(server, "listening");
  closers.push(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  const host = `127.0.0.1:${address.port}`;
  const dir = mkdtempSync(join(tmpdir(), "nightplot-looks-live-"));
  const store = new FileLightsStore(join(dir, "lights.json"));
  const looks = new FileLooksStore(join(dir, "looks.json"));
  const app = createApp({
    store, looks, probe: createWledProbe(), collect: async () => [],
    write: createWledWriter(), readLive: createWledLiveReader(), readCfg: async () => null, writeCfg: async () => false,
    readJson: async () => null, lookSettleMs: 0,
  });
  const enrolled = await app.request("/api/lights", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host }),
  });
  expect(enrolled.status).toBe(201);
  const { light } = await enrolled.json() as Pick<LightDetail, "light">;
  store.replaceElements(light.id, [
    { id: "a", lightId: light.id, label: "Left", start: 0, stop: 30 },
    { id: "b", lightId: light.id, label: "Right", start: 30, stop: 60 },
  ]);
  const state = async () => (await fetch(`http://${host}/json/state`)).json() as Promise<{ on: boolean; bri: number; seg: { start: number; stop: number; fx?: number; col: number[][] }[] }>;
  const post = (path: string, body: unknown) => app.request(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { app, light, state, post, looks };
}

describe("Looks on the lights", () => {
  it("Preview shows the Look with its effect, and End puts back what was on", async () => {
    const { app, light, state, post } = await setup();
    const before = await state();
    const doc = await (await app.request("/api/looks")).json() as LooksDocument;
    const look = { ...doc.looks[0]!, style: { ...doc.looks[0]!.style, fx: 2, color: "#ff0000" } };
    const shown = await post(`/api/looks/${look.id}/preview`, { look });
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ showing: 1, total: 1 });
    const during = await state();
    expect(during.seg[0]).toMatchObject({ fx: 2 });
    expect(during.seg[0]!.col[0]!.slice(0, 3)).toEqual([255, 0, 0]);
    // A second edit updates the same Preview.
    const again = await post(`/api/looks/${look.id}/preview`, { look: { ...look, style: { ...look.style, color: "#00ff00" } } });
    expect((await again.json()).rows[0].status).toBe("showing");
    expect((await state()).seg[0]!.col[0]!.slice(0, 3)).toEqual([0, 255, 0]);
    const ended = await post("/api/looks/preview/end", {});
    expect((await ended.json()).rows[0]).toMatchObject({ lightId: light.id, status: "matched" });
    const after = await state();
    expect(after.seg.map((row) => [row.start, row.stop])).toEqual(before.seg.map((row) => [row.start, row.stop]));
    expect(after.seg[0]!.col[0]).toEqual(before.seg[0]!.col[0]);
  });

  it("Turn on refuses a Look that was never sent to that Light", async () => {
    const { app, post } = await setup();
    const doc = await (await app.request("/api/looks")).json() as LooksDocument;
    const res = await post("/api/looks/turn-on", { slot: doc.looks[0]!.slot });
    const body = await res.json();
    expect(body.rows[0]).toMatchObject({ status: "refused" });
    expect(body.rows[0].detail).toMatch(/Send first/);
  });

  it("says what each Light has not been sent, and falls back to WLED's usual effects when no Light answers", async () => {
    const { app } = await setup();
    const now = await (await app.request("/api/looks/now")).json() as { rows: { online: boolean; changes: unknown[] }[] };
    expect(now.rows[0]!.online).toBe(true);
    expect(now.rows[0]!.changes.length).toBeGreaterThan(0);
    const effects = await (await app.request("/api/looks/effects")).json() as { source: string; effects: unknown[] };
    expect(effects.source).toBe("built-in");
    expect(effects.effects.length).toBeGreaterThan(5);
  });

  it("copies what a Light shows into a style", async () => {
    const { light, post } = await setup();
    const res = await post("/api/looks/capture", { lightId: light.id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.style).toMatchObject({ fx: expect.any(Number), color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
  });
});
