import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SOFTWARE_PATH_ONLY_CAPTION } from "@nightplot/shared";
import { createApp } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { spawnWledSim, type SpawnedWledSim } from "./wled-sim-spawn.ts";
import { createWledCfgReader, createWledCfgWriter } from "./wled/cfg.ts";
import { createWledProbe } from "./wled/client.ts";
import { createWledLiveReader, createWledWriter } from "./wled/live.ts";
import { rgbFill, sendDdpRgb } from "./wled-ddp.ts";

const sims: SpawnedWledSim[] = [];

afterEach(async () => {
  await Promise.all(sims.splice(0).map((sim) => sim.stop()));
});

async function startSim(extraEnv?: NodeJS.ProcessEnv) {
  const sim = await spawnWledSim({ extraEnv });
  sims.push(sim);
  return sim;
}

function appAgainstHttp() {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-sim-"));
  const store = new FileLightsStore(join(dir, "lights.json"));
  const app = createApp({
    store,
    probe: createWledProbe(),
    write: createWledWriter(),
    readLive: createWledLiveReader(),
    readCfg: createWledCfgReader(),
    writeCfg: createWledCfgWriter(),
    collect: async () => [],
  });
  return { app, store };
}

async function enroll(app: ReturnType<typeof createApp>, host: string) {
  const res = await app.request("/api/lights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { light: { id: string; name: string } }).light;
}

async function declareElements(
  app: ReturnType<typeof createApp>,
  id: string,
  elements: { label: string; start: number; stop: number }[],
) {
  const res = await app.request(`/api/lights/${id}/elements`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elements }),
  });
  expect(res.status).toBe(200);
}

describe("headless WLED sim e2e (external process)", () => {
  it(
    "enrolls, provisions, Applies, and proves live/DDP as software path only",
    async () => {
      const sim = await startSim();
      const host = `${sim.host}:${sim.httpPort}`;
      const { app } = appAgainstHttp();
      const light = await enroll(app, host);

      const inspect = (await (await app.request(`/api/lights/${light.id}`)).json()) as {
        liveCaption: string | null;
      };
      expect(inspect.liveCaption).toBe(SOFTWARE_PATH_ONLY_CAPTION);
      expect(inspect.liveCaption).toMatch(/software path only/i);
      expect(inspect.liveCaption).toMatch(/Not Hardware Done/);

      const provision = await app.request(`/api/lights/${light.id}/provision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provision: { ledType: "ws281x", length: 80, gpio: 2 } }),
      });
      expect(provision.status).toBe(200);
      const provisionBody = (await provision.json()) as {
        provisionWrite: { matched: boolean; caption: string; snapshotLedCount: number };
        provision: { settings: { length: number; gpio: number } };
      };
      expect(provisionBody.provisionWrite.matched).toBe(true);
      expect(provisionBody.provisionWrite.snapshotLedCount).toBe(80);
      expect(provisionBody.provision.settings).toMatchObject({ length: 80, gpio: 2 });
      expect(provisionBody.provisionWrite.caption).toBe(SOFTWARE_PATH_ONLY_CAPTION);

      await declareElements(app, light.id, [
        { label: "Left run", start: 0, stop: 24 },
        { label: "Right run", start: 24, stop: 50 },
      ]);
      const apply = await app.request(`/api/lights/${light.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elements: [
            { label: "Left run", start: 0, stop: 24, color: { hex: "#ffa000", white: 0 } },
            { label: "Right run", start: 24, stop: 50, color: { hex: "#ffa000", white: 0 } },
          ],
        }),
      });
      expect(apply.status).toBe(200);
      const applyBody = (await apply.json()) as {
        apply: { matched: boolean; status: string; caption: string };
      };
      expect(applyBody.apply.matched).toBe(true);
      expect(applyBody.apply.status).toBe("matched");
      expect(applyBody.apply.caption).toBe(SOFTWARE_PATH_ONLY_CAPTION);

      const preview = await app.request(`/api/lights/${light.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: "#4f7dff", brightness: 180 }),
      });
      expect(preview.status).toBe(200);
      const previewBody = (await preview.json()) as { liveCaption: string };
      expect(previewBody.liveCaption).toBe(SOFTWARE_PATH_ONLY_CAPTION);

      await sendDdpRgb(sim.host, sim.ddpPort, rgbFill(80, 0, 255, 0));
      await viWaitForLive(sim.baseUrl, "#00ff00");
      const live = (await (await app.request(`/api/lights/${light.id}/live`)).json()) as {
        liveLeds: (string | null)[];
        liveCaption: string;
      };
      expect(live.liveCaption).toBe(SOFTWARE_PATH_ONLY_CAPTION);
      expect(live.liveLeds[0]).toBe("#00ff00");
    },
    20_000,
  );

  it("keeps Apply mismatch failed — not Hardware Done", async () => {
    const sim = await startSim();
    const { app } = appAgainstHttp();
    const light = await enroll(app, `${sim.host}:${sim.httpPort}`);
    await declareElements(app, light.id, [{ label: "Left run", start: 0, stop: 24 }]);
    await fetch(`${sim.baseUrl}/nightplot/mismatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Left run", start: 0, stop: 24, color: { hex: "#ffa000", white: 0 } }] }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      apply: { matched: boolean; status: string; caption: string; message: string };
    };
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("mismatch");
    expect(body.apply.message).toMatch(/didn’t stick/);
    expect(body.apply.caption).toBe(SOFTWARE_PATH_ONLY_CAPTION);
  }, 20_000);

  it("does not treat unknown reread segments as a match", async () => {
    const sim = await startSim();
    const { app, store } = appAgainstHttp();
    const light = await enroll(app, `${sim.host}:${sim.httpPort}`);
    await declareElements(app, light.id, [{ label: "Left run", start: 0, stop: 24 }]);
    await fetch(`${sim.baseUrl}/nightplot/unknown-reread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Left run", start: 0, stop: 24, color: { hex: "#ffa000", white: 0 } }] }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      apply: {
        matched: boolean;
        status: string;
        read: unknown;
        caption: string;
        message: string;
      };
    };
    expect(body.error).toBe("reread-unknown-segments");
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("failed");
    expect(body.apply.read).toBeNull();
    expect(body.apply.message).toMatch(/segments are unknown/);
    expect(body.apply.caption).toBe(SOFTWARE_PATH_ONLY_CAPTION);
    expect(store.findById(light.id)?.lastSnapshot).toBeFalsy();
  }, 20_000);

  it("All Off partial_failure lists the Light that failed", async () => {
    const keep = await startSim();
    const fail = await startSim();
    const { app } = appAgainstHttp();
    const keepLight = await enroll(app, `${keep.host}:${keep.httpPort}`);
    const failLight = await enroll(app, `${fail.host}:${fail.httpPort}`);
    await fetch(`${fail.baseUrl}/nightplot/refuse-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const res = await app.request("/api/all-off", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      restored: boolean;
      rows: { lightId: string; status: string }[];
      failedIds: string[];
      message: string;
      caption: string;
    };
    expect(body.restored).toBe(false);
    expect(body.rows.find((row) => row.lightId === keepLight.id)?.status).toBe("off");
    expect(body.rows.find((row) => row.lightId === failLight.id)?.status).toBe("failed");
    expect(body.failedIds).toEqual([failLight.id]);
    expect(body.message).toMatch(/1 of 2 off/);
    expect(body.caption).toBe(SOFTWARE_PATH_ONLY_CAPTION);
  }, 20_000);

  it("incomplete delete refuses when the sim is gone", async () => {
    const sim = await startSim();
    const { app } = appAgainstHttp();
    const light = await enroll(app, `${sim.host}:${sim.httpPort}`);
    await sim.stop();
    const checks = (await (await app.request(`/api/lights/${light.id}/delete-checks`)).json()) as {
      checks: { key: string; status: string }[];
      caption: string;
    };
    expect(checks.checks.find((check) => check.key === "controller")?.status).toBe("unknown");
    const refused = await app.request(`/api/lights/${light.id}`, { method: "DELETE" });
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { error: string; message: string };
    expect(body.error).toBe("checks_incomplete");
    expect(body.message).toMatch(/I understand/);
  }, 20_000);
});

async function viWaitForLive(baseUrl: string, hex: string) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const live = (await (await fetch(`${baseUrl}/json/live`)).json()) as {
      leds: string[];
      nightplot?: string;
    };
    expect(live.nightplot).toBe("sim");
    if (live.leds[0] === hex.replace(/^#/, "")) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`sim /json/live did not show ${hex}`);
}
