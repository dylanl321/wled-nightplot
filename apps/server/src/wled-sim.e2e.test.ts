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
import { createWledPresetsReader, createWledPresetsWriter } from "./wled/native-backup.ts";
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

  it("sets up a fresh 0.15.1 controller as FW1906 and Applies a white Segment", async () => {
    const sim = await startSim({ NIGHTPLOT_SIM_VER: "0.15.1" });
    const { app } = appAgainstHttp();
    const light = await enroll(app, `${sim.host}:${sim.httpPort}`);
    const read = (await (await app.request(`/api/lights/${light.id}/provision`)).json()) as {
      provision: { refuse: string | null; fingerprint: { writable: boolean } };
    };
    expect(read.provision.refuse).toBeNull();
    expect(read.provision.fingerprint.writable).toBe(true);

    const provision = await app.request(`/api/lights/${light.id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "fw1906", length: 60, gpio: 16 } }),
    });
    expect(provision.status).toBe(200);
    const provisionBody = (await provision.json()) as {
      provisionWrite: { matched: boolean };
      provision: { settings: { ledType: string; nativeType: number; colorOrder: string } };
    };
    expect(provisionBody.provisionWrite.matched).toBe(true);
    expect(provisionBody.provision.settings).toMatchObject({ ledType: "fw1906", nativeType: 28, colorOrder: "GRB" });

    await declareElements(app, light.id, [{ label: "Shelf", start: 0, stop: 60 }]);
    const apply = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Shelf", start: 0, stop: 60, color: { hex: "#000000", white: 200 } }],
      }),
    });
    expect(apply.status).toBe(200);
    expect(((await apply.json()) as { apply: { matched: boolean } }).apply.matched).toBe(true);
  }, 20_000);

  it("refuses Apply past the controller's reported segment limit and sends nothing", async () => {
    const sim = await startSim({ NIGHTPLOT_SIM_MAXSEG: "1" });
    const { app } = appAgainstHttp();
    const light = await enroll(app, `${sim.host}:${sim.httpPort}`);
    const elements = [{ label: "Left", start: 0, stop: 30 }, { label: "Right", start: 30, stop: 60 }];
    await declareElements(app, light.id, elements);
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: elements.map((row) => ({ ...row, color: { hex: "#ffa000", white: 0 } })) }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toMatch(/at most 1 segments; 2 are declared/);
    const state = (await (await fetch(`${sim.baseUrl}/json/state`)).json()) as { seg: unknown[] };
    expect(state.seg).toHaveLength(1);
  }, 20_000);

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

describe("headless WLED sim e2e: Sync across Lights", () => {
  const presets = JSON.stringify({
    "0": {},
    "1": { n: "Amber", on: true, bri: 120, seg: [{ id: 0, start: 0, stop: 60, col: [[255, 160, 0]], fx: 0 }] },
    "2": { n: "Ocean", on: true, bri: 200, seg: [{ id: 0, start: 0, stop: 60, col: [[0, 80, 255]], fx: 9, pal: 11 }] },
  });

  async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
    const res = await app.request(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> & {
      rows: { lightId: string; status: string; detail: string; safetyBackupId?: string }[];
      warnings?: { message: string }[];
    } };
  }

  it("copies presets, turns one on everywhere, and copies the look", async () => {
    const [a, b] = await Promise.all([startSim(), startSim()]);
    const { app } = appAgainstHttp();
    const source = await enroll(app, `${a.host}:${a.httpPort}`);
    const target = await enroll(app, `${b.host}:${b.httpPort}`);
    await createWledPresetsWriter()({ hostname: a.host, port: a.httpPort }, presets);

    const listed = (await (await app.request(`/api/sync/presets/${source.id}`)).json()) as { presets: { id: number; name: string }[] };
    expect(listed.presets.map((entry) => entry.name)).toEqual(["Amber", "Ocean"]);

    const copy = await post(app, "/api/sync/presets", { sourceLightId: source.id, targetLightIds: [target.id] });
    expect(copy.status).toBe(200);
    expect(copy.body.rows).toEqual([expect.objectContaining({ lightId: target.id, status: "matched" })]);
    expect(copy.body.rows[0]!.safetyBackupId).toBeTruthy();
    expect(copy.body.caption).toMatch(/Not Hardware Done/);
    expect(JSON.parse(await createWledPresetsReader()({ hostname: b.host, port: b.httpPort }))).toEqual(JSON.parse(presets));

    const on = await post(app, "/api/sync/preset", { lightIds: [source.id, target.id], presetId: 2 });
    expect(on.status).toBe(200);
    expect(on.body.rows.map((row) => row.status)).toEqual(["matched", "matched"]);
    const bState = (await (await fetch(`${b.baseUrl}/json/state`)).json()) as { ps: number; seg: { fx: number }[] };
    expect(bState.ps).toBe(2);
    expect(bState.seg[0]!.fx).toBe(9);

    const missing = await post(app, "/api/sync/preset", { lightIds: [target.id], presetId: 5 });
    expect(missing.body.rows[0]).toMatchObject({ status: "refused", detail: expect.stringMatching(/no preset 5/) });

    await fetch(`${a.baseUrl}/json/state`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true, bri: 77, seg: [{ id: 0, start: 0, stop: 60, col: [[12, 200, 40]], fx: 38, sx: 40, pal: 5 }] }) });
    const look = await post(app, "/api/sync/look", { sourceLightId: source.id, targetLightIds: [target.id] });
    expect(look.status).toBe(200);
    expect(look.body.rows[0]).toMatchObject({ status: "matched" });
    const copied = (await (await fetch(`${b.baseUrl}/json/state`)).json()) as { bri: number; seg: { fx: number; pal: number; col: number[][] }[] };
    expect(copied.bri).toBe(77);
    expect(copied.seg[0]).toMatchObject({ fx: 38, pal: 5, col: [[12, 200, 40]] });

    const activity = (await (await app.request(`/api/activity?lightId=${target.id}`)).json()) as { entries: { action: string }[] };
    expect(activity.entries.filter((entry) => entry.action === "sync")).toHaveLength(4);
  }, 30_000);

  it("sets up a WLED UDP sync group with one leader and a follower, and refuses two leaders", async () => {
    const [a, b] = await Promise.all([startSim(), startSim()]);
    const { app } = appAgainstHttp();
    const leader = await enroll(app, `${a.host}:${a.httpPort}`);
    const follower = await enroll(app, `${b.host}:${b.httpPort}`);

    const two = await post(app, "/api/sync/udp", { group: 2, roles: { [leader.id]: "leader", [follower.id]: "leader" } });
    expect(two.status).toBe(400);

    const set = await post(app, "/api/sync/udp", { group: 2, roles: { [leader.id]: "leader", [follower.id]: "follower" } });
    expect(set.status).toBe(200);
    expect(set.body.rows.map((entry) => entry.status)).toEqual(["matched", "matched"]);
    expect(set.body.rows[0]!.safetyBackupId).toBeTruthy();
    const cfgA = (await (await fetch(`${a.baseUrl}/json/cfg`)).json()) as { if: { sync: { send: { en: boolean; dir: boolean; grp: number } } } };
    expect(cfgA.if.sync.send).toMatchObject({ en: true, dir: true, grp: 2 });
    const cfgB = (await (await fetch(`${b.baseUrl}/json/cfg`)).json()) as { if: { sync: { recv: { grp: number; sb: boolean } } } };
    expect(cfgB.if.sync.recv).toMatchObject({ grp: 3, sb: false });

    const listed = (await (await app.request("/api/sync/udp")).json()) as {
      rows: { lightId: string; sendGroups: number[] | null; receiveGroups: number[] | null }[];
    };
    expect(listed.rows.find((entry) => entry.lightId === leader.id)).toMatchObject({ sendGroups: [2], receiveGroups: [1] });
    expect(listed.rows.find((entry) => entry.lightId === follower.id)).toMatchObject({ sendGroups: [], receiveGroups: [1, 2] });

    const off = await post(app, "/api/sync/udp", { group: 2, roles: { [follower.id]: "off" } });
    expect(off.body.rows[0]).toMatchObject({ status: "matched" });
  }, 30_000);

  it("asks before copying presets to a Light with a different length, and lists offline targets", async () => {
    const [a, b, gone] = await Promise.all([startSim(), startSim({ NIGHTPLOT_SIM_LEDS: "90" }), startSim()]);
    const { app } = appAgainstHttp();
    const source = await enroll(app, `${a.host}:${a.httpPort}`);
    const longer = await enroll(app, `${b.host}:${b.httpPort}`);
    const offline = await enroll(app, `${gone.host}:${gone.httpPort}`);
    await gone.stop();

    const ask = await post(app, "/api/sync/presets", { sourceLightId: source.id, targetLightIds: [longer.id, offline.id] });
    expect(ask.status).toBe(409);
    expect(ask.body.error).toBe("confirm-warnings");
    expect(ask.body.warnings?.[0]?.message).toMatch(/90 LEDs; the source has 60/);

    const confirmed = await post(app, "/api/sync/presets", {
      sourceLightId: source.id, targetLightIds: [longer.id, offline.id], confirmWarnings: true,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.rows.find((row) => row.lightId === offline.id)?.status).toBe("failed");
    expect(confirmed.body.rows.find((row) => row.lightId === longer.id)?.status).toBe("matched");
    expect(confirmed.body.message).toBe("1 of 2 have the copied presets. Check the Lights listed below.");
  }, 30_000);

  it("reads a multi-bus sim, adds all found, and applies a setup profile as software path only", async () => {
    const [multi, extra] = await Promise.all([
      startSim({ NIGHTPLOT_SIM_BUS2_LEN: "40", NIGHTPLOT_SIM_BUS2_PIN: "2" }),
      startSim({ NIGHTPLOT_SIM_NAME: "WLED-sim-b" }),
    ]);
    const { app, store } = appAgainstHttp();
    const hostA = `${multi.host}:${multi.httpPort}`;
    const hostB = `${extra.host}:${extra.httpPort}`;
    const bulk = await app.request("/api/lights/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hosts: [hostA, hostB] }),
    });
    expect(bulk.status).toBe(200);
    const enrolled = (await bulk.json()) as {
      results: { host: string; status: string; lightId?: string }[];
      caption: string;
    };
    expect(enrolled.results.every((row) => row.status === "added")).toBe(true);
    expect(enrolled.caption).toMatch(/software path only|Not Hardware Done|automatic backup/i);
    const multiId = enrolled.results.find((row) => row.host === hostA)!.lightId!;
    const extraId = enrolled.results.find((row) => row.host === hostB)!.lightId!;

    const provision = (await (await app.request(`/api/lights/${multiId}/provision`)).json()) as {
      provision: { buses: number; refuse: string | null };
      light: { outputs?: { ledCount: number }[] };
    };
    expect(provision.provision.refuse).toBeNull();
    expect(provision.provision.buses).toBe(2);
    expect(provision.light.outputs).toHaveLength(2);

    const gaps = await app.request(`/api/lights/${multiId}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Roofline", start: 0, stop: 20 },
          { label: "Window", start: 40, stop: 55 },
        ],
      }),
    });
    expect(gaps.status).toBe(200);

    const apply = await app.request("/api/lights/setup-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lightIds: [multiId, extraId],
        profile: { name: "Yard", ledType: "ws281x", currentLimitMa: 1500, namePattern: "yard-{nn}" },
      }),
    });
    expect(apply.status).toBe(200);
    const applied = (await apply.json()) as {
      results: { lightId: string; status: string }[];
    };
    expect(applied.results.map((row) => row.status)).toEqual(["applied", "applied"]);
    expect(store.findById(multiId)?.name).toBe("yard-01");
    expect(store.findById(extraId)?.name).toBe("yard-02");

    const writeBoth = await app.request(`/api/lights/${multiId}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provision: {
          outputs: [
            { index: 0, ledType: "ws281x", length: 28, gpio: 16 },
            { index: 1, ledType: "ws281x", length: 36, gpio: 2 },
          ],
        },
      }),
    });
    expect(writeBoth.status).toBe(200);
    const written = (await writeBoth.json()) as {
      provisionWrite: { matched: boolean; outputs?: { index: number; matched: boolean }[] };
    };
    expect(written.provisionWrite.matched).toBe(true);
    expect(written.provisionWrite.outputs?.map((row) => row.matched)).toEqual([true, true]);

    const secondOnly = await app.request("/api/lights/setup-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lightIds: [multiId],
        profile: { name: "Second bus", length: 41, outputIndex: 1 },
      }),
    });
    expect(secondOnly.status).toBe(200);
    const secondBody = (await secondOnly.json()) as { results: { status: string }[] };
    expect(secondBody.results[0]?.status).toBe("applied");
    const after = (await (await app.request(`/api/lights/${multiId}/provision`)).json()) as {
      provision: { outputs: { index: number; settings: { length: number | null } }[] };
    };
    expect(after.provision.outputs.find((row) => row.index === 0)?.settings.length).toBe(28);
    expect(after.provision.outputs.find((row) => row.index === 1)?.settings.length).toBe(41);
  }, 30_000);
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
