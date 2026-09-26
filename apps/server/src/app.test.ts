import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "./app.ts";
import { FileLightsStore } from "./store/lights-store.ts";
import { probeWled, type ProbeFn } from "./wled/client.ts";

const snapshot = {
  name: "WLED",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 60,
  rgbw: false,
  on: true,
  brightness: 128,
  segmentColor: "#ffa000",
};

function testApp(overrides: Partial<AppDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nightplot-"));
  const store = overrides.store ?? new FileLightsStore(join(dir, "lights.json"));
  const probe: ProbeFn =
    overrides.probe ??
    (async () => ({ kind: "found", snapshot }));
  const app = createApp({
    store,
    probe,
    collect: overrides.collect ?? (async () => []),
    now: overrides.now ?? (() => new Date("2026-09-26T18:00:00.000Z")),
  });
  return { app, store, dir };
}

describe("configure server", () => {
  it("reports health for R1", async () => {
    const { app } = testApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      slice: "R1",
    });
  });

  it("keeps Preview / Apply / All Off unwired", async () => {
    const { app } = testApp();
    for (const path of ["/api/preview", "/api/apply", "/api/all-off"]) {
      const res = await app.request(path, { method: "POST" });
      expect(res.status).toBe(501);
    }
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
