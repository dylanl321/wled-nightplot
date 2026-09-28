import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createFixtureBox } from "./wled-fixture-box.ts";
import {
  locateHopWrite,
  overlayLocatePicture,
  stabilizeLocateOverlayIds,
} from "./wled/live.ts";

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

  it("keeps a later Element id when a gap-cursor hop posts only the new LED", async () => {
    const box = createFixtureBox({ ledCount: 16, name: "WLED" });
    const base = await listen(box);
    const windowSpan = { start: 0, stop: 4, color: "#d4a574" };
    const doorSpan = { start: 10, stop: 14, color: "#7ee0d0" };
    const gapCursor = { start: 6, stop: 7, color: "#fff4dc" };
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parked),
    });
    const inGap = stabilizeLocateOverlayIds(
      overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16),
      parked,
    );
    const enter = locateHopWrite(inGap, parked);
    expect(enter.seg).toEqual([{ id: 3, start: 6, stop: 7, col: [[255, 244, 220]] }]);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enter),
    });
    const afterEnter = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const liveEnter = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterEnter.state.seg?.find((seg) => seg.start === 10)).toMatchObject({
      id: 2,
      start: 10,
      stop: 14,
    });
    expect(liveEnter.leds[10]).toBe("7ee0d0");
    expect(liveEnter.leds[13]).toBe("7ee0d0");
    expect(liveEnter.leds[6]).toBe("fff4dc");
    expect(liveEnter.leds[0]).toBe("d4a574");
    const leave = locateHopWrite(parked, inGap);
    expect(leave.seg).toEqual([{ id: 3, start: 0, stop: 0 }]);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(leave),
    });
    const afterLeave = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const liveLeave = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterLeave.state.seg?.find((seg) => seg.start === 10)).toMatchObject({
      id: 2,
      start: 10,
      stop: 14,
    });
    expect(afterLeave.state.seg?.some((seg) => seg.id === 3 && (seg.stop ?? 0) > (seg.start ?? 0))).toBe(
      false,
    );
    expect(liveLeave.leds[10]).toBe("7ee0d0");
    expect(liveLeave.leds[6]).toBe("000000");
  });

  it("retains leftover overlay ids when unnamed Preview omits leftover stop:0", async () => {
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
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 180,
        seg: [{ start: 0, stop: 10, col: [[79, 125, 255]] }],
      }),
    });
    const after = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(after.state.seg?.find((seg) => seg.id === 1)).toMatchObject({
      id: 1,
      start: 4,
      stop: 5,
    });
    expect(live.leds[0]).toBe("4f7dff");
    expect(live.leds[4]).toBe("fff4dc");
    expect(live.leds[4]).not.toBe("4f7dff");
  });

  it("retains leftover hold overlay ids after unnamed Preview without leftover stop:0", async () => {
    const box = createFixtureBox({ ledCount: 16, name: "WLED" });
    const base = await listen(box);
    const parked = overlayLocatePicture(
      [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 10, stop: 14, color: "#7ee0d0" },
      ],
      180,
      16,
    );
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parked),
    });
    expect(parked.seg?.map((seg) => seg.id)).toEqual([0, 1, 2]);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 180,
        seg: [{ start: 0, stop: 16, col: [[79, 125, 255]] }],
      }),
    });
    const after = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(after.state.seg?.find((seg) => seg.id === 1)).toMatchObject({
      id: 1,
      start: 0,
      stop: 4,
    });
    expect(after.state.seg?.find((seg) => seg.id === 2)).toMatchObject({
      id: 2,
      start: 10,
      stop: 14,
    });
    expect(live.leds[0]).toBe("d4a574");
    expect(live.leds[10]).toBe("7ee0d0");
    expect(live.leds[4]).toBe("4f7dff");
    expect(live.leds[0]).not.toBe("4f7dff");
  });

  it("does not invent leftover overlay ids on an unnamed Preview with no overlay", async () => {
    const box = createFixtureBox({ ledCount: 10, name: "WLED" });
    const base = await listen(box);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 180,
        seg: [{ start: 0, stop: 10, col: [[79, 125, 255]] }],
      }),
    });
    const after = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(after.state.seg?.some((seg) => seg.id != null && seg.id > 0)).toBe(false);
    expect(live.leds.every((led) => led === "4f7dff")).toBe(true);
  });

  it("clears leftover overlay lit when named-Element Preview includes leftover stop:0", async () => {
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
    const afterOverlay = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterOverlay.leds[4]).toBe("fff4dc");
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 180,
        seg: [
          { start: 0, stop: 10, col: [[79, 125, 255]] },
          { id: 1, start: 0, stop: 0 },
        ],
      }),
    });
    const afterNamed = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterNamed.state.seg?.some((seg) => seg.id === 1)).toBe(false);
    expect(live.leds[4]).toBe("4f7dff");
    expect(live.leds[4]).not.toBe("fff4dc");
    expect(live.leds.every((led) => led === "4f7dff")).toBe(true);
  });

  it("drops the second unnamed range when leftover overlay id:1 stop:0 follows in the same array", async () => {
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
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 40,
        seg: [
          { start: 0, stop: 3, col: [[255, 160, 0]] },
          { start: 3, stop: 7, col: [[255, 160, 0]] },
          { id: 1, start: 0, stop: 0 },
        ],
      }),
    });
    const after = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(after.state.seg?.find((seg) => (seg.id ?? 0) === 0)).toMatchObject({
      start: 0,
      stop: 3,
    });
    expect(after.state.seg?.some((seg) => seg.start === 3 && seg.stop === 7)).toBe(false);
    expect(after.state.seg?.some((seg) => seg.id === 1 && seg.stop > seg.start)).toBe(false);
    expect(live.leds[0]).toBe("ffa000");
    expect(live.leds[2]).toBe("ffa000");
    expect(live.leds[3]).not.toBe("ffa000");
    expect(live.leds[4]).not.toBe("fff4dc");
  });

  it("clears leftover overlay lit when End Preview restore includes leftover stop:0", async () => {
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
    const afterOverlay = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterOverlay.leds[4]).toBe("fff4dc");
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 40,
        seg: [
          { start: 0, stop: 3, col: [[255, 160, 0]] },
          { id: 1, start: 0, stop: 0 },
        ],
      }),
    });
    const afterRestore = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterRestore.state.seg?.some((seg) => seg.id === 1)).toBe(false);
    expect(live.leds[0]).toBe("ffa000");
    expect(live.leds[4]).toBe("000000");
    expect(live.leds[4]).not.toBe("fff4dc");
  });

  it("clears leftover controller segs when first locate includes leftover stop:0", async () => {
    const box = createFixtureBox({ ledCount: 10, name: "WLED" });
    const base = await listen(box);
    await fetch(`${base}/json/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        on: true,
        bri: 140,
        seg: [
          { id: 0, start: 0, stop: 3, col: [[255, 160, 0]] },
          { id: 1, start: 3, stop: 7, col: [[255, 160, 0]] },
          { id: 2, start: 7, stop: 10, col: [[255, 160, 0]] },
        ],
      }),
    });
    const afterApply = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterApply.leds[7]).toBe("ffa000");
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
          { id: 2, start: 0, stop: 0 },
        ],
      }),
    });
    const afterLocate = (await (await fetch(`${base}/json`)).json()) as {
      state: { seg?: { id?: number; start: number; stop: number }[] };
    };
    const live = (await (await fetch(`${base}/json/live`)).json()) as { leds: string[] };
    expect(afterLocate.state.seg?.some((seg) => seg.id === 2 && seg.stop > seg.start)).toBe(
      false,
    );
    expect(live.leds[4]).toBe("fff4dc");
    expect(live.leds[7]).toBe("000000");
    expect(live.leds[9]).toBe("000000");
    expect(live.leds[7]).not.toBe("ffa000");
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
