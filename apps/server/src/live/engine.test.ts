import { describe, expect, it } from "vitest";
import type { Light, WledSnapshot } from "@nightplot/shared";
import { createLiveEngine } from "./engine.ts";
import type { WledStateWrite } from "../wled/live.ts";

const infoOnly: WledSnapshot = {
  name: "WLED",
  firmware: "WLED 0.15.4",
  mac: "e8:9f:6d:7f:2a:04",
  ledCount: 10,
  rgbw: false,
  on: null,
  brightness: null,
  segmentColor: null,
  segments: null,
};

const light: Light = {
  id: "light-1",
  name: "Porch rail",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.72",
  port: 80,
  hostKey: "192.168.1.72:80",
  mac: infoOnly.mac,
  firmware: infoOnly.firmware,
  ledCount: 10,
  rgbw: false,
  reachability: "online",
  lastSeenAt: "2026-09-26T18:00:00.000Z",
  on: null,
  brightness: null,
  enrolledAt: "2026-09-26T18:00:00.000Z",
  ledProductId: null,
};

function engineWithWrites(writes: WledStateWrite[]) {
  return createLiveEngine({
    write: async (_target, body) => {
      writes.push(body);
      return true;
    },
    readLive: async () => ({
      source: "fixture",
      leds: Array.from({ length: 10 }, () => "#4f7dff"),
    }),
    findLight: (id) => (id === light.id ? light : undefined),
  });
}

describe("Preview restore honesty", () => {
  it("does not invent on when the session snapshot is info-only", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      color: "#4f7dff",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.restored).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("on");
    expect(writes[0]).not.toHaveProperty("bri");
    expect(writes[0]).not.toHaveProperty("seg");
  });

  it("restores known off after Preview", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: false, brightness: 40 },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      color: "#4f7dff",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    expect(writes[0]?.on).toBe(false);
    expect(writes[0]?.bri).toBe(40);
    expect(writes[0]).not.toHaveProperty("seg");
  });

  it("identifyHost restore omits on from an info-only snapshot", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const result = await engine.identifyHost(
      { hostname: light.hostname, port: light.port },
      light.ledCount,
      infoOnly,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.restored).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes[0]?.on).toBe(true);
    expect(writes[1]).not.toHaveProperty("on");
    expect(writes[1]).not.toHaveProperty("bri");
    expect(writes[1]).not.toHaveProperty("seg");
  });

  it("does not invent a whole-strip segment from colour when segments are unknown", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40, segmentColor: "#ffa000" },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      color: "#4f7dff",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.restored).toBe(true);
    expect(writes[0]?.on).toBe(true);
    expect(writes[0]?.bri).toBe(40);
    expect(writes[0]).not.toHaveProperty("seg");
    expect(JSON.stringify(writes[0])).not.toContain('"start":0');
    expect(JSON.stringify(writes[0])).not.toContain('"stop":10');
  });

  it("restores known ranges after Preview", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: {
        ...infoOnly,
        on: true,
        brightness: 40,
        segmentColor: "#ffa000",
        segments: [{ start: 0, stop: 10 }],
      },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      color: "#4f7dff",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([{ start: 0, stop: 10, col: [[255, 160, 0]] }]);
  });

  it("identifyHost restore omits seg from unknown segments even when colour is known", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const result = await engine.identifyHost(
      { hostname: light.hostname, port: light.port },
      light.ledCount,
      { ...infoOnly, on: true, brightness: 40, segmentColor: "#ffa000" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.restored).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.on).toBe(true);
    expect(writes[1]?.bri).toBe(40);
    expect(writes[1]).not.toHaveProperty("seg");
  });

  it("does not invent brightness 128 or colour #ffa000 from info-only restore", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      color: "#4f7dff",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.restored).toBe(true);
    expect(writes[0]?.bri).toBeUndefined();
    expect(JSON.stringify(writes[0])).not.toContain("128");
    expect(JSON.stringify(writes[0])).not.toContain("255,160,0");
    expect(JSON.stringify(writes[0])).not.toMatch(/ffa000/i);
  });
});
