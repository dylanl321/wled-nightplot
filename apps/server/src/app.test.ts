import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listStripPresets, provisionApplyBodyFromPreset } from "@nightplot/shared";
import { createApp, type AppDeps } from "./app.ts";
import { ALL_OFF_PROBE_CONCURRENCY, FIND_PROBE_CONCURRENCY } from "./discovery/map-limit.ts";
import { FileLedProductsStore } from "./store/led-products-store.ts";
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
        if (seg.stop <= seg.start) continue;
        next.push({ start: seg.start, stop: seg.stop });
        const rgb = seg.col?.[0];
        if (!rgb) continue;
        const hex = `#${rgb
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("")}`;
        color = hex;
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
  const products = overrides.products ?? new FileLedProductsStore(join(dir, "led-products.json"));
  const box = memoryBox();
  const cfg = memoryCfg();
  const probe: ProbeFn = overrides.probe ?? box.probe;
  const app = createApp({
    store,
    products,
    probe,
    write: overrides.write ?? box.write,
    readLive: overrides.readLive ?? box.readLive,
    readCfg: overrides.readCfg ?? cfg.read,
    writeCfg: overrides.writeCfg ?? cfg.write,
    collect: overrides.collect ?? (async () => []),
    now: overrides.now ?? (() => new Date("2026-09-26T18:00:00.000Z")),
  });
  return { app, store, products, dir, box, cfg };
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

  it("CORS defaults to loopback web; env may add one published origin", async () => {
    const { app } = testApp();
    const allowed = await app.request("/health", {
      headers: { Origin: "http://127.0.0.1:43180" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:43180",
    );
    const denied = await app.request("/health", {
      headers: { Origin: "http://192.168.1.10:43180" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const previous = process.env.NIGHTPLOT_CORS_ORIGINS;
    process.env.NIGHTPLOT_CORS_ORIGINS = "http://192.168.1.10:43180";
    try {
      const { app: gated } = testApp();
      const extra = await gated.request("/health", {
        headers: { Origin: "http://192.168.1.10:43180" },
      });
      expect(extra.headers.get("access-control-allow-origin")).toBe(
        "http://192.168.1.10:43180",
      );
    } finally {
      if (previous === undefined) delete process.env.NIGHTPLOT_CORS_ORIGINS;
      else process.env.NIGHTPLOT_CORS_ORIGINS = previous;
    }
  });

  it("exposes strip presets on the catalog snapshot", async () => {
    const { app } = testApp();
    const res = await app.request("/api/catalogs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stripPresets: { id: string; ledType: string; length: number; gpio: number }[];
      ledProducts: { id: string; driverId: string; formFactor: string }[];
      strips: { id: string; bead: string }[];
    };
    expect(body.stripPresets.length).toBeGreaterThanOrEqual(3);
    expect(body.stripPresets.every((entry) => entry.ledType === "ws281x")).toBe(true);
    expect(body.ledProducts.length).toBeGreaterThanOrEqual(2);
    expect(body.ledProducts.every((entry) => entry.driverId === "ws281x")).toBe(true);
    expect(body.strips.map((row) => row.id)).toEqual(["ws281x", "sk6812-rgbw"]);
    expect(body.strips.find((row) => row.id === "sk6812-rgbw")?.bead).toBe("rgbw");
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
    const created = (await first.json()) as {
      light: { hostKey: string; name: string; ledProductId: string | null };
    };
    expect(created.light.name).toBe("WLED");
    expect(created.light.ledProductId).toBeNull();
    expect(store.load()).toHaveLength(1);
    expect(store.load()[0]?.ledProductId).toBeNull();

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

    const invertPast = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Peak", start: 80, stop: 40 }] }),
    });
    expect(invertPast.status).toBe(422);
    const invertPastBody = (await invertPast.json()) as {
      error: string;
      message: string;
      issues: { code: string; message: string }[];
    };
    expect(invertPastBody.error).toBe("invert");
    expect(invertPastBody.message).toMatch(/inverted/);
    expect(invertPastBody.message).toMatch(/past the strip \(60 LEDs\)/);
    expect(invertPastBody.issues.map((issue) => issue.code)).toEqual([
      "invert",
      "over-ledCount",
    ]);
    expect(invertPastBody.issues[1]?.message).toMatch(/Peak 80–40 runs past the strip \(60 LEDs\)/);
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

describe("info-only segmentCount", () => {
  it("does not report segmentCount 0 when state.seg is unknown", async () => {
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: infoOnly }),
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    const { light } = (await enrolled.json()) as {
      light: { id: string; segmentCount: number | null; on: boolean | null };
    };
    expect(enrolled.status).toBe(201);
    expect(light.on).toBeNull();
    expect(light.segmentCount).toBeNull();
    expect(light.segmentCount).not.toBe(0);

    const list = (await (await app.request("/api/lights")).json()) as {
      lights: { segmentCount: number | null }[];
    };
    expect(list.lights[0]?.segmentCount).toBeNull();

    const inspect = (await (await app.request(`/api/lights/${light.id}`)).json()) as {
      light: { segmentCount: number | null };
    };
    expect(inspect.light.segmentCount).toBeNull();
  });

  it("does not treat unknown segments as empty rails for declared-vs-report", async () => {
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: infoOnly }),
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    const { light } = (await enrolled.json()) as { light: { id: string } };
    const save = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Door", start: 0, stop: 60 }],
      }),
    });
    const detail = (await save.json()) as {
      light: { segmentCount: number | null; driftLabel: string | null };
      display: {
        notes: { text: string }[];
        regions: { kind: string }[];
        declared: { differs: boolean }[];
      };
    };
    expect(save.status).toBe(200);
    expect(detail.light.segmentCount).toBeNull();
    expect(detail.light.driftLabel).toBe("Segments unknown — no report to compare.");
    expect(detail.light.driftLabel).not.toMatch(/not on the controller/);
    expect(detail.display.declared[0]?.differs).toBe(false);
    expect(detail.display.regions).not.toContainEqual(
      expect.objectContaining({ kind: "drift" }),
    );

    const list = (await (await app.request("/api/lights")).json()) as {
      lights: { driftLabel: string | null; segmentCount: number | null }[];
    };
    expect(list.lights[0]?.segmentCount).toBeNull();
    expect(list.lights[0]?.driftLabel).toBe("Segments unknown — no report to compare.");
  });

  it("keeps a known empty seg list as zero — distinct from unknown", async () => {
    const { app } = testApp({
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, segments: [] },
      }),
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.91" }),
    });
    const { light } = (await enrolled.json()) as {
      light: { segmentCount: number | null };
    };
    expect(light.segmentCount).toBe(0);
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
      reported: { start: number; stop: number }[];
      liveMatch: { matched: number; total: number } | null;
    };
    expect(live.session.kind).toBe("preview");
    expect(live.session.target.label).toBe("Right run");
    expect(live.liveLeds.slice(24, 50).every((led) => led === "#4f7dff")).toBe(true);
    expect(live.liveLeds[0]).toBe("#ffa000");
    expect(live.liveCaption).toMatch(/Not Hardware Done/);
    expect(box.leds[24]).toBe("#4f7dff");
    expect(live.reported.map((row) => `${row.start}-${row.stop}`)).toEqual(["0-60"]);
    expect(live.liveMatch).toEqual({ matched: 26, total: 26 });

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

  it("does not invent on when Preview ends from an info-only snapshot", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: infoOnly }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const id = await enroll(app);
    const preview = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff", brightness: 180 }),
    });
    expect(preview.status).toBe(200);
    expect(writes[0]?.on).toBe(true);
    writes.length = 0;

    const ended = await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as { restored: boolean }).restored).toBe(true);
    expect(writes[0]).toBeDefined();
    expect(writes[0]).not.toHaveProperty("on");
    expect(writes[0]).not.toHaveProperty("bri");
    expect(writes[0]).not.toHaveProperty("seg");
  });

  it("does not invent a whole-strip segment when Preview ends with unknown segments", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const infoOnlyColor = {
      ...snapshot,
      on: true,
      brightness: 40,
      segmentColor: "#ffa000",
      segments: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: infoOnlyColor }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const id = await enroll(app);
    const preview = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: "#4f7dff", brightness: 180 }),
    });
    expect(preview.status).toBe(200);
    writes.length = 0;

    const ended = await app.request(`/api/lights/${id}/preview/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as { restored: boolean }).restored).toBe(true);
    expect(writes[0]?.on).toBe(true);
    expect(writes[0]?.bri).toBe(40);
    expect(writes[0]).not.toHaveProperty("seg");
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

  it("does not re-probe or re-read live on a locate hop after Preview is open", async () => {
    let probes = 0;
    let liveReads = 0;
    const { app, box } = testApp({
      probe: async () => {
        probes += 1;
        return { kind: "found" as const, snapshot };
      },
      readLive: async () => {
        liveReads += 1;
        return { source: "fixture", leds: box.leds.slice() };
      },
    });
    const id = await enroll(app);
    const afterEnroll = probes;
    await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: 2, stop: 4, color: "#fff4dc", brightness: 180 }),
    });
    expect(probes).toBeGreaterThan(afterEnroll);
    const afterStart = { probes, liveReads };

    const hop = await app.request(`/api/lights/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: 5, stop: 6, color: "#4f7dff", brightness: 180 }),
    });
    expect(hop.status).toBe(200);
    const body = (await hop.json()) as {
      session: { kind: string; restore: { color: string | null } };
      liveLeds: string[] | null;
      liveCaption: string;
      liveMatch: { matched: number; total: number } | null;
    };
    expect(body.session.kind).toBe("preview");
    expect(body.liveLeds).toBeNull();
    expect(body.liveMatch).toBeNull();
    expect(body.liveCaption).toMatch(/Not Hardware Done/);
    expect(body.liveCaption).not.toMatch(/controller reported/);
    expect(probes).toBe(afterStart.probes);
    expect(liveReads).toBe(afterStart.liveReads);
    expect(box.leds[5]).toBe("#4f7dff");
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
    const pulsing = (await blink.json()) as {
      session: { kind: string };
      liveLeds: string[];
      reported: { start: number; stop: number }[];
      liveMatch: { matched: number; total: number } | null;
    };
    expect(pulsing.session.kind).toBe("blink");
    expect(pulsing.liveLeds[0]).toBe("#f4f1ea");
    expect(box.leds[0]).toBe("#f4f1ea");
    expect(pulsing.reported.map((row) => `${row.start}-${row.stop}`)).toEqual(["0-60"]);
    expect(pulsing.liveMatch).toEqual({ matched: 60, total: 60 });

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

  it("write-failed Apply does not invent apply.read as a known empty list", async () => {
    let written = false;
    const { app } = testApp({
      write: async () => {
        written = true;
        return false;
      },
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
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      message: string;
      apply: {
        matched: boolean;
        status: string;
        message: string;
        read: { start: number; stop: number }[] | null;
        rows: unknown[];
        caption: string;
      };
    };
    expect(written).toBe(true);
    expect(body.error).toBe("write-failed");
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("failed");
    expect(body.apply.read).toBeNull();
    expect(body.apply.read).not.toEqual([]);
    expect(body.apply.rows).toEqual([]);
    expect(body.apply.message).toMatch(/did not take the ranges/);
    expect(body.message).toMatch(/did not take the ranges/);
    expect(body.apply.caption).toMatch(/Ranges were not read/);
    expect(body.apply.caption).not.toMatch(/controller reported these ranges/);
  });

  it("reread-failed Apply does not invent apply.read as a known empty list", async () => {
    let written = false;
    const { app } = testApp({
      write: async () => {
        written = true;
        return true;
      },
      probe: async () =>
        written
          ? { kind: "probe-failed" as const, reason: "no answer" }
          : { kind: "found" as const, snapshot },
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
      error: string;
      message: string;
      apply: {
        matched: boolean;
        status: string;
        message: string;
        read: { start: number; stop: number }[] | null;
        rows: unknown[];
        caption: string;
      };
    };
    expect(written).toBe(true);
    expect(body.error).toBe("reread-failed");
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("failed");
    expect(body.apply.read).toBeNull();
    expect(body.apply.read).not.toEqual([]);
    expect(body.apply.rows).toEqual([]);
    expect(body.apply.message).toMatch(/could not re-read/);
    expect(body.message).toMatch(/could not re-read/);
    expect(body.apply.caption).toMatch(/Ranges were not read/);
    expect(body.apply.caption).not.toMatch(/controller reported these ranges/);
  });

  it("does not treat unknown reread segments as empty before applyOutcome", async () => {
    let written = false;
    const { app, store } = testApp({
      write: async () => {
        written = true;
        return true;
      },
      probe: async () => ({
        kind: "found" as const,
        snapshot: written ? { ...snapshot, segments: null } : snapshot,
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
      error: string;
      message: string;
      apply: {
        matched: boolean;
        status: string;
        message: string;
        read: { start: number; stop: number }[] | null;
        rows: unknown[];
        caption: string;
      };
    };
    expect(written).toBe(true);
    expect(body.error).toBe("reread-unknown-segments");
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("failed");
    expect(body.apply.status).not.toBe("matched");
    expect(body.apply.status).not.toBe("mismatch");
    expect(body.apply.read).toBeNull();
    expect(body.apply.rows).toEqual([]);
    expect(body.apply.message).toMatch(/segments are unknown/);
    expect(body.apply.message).not.toMatch(/didn’t stick/);
    expect(body.message).toMatch(/segments are unknown/);
    expect(body.apply.caption).toMatch(/Software-green from the fixture/);
    expect(body.apply.caption).not.toMatch(/controller reported these ranges/);
    expect(store.findById(id)?.lastSnapshot).toBeFalsy();
  });

  it("refuses leftover-segment clears when pre-apply segment count is unknown — does not invent 0", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const infoOnly = {
      ...snapshot,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: infoOnly }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.90" }),
    });
    const { light } = (await enrolled.json()) as { light: { id: string } };
    const save = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    const detail = (await save.json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("refused");
    expect(body.message).toMatch(/segments unknown/i);
    expect(body.message).toMatch(/leftover/);
    expect(writes).toEqual([]);
  });

  it("applies with no leftover clears when previous segment count is known empty — distinct from unknown", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const emptySeg = { ...snapshot, segments: [] };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: emptySeg }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.91" }),
    });
    const { light } = (await enrolled.json()) as { light: { id: string } };
    const save = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 50 },
        ],
      }),
    });
    const detail = (await save.json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 24, col: [[255, 160, 0]] },
      { id: 1, start: 24, stop: 50, col: [[255, 160, 0]] },
    ]);
    expect(writes[0]?.seg?.some((seg) => seg.stop === 0)).toBe(false);
    expect(res.status).not.toBe(422);
    expect(((await res.json()) as { error?: string }).error).not.toBe("refused");
  });

  it("clears leftover segments when the previous count is known and higher than the draft", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const three = {
      ...snapshot,
      segments: [
        { start: 0, stop: 20 },
        { start: 20, stop: 40 },
        { start: 40, stop: 60 },
      ],
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: three }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.92" }),
    });
    const { light } = (await enrolled.json()) as { light: { id: string } };
    const save = await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [{ label: "Door", start: 0, stop: 24 }],
      }),
    });
    const detail = (await save.json()) as {
      elements: { id: string; label: string; start: number; stop: number }[];
    };
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: detail.elements }),
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 24, col: [[255, 160, 0]] },
      { id: 1, start: 0, stop: 0, col: [[255, 160, 0]] },
      { id: 2, start: 0, stop: 0, col: [[255, 160, 0]] },
    ]);
    expect(res.status).not.toBe(422);
  });

  it("still compares a known empty reread seg list as empty — distinct from unknown", async () => {
    let written = false;
    const { app, store } = testApp({
      write: async () => {
        written = true;
        return true;
      },
      probe: async () => ({
        kind: "found" as const,
        snapshot: written ? { ...snapshot, segments: [] } : snapshot,
      }),
      readLive: async () => ({ source: "controller", leds: [] }),
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
      error?: string;
      apply: {
        matched: boolean;
        status: string;
        message: string;
        read: unknown;
        caption: string;
      };
    };
    expect(written).toBe(true);
    expect(body.error).not.toBe("reread-unknown-segments");
    expect(body.apply.matched).toBe(false);
    expect(body.apply.status).toBe("mismatch");
    expect(body.apply.read).toEqual([]);
    expect(body.apply.message).toMatch(/didn’t stick/);
    expect(body.apply.message).not.toMatch(/segments are unknown/);
    expect(body.apply.caption).toMatch(/reported no ranges/);
    expect(body.apply.caption).toMatch(/until you look at the strip/);
    expect(body.apply.caption).not.toMatch(/these ranges/);
    expect(body.apply.caption).not.toMatch(/\bthem\b/);
    expect(body.apply.caption).not.toMatch(/until you see them/);
    expect(body.apply.caption).not.toMatch(/Ranges were not read/);
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

  it("refuses Apply when colour is unknown — does not invent #ffa000", async () => {
    const writes: import("./wled/live.ts").WledStateWrite[] = [];
    const noColour = {
      ...snapshot,
      segmentColor: null,
    };
    const { app } = testApp({
      probe: async () => ({ kind: "found" as const, snapshot: noColour }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const enrolled = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const { light } = (await enrolled.json()) as { light: { id: string } };
    const elements = [
      { label: "Left run", start: 0, stop: 24 },
      { label: "Right run", start: 24, stop: 50 },
    ];
    await app.request(`/api/lights/${light.id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    });
    const res = await app.request(`/api/lights/${light.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { message: string }).message).toMatch(/will not invent a look/);
    expect(writes).toEqual([]);

    const onWithoutColour = testApp({
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, segmentColor: null },
      }),
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
    });
    const onEnrolled = await onWithoutColour.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.73" }),
    });
    const onId = ((await onEnrolled.json()) as { light: { id: string } }).light.id;
    await onWithoutColour.app.request(`/api/lights/${onId}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    });
    const onRefused = await onWithoutColour.app.request(`/api/lights/${onId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements }),
    });
    expect(onRefused.status).toBe(422);
    expect(((await onRefused.json()) as { message: string }).message).toMatch(
      /will not invent a look/,
    );
    expect(writes).toEqual([]);
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

  it("does not claim 3 s when All Off refuse is instant", async () => {
    let fail = false;
    const { app, box } = testApp({
      probe: async (target) => {
        if (fail) return { kind: "probe-failed" as const, reason: "probe failed." };
        return box.probe();
      },
    });
    const id = await enrollHost(app, "192.168.1.63");
    fail = true;
    const res = await app.request("/api/all-off", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { lightId: string; status: string; detail: string }[];
    };
    expect(body.rows).toEqual([
      {
        lightId: id,
        name: "WLED",
        status: "unknown",
        detail: "no answer from 192.168.1.63.",
      },
    ]);
    expect(body.rows[0]?.detail).not.toMatch(/in 3 s/);
  });

  it("names the All Off wait from actual elapsed, not a fixed 3 s", async () => {
    let fail = false;
    const origin = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(origin);
    try {
      const { app, box } = testApp({
        probe: async (target) => {
          if (fail) {
            now.mockReturnValue(origin + 2800);
            return { kind: "probe-failed" as const, reason: "probe failed." };
          }
          return box.probe();
        },
      });
      const id = await enrollHost(app, "192.168.1.63");
      fail = true;
      const res = await app.request("/api/all-off", { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rows: { lightId: string; detail: string }[] };
      expect(body.rows[0]?.lightId).toBe(id);
      expect(body.rows[0]?.detail).toBe("no answer from 192.168.1.63 in 3 s.");
    } finally {
      now.mockRestore();
    }
  });

  it("probes enrolled Lights with a bound of four; a refuse stays unknown", async () => {
    const boxes = new Map<string, ReturnType<typeof memoryBox>>();
    const boxFor = (host: string) => {
      const existing = boxes.get(host);
      if (existing) return existing;
      const next = memoryBox();
      boxes.set(host, next);
      return next;
    };
    const hosts = [
      "192.168.1.10",
      "192.168.1.11",
      "192.168.1.12",
      "192.168.1.13",
      "192.168.1.14",
      "192.168.1.15",
    ];
    const firstSeen = new Set<string>();
    const started: string[] = [];
    const gates: Array<() => void> = [];
    let gating = false;
    let inFlight = 0;
    let maxInFlight = 0;

    const { app } = testApp({
      write: async (target, body) => boxFor(target.hostname).write(target, body),
      readLive: (target, count) => boxFor(target.hostname).readLive(target, count),
      probe: async (target) => {
        if (gating && !firstSeen.has(target.hostname)) {
          firstSeen.add(target.hostname);
          started.push(target.hostname);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise<void>((resolve) => {
            gates.push(resolve);
          });
          inFlight -= 1;
        }
        if (gating && target.hostname === "192.168.1.14") {
          return { kind: "probe-failed", reason: "no answer" };
        }
        return boxFor(target.hostname).probe();
      },
    });

    const ids: string[] = [];
    for (const host of hosts) {
      ids.push(await enrollHost(app, host));
    }
    gating = true;

    const pending = app.request("/api/all-off", { method: "POST" });

    await vi.waitFor(() => {
      expect(inFlight).toBe(ALL_OFF_PROBE_CONCURRENCY);
      expect(started).toEqual(hosts.slice(0, ALL_OFF_PROBE_CONCURRENCY));
    });

    for (const release of gates.splice(0)) release();

    await vi.waitFor(() => {
      expect(started).toEqual(hosts);
    });

    for (const release of gates.splice(0)) release();

    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { lightId: string; name: string; status: string; detail: string }[];
      failedIds: string[];
      caption: string;
    };
    expect(maxInFlight).toBe(ALL_OFF_PROBE_CONCURRENCY);
    expect(body.rows.map((row) => row.lightId)).toEqual(ids);
    expect(body.rows.map((row) => row.status)).toEqual([
      "off",
      "off",
      "off",
      "off",
      "unknown",
      "off",
    ]);
    expect(body.rows[4]?.detail).toMatch(/^no answer from 192\.168\.1\.14(\.| in \d+ s\.)$/);
    expect(body.failedIds).toEqual([ids[4]]);
    expect(body.rows.some((row) => row.status === "off" && row.lightId === ids[4])).toBe(false);
    expect(body.caption).toMatch(/Not Hardware Done/);
  });

  it("settles All Off when one Light probe throws; siblings stay fail-closed", async () => {
    const boxes = new Map<string, ReturnType<typeof memoryBox>>();
    const boxFor = (host: string) => {
      const existing = boxes.get(host);
      if (existing) return existing;
      const next = memoryBox();
      boxes.set(host, next);
      return next;
    };
    let explode = false;
    const { app, store } = testApp({
      write: async (target, body) => boxFor(target.hostname).write(target, body),
      readLive: (target, count) => boxFor(target.hostname).readLive(target, count),
      probe: async (target) => {
        if (explode && target.hostname === "192.168.1.73") {
          throw new Error("probe exploded");
        }
        return boxFor(target.hostname).probe();
      },
    });
    const keep = await enrollHost(app, "192.168.1.72");
    const boom = await enrollHost(app, "192.168.1.73");
    const later = await enrollHost(app, "192.168.1.74");
    explode = true;

    const res = await app.request("/api/all-off", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { lightId: string; status: string; detail: string }[];
      failedIds: string[];
      caption: string;
    };
    expect(body.rows).toHaveLength(3);
    expect(body.rows.find((row) => row.lightId === keep)?.status).toBe("off");
    expect(body.rows.find((row) => row.lightId === later)?.status).toBe("off");
    const unknown = body.rows.find((row) => row.lightId === boom);
    expect(unknown?.status).toBe("unknown");
    expect(unknown?.detail).toBe("no answer from 192.168.1.73.");
    expect(unknown?.detail).not.toMatch(/in 3 s/);
    expect(body.failedIds).toEqual([boom]);
    expect(store.findById(keep)?.on).toBe(false);
    expect(store.findById(later)?.on).toBe(false);
    expect(store.findById(boom)?.on).toBeNull();
    expect(store.findById(boom)?.reachability).toBe("no-answer");
    expect(body.caption).toMatch(/Not Hardware Done/);
  });

  it("All Off Light probes overlap instead of waiting out each dead Light", async () => {
    const delayMs = 80;
    const hosts = ["192.168.1.80", "192.168.1.81", "192.168.1.82"];
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const store = new FileLightsStore(join(dir, "lights.json"));
    const online = testApp({ store });
    const ids: string[] = [];
    for (const host of hosts) {
      ids.push(await enrollHost(online.app, host));
    }

    const dead = testApp({
      store,
      probe: async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { kind: "probe-failed" as const, reason: "no answer" };
      },
    });

    const started = Date.now();
    const res = await dead.app.request("/api/all-off", { method: "POST" });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { lightId: string; status: string; detail: string }[];
    };
    expect(body.rows.map((row) => row.lightId)).toEqual(ids);
    expect(body.rows.every((row) => row.status === "unknown")).toBe(true);
    expect(body.rows.map((row) => row.detail)).toEqual([
      "no answer from 192.168.1.80.",
      "no answer from 192.168.1.81.",
      "no answer from 192.168.1.82.",
    ]);
    expect(body.rows.every((row) => !/in 3 s/.test(row.detail))).toBe(true);
    // Serial would be ~3 × delay; overlap should finish near one delay.
    expect(elapsed).toBeLessThan(delayMs * 2.2);
    expect(elapsed).toBeGreaterThanOrEqual(delayMs);
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

  it("does not invent a wait when Delete controller refuse is instant", async () => {
    let fail = false;
    const { app, box } = testApp({
      probe: async () => {
        if (fail) return { kind: "probe-failed" as const, reason: "probe failed." };
        return box.probe();
      },
    });
    const id = await enrollHost(app, "192.168.1.63");
    fail = true;
    const res = await app.request(`/api/lights/${id}/delete-checks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      checks: { key: string; status: string; detail: string }[];
    };
    const controller = body.checks.find((check) => check.key === "controller");
    expect(controller?.status).toBe("unknown");
    expect(controller?.detail).toBe(
      "Couldn’t read it, so we can’t say what it’ll be left doing.",
    );
    expect(controller?.detail).not.toMatch(/in time/);
    expect(controller?.detail).not.toMatch(/in \d+ s/);
  });

  it("names the Delete wait from actual elapsed, not “in time”", async () => {
    let fail = false;
    const origin = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(origin);
    try {
      const { app, box } = testApp({
        probe: async () => {
          if (fail) {
            now.mockReturnValue(origin + 2800);
            return { kind: "probe-failed" as const, reason: "probe failed." };
          }
          return box.probe();
        },
      });
      const id = await enrollHost(app, "192.168.1.63");
      fail = true;
      now.mockReturnValue(origin);
      const res = await app.request(`/api/lights/${id}/delete-checks`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        checks: { key: string; detail: string }[];
      };
      const controller = body.checks.find((check) => check.key === "controller");
      expect(controller?.detail).toBe(
        "Couldn’t read it in 3 s, so we can’t say what it’ll be left doing.",
      );
      expect(controller?.detail).not.toMatch(/in time/);
      now.mockReturnValue(origin);
      const inspect = await app.request(`/api/lights/${id}`);
      const inspectBody = (await inspect.json()) as {
        deleteChecks?: { key: string; detail: string }[];
      };
      expect(inspectBody.deleteChecks?.find((check) => check.key === "controller")?.detail).toBe(
        controller?.detail,
      );
    } finally {
      now.mockRestore();
    }
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
    const body = (await res.json()) as {
      error: string;
      message: string;
      safeWrite?: { status: string; matched: boolean; message: string };
    };
    expect(body.error).toBe("refused");
    expect(body.message).toMatch(/isn’t a shape we write/);
    expect(body.safeWrite).toMatchObject({
      status: "refused",
      matched: false,
    });
    expect(body.safeWrite?.message).toBe(body.message);
    expect(cfg.cfg).toEqual(before);
  });
});

describe("strip provision", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  async function enrollFixture(
    box: ReturnType<typeof createFixtureBox>,
    writeCfg = createWledCfgWriter(),
  ) {
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
      writeCfg,
      collect: async () => [],
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: `127.0.0.1:${port}` }),
    });
    expect(enroll.status).toBe(201);
    const id = ((await enroll.json()) as { light: { id: string; ledCount: number } }).light.id;
    return { app, store, id, port };
  }

  it("writes WS281x length and GPIO, then rereads a matching snapshot", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 150, gpio: 2 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { ledCount: number };
      provision: { settings: { ledType: string; length: number; gpio: number } };
      provisionWrite: { matched: boolean; caption: string; snapshotLedCount: number };
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.provision.settings).toMatchObject({
      ledType: "ws281x",
      length: 150,
      gpio: 2,
    });
    expect(body.light.ledCount).toBe(150);
    expect(body.provisionWrite.snapshotLedCount).toBe(150);
    expect(body.provisionWrite.caption).toMatch(/Not Hardware Done/);
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ len: 150, pin: [2], type: 22 });
    expect(box.info.leds.count).toBe(150);
    expect(store.findById(id)?.ledCount).toBe(150);
  });

  it("accepts a catalog preset as the provision Apply payload", async () => {
    const preset = listStripPresets().find((entry) => entry.id === "ws281x-150-gpio16");
    expect(preset).toBeDefined();
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, id } = await enrollFixture(box);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provisionApplyBodyFromPreset(preset!)),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provisionWrite: { matched: boolean; sent: { length: number; gpio: number } };
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.provisionWrite.sent).toEqual({
      ledType: "ws281x",
      length: preset!.length,
      gpio: preset!.gpio,
    });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({
      len: preset!.length,
      pin: [preset!.gpio],
    });
  });

  it("keeps a cfg/snapshot mismatch on the failure contract — no silent success", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16, busMismatch: true });
    const { app, store, id } = await enrollFixture(box);
    const before = store.findById(id)?.ledCount;
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 200, gpio: 4 } }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      provisionWrite: { matched: boolean; status: string; message: string };
      light: { ledCount: number };
    };
    expect(body.provisionWrite.matched).toBe(false);
    expect(body.provisionWrite.status).toBe("mismatch");
    expect(body.provisionWrite.message).toMatch(/Not treating as success/);
    expect(box.cfg.hw.led.ins[0]?.len).toBe(60);
    expect(body.light.ledCount).toBe(before);
  });

  it("treats a matching cfg with a stale snapshot as failure", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16, infoCountLag: true });
    const { app, id } = await enrollFixture(box);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 180, gpio: 5 } }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      provisionWrite: {
        matched: boolean;
        message: string;
        read: { length: number; gpio: number };
        snapshotLedCount: number;
      };
    };
    expect(body.provisionWrite.matched).toBe(false);
    expect(body.provisionWrite.read.length).toBe(180);
    expect(body.provisionWrite.read.gpio).toBe(5);
    expect(body.provisionWrite.snapshotLedCount).toBe(60);
    expect(body.provisionWrite.message).toMatch(/snapshot still has 60 LEDs/);
    expect(box.cfg.hw.led.ins[0]?.len).toBe(180);
    expect(box.info.leds.count).toBe(60);
  });

  it("refuses unsupported firmware without writing", async () => {
    const { app, cfg } = testApp({
      readCfg: async () => ({ vid: 1903252, rev: [1, 0] }),
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    const before = structuredClone(cfg.cfg);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 80, gpio: 2 } }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      message: string;
      provisionWrite?: { status: string; matched: boolean; message: string };
    };
    expect(body.error).toBe("refused");
    expect(body.message).toMatch(/isn’t a shape we write|compatibility table/);
    expect(body.provisionWrite).toMatchObject({
      status: "refused",
      matched: false,
    });
    expect(body.provisionWrite?.message).toBe(body.message);
    expect(cfg.cfg).toEqual(before);
  });

  it("buildProvisionWrite refuse 422 includes provisionWrite — not notice-only", async () => {
    const bus = { start: 0, len: 60, pin: [16], type: 22, order: 0 };
    let insReads = 0;
    let wrote = false;
    const { app } = testApp({
      readCfg: async () => ({
        hw: {
          led: {
            get ins() {
              insReads += 1;
              // readProvision parse hits ins twice (has-list + buses) and is writable.
              // buildProvisionWrite re-parses; an empty list is that refuse.
              return insReads <= 2 ? [bus] : [];
            },
          },
        },
      }),
      writeCfg: async () => {
        wrote = true;
        return true;
      },
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 80, gpio: 2 } }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      message: string;
      provisionWrite?: {
        status: string;
        matched: boolean;
        sent: { ledType: string; length: number; gpio: number };
        message: string;
      };
    };
    expect(body.error).toBe("refused");
    expect(body.message).toMatch(/No LED bus/);
    expect(body.provisionWrite).toEqual(
      expect.objectContaining({
        status: "refused",
        matched: false,
        sent: { ledType: "ws281x", length: 80, gpio: 2 },
        message: body.message,
      }),
    );
    expect(wrote).toBe(false);
  });

  it("clips declared ranges that run past a shorter strip", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    const save = await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Left run", start: 0, stop: 24 },
          { label: "Right run", start: 24, stop: 60 },
        ],
      }),
    });
    expect(save.status).toBe(200);

    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 30, gpio: 16 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { ledCount: number; driftLabel: string | null };
      elements: { label: string; start: number; stop: number }[];
      display: { notes: { text: string }[] };
      provisionWrite: {
        matched: boolean;
        ranges: {
          rewritten: boolean;
          kind: string;
          notes: string[];
          clipped: { label: string; previousStop: number; stop: number }[];
        };
      };
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.light.ledCount).toBe(30);
    expect(body.provisionWrite.ranges.kind).toBe("shrink");
    expect(body.provisionWrite.ranges.rewritten).toBe(true);
    expect(body.provisionWrite.ranges.clipped).toEqual([
      expect.objectContaining({ label: "Right run", previousStop: 60, stop: 30 }),
    ]);
    expect(body.provisionWrite.ranges.notes.join(" ")).toMatch(/clipped to 24–30/);
    expect(body.elements).toEqual([
      expect.objectContaining({ label: "Left run", start: 0, stop: 24 }),
      expect.objectContaining({ label: "Right run", start: 24, stop: 30 }),
    ]);
    expect(store.elementsFor(id).map((element) => ({ start: element.start, stop: element.stop }))).toEqual(
      [
        { start: 0, stop: 24 },
        { start: 24, stop: 30 },
      ],
    );
    expect(body.display.notes.some((note) => /past the strip/.test(note.text))).toBe(false);
  });

  it("drops a range that starts past the new length and flags leftover coverage", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elements: [
          { label: "Door", start: 0, stop: 24 },
          { label: "Peak", start: 40, stop: 60 },
        ],
      }),
    });
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 30, gpio: 16 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      elements: { label: string; start: number; stop: number }[];
      provisionWrite: { ranges: { dropped: { label: string }[]; uncovered: { start: number; stop: number }[]; notes: string[] } };
    };
    expect(body.elements).toEqual([expect.objectContaining({ label: "Door", start: 0, stop: 24 })]);
    expect(body.provisionWrite.ranges.dropped).toEqual([
      expect.objectContaining({ label: "Peak" }),
    ]);
    expect(body.provisionWrite.ranges.uncovered).toEqual([{ start: 24, stop: 30 }]);
    expect(body.provisionWrite.ranges.notes.join(" ")).toMatch(/Peak 40–60 was dropped/);
    expect(store.elementsFor(id)).toHaveLength(1);
  });

  it("flags grow without inventing Elements", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Door", start: 0, stop: 60 }] }),
    });
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 150, gpio: 16 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { ledCount: number; driftLabel: string | null };
      elements: { label: string; start: number; stop: number }[];
      provisionWrite: {
        ranges: {
          rewritten: boolean;
          kind: string;
          uncovered: { start: number; stop: number }[];
          notes: string[];
        };
      };
    };
    expect(body.light.ledCount).toBe(150);
    expect(body.provisionWrite.ranges.kind).toBe("grow");
    expect(body.provisionWrite.ranges.rewritten).toBe(false);
    expect(body.provisionWrite.ranges.uncovered).toEqual([{ start: 60, stop: 150 }]);
    expect(body.provisionWrite.ranges.notes.join(" ")).toMatch(/were not extended/);
    expect(body.elements).toEqual([expect.objectContaining({ label: "Door", start: 0, stop: 60 })]);
    expect(store.elementsFor(id)).toEqual([
      expect.objectContaining({ label: "Door", start: 0, stop: 60 }),
    ]);
    expect(body.light.driftLabel).toMatch(/more LEDs than declared|not in an Element|reports/);
  });

  it("does not rewrite Elements when snapshot length does not match", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16, infoCountLag: true });
    const { app, store, id } = await enrollFixture(box);
    await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Door", start: 0, stop: 60 }] }),
    });
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 30, gpio: 16 } }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      provisionWrite: { matched: boolean; ranges?: unknown };
      elements: { start: number; stop: number }[];
    };
    expect(body.provisionWrite.matched).toBe(false);
    expect(body.provisionWrite.ranges).toBeUndefined();
    expect(body.elements).toEqual([expect.objectContaining({ start: 0, stop: 60 })]);
    expect(store.elementsFor(id)).toEqual([
      expect.objectContaining({ start: 0, stop: 60 }),
    ]);
  });

  it("does not rewrite Elements when only GPIO changes", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    await app.request(`/api/lights/${id}/elements`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: [{ label: "Door", start: 0, stop: 60 }] }),
    });
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 60, gpio: 2 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provisionWrite: { matched: boolean; ranges?: unknown };
      elements: { start: number; stop: number }[];
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.provisionWrite.ranges).toBeUndefined();
    expect(body.elements).toEqual([expect.objectContaining({ start: 0, stop: 60 })]);
    expect(store.elementsFor(id)[0]).toMatchObject({ start: 0, stop: 60 });
  });

  it("keeps ledProductId after a strip Apply", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, store, id } = await enrollFixture(box);
    const list = await app.request("/api/led-products");
    const product = ((await list.json()) as { products: { id: string }[] }).products[0]!;

    const attached = await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: product.id }),
    });
    expect(attached.status).toBe(200);

    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "ws281x", length: 150, gpio: 2 } }),
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { light: { ledProductId: string | null } }).light.ledProductId,
    ).toBe(product.id);
    expect(store.findById(id)?.ledProductId).toBe(product.id);
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ len: 150, pin: [2], type: 22 });
  });

  it("refuses an unknown LED type without writing", async () => {
    const box = createFixtureBox();
    const { app, id } = await enrollFixture(box);
    const before = structuredClone(box.cfg.hw.led.ins[0]);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "apa102", length: 80, gpio: 2 } }),
    });
    expect(res.status).toBe(400);
    expect(box.cfg.hw.led.ins[0]).toEqual(before);
  });

  it("writes SK6812 RGBW type 30 and rereads a matching fixture bus", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    const { app, id } = await enrollFixture(box);
    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "sk6812-rgbw", length: 90, gpio: 2 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { stripKind: string; stripBead: string; stripChip: string };
      provision: { settings: { ledType: string; length: number; gpio: number; nativeType: number } };
      provisionWrite: {
        matched: boolean;
        sent: { ledType: string };
        caption: string;
        orderPreserved?: boolean;
      };
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.provisionWrite.sent.ledType).toBe("sk6812-rgbw");
    expect(body.light.stripKind).toBe("sk6812-rgbw");
    expect(body.light.stripBead).toBe("rgbw");
    expect(body.light.stripChip).toBe("SK6812 RGBW");
    expect(body.provision.settings).toMatchObject({
      ledType: "sk6812-rgbw",
      length: 90,
      gpio: 2,
      nativeType: 30,
      nativeOrder: 0,
      colorOrder: "GRBW",
    });
    expect(body.provisionWrite.caption).toMatch(/Not Hardware Done/);
    expect(body.provisionWrite.orderPreserved).toBe(false);
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ type: 30, order: 0, len: 90, pin: [2] });
    expect(box.info.leds.rgbw).toBe(true);
  });

  it("returns the preserved SK6812 colour order after a same-type Apply", async () => {
    const box = createFixtureBox({
      ledCount: 60,
      gpio: 16,
      nativeType: 30,
      nativeOrder: 1,
    });
    const { app, id } = await enrollFixture(box);
    const loaded = await app.request(`/api/lights/${id}/provision`);
    expect(loaded.status).toBe(200);
    const before = (await loaded.json()) as {
      provision: { settings: { colorOrder: string; nativeOrder: number } };
    };
    expect(before.provision.settings).toMatchObject({
      colorOrder: "RGBW",
      nativeOrder: 1,
    });

    const res = await app.request(`/api/lights/${id}/provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provision: { ledType: "sk6812-rgbw", length: 90, gpio: 16 } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provision: {
        settings: {
          ledType: string;
          length: number;
          gpio: number;
          nativeType: number;
          nativeOrder: number;
          colorOrder: string;
        };
      };
      provisionWrite: {
        matched: boolean;
        orderPreserved: boolean;
        read: { colorOrder: string; nativeOrder: number };
      };
    };
    expect(body.provisionWrite.matched).toBe(true);
    expect(body.provisionWrite.orderPreserved).toBe(true);
    expect(body.provision.settings).toMatchObject({
      ledType: "sk6812-rgbw",
      length: 90,
      gpio: 16,
      nativeType: 30,
      nativeOrder: 1,
      colorOrder: "RGBW",
    });
    expect(body.provisionWrite.read.colorOrder).toBe("RGBW");
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ type: 30, order: 1, len: 90, pin: [16] });
  });

  it("Inspect seeds SK6812 from a type-30 fixture cfg after enroll", async () => {
    const box = createFixtureBox({ ledCount: 80, gpio: 16, nativeType: 30 });
    const { app, store, id } = await enrollFixture(box);
    expect(store.findById(id)?.stripKind).toBe("ws281x");
    expect(store.findById(id)?.rgbw).toBe(true);

    const listed = (await (await app.request("/api/lights")).json()) as {
      lights: { stripKind: string; stripChip: string; rgbw: boolean }[];
    };
    expect(listed.lights[0]).toMatchObject({
      rgbw: true,
      stripKind: "ws281x",
      stripChip: "WS281x RGB",
    });
    expect(store.findById(id)?.stripKind).toBe("ws281x");

    const inspect = await app.request(`/api/lights/${id}`);
    expect(inspect.status).toBe(200);
    const body = (await inspect.json()) as {
      light: { stripKind: string; stripBead: string; stripChip: string; rgbw: boolean };
    };
    expect(body.light.rgbw).toBe(true);
    expect(body.light.stripKind).toBe("sk6812-rgbw");
    expect(body.light.stripBead).toBe("rgbw");
    expect(body.light.stripChip).toBe("SK6812 RGBW");
    expect(store.findById(id)?.stripKind).toBe("sk6812-rgbw");
  });

  it("reads an SK6812 fixture bus without writing", async () => {
    const box = createFixtureBox({ ledCount: 80, gpio: 16, nativeType: 30 });
    const { app, store, id } = await enrollFixture(box);
    const res = await app.request(`/api/lights/${id}/provision`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      light: { stripKind: string; stripBead: string; stripChip: string };
      provision: {
        settings: { ledType: string; nativeType: number };
        refuse: string | null;
        fingerprint: { writable: boolean; mappingId: string | null };
      };
    };
    expect(body.light.stripKind).toBe("sk6812-rgbw");
    expect(body.light.stripBead).toBe("rgbw");
    expect(body.light.stripChip).toBe("SK6812 RGBW");
    expect(store.findById(id)?.stripKind).toBe("sk6812-rgbw");
    expect(body.provision.refuse).toBeNull();
    expect(body.provision.fingerprint.writable).toBe(true);
    expect(body.provision.fingerprint.mappingId).toBe("wled-0.15-sk6812-rgbw-grbw");
    expect(body.provision.settings).toMatchObject({
      ledType: "sk6812-rgbw",
      nativeType: 30,
      nativeOrder: 0,
      colorOrder: "GRBW",
    });
    expect(box.cfg.hw.led.ins[0]?.type).toBe(30);
  });
});

describe("LED product catalog", () => {
  it("lists seeded products and fetches one by id", async () => {
    const { app, products } = testApp();
    const list = await app.request("/api/led-products");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      products: { id: string; driverId: string; formFactor: string; defaultLength?: number }[];
    };
    expect(body.products.length).toBeGreaterThanOrEqual(2);
    expect(body.products.every((row) => row.driverId === "ws281x")).toBe(true);
    expect(products.list()).toEqual(body.products);

    const first = body.products[0]!;
    const found = await app.request(`/api/led-products/${first.id}`);
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({ product: first });

    const missing = await app.request("/api/led-products/no-such-sku");
    expect(missing.status).toBe(404);
  });

  it("creates a product and refuses unknown driver, form factor, and bad defaults", async () => {
    const writeCfg = vi.fn(async () => true);
    const { app } = testApp({ writeCfg });

    const created = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "eave-cob",
        label: "Eave COB",
        formFactor: "cob",
        driverId: "ws281x",
        defaultLength: 120,
        defaultGpio: 16,
        notes: "Operator SKU. Not written to WLED.",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      product: { id: string; formFactor: string; driverId: string };
    };
    expect(createdBody.product).toMatchObject({
      id: "eave-cob",
      formFactor: "cob",
      driverId: "ws281x",
    });
    expect(writeCfg).not.toHaveBeenCalled();

    const again = await app.request("/api/led-products/eave-cob");
    expect(again.status).toBe(200);

    const unknownDriver = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Mystery",
        formFactor: "discrete",
        driverId: "apa102",
      }),
    });
    expect(unknownDriver.status).toBe(422);
    expect(((await unknownDriver.json()) as { error: string }).error).toBe("unknown_driver");

    const badForm = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Tape",
        formFactor: "tape",
        driverId: "ws281x",
      }),
    });
    expect(badForm.status).toBe(422);
    expect(((await badForm.json()) as { error: string }).error).toBe("bad_form_factor");

    const badLength = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Too long",
        formFactor: "discrete",
        driverId: "ws281x",
        defaultLength: 0,
      }),
    });
    expect(badLength.status).toBe(422);
    expect(((await badLength.json()) as { error: string }).error).toBe("bad_defaults");

    const duplicate = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "eave-cob",
        label: "Eave COB again",
        formFactor: "cob",
        driverId: "ws281x",
      }),
    });
    expect(duplicate.status).toBe(409);
    expect(writeCfg).not.toHaveBeenCalled();

    const rgbw = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "porch-sk6812",
        label: "Porch SK6812",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
        defaultLength: 90,
        defaultGpio: 16,
      }),
    });
    expect(rgbw.status).toBe(201);
    expect(((await rgbw.json()) as { product: { driverId: string } }).product.driverId).toBe(
      "sk6812-rgbw",
    );
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it("patches an existing product and refuses id change or unknown driver", async () => {
    const writeCfg = vi.fn(async () => true);
    const { app, store } = testApp({ writeCfg });

    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(enroll.status).toBe(201);
    const lightId = ((await enroll.json()) as { light: { id: string } }).light.id;
    const before = store.findById(lightId);
    expect(before).toBeDefined();

    const created = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "eave-cob",
        label: "Eave COB",
        formFactor: "cob",
        driverId: "ws281x",
        defaultLength: 120,
      }),
    });
    expect(created.status).toBe(201);

    const patched = await app.request("/api/led-products/eave-cob", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: {
          label: "Eave COB revised",
          formFactor: "cob",
          driverId: "ws281x",
          defaultLength: 150,
          notes: "Shared recipe. Not written to WLED.",
        },
      }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as {
      product: { id: string; label: string; defaultLength?: number };
    };
    expect(patchedBody.product).toMatchObject({
      id: "eave-cob",
      label: "Eave COB revised",
      defaultLength: 150,
    });
    expect(writeCfg).not.toHaveBeenCalled();
    const after = store.findById(lightId);
    expect(after).toEqual(before);
    expect(after?.ledProductId).toBeNull();
    expect(after?.ledCount).toBe(before?.ledCount);

    const listed = await app.request("/api/led-products/eave-cob");
    expect(((await listed.json()) as { product: { label: string } }).product.label).toBe(
      "Eave COB revised",
    );

    const idChange = await app.request("/api/led-products/eave-cob", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "other-slug",
        label: "Eave COB",
        formFactor: "cob",
        driverId: "ws281x",
      }),
    });
    expect(idChange.status).toBe(400);

    const unknownDriver = await app.request("/api/led-products/eave-cob", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Eave COB",
        formFactor: "cob",
        driverId: "apa102",
      }),
    });
    expect(unknownDriver.status).toBe(422);

    const missing = await app.request("/api/led-products/no-such-sku", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Missing",
        formFactor: "discrete",
        driverId: "ws281x",
      }),
    });
    expect(missing.status).toBe(404);
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it("deletes an unattached recipe and refuses while Lights attach or refs are unknown", async () => {
    const writeCfg = vi.fn(async () => true);
    const { app, store, dir } = testApp({ writeCfg });
    const lightsPath = join(dir, "lights.json");

    const created = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "eave-cob",
        label: "Eave COB",
        formFactor: "cob",
        driverId: "ws281x",
        defaultLength: 120,
      }),
    });
    expect(created.status).toBe(201);

    const clearChecks = await app.request("/api/led-products/eave-cob/delete-checks");
    expect(clearChecks.status).toBe(200);
    const clearBody = (await clearChecks.json()) as {
      attached: number | null;
      checks: { status: string; detail: string }[];
    };
    expect(clearBody.attached).toBe(0);
    expect(clearBody.checks[0]?.status).toBe("ok");

    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(enroll.status).toBe(201);
    const lightId = ((await enroll.json()) as { light: { id: string } }).light.id;

    const attached = await app.request(`/api/lights/${lightId}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: "eave-cob" }),
    });
    expect(attached.status).toBe(200);
    expect(store.findById(lightId)?.ledProductId).toBe("eave-cob");

    const blockedChecks = await app.request("/api/led-products/eave-cob/delete-checks");
    const blockedCheckBody = (await blockedChecks.json()) as {
      attached: number | null;
      checks: { status: string }[];
    };
    expect(blockedCheckBody.attached).toBe(1);
    expect(blockedCheckBody.checks[0]?.status).toBe("blocked");

    const refused = await app.request("/api/led-products/eave-cob", { method: "DELETE" });
    expect(refused.status).toBe(409);
    const refusedBody = (await refused.json()) as {
      error: string;
      message: string;
      attached: number | null;
    };
    expect(refusedBody.error).toBe("in_use");
    expect(refusedBody.attached).toBe(1);
    expect(refusedBody.message).toMatch(/still attaches this recipe/);
    expect((await (await app.request("/api/led-products/eave-cob")).json()) as { product: { id: string } })
      .toMatchObject({ product: { id: "eave-cob" } });
    expect(writeCfg).not.toHaveBeenCalled();

    const clearedAttach = await app.request(`/api/lights/${lightId}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: null }),
    });
    expect(clearedAttach.status).toBe(200);

    const deleted = await app.request("/api/led-products/eave-cob", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as {
      deleted: boolean;
      attached: number;
      product: { id: string };
      message: string;
    };
    expect(deletedBody).toMatchObject({ deleted: true, attached: 0, product: { id: "eave-cob" } });
    expect(deletedBody.message).toMatch(/Not a WLED write/);
    expect((await app.request("/api/led-products/eave-cob")).status).toBe(404);
    expect(writeCfg).not.toHaveBeenCalled();

    const again = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "eave-cob",
        label: "Eave COB",
        formFactor: "cob",
        driverId: "ws281x",
      }),
    });
    expect(again.status).toBe(201);

    writeFileSync(lightsPath, "{not-json");
    const unknown = await app.request("/api/led-products/eave-cob", { method: "DELETE" });
    expect(unknown.status).toBe(422);
    expect(((await unknown.json()) as { error: string }).error).toBe("unknown_refs");
    expect((await (await app.request("/api/led-products/eave-cob")).json()) as { product: { id: string } })
      .toMatchObject({ product: { id: "eave-cob" } });

    writeFileSync(
      lightsPath,
      `${JSON.stringify({
        version: 1,
        lights: [{ id: "light-garage", name: "Garage", ledProductId: 12 }],
        elements: [],
      })}\n`,
    );
    const partial = await app.request("/api/led-products/eave-cob", { method: "DELETE" });
    expect(partial.status).toBe(422);
    expect(((await partial.json()) as { error: string }).error).toBe("unknown_refs");
    expect((await app.request("/api/led-products/eave-cob")).status).toBe(200);

    const missing = await app.request("/api/led-products/no-such-sku", { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(writeCfg).not.toHaveBeenCalled();
  });
});

describe("LED product attach", () => {
  it("persists ledProductId on the Light and lists products on Strip GET", async () => {
    const { app, store, products } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    expect(enroll.status).toBe(201);
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    const product = products.list()[0]!;

    const attached = await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: product.id }),
    });
    expect(attached.status).toBe(200);
    const attachedBody = (await attached.json()) as {
      light: { ledProductId: string | null };
      ledProducts: { id: string }[];
    };
    expect(attachedBody.light.ledProductId).toBe(product.id);
    expect(attachedBody.ledProducts.map((row) => row.id)).toContain(product.id);
    expect(store.findById(id)?.ledProductId).toBe(product.id);

    const inspect = await app.request(`/api/lights/${id}`);
    expect(
      ((await inspect.json()) as { light: { ledProductId: string | null } }).light.ledProductId,
    ).toBe(product.id);

    const provision = await app.request(`/api/lights/${id}/provision`);
    const provisionBody = (await provision.json()) as {
      light: { ledProductId: string | null };
      ledProducts: { id: string }[];
    };
    expect(provisionBody.light.ledProductId).toBe(product.id);
    expect(provisionBody.ledProducts.length).toBeGreaterThanOrEqual(2);
  });

  it("clears ledProductId, refuses unknown ids, and does not write cfg", async () => {
    const writeCfg = vi.fn(async () => true);
    const { app, store, products } = testApp({ writeCfg });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    const product = products.list()[1]!;

    await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: product.id }),
    });

    const missing = await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: "no-such-sku" }),
    });
    expect(missing.status).toBe(404);
    expect(store.findById(id)?.ledProductId).toBe(product.id);

    const cleared = await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: null }),
    });
    expect(cleared.status).toBe(200);
    expect(
      ((await cleared.json()) as { light: { ledProductId: string | null } }).light.ledProductId,
    ).toBeNull();
    expect(store.findById(id)?.ledProductId).toBeNull();
    expect(writeCfg).not.toHaveBeenCalled();
  });

  it("Inspect chrome follows an attached SK6812 product — not snapshot rgbw", async () => {
    const { app, store } = testApp();
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string; rgbw: boolean } }).light.id;
    const created = await app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "porch-sk6812",
        label: "Porch SK6812",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      }),
    });
    expect(created.status).toBe(201);

    const attached = await app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: "porch-sk6812" }),
    });
    const attachedBody = (await attached.json()) as {
      light: { rgbw: boolean; stripBead: string; stripChip: string; bead: string };
    };
    expect(attachedBody.light.rgbw).toBe(false);
    expect(attachedBody.light.stripBead).toBe("rgbw");
    expect(attachedBody.light.stripChip).toBe("SK6812 RGBW");
    expect(store.findById(id)?.stripKind).toBe("ws281x");

    const inspect = await app.request(`/api/lights/${id}`);
    const inspectBody = (await inspect.json()) as {
      light: { stripBead: string; stripChip: string; bead: string };
    };
    expect(inspectBody.light.stripBead).toBe("rgbw");
    expect(inspectBody.light.stripChip).toBe("SK6812 RGBW");
    expect(inspectBody.light.bead).toBe("#ffa000");
  });
});

describe("bead / Inspect RGBW honesty", () => {
  it("does not label snapshot rgbw as WS281x RGBW", async () => {
    const { app, store } = testApp({
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, rgbw: true },
      }),
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const body = (await enroll.json()) as {
      light: { rgbw: boolean; stripKind: string; stripBead: string; stripChip: string };
    };
    expect(body.light.rgbw).toBe(true);
    expect(body.light.stripKind).toBe("ws281x");
    expect(body.light.stripBead).toBe("rgb");
    expect(body.light.stripChip).toBe("WS281x RGB");
    expect(store.load()[0]?.rgbw).toBe(true);
    expect(store.load()[0]?.stripKind).toBe("ws281x");
  });

  it("keeps unreachable RGBW beads unknown — never a last colour", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const enroll = await online.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const { light } = (await enroll.json()) as { light: { id: string } };
    await online.app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "porch-sk6812",
        label: "Porch SK6812",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      }),
    });
    await online.app.request(`/api/lights/${light.id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: "porch-sk6812" }),
    });

    const offline = testApp({
      store: new FileLightsStore(file),
      products: online.products,
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.40 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await offline.app.request(`/api/lights/${light.id}`);
    const body = (await res.json()) as {
      light: {
        bead: string;
        reachability: string;
        stripBead: string;
        stripChip: string;
      };
    };
    expect(body.light.reachability).toBe("no-answer");
    expect(body.light.bead).toBe("unknown");
    expect(body.light.stripBead).toBe("rgbw");
    expect(body.light.stripChip).toBe("SK6812 RGBW");
  });
});

describe("Inspect stripKind seed", () => {
  function type30Cfg() {
    return {
      hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 30, order: 0 }] } },
    };
  }

  it("enroll stays default; Inspect persists a known cfg ledType", async () => {
    const readCfg = vi.fn(async () => type30Cfg());
    const { app, store } = testApp({
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, rgbw: true },
      }),
      readCfg,
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string; stripKind: string } }).light.id;
    expect(store.findById(id)?.stripKind).toBe("ws281x");
    expect(readCfg).not.toHaveBeenCalled();

    const list = await app.request("/api/lights");
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as { lights: { stripKind: string; stripChip: string }[] }).lights[0],
    ).toMatchObject({ stripKind: "ws281x", stripChip: "WS281x RGB" });
    expect(readCfg).not.toHaveBeenCalled();

    const inspect = await app.request(`/api/lights/${id}`);
    const body = (await inspect.json()) as {
      light: { stripKind: string; stripBead: string; stripChip: string; rgbw: boolean };
    };
    expect(body.light.rgbw).toBe(true);
    expect(body.light.stripKind).toBe("sk6812-rgbw");
    expect(body.light.stripBead).toBe("rgbw");
    expect(body.light.stripChip).toBe("SK6812 RGBW");
    expect(store.findById(id)?.stripKind).toBe("sk6812-rgbw");
    expect(readCfg).toHaveBeenCalledTimes(1);

    await app.request(`/api/lights/${id}`);
    expect(readCfg).toHaveBeenCalledTimes(1);
  });

  it("does not invent stripKind from snapshot rgbw when cfg type is unknown", async () => {
    const readCfg = vi.fn(async () => ({
      hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 32, order: 0 }] } },
    }));
    const { app, store } = testApp({
      probe: async () => ({
        kind: "found" as const,
        snapshot: { ...snapshot, rgbw: true },
      }),
      readCfg,
    });
    const enroll = await app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.72" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;

    const inspect = await app.request(`/api/lights/${id}`);
    const body = (await inspect.json()) as {
      light: { rgbw: boolean; stripKind: string; stripChip: string };
    };
    expect(body.light.rgbw).toBe(true);
    expect(body.light.stripKind).toBe("ws281x");
    expect(body.light.stripChip).toBe("WS281x RGB");
    expect(store.findById(id)?.stripKind).toBe("ws281x");
    expect(readCfg).toHaveBeenCalledTimes(1);
  });

  it("does not GET cfg when a product is attached or the Light is unreachable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const readCfg = vi.fn(async () => type30Cfg());
    const online = testApp({
      store: new FileLightsStore(file),
      readCfg,
    });
    const enroll = await online.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    await online.app.request("/api/led-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "porch-sk6812",
        label: "Porch SK6812",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      }),
    });
    await online.app.request(`/api/lights/${id}/led-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ledProductId: "porch-sk6812" }),
    });
    expect(online.store.findById(id)?.stripKind).toBe("ws281x");
    readCfg.mockClear();

    const attached = await online.app.request(`/api/lights/${id}`);
    expect(
      ((await attached.json()) as { light: { stripKind: string; stripChip: string } }).light,
    ).toMatchObject({ stripKind: "ws281x", stripChip: "SK6812 RGBW" });
    expect(readCfg).not.toHaveBeenCalled();

    const offlineRead = vi.fn(async () => type30Cfg());
    const offline = testApp({
      store: new FileLightsStore(file),
      products: online.products,
      readCfg: offlineRead,
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.40 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await offline.app.request(`/api/lights/${id}`);
    const body = (await res.json()) as {
      light: { bead: string; reachability: string; stripKind: string };
    };
    expect(body.light.reachability).toBe("no-answer");
    expect(body.light.bead).toBe("unknown");
    expect(body.light.stripKind).toBe("ws281x");
    expect(offlineRead).not.toHaveBeenCalled();
  });

  it("unreachable Inspect stays grey and does not GET cfg", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
    const file = join(dir, "lights.json");
    const online = testApp({ store: new FileLightsStore(file) });
    const enroll = await online.app.request("/api/lights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "192.168.1.40" }),
    });
    const id = ((await enroll.json()) as { light: { id: string } }).light.id;
    expect(online.store.findById(id)?.ledProductId).toBeNull();

    const readCfg = vi.fn(async () => type30Cfg());
    const offline = testApp({
      store: new FileLightsStore(file),
      readCfg,
      probe: async () => ({
        kind: "probe-failed",
        reason: "192.168.1.40 didn’t return a snapshot in 3 s.",
      }),
    });
    const res = await offline.app.request(`/api/lights/${id}`);
    const body = (await res.json()) as {
      light: { bead: string; reachability: string; stripKind: string; lastSeenAt: string | null };
    };
    expect(body.light.reachability).toBe("no-answer");
    expect(body.light.bead).toBe("unknown");
    expect(body.light.stripKind).toBe("ws281x");
    expect(body.light.lastSeenAt).toBeTruthy();
    expect(readCfg).not.toHaveBeenCalled();
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
