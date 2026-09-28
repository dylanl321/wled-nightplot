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

function engineWithWrites(writes: WledStateWrite[], reads: number[] = []) {
  return createLiveEngine({
    write: async (_target, body) => {
      writes.push(body);
      return true;
    },
    readLive: async () => {
      reads.push(1);
      return {
        source: "fixture" as const,
        leds: Array.from({ length: 10 }, () => "#4f7dff"),
      };
    },
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

  it("writes one segment when Preview names an Element", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40, segmentColor: "#ffa000" },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      elementId: "el-1",
      color: "#4f7dff",
    });
    expect(started.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([{ start: 0, stop: 10, col: [[79, 125, 255]] }]);
  });

  it("keeps each Element lit and blacks the gaps when Preview sends spans", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40, segmentColor: "#ffa000" },
      elements: [],
      spans: [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 4, stop: 5, color: "#fff4dc" },
        { start: 5, stop: 8, color: "#d4a574" },
      ],
    });
    expect(started.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 4, col: [[212, 165, 116]] },
      { id: 2, start: 4, stop: 5, col: [[255, 244, 220]] },
      { id: 3, start: 5, stop: 8, col: [[212, 165, 116]] },
    ]);
    expect(writes[0]?.tt).toBe(0);
  });

  it("blacks the rest of the strip for an ad-hoc Preview range", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40, segmentColor: "#ffa000" },
      elements: [],
      range: { start: 2, stop: 4 },
      color: "#fff4dc",
    });
    expect(started.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 2, stop: 4, col: [[255, 244, 220]] },
    ]);
    expect(writes[0]?.tt).toBe(0);
  });
});

describe("Preview session update", () => {
  it("keeps the first restore when a hop arrives with a different snapshot", async () => {
    const writes: WledStateWrite[] = [];
    const reads: number[] = [];
    const engine = engineWithWrites(writes, reads);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: false, brightness: 40, segmentColor: "#ffa000" },
      elements: [],
      range: { start: 1, stop: 2 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.updated).toBe(false);
    expect(started.wrote).toBe(true);
    expect(started.reread).toBe(true);
    expect(reads).toHaveLength(1);
    const sessionId = started.session?.id;
    writes.length = 0;
    reads.length = 0;

    const hopped = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 255, segmentColor: "#3dff7a", segments: [{ start: 0, stop: 10 }] },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#4f7dff",
      brightness: 200,
    });
    expect(hopped.ok).toBe(true);
    if (!hopped.ok) return;
    expect(hopped.updated).toBe(true);
    expect(hopped.wrote).toBe(true);
    expect(hopped.reread).toBe(false);
    expect(hopped.live).toBeNull();
    expect(hopped.reported).toBeNull();
    expect(hopped.session?.id).toBe(sessionId);
    expect(hopped.session?.restore).toEqual({
      on: false,
      brightness: 40,
      color: "#ffa000",
      segments: null,
    });
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(1);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    if (ended.ok) expect(ended.restored).toBe(true);
    expect(writes[0]?.on).toBe(false);
    expect(writes[0]?.bri).toBe(40);
    expect(writes[0]?.seg).toEqual([{ id: 1, start: 0, stop: 0 }]);
    expect(writes[0]?.seg?.some((seg) => seg.start === 0 && seg.stop === 10)).toBe(false);
  });

  it("skips the controller POST when the hop body matches the last write", async () => {
    const writes: WledStateWrite[] = [];
    const reads: number[] = [];
    const engine = engineWithWrites(writes, reads);
    const first = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 2, stop: 4 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(first.ok).toBe(true);
    expect(writes).toHaveLength(1);
    writes.length = 0;
    reads.length = 0;

    const again = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 2, stop: 4 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.updated).toBe(true);
    expect(again.wrote).toBe(false);
    expect(again.reread).toBe(false);
    expect(writes).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  it("still reads /json/live on a locate hop when reread is true", async () => {
    const writes: WledStateWrite[] = [];
    const reads: number[] = [];
    const engine = engineWithWrites(writes, reads);
    await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 1, stop: 2 },
      color: "#fff4dc",
    });
    reads.length = 0;

    const hopped = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [],
      range: { start: 5, stop: 6 },
      color: "#4f7dff",
      reread: true,
    });
    expect(hopped.ok).toBe(true);
    if (!hopped.ok) return;
    expect(hopped.updated).toBe(true);
    expect(hopped.reread).toBe(true);
    expect(hopped.live).not.toBeNull();
    expect(reads).toHaveLength(1);
  });

  it("posts only the moved cursor segment on a locate hop", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
    ]);
    writes.length = 0;

    const hopped = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [],
      range: { start: 5, stop: 6 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(hopped.ok).toBe(true);
    if (!hopped.ok) return;
    expect(hopped.wrote).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([{ id: 1, start: 5, stop: 6, col: [[255, 244, 220]] }]);
    expect(writes[0]?.tt).toBe(0);
    expect(writes[0]?.seg).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("on");
    expect(writes[0]).not.toHaveProperty("bri");
  });

  it("clears leftover controller segs on first locate when snapshot count is known and higher", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: {
        ...infoOnly,
        on: true,
        brightness: 40,
        segmentColor: "#ffa000",
        segments: [
          { start: 0, stop: 4 },
          { start: 4, stop: 7 },
          { start: 7, stop: 10 },
        ],
      },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
      { id: 2, start: 0, stop: 0 },
    ]);
    writes.length = 0;

    const hopped = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [],
      range: { start: 5, stop: 6 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(hopped.ok).toBe(true);
    if (!hopped.ok) return;
    expect(writes[0]?.seg).toEqual([{ id: 1, start: 5, stop: 6, col: [[255, 244, 220]] }]);
    expect(writes[0]?.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("uses the first restore segment count when locate opens after a named-Element Preview", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    await engine.startPreview({
      light,
      live: {
        ...infoOnly,
        on: true,
        brightness: 40,
        segmentColor: "#ffa000",
        segments: [
          { start: 0, stop: 4 },
          { start: 4, stop: 7 },
          { start: 7, stop: 10 },
        ],
      },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      elementId: "el-1",
      color: "#4f7dff",
    });
    expect(writes[0]?.seg).toEqual([{ start: 0, stop: 10, col: [[79, 125, 255]] }]);
    writes.length = 0;

    const locate = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 255, segments: [{ start: 0, stop: 10 }] },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(locate.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
      { id: 2, start: 0, stop: 0 },
    ]);
  });

  it("does not invent first-locate leftover ids when snapshot segments are unknown", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    const started = await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(started.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
    ]);
    expect(writes[0]?.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("clears leftover overlay ids when End Preview restores after locate", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    await engine.startPreview({
      light,
      live: {
        ...infoOnly,
        on: true,
        brightness: 40,
        segmentColor: "#ffa000",
        segments: [{ start: 0, stop: 10 }],
      },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
    ]);
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.restored).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([
      { start: 0, stop: 10, col: [[255, 160, 0]] },
      { id: 1, start: 0, stop: 0 },
    ]);
    expect(writes[0]?.seg?.[0]).not.toHaveProperty("id");
    expect(writes[0]?.on).toBe(true);
    expect(writes[0]?.bri).toBe(40);
  });

  it("does not invent leftover ids on End Preview when last write was not overlay", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    await engine.startPreview({
      light,
      live: {
        ...infoOnly,
        on: true,
        brightness: 40,
        segmentColor: "#ffa000",
        segments: [{ start: 0, stop: 10 }],
      },
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      elementId: "el-1",
      color: "#4f7dff",
    });
    writes.length = 0;

    const ended = await engine.end(light.id, "complete");
    expect(ended.ok).toBe(true);
    expect(writes[0]?.seg).toEqual([{ start: 0, stop: 10, col: [[255, 160, 0]] }]);
    expect(writes[0]?.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("clears leftover overlay ids when Preview names an Element after locate", async () => {
    const writes: WledStateWrite[] = [];
    const engine = engineWithWrites(writes);
    await engine.startPreview({
      light,
      live: { ...infoOnly, on: true, brightness: 40 },
      elements: [],
      range: { start: 4, stop: 5 },
      color: "#fff4dc",
      brightness: 180,
    });
    expect(writes[0]?.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
    ]);
    writes.length = 0;

    const named = await engine.startPreview({
      light,
      live: infoOnly,
      elements: [{ id: "el-1", lightId: light.id, label: "Porch", start: 0, stop: 10 }],
      elementId: "el-1",
      color: "#4f7dff",
      brightness: 180,
    });
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.updated).toBe(true);
    expect(named.wrote).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([
      { start: 0, stop: 10, col: [[79, 125, 255]] },
      { id: 1, start: 0, stop: 0 },
    ]);
    expect(writes[0]?.seg?.[0]).not.toHaveProperty("id");
    expect(writes[0]?.seg?.some((seg) => seg.id === 0 && seg.stop === 0)).toBe(false);
  });

  it("does not rewrite a later Element when a gap cursor is inserted or removed", async () => {
    const holdLight: Light = { ...light, ledCount: 16 };
    const writes: WledStateWrite[] = [];
    const engine = createLiveEngine({
      write: async (_target, body) => {
        writes.push(body);
        return true;
      },
      readLive: async () => ({
        source: "fixture" as const,
        leds: Array.from({ length: 16 }, () => "#4f7dff"),
      }),
      findLight: (id) => (id === holdLight.id ? holdLight : undefined),
    });
    const windowSpan = { start: 0, stop: 4, color: "#d4a574" };
    const doorSpan = { start: 10, stop: 14, color: "#7ee0d0" };
    const gapCursor = { start: 6, stop: 7, color: "#fff4dc" };
    const live: WledSnapshot = { ...infoOnly, ledCount: 16, on: true, brightness: 40 };

    const parked = await engine.startPreview({
      light: holdLight,
      live,
      elements: [],
      spans: [windowSpan, doorSpan],
      brightness: 180,
    });
    expect(parked.ok).toBe(true);
    expect(writes[0]?.seg?.find((seg) => seg.start === 10)).toMatchObject({
      id: 2,
      start: 10,
      stop: 14,
    });
    writes.length = 0;

    const enter = await engine.startPreview({
      light: holdLight,
      live,
      elements: [],
      spans: [windowSpan, doorSpan, gapCursor],
      brightness: 180,
    });
    expect(enter.ok).toBe(true);
    if (!enter.ok) return;
    expect(enter.updated).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([{ id: 3, start: 6, stop: 7, col: [[255, 244, 220]] }]);
    expect(writes[0]?.seg?.some((seg) => seg.start === 10)).toBe(false);
    writes.length = 0;

    const leave = await engine.startPreview({
      light: holdLight,
      live,
      elements: [],
      spans: [windowSpan, doorSpan],
      brightness: 180,
    });
    expect(leave.ok).toBe(true);
    if (!leave.ok) return;
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([{ id: 3, start: 0, stop: 0 }]);
    expect(writes[0]?.seg?.some((seg) => seg.start === 10)).toBe(false);
    writes.length = 0;

    const reenter = await engine.startPreview({
      light: holdLight,
      live,
      elements: [],
      spans: [windowSpan, doorSpan, gapCursor],
      brightness: 180,
    });
    expect(reenter.ok).toBe(true);
    if (!reenter.ok) return;
    expect(writes).toHaveLength(1);
    expect(writes[0]?.seg).toEqual([{ id: 3, start: 6, stop: 7, col: [[255, 244, 220]] }]);
    expect(writes[0]?.seg?.some((seg) => seg.start === 10)).toBe(false);
  });
});
