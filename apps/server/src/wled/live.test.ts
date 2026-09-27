import { describe, expect, it } from "vitest";
import type { WledSnapshot } from "@nightplot/shared";
import {
  applyRangesWrite,
  restoreBriField,
  restoreColField,
  restoreOnField,
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
    const write = applyRangesWrite([{ start: 0, stop: 24 }], 2, "#4f7dff");
    expect(write.seg?.[0]).toMatchObject({
      id: 0,
      start: 0,
      stop: 24,
      col: [[79, 125, 255]],
    });
    expect(write.seg?.[1]).toMatchObject({ id: 1, start: 0, stop: 0, col: [[79, 125, 255]] });
    expect(JSON.stringify(write)).not.toContain("255,160,0");
  });

  it("omits col when colour is not a hex — never invents #ffa000", () => {
    const write = applyRangesWrite([{ start: 0, stop: 24 }], 0, "");
    expect(write.seg?.[0]).toEqual({ id: 0, start: 0, stop: 24 });
    expect(write.seg?.[0]).not.toHaveProperty("col");
    expect(JSON.stringify(write)).not.toContain("255,160,0");
  });
});
