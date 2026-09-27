import { describe, expect, it } from "vitest";
import type { WledSnapshot } from "@nightplot/shared";
import {
  applyRangesWrite,
  restoreBriField,
  restoreColField,
  restoreOnField,
  restoreSegField,
  restoreWriteFromSnapshot,
} from "./live.ts";

const known: WledSnapshot = {
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

describe("applyRangesWrite leftover clears", () => {
  const ranges = [
    { start: 0, stop: 24 },
    { start: 24, stop: 50 },
  ];

  it("refuses leftover clears when previous segment count is unknown — never invents 0", () => {
    const refused = applyRangesWrite(ranges, null, "#ffa000");
    expect(refused).toEqual({ ok: false, reason: "unknown-segment-count" });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unknown count must not author a write");
    expect(refused).not.toHaveProperty("body");
  });

  it("writes no leftover stop:0 clears when previous count is known empty — distinct from unknown", () => {
    const planned = applyRangesWrite(ranges, 0, "#ffa000");
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("known empty must write");
    expect(planned.body.seg).toEqual([
      { id: 0, start: 0, stop: 24, col: [[255, 160, 0]] },
      { id: 1, start: 24, stop: 50, col: [[255, 160, 0]] },
    ]);
    expect(planned.body.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("appends stop:0 leftover clears when previous count is known and higher", () => {
    const planned = applyRangesWrite([{ start: 0, stop: 24 }], 3, "#4f7dff");
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("known count must write");
    expect(planned.body.seg).toEqual([
      { id: 0, start: 0, stop: 24, col: [[79, 125, 255]] },
      { id: 1, start: 0, stop: 0, col: [[79, 125, 255]] },
      { id: 2, start: 0, stop: 0, col: [[79, 125, 255]] },
    ]);
  });
});

describe("restoreOnField", () => {
  it("preserves known on and known off", () => {
    expect(restoreOnField(true)).toEqual({ on: true });
    expect(restoreOnField(false)).toEqual({ on: false });
  });

  it("omits power when unknown — never invents on", () => {
    expect(restoreOnField(null)).toEqual({});
    expect(restoreOnField(undefined)).toEqual({});
    expect(restoreOnField(null)).not.toHaveProperty("on");
  });
});

describe("restoreBriField", () => {
  it("preserves known brightness, including zero", () => {
    expect(restoreBriField(128)).toEqual({ bri: 128 });
    expect(restoreBriField(0)).toEqual({ bri: 0 });
  });

  it("omits brightness when unknown — never invents 128", () => {
    expect(restoreBriField(null)).toEqual({});
    expect(restoreBriField(undefined)).toEqual({});
    expect(restoreBriField(null)).not.toHaveProperty("bri");
  });
});

describe("restoreColField", () => {
  it("preserves a known colour", () => {
    expect(restoreColField("#ffa000")).toEqual({ col: [[255, 160, 0]] });
    expect(restoreColField("#4f7dff")).toEqual({ col: [[79, 125, 255]] });
  });

  it("omits colour when unknown — never invents #ffa000", () => {
    expect(restoreColField(null)).toEqual({});
    expect(restoreColField(undefined)).toEqual({});
    expect(restoreColField("")).toEqual({});
    expect(restoreColField(null)).not.toHaveProperty("col");
  });
});

describe("restoreSegField", () => {
  it("writes known ranges", () => {
    expect(
      restoreSegField([{ start: 0, stop: 60, color: "#ffa000" }], "#ffa000"),
    ).toEqual({ seg: [{ start: 0, stop: 60, col: [[255, 160, 0]] }] });
  });

  it("omits segments when unknown — never invents a whole-strip from colour", () => {
    expect(restoreSegField(null, "#ffa000")).toEqual({});
    expect(restoreSegField(undefined, "#ffa000")).toEqual({});
    expect(restoreSegField(null, "#ffa000")).not.toHaveProperty("seg");
  });

  it("restores a known empty list as empty — no whole-strip invent", () => {
    expect(restoreSegField([], "#ffa000")).toEqual({});
    expect(restoreSegField([], "#ffa000")).not.toHaveProperty("seg");
  });
});

describe("restoreWriteFromSnapshot", () => {
  it("does not invent on, brightness, or colour from an info-only snapshot", () => {
    const write = restoreWriteFromSnapshot({
      ...known,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    });
    expect(write).not.toHaveProperty("on");
    expect(write).not.toHaveProperty("bri");
    expect(write).not.toHaveProperty("seg");
    expect(write.on).toBeUndefined();
    expect(write.bri).toBeUndefined();
  });

  it("omits seg when segments are unknown even if colour is known", () => {
    const write = restoreWriteFromSnapshot({
      ...known,
      segments: null,
    });
    expect(write.on).toBe(true);
    expect(write.bri).toBe(128);
    expect(write).not.toHaveProperty("seg");
    expect(JSON.stringify(write)).not.toContain('"start":0');
    expect(JSON.stringify(write)).not.toContain('"stop":60');
  });

  it("restores known empty segments as empty — no whole-strip invent from colour", () => {
    const write = restoreWriteFromSnapshot({
      ...known,
      segments: [],
    });
    expect(write.on).toBe(true);
    expect(write.bri).toBe(128);
    expect(write).not.toHaveProperty("seg");
  });

  it("writes known off — does not flip off to on", () => {
    expect(restoreWriteFromSnapshot({ ...known, on: false }).on).toBe(false);
  });

  it("writes known on, brightness, and colour", () => {
    const write = restoreWriteFromSnapshot(known);
    expect(write.on).toBe(true);
    expect(write.bri).toBe(128);
    expect(write.seg?.[0]?.col).toEqual([[255, 160, 0]]);
  });

  it("omits colour on known ranges when segmentColor is missing", () => {
    const write = restoreWriteFromSnapshot({
      ...known,
      segmentColor: null,
    });
    expect(write.bri).toBe(128);
    expect(write.seg).toEqual([{ start: 0, stop: 60 }]);
    expect(write.seg?.[0]).not.toHaveProperty("col");
  });
});

describe("applyRangesWrite", () => {
  it("writes a known colour — does not default to #ffa000", () => {
    const planned = applyRangesWrite([{ start: 0, stop: 24 }], 2, "#4f7dff");
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("known count must write");
    expect(planned.body.seg?.[0]).toMatchObject({
      id: 0,
      start: 0,
      stop: 24,
      col: [[79, 125, 255]],
    });
    expect(planned.body.seg?.[1]).toMatchObject({ id: 1, start: 0, stop: 0, col: [[79, 125, 255]] });
    expect(JSON.stringify(planned.body)).not.toContain("255,160,0");
  });

  it("omits col when colour is not a hex — never invents #ffa000", () => {
    const planned = applyRangesWrite([{ start: 0, stop: 24 }], 0, "");
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("known empty must write");
    expect(planned.body.seg?.[0]).toEqual({ id: 0, start: 0, stop: 24 });
    expect(planned.body.seg?.[0]).not.toHaveProperty("col");
    expect(JSON.stringify(planned.body)).not.toContain("255,160,0");
  });
});
