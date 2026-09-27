import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "./app.ts";
import { FIND_PROBE_CONCURRENCY } from "./discovery/map-limit.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { createFixtureBox } from "./wled-fixture-box.ts";
import { createWledCfgReader, createWledCfgWriter } from "./wled/cfg.ts";
import { probeWled, type ProbeFn } from "./wled/client.ts";
import type { ReadLiveFn, WriteStateFn } from "./wled/live.ts";

const snapshot = {
  name: "WLED",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 60,
  rgbw: false,
  on: true,
  brightness: 128,
  segmentColor: "#ffa000",
  segments: [{ start: 0, stop: 60 }],
};

function memoryBox() {
  const leds = Array.from({ length: 60 }, () => "#ffa000");
  let on = true;
  let bri = 128;
  let color = "#ffa000";
  let segs = [{ start: 0, stop: 60 }];
  let name = snapshot.name;
  const snap = () => ({
    ...snapshot,
    name,
    on,
    brightness: bri,
    segmentColor: color,
    segments: segs.map((seg) => ({ ...seg })),
  });
  const write: WriteStateFn = async (_target, body) => {
    if (typeof body.on === "boolean") on = body.on;
    if (typeof body.bri === "number") bri = body.bri;
    if (body.seg) {
      const next: { start: number; stop: number }[] = [];
      for (const seg of body.seg) {
        const rgb = seg.col[0] ?? [255, 160, 0];
        const hex = `#${rgb
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")}`;
        color = hex;
        if (seg.stop <= seg.start) continue;
        next.push({ start: seg.start, stop: seg.stop });
        for (let i = seg.start; i < seg.stop && i < leds.length; i += 1) {
          leds[i] = hex;
        }
      }
      if (next.length) segs = next;
    }
    return true;
  };
  const readLive: ReadLiveFn = async () => ({
    source: "fixture",
    leds: on ? leds.slice() : leds.map(() => "#000000"),
  });
  return {
    write,
    readLive,
    probe: (async () => ({ kind: "found" as const, snapshot: snap() })) satisfies ProbeFn,
    leds,
    segs,
    setName(next: string) {
      name = next;
    },
  };
}

function memoryCfg(name = "WLED") {
  const cfg: {
    id: { name: string };
    def: { on: boolean; bri: number; ps: number };
    light: { tr: { dur: number } };
    hw: { led: { maxpwr: number } };
  } = {
    id: { name },
    def: { on: true, bri: 128, ps: 0 },
    light: { tr: { dur: 7 } },
    hw: { led: { maxpwr: 850 } },
  };
  return {
    cfg,
    read: async () => structuredClone(cfg),
    write: async (_target: unknown, body: Record<string, unknown>) => {
      const next = body as {
        id?: { name?: unknown };
        def?: { on?: unknown; bri?: unknown; ps?: unknown };
        light?: { tr?: { dur?: unknown } };
        hw?: { led?: { maxpwr?: unknown } };
      };
      if (typeof next.id?.name === "string") cfg.id.name = next.id.name;
      if (typeof next.def?.on === "boolean") cfg.def.on = next.def.on;
      if (typeof next.def?.bri === "number") cfg.def.bri = next.def.bri;
      if (typeof next.def?.ps === "number") cfg.def.ps = next.def.ps;
      if (typeof next.light?.tr?.dur === "number") cfg.light.tr.dur = next.light.tr.dur;
      if (typeof next.hw?.led?.maxpwr === "number") cfg.hw.led.maxpwr = next.hw.led.maxpwr;
      return true;
    },
  };
}

function testApp(overrides: Partial<AppDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
  const store = overrides.store ?? new FileLightsStore(join(dir, "lights.json"));
  const box = memoryBox();
  const cfg = memoryCfg();
  const probe: ProbeFn = overrides.probe ?? box.probe;
  const app = createApp({
    store,
    probe,
    write: overrides.write ?? box.write,
    readLive: overrides.readLive ?? box.readLive,
    readCfg: overrides.readCfg ?? cfg.read,
    writeCfg: overrides.writeCfg ?? cfg.write,
    collect: overrides.collect ?? (async () => []),
    now: overrides.now ?? (() => new Date("2026-09-26T18:00:00.000Z")),
  });
  return { app, store, dir, box, cfg };
}

describe("configure server", () => {
  it("reports health for R6", async () => {
    const { app } = testApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      slice: "R6",
    });
  });

  it("keeps root Apply off the Light path; root Preview is not Apply", async () => {
    const { app } = testApp();
    const apply = await app.request("/api/apply", { method: "POST" });
    expect(apply.status).toBe(400);
    expect(((await apply.json()) as { message: string }).message).toMatch(/lights\/:id\/apply/);
    const preview = await app.request("/api/preview", { method: "POST" });
    expect(preview.status).toBe(400);
  });
});

describe("discover + connect", () => {
  it("refuses a public address before probing", async () => {
    let probed = 0;
    const { app } = testApp({
      probe: async () => {
        probed += 1;
        return { kind: "found", snapshot };
      },
    });
    const res = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidate: { status: string; reasonCode: string; reason: string };
    };
    expect(body.candidate.status).toBe("rejected");
    expect(body.candidate.reasonCode).toBe("disallowed-address");
    expect(body.candidate.reason).toMatch(/Refused before probing/);
    expect(probed).toBe(0);

    const add = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(add.status).toBe(403);
    expect(probed).toBe(0);
  });

  it("lists probe-failed and not-wled with a plain reason", async () => {
    const { app } = testApp({
      probe: async (target) =>
        target.hostname.endsWith(".41")
          ? { kind: "not-wled", reason: "Answered, but /json isn’t WLED. Not added." }
          : { kind: "probe-failed", reason: "192.168.1.90 didn’t return a snapshot in 3 s." },
    });

    const failed = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    const failedBody = (await failed.json()) as { candidate: { reasonCode: string } };
    expect(failedBody.candidate.reasonCode).toBe("probe-failed");

    const notWled = await app.request("/api/discover/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.41" }),
    });
    const notWledBody = (await notWled.json()) as { candidate: { reasonCode: string } };
    expect(notWledBody.candidate.reasonCode).toBe("not-wled");
  });

  it("fails closed when a snapshot cannot be read — nothing enrolled", async () => {
    const { app, store } = testApp({
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.90 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("probe-failed");
    expect(store.load()).toEqual([]);
  });

  it("lists a scanned WLED as found without enrolling it", async () => {
    const { app, store } = testApp({
      collect: async () => [{ hostname: "192.168.1.72", port: 80, via: "mdns" }],
    });
    const res = await app.request("/api/discover", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: { status: string; name: string | null }[];
    };
    expect(body.candidates[0]?.status).toBe("found");
    expect(body.candidates[0]?.name).toBe("WLED");
    expect(store.load()).toEqual([]);
  });

  it("probes a non-80 discovered host and shows host:port", async () => {
    const probed: { hostname: string; port: number }[] = [];
    const { app } = testApp({
      collect: async () => [{ hostname: "127.0.0.1", port: 48210, via: "ssdp" }],
      probe: async (target) => {
        probed.push(target);
        return { kind: "found", snapshot };
      },
    });
    const res = await app.request("/api/discover", { method: "POST" });
    const body = (await res.json()) as {
      candidates: { status: string; displayHost: string; port: number | null }[];
    };
    expect(probed).toEqual([{ hostname: "127.0.0.1", port: 48210 }]);
    expect(body.candidates[0]).toMatchObject({
      status: "found",
      displayHost: "127.0.0.1:48210",
      port: 48210,
    });
  });

  it("does not probe when find has a host but no port", async () => {
    let probed = 0;
    const { app } = testApp({
      collect: async () => [{ hostname: "192.168.1.50", port: null, via: "ssdp" }],
      probe: async () => {
        probed += 1;
        return { kind: "found", snapshot };
      },
    });
    const res = await app.request("/api/discover", { method: "POST" });
    const body = (await res.json()) as {
      candidates: {
        status: string;
        reasonCode: string | null;
        displayHost: string;
        port: number | null;
      }[];
    };
    expect(probed).toBe(0);
    expect(body.candidates[0]).toMatchObject({
      status: "rejected",
      reasonCode: "missing-port",
      displayHost: "192.168.1.50",
      port: null,
    });
    expect(body.candidates[0]?.status).not.toBe("found");
  });

  it("probes collected hosts with a bound of four, keeping collect order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const gates: Array<() => void> = [];

    const hosts = [
      { hostname: "192.168.1.10", port: 80, via: "mdns" as const },
      { hostname: "192.168.1.11", port: 80, via: "ssdp" as const },
      { hostname: "192.168.1.12", port: 80, via: "targets" as const },
      { hostname: "192.168.1.13", port: 80, via: "mdns" as const },
      { hostname: "192.168.1.14", port: 80, via: "ssdp" as const },
      { hostname: "192.168.1.15", port: 80, via: "targets" as const },
    ];

    const { app } = testApp({
      collect: async () => hosts,
      probe: async (target) => {
        started.push(target.hostname);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => {
          gates.push(resolve);
        });
        inFlight -= 1;
        if (target.hostname === "192.168.1.12") {
          return {
            kind: "probe-failed",
            reason: `${target.hostname} didn’t return a snapshot in 3 s.`,
          };
        }
        return {
          kind: "found",
          snapshot: { ...snapshot, name: target.hostname },
        };
      },
    });

    const pending = app.request("/api/discover", { method: "POST" });

    await vi.waitFor(() => {
      expect(inFlight).toBe(FIND_PROBE_CONCURRENCY);
      expect(started).toEqual([
        "192.168.1.10",
        "192.168.1.11",
        "192.168.1.12",
        "192.168.1.13",
      ]);
    });

    for (const release of gates.splice(0).reverse()) release();

    await vi.waitFor(() => {
      expect(started).toEqual(hosts.map((host) => host.hostname));
    });

    for (const release of gates.splice(0)) release();

    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: { status: string; name: string | null; hostname: string }[];
    };
    expect(maxInFlight).toBe(FIND_PROBE_CONCURRENCY);
    expect(body.candidates.map((row) => row.hostname)).toEqual(
      hosts.map((host) => host.hostname),
    );
    expect(body.candidates.map((row) => row.status)).toEqual([
      "found",
      "found",
      "rejected",
      "found",
      "found",
      "found",
    ]);
    expect(body.candidates[2]?.name).toBeNull();
    expect(body.candidates[0]?.name).toBe("192.168.1.10");
  });

  it("does not spend a Find probe slot on missing-port or already-added", async () => {
    let probed = 0;
    const { app, store } = testApp({
      collect: async () => [
        { hostname: "192.168.1.72", port: 80, via: "mdns" },
        { hostname: "192.168.1.50", port: null, via: "ssdp" },
        { hostname: "192.168.1.40", port: 80, via: "targets" },
      ],
      probe: async (target) => {
        probed += 1;
        return { kind: "found", snapshot: { ...snapshot, name: target.hostname } };
      },
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(enroll.status).toBe(201);
    probed = 0;

    const res = await app.request("/api/discover", { method: "POST" });
    const body = (await res.json()) as {
      candidates: { status: string; reasonCode: string | null; hostname: string }[];
    };
    expect(probed).toBe(1);
    expect(store.load()).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      hostname: "192.168.1.72",
      status: "already-added",
    });
    expect(body.candidates[1]).toMatchObject({
      hostname: "192.168.1.50",
      status: "rejected",
      reasonCode: "missing-port",
    });
    expect(body.candidates[2]).toMatchObject({
      hostname: "192.168.1.40",
      status: "found",
    });
  });

  it("enrolls a Light once and refuses a duplicate host", async () => {
    const { app, store } = testApp();
    const first = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { light: { hostKey: string; name: string } };
    expect(created.light.name).toBe("WLED");
    expect(store.load()).toHaveLength(1);

    const dup = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72:80" }),
    });
    expect(dup.status).toBe(409);
    expect(store.load()).toHaveLength(1);
  });

  it("persists enrolled Lights across a new server instance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const first = testApp({ store: new FileLightsStore(file) });
    const enroll = await first.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.20" }),
    });
    expect(enroll.status).toBe(201);

    const restarted = testApp({ store: new FileLightsStore(file) });
    const list = await restarted.app.request("/api/lights");
    const body = (await list.json()) as { lights: { hostKey: string }[] };
    expect(body.lights).toHaveLength(1);
    expect(body.lights[0]?.hostKey).toBe("10.0.0.20:80");
  });
});

describe("real WLED HTTP probe", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it("happy-path enrolls from /json and not from a non-WLED 200", async () => {
    server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/json") {
        res.end(
          JSON.stringify({
            info: {
              ver: "0.15.4",
              name: "WLED",
              mac: "aabbccddeeff",
              brand: "WLED",
              leds: { count: 30, rgbw: false },
            },
            state: { on: false, bri: 0, seg: [] },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await listen(server);

    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const app = createApp({
      store,
      probe: (target) => probeWled(target, fetch, 500),
      write: async () => true,
      readLive: async () => ({ source: "controller", leds: [] }),
      readCfg: async () => null,
      writeCfg: async () => false,
      collect: async () => [],
    });

    const ok = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: `127.0.0.1:${port}` }),
    });
    expect(ok.status).toBe(201);
    expect(store.load()).toHaveLength(1);
  });

  it("enrolls from the fixture and prefers cfg when info name lags", async () => {
    const box = createFixtureBox({ name: "WLED", infoNameLag: true });
    server = box.listen(0, "127.0.0.1");
    const port = await listenReady(server);

    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const app = createApp({
      store,
      probe: (target) => probeWled(target, fetch, 500),
      write: async () => true,
      readLive: async () => ({ source: "fixture", leds: [] }),
      readCfg: createWledCfgReader(),
      writeCfg: createWledCfgWriter(),
      collect: async () => [],
    });

    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: `127.0.0.1:${port}` }),
    });
    expect(enroll.status).toBe(201);
    const id = ((await enroll.json()) as { light: { id: string; name: string } }).light.id;

    const renamed = await app.request(`/api/lights/${id}/safe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { displayName: "Porch rail" } }),
    });
    expect(renamed.status).toBe(200);
    const body = (await renamed.json()) as {
      light: { name: string; staleInfoName: string | null };
      safe: { settings: { displayName: string } };
    };
    expect(body.safe.settings.displayName).toBe("Porch rail");
    expect(body.light.name).toBe("Porch rail");
    expect(body.light.staleInfoName).toBe("WLED");
    expect(box.info.name).toBe("WLED");
    expect(box.cfg.id.name).toBe("Porch rail");

    const listed = (await (await app.request("/api/lights")).json()) as {
      lights: { name: string }[];
    };
    expect(listed.lights[0]?.name).toBe("Porch rail");
  });
});

describe("declared Elements", () => {
  it("persists a valid draft and returns declared vs reported drift", async () => {
    const { app, store } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const created = (await enroll.json()) as { light: { id: string } };
    const id = created.light.id;

    const save = await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const detail = (await save.json()) as {
      elements: { label: string; start: number; stop: number }[];
      reported: { start: number; stop: number; differs: boolean }[];
      display: { notes: { text: string }[]; regions: { kind: string; start: number; stop: number }[] };
      light: { elementCount: number; driftLabel: string | null };
    };
    expect(detail.elements).toEqual([
      expect.objectContaining({ label: "Left run", start: 0, stop: 24 }),
      expect.objectContaining({ label: "Right run", start: 24, stop: 50 }),
    ]);
    expect(store.elementsFor(id)).toHaveLength(2);
    expect(detail.reported).toEqual([{ start: 0, stop: 60, differs: true }]);
    expect(detail.display.regions).toContainEqual({ kind: "drift", start: 50, stop: 60 });
    expect(detail.light.elementCount).toBe(2);
    expect(detail.light.driftLabel).toMatch(/reports|not on the controller/);

    const restarted = testApp({ store });
    const again = await restarted.app.request(`/api/lights/${id}`);
    const againBody = (await again.json()) as { elements: { label: string }[] };
    expect(againBody.elements.map((element) => element.label)).toEqual([
      "Left run",
      "Right run",
    ]);
  });

  it("refuses invert, overlap, and over-ledCount drafts without writing", async () => {
    const { app, store } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "10.0.0.8" }),
    });
    const { light } = (await enroll.json()) as { light: { id: string } };

    const invert = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Peak", start: 40, stop: 10 }] }),
    });
    expect(invert.status).toBe(422);
    const invertBody = (await invert.json()) as { error: string; message: string };
    expect(invertBody.error).toBe("invert");
    expect(invertBody.message).toMatch(/inverted/);

    const overlap = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Peak", start: 10, stop: 40 },
          { label: "Right run", start: 30, stop: 60 },
        ],
      }),
    });
    expect(overlap.status).toBe(422);
    expect(((await overlap.json()) as { error: string }).error).toBe("overlap");

    const over = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Right run", start: 50, stop: 80 }] }),
    });
    expect(over.status).toBe(422);
    expect(((await over.json()) as { error: string }).error).toBe("over-ledCount");
    expect(store.elementsFor(light.id)).toEqual([]);
  });

  it("keeps unreachable Inspect honest — grey, last-seen, no last colour or last report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const enroll = await online.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const { light } = (await enroll.json()) as { light: { id: string } };
    await online.app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Door", start: 0, stop: 60 }] }),
    });

    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.40 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await offline.app.request(`/api/lights/${light.id}`);
    const body = (await res.json()) as {
      light: { bead: string; reachability: string; lastSeenAt: string | null };
      reported: unknown[];
      display: { notes: { text: string }[] };
    };
    expect(body.light.reachability).toBe("no-answer");
    expect(body.light.bead).toBe("unknown");
    expect(body.light.lastSeenAt).toBe("2026-09-26T18:00:00.000Z");
    expect(body.reported).toEqual([]);
    expect(body.display.notes[0]?.text).toBe("No current report to compare.");
  });
});

describe("preview + blink", () => {
  async function enroll(app: ReturnType<typeof testApp>["app"]) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const body = (await res.json()) as { light: { id: string } };
    await app.request(`/api/lights/${body.light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    return body.light.id;
  }

  it("previews a range, reads it back, then restores", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const detail = (await (
      await app.request(`/api/lights/${id}`)
    ).json()) as { elements: { id: string; label: string }[] };
    const right = detail.elements.find((element) => element.label === "Right run");

    const preview = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: right?.id,
        color: "#4f7dff",
        brightness: 180,
      }),
    });
    expect(preview.status).toBe(200);
    const live = (await preview.json()) as {
      session: { kind: string; target: { label: string } };
      liveLeds: string[];
      liveCaption: string;
    };
    expect(live.session.kind).toBe("preview");
    expect(live.session.target.label).toBe("Right run");
    expect(live.liveLeds.slice(24, 50).every((led) => led === "#4f7dff")).toBe(true);
    expect(live.liveLeds[0]).toBe("#ffa000");
    expect(live.liveCaption).toMatch(/Not Hardware Done/);
    expect(box.leds[24]).toBe("#4f7dff");

    const ended = await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ended.status).toBe(200);
    const after = (await ended.json()) as { restored: boolean; session: null };
    expect(after.restored).toBe(true);
    expect(after.session).toBeNull();
    expect(box.leds[24]).toBe("#ffa000");
  });

  it("keeps the original restore if Preview is sent again", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const detail = (await (
      await app.request(`/api/lights/${id}`)
    ).json()) as { elements: { id: string }[] };

    await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: detail.elements[0]?.id,
        color: "#4f7dff",
        brightness: 180,
      }),
    });
    const again = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: detail.elements[0]?.id,
        color: "#3dff7a",
        brightness: 200,
      }),
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { liveLeds: string[] }).liveLeds[0]).toBe("#3dff7a");

    await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(box.leds[0]).toBe("#ffa000");
  });

  it("blinks then restores, and refuses both when offline", async () => {
    const { app, box } = testApp();
    const id = await enroll(app);
    const blink = await app.request(`/api/lights/${id}/blink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(blink.status).toBe(200);
    const pulsing = (await blink.json()) as { session: { kind: string }; liveLeds: string[] };
    expect(pulsing.session.kind).toBe("blink");
    expect(pulsing.liveLeds[0]).toBe("#f4f1ea");
    expect(box.leds[0]).toBe("#f4f1ea");

    const ended = await app.request(`/api/lights/${id}/blink/end`, { method: "POST" });
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as { restored: boolean }).restored).toBe(true);
    expect(box.leds[0]).toBe("#ffa000");

    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const offlineId = await enroll(online.app);
    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({
        kind: "probe-failed",
        reason: "no answer",
      }),
    });
    const refused = await offline.app.request(`/api/lights/${offlineId}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff" }),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string; message: string }).error).toBe(
      "offline",
    );
    const blinkOff = await offline.app.request(`/api/lights/${offlineId}/blink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(blinkOff.status).toBe(422);
  });
});

describe("apply + re-address", () => {
  async function enroll(app: ReturnType<typeof testApp>["app"]) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const body = (await res.json()) as { light: { id: string } };
    await app.request(`/api/lights/${body.light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    return body.light.id;
  }

  it("applies declared ranges, rereads, and persists a last-good snapshot", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const detail = (await (await app.request(`/api/lights/${id}`)).json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      apply: { matched: boolean; caption: string; status: string };
      reported: { start: number; stop: number }[];
    };
    expect(body.apply.matched).toBe(true);
    expect(body.apply.status).toBe("matched");
    expect(body.apply.caption).toMatch(/Not Hardware Done/);
    expect(body.reported.map((row) => `${row.start}-${row.stop}`).sort()).toEqual([
      "0-24",
      "24-50",
    ]);
    expect(store.findById(id)?.lastSnapshot?.segments).toEqual([
      { start: 0, stop: 24 },
      { start: 24, stop: 50 },
    ]);
  });

  it("stays failed when the reread does not match what was applied", async () => {
    const box = memoryBox();
    const { app, store } = testApp({
      write: box.write,
      readLive: box.readLive,
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, segments: [{ start: 0, stop: 60 }] },
      }),
    });
    const id = await enroll(app);
    const detail = (await (await app.request(`/api/lights/${id}`)).json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      apply: { matched: boolean; status: string; message: string };
    };
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("mismatch");
    expect(body.apply.message).toMatch(/didn’t stick/);
    expect(store.findById(id)?.lastSnapshot).toBeFalsy();
  });

  it("refuses Apply when offline or the draft is invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const id = await enroll(online.app);
    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({ kind: "probe-failed", reason: "no answer" }),
    });
    const refused = await offline.app.request(`/api/lights/${id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/hasn’t answered/);

    const { app } = testApp();
    const liveId = await enroll(app);
    const invert = await app.request(`/api/lights/${liveId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Bad", start: 24, stop: 10 }],
      }),
    });
    expect(invert.status).toBe(422);
    expect(((await invert.json()) as { message: string }).message).toMatch(/stop/i);
  });

  it("probes a new host before switching, and keeps the old address on failure", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const before = store.findById(id)!;
    let seen: string | null = null;
    const other = testApp({
      store,
      probe: async (target) => {
        seen = `${target.hostname}:${target.port}`;
        expect(store.findById(id)?.hostKey).toBe(before.hostKey);
        return { kind: "probe-failed" as const, reason: "no answer at the new host." };
      },
    });
    const res = await other.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.88" }),
    });
    expect(res.status).toBe(422);
    expect(seen).toBe("192.168.1.88:80");
    expect(store.findById(id)?.hostKey).toBe(before.hostKey);
  });

  it("refuses a public re-address before any probe", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    let probed = 0;
    const guarded = testApp({
      store,
      probe: async () => {
        probed += 1;
        return { kind: "found" as const, snapshot };
      },
    });
    const res = await guarded.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "203.0.113.9" }),
    });
    expect(res.status).toBe(403);
    expect(probed).toBe(0);
    expect(store.findById(id)?.hostKey).toBe("192.168.1.72:80");
  });

  it("switches on same-MAC from a fresh snapshot, and refuses a different MAC", async () => {
    const { app, store } = testApp();
    const id = await enroll(app);
    const ok = testApp({
      store,
      probe: async () => ({
        kind: "found" as const,
        snapshot: {
          ...snapshot,
          name: "WLED-44",
          mac: "e8:9f:6d:7f:2a:04",
          segments: [{ start: 0, stop: 60 }],
        },
      }),
    });
    const switched = await ok.app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.44" }),
    });
    expect(switched.status).toBe(200);
    const after = store.findById(id)!;
    expect(after.hostKey).toBe("192.168.1.44:80");
    expect(after.name).toBe("WLED-44");
    expect(after.lastSnapshot?.name).toBe("WLED-44");

    const refused = await testApp({
      store,
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, mac: "aa:bb:cc:dd:ee:ff", name: "Other" },
      }),
    }).app.request(`/api/lights/${id}/readdress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toBe("mac-mismatch");
    expect(store.findById(id)?.hostKey).toBe("192.168.1.44:80");
  });
});

describe("all-off + delete", () => {
  async function enrollHost(app: ReturnType<typeof testApp>["app"], host: string) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host }),
    });
    const body = (await res.json()) as { light: { id: string } };
    await app.request(`/api/lights/${body.light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Left run", start: 0, stop: 24 }],
      }),
    });
    return body.light.id;
  }

  it("cancels a Preview without restoring, then powers off", async () => {
    const { app, box } = testApp();
    const id = await enrollHost(app, "192.168.1.72");
    await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff", brightness: 180 }),
    });
    expect(box.leds[0]).toBe("#4f7dff");
    const res = await app.request("/api/all-off", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      restored: boolean;
      cancelled: { kind: string; label: string }[];
      rows: { status: string; detail: string }[];
      caption: string;
    };
    expect(body.restored).toBe(false);
    expect(body.cancelled[0]?.kind).toBe("preview");
    expect(body.rows[0]?.status).toBe("off");
    expect(body.caption).toMatch(/Not Hardware Done/);
    expect(box.leds[0]).toBe("#4f7dff");
    const live = await app.request(`/api/lights/${id}`);
    expect(((await live.json()) as { session: null }).session).toBeNull();
  });

  it("retries only Lights that failed All Off", async () => {
    const boxes = new Map<string, ReturnType<typeof memoryBox>>();
    const boxFor = (host: string) => {
      const existing = boxes.get(host);
      if (existing) return existing;
      const next = memoryBox();
      boxes.set(host, next);
      return next;
    };
    let fail73 = true;
    const { app } = testApp({
      write: async (target, body) => {
        if (target.hostname === "192.168.1.73" && fail73) return false;
        return boxFor(target.hostname).write(target, body);
      },
      readLive: (target, count) => boxFor(target.hostname).readLive(target, count),
      probe: async (target) => boxFor(target.hostname).probe(),
    });
    const keep = await enrollHost(app, "192.168.1.72");
    const fail = await enrollHost(app, "192.168.1.73");
    const first = await app.request("/api/all-off", { method: "POST" });
    const firstBody = (await first.json()) as {
      rows: { lightId: string; status: string }[];
      failedIds: string[];
    };
    expect(firstBody.failedIds).toEqual([fail]);
    expect(firstBody.rows.find((row) => row.lightId === keep)?.status).toBe("off");
    expect(firstBody.rows.find((row) => row.lightId === fail)?.status).toBe("failed");
    fail73 = false;
    const retry = await app.request("/api/all-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lightIds: firstBody.failedIds }),
    });
    const retryBody = (await retry.json()) as { rows: { lightId: string; status: string }[] };
    expect(retryBody.rows).toHaveLength(1);
    expect(retryBody.rows[0]?.lightId).toBe(fail);
    expect(retryBody.rows[0]?.status).toBe("off");
  });

  it("refuses Delete until every check is complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const id = await enrollHost(online.app, "192.168.1.72");
    const offline = testApp({
      store: new FileLightsStore(file),
      probe: async () => ({ kind: "probe-failed", reason: "no answer" }),
    });
    const locked = await offline.app.request(`/api/lights/${id}/delete-checks`);
    const lockedBody = (await locked.json()) as {
      checks: { key: string; status: string }[];
    };
    expect(lockedBody.checks.filter((check) => check.status === "ok")).toHaveLength(2);
    const refused = await offline.app.request(`/api/lights/${id}`, { method: "DELETE" });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message: string }).message).toMatch(/I understand/);

    await online.app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff" }),
    });
    const live = await online.app.request(`/api/lights/${id}`, { method: "DELETE" });
    expect(live.status).toBe(422);

    await online.app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const ok = await online.app.request(`/api/lights/${id}`, { method: "DELETE" });
    expect(ok.status).toBe(200);
    expect(online.store.findById(id)).toBeUndefined();
  });
});

describe("safe settings", () => {
  async function enroll(app: ReturnType<typeof testApp>["app"]) {
    const res = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    return ((await res.json()) as { light: { id: string } }).light.id;
  }

  it("writes understood fields and rereads a match", async () => {
    const { app, cfg } = testApp();
    const id = await enroll(app);
    const res = await app.request(`/api/lights/${id}/safe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          displayName: "Porch rail",
          turnOnAtBoot: false,
          bootBrightness: 180,
          bootPreset: 2,
          defaultTransition: 10,
          currentLimitMa: 1200,
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { name: string };
      safeWrite: { matched: boolean; caption: string };
      safe: { settings: { displayName: string; bootBrightness: number } };
    };
    expect(body.safeWrite.matched).toBe(true);
    expect(body.safe.settings.displayName).toBe("Porch rail");
    expect(body.light.name).toBe("Porch rail");
    expect(body.safe.settings.bootBrightness).toBe(180);
    expect(cfg.cfg.id.name).toBe("Porch rail");
    expect(cfg.cfg.def.on).toBe(false);
    expect(body.safeWrite.caption).toMatch(/Not Hardware Done/);
  });

  it("uses the cfg name for the Light title when /json/info still lags", async () => {
    const { app, store, box, cfg } = testApp();
    const id = await enroll(app);
    const res = await app.request(`/api/lights/${id}/safe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { displayName: "Porch rail" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { name: string; nameSource: string; staleInfoName: string | null };
      safeWrite: { matched: boolean; message: string };
      safe: { settings: { displayName: string } };
    };
    expect(body.safeWrite.matched).toBe(true);
    expect(body.safe.settings.displayName).toBe("Porch rail");
    expect(cfg.cfg.id.name).toBe("Porch rail");
    expect(body.light.name).toBe("Porch rail");
    expect(body.light.nameSource).toBe("cfg");
    expect(body.light.staleInfoName).toBe("WLED");
    expect(body.safeWrite.message).toMatch(/\/json\/info still reports “WLED”/);
    expect(store.findById(id)?.name).toBe("Porch rail");

    const listed = (await (await app.request("/api/lights")).json()) as {
      lights: { id: string; name: string; staleInfoName: string | null }[];
    };
    const row = listed.lights.find((light) => light.id === id);
    expect(row?.name).toBe("Porch rail");
    expect(row?.staleInfoName).toBe("WLED");

    const inspect = (await (await app.request(`/api/lights/${id}`)).json()) as {
      light: { name: string; nameSource: string; staleInfoName: string | null };
    };
    expect(inspect.light.name).toBe("Porch rail");
    expect(inspect.light.nameSource).toBe("cfg");

    box.setName("Porch rail");
    const caughtUp = (await (await app.request(`/api/lights/${id}`)).json()) as {
      light: { name: string; nameSource: string; staleInfoName: string | null };
    };
    expect(caughtUp.light.name).toBe("Porch rail");
    expect(caughtUp.light.nameSource).toBe("info");
    expect(caughtUp.light.staleInfoName).toBeNull();
  });

  it("refuses unsupported firmware without writing", async () => {
    const { app, cfg } = testApp({
      readCfg: async () => ({ vid: 1903252, rev: [1, 0] }),
    });
    const id = await enroll(app);
    const before = structuredClone(cfg.cfg);
    const res = await app.request(`/api/lights/${id}/safe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { displayName: "Nope" } }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toMatch(/isn’t a shape we write/);
    expect(cfg.cfg).toEqual(before);
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
  });
}

function listenReady(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const done = () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    };
    if (server.listening) {
      done();
      return;
    }
    server.once("listening", done);
    server.once("error", reject);
  });
}
