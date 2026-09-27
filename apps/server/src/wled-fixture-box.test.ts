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

  it("applies a WS281x bus write to cfg and info count", async () => {
    const box = createFixtureBox({ ledCount: 60, gpio: 16 });
    box.applyCfg({
      hw: { led: { ins: [{ start: 0, len: 120, pin: [2], type: 22, order: 0 }] } },
    });
    expect(box.cfg.hw.led.ins[0]).toMatchObject({ len: 120, pin: [2], type: 22 });
    expect(box.info.leds.count).toBe(120);
    expect(box.ledCount).toBe(120);
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
