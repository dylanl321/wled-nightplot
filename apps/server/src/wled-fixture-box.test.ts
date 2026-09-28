import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createFixtureBox } from "./wled-fixture-box.ts";

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

async function listen(box: ReturnType<typeof createFixtureBox>): Promise<string> {
  const server = box.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("no port");
  return `http://127.0.0.1:${addr.port}`;
}

describe("fixture info/cfg name divergence", () => {
  it("keeps /json/info stale after a cfg rename when info-name-lag is on", async () => {
    const box = createFixtureBox({ name: "WLED", infoNameLag: true });
    const base = await listen(box);
    const written = await fetch(`${base}/json/cfg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: { name: "Porch rail" } }),
    });
    expect(written.ok).toBe(true);
    const cfg = (await (await fetch(`${base}/json/cfg`)).json()) as { id: { name: string } };
    const info = (await (await fetch(`${base}/json/info`)).json()) as { name: string };
    expect(cfg.id.name).toBe("Porch rail");
    expect(info.name).toBe("WLED");
    expect(box.infoNameLag).toBe(true);
  });

  it("syncs /json/info from cfg when info-name-lag is turned off", async () => {
    const box = createFixtureBox({ name: "WLED", infoNameLag: true });
    const base = await listen(box);
    await fetch(`${base}/json/cfg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: { name: "Porch rail" } }),
    });
    const toggle = await fetch(`${base}/nightplot/info-name-lag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: false }),
    });
    const body = (await toggle.json()) as { infoName: string; cfgName: string; infoNameLag: boolean };
    expect(body.infoNameLag).toBe(false);
    expect(body.cfgName).toBe("Porch rail");
    expect(body.infoName).toBe("Porch rail");
    const info = (await (await fetch(`${base}/json/info`)).json()) as { name: string };
    expect(info.name).toBe("Porch rail");
  });

  it("updates both names when lag is off (default)", async () => {
    const box = createFixtureBox({ name: "WLED" });
    box.applyCfg({ id: { name: "Porch rail" } });
    expect(box.cfg.id.name).toBe("Porch rail");
    expect(box.info.name).toBe("Porch rail");
  });

  it("starts as SK6812 RGBW when nativeType is 30", () => {
    const box = createFixtureBox({ nativeType: 30, ledCount: 80 });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ type: 30, order: 0, len: 80 });
    expect(box.info.leds.rgbw).toBe(true);
  });

  it("starts with a non-GRBW SK6812 order when nativeOrder is set", () => {
    const box = createFixtureBox({ nativeType: 30, nativeOrder: 1, ledCount: 80 });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ type: 30, order: 1, len: 80 });
  });

  it("applies an SK6812 RGBW bus write and sets info rgbw", () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    expect(box.info.leds.rgbw).toBe(false);
    box.applyCfg({
      hw: { led: { ins: [{ start: 0, len: 90, pin: [2], type: 30, order: 0 }] } },
    });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ len: 90, pin: [2], type: 30, order: 0 });
    expect(box.info.leds.rgbw).toBe(true);
    expect(box.info.leds.count).toBe(90);
  });

  it("applies a WS281x bus write to cfg and info count", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    box.applyCfg({
      hw: { led: { ins: [{ start: 0, len: 120, pin: [2], type: 22, order: 0 }] } },
    });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ len: 120, pin: [2], type: 22 });
    expect(box.info.leds.count).toBe(120);
    expect(box.ledCount).toBe(120);
  });

  it("tags sim /json/live as software path, not fixture", async () => {
    const box = createFixtureBox({ kind: "sim", name: "WLED-sim" });
    const base = await listen(box);
    const live = (await (await fetch(`${base}/json/live`)).json()) as { nightplot: string };
    const info = (await (await fetch(`${base}/json/info`)).json()) as { nightplot: string };
    expect(live.nightplot).toBe("sim");
    expect(info.nightplot).toBe("sim");
    expect(box.kind).toBe("sim");
  });

  it("omits state.seg on reread after a state write when unknown-reread is on", async () => {
    const box = createFixtureBox({ kind: "sim" });
    const base = await listen(box);
    await fetch(`${base}/nightplot/unknown-reread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
    const before = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: unknown };
    };
    expect(before.state.seg).toBeDefined();
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seg: [{ start: 0, stop: 24, col: [[255, 160, 0]] }] }),
    });
    const after = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: unknown; on: boolean };
    };
    expect(after.state.on).toBe(true);
    expect(after.state.seg).toBeUndefined();
  });

  it("keeps the underlay and moves one named locate segment on a hop", async () => {
    const box = createFixtureBox({ ledCount: 10, name: "WLED" });
    const base = await listen(box);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 180,
        tt: 0,
        seg: [
          { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
          { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
        ],
      }),
    });
    const afterFirst = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterFirst.leds[4]).toBe("fff4dc");
    expect(afterFirst.leds[0]).toBe("000000");
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tt: 0,
        seg: [{ id: 1, start: 5, stop: 6, col: [[79, 125, 255]] }],
      }),
    });
    const afterHop = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterHop.leds[5]).toBe("4f7dff");
    expect(afterHop.leds[4]).toBe("000000");
    expect(afterHop.leds[0]).toBe("000000");
  });

  it("leaves the bus stale when busMismatch is on", async () => {
    const box = createFixtureBox({ ledCount: 60, busMismatch: true });
    box.applyCfg({
      hw: { led: { ins: [{ start: 0, len: 200, pin: [4], type: 22 }] } },
    });
    expect(box.cfg.hw.led.ins[0]?.len).toBe(60);
    expect(box.info.leds.count).toBe(60);
  });
});
