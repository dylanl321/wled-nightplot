import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { expect, it } from "vitest";
import type { LightDetail } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { createFixtureBox } from "./wled-fixture-box.ts";
import { createWledProbe } from "./wled/client.ts";
import { createWledLiveReader, createWledWriter, type WledStateWrite } from "./wled/live.ts";

it("recovers a stranded fixture Preview through the API and preserves saved Segments", async () => {
  const box = createFixtureBox({ ledCount: 60 });
  const server = box.listen();
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    const host = `127.0.0.1:${address.port}`;
    // Represents frozen pixels left behind without a Nightplot session.
    await fetch(`http://${host}/json/state`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seg: [{ id: 0, start: 0, stop: 60, i: [0, 60, "123456"] }] }),
    });
    const store = new FileLightsStore(join(mkdtempSync(join(tmpdir(), "nightplot-recovery-")), "lights.json"));
    const writes: WledStateWrite[] = [];
    const writer = createWledWriter();
    const app = createApp({
      store, probe: createWledProbe(), collect: async () => [],
      write: async (target, body) => { writes.push(body); return writer(target, body); },
      readLive: createWledLiveReader(), readCfg: async () => null, writeCfg: async () => false,
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host }),
    });
    expect(enrolled.status).toBe(201);
    const { light } = await enrolled.json() as Pick<LightDetail, "light">;
    const id = light.id;
    const detail = await (await app.request(`/api/lights/${id}`)).json() as LightDetail;
    expect(detail.frozenPreview).toBe(true);
    const saved = [
      { id: "a", lightId: id, label: "Left", start: 0, stop: 15 },
      { id: "b", lightId: id, label: "Right", start: 15, stop: 59 },
    ];
    store.replaceElements(id, saved);
    const path = `/api/lights/${id}/preview/recover`;
    const unconfirmed = await app.request(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(unconfirmed.status).toBe(400);
    expect(writes).toEqual([]);
    const recovered = await app.request(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discardFrozenPixels: true }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({
      frozenPreview: false, elements: saved, session: null,
      recovery: { cleared: true, wrote: true, restored: false },
    });
    expect(writes).toEqual([{ seg: [{ id: 0, start: 0, stop: 60, frz: false }] }]);
    expect(store.elementsFor(id)).toEqual(saved);
    const preview = await app.request(`/api/lights/${id}/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pixels: true, spans: [{ start: 0, stop: 1, color: "#fff4dc" }] }),
    });
    expect(preview.status).toBe(200);
    const activeRecovery = await app.request(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discardFrozenPixels: true }),
    });
    expect(activeRecovery.status).toBe(422);
    expect(await activeRecovery.json()).toMatchObject({ error: "busy", sent: false });
    expect((await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status).toBe(200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
