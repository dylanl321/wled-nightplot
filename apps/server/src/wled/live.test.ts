import { describe, expect, it } from "vitest";
import type { WledSnapshot } from "@nightplot/shared";
import { restoreOnField, restoreWriteFromSnapshot } from "./live.ts";

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

describe("restoreWriteFromSnapshot", () => {
  it("does not invent on from an info-only snapshot", () => {
    const write = restoreWriteFromSnapshot({
      ...known,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    });
    expect(write).not.toHaveProperty("on");
    expect(write.on).toBeUndefined();
  });

  it("writes known off — does not flip off to on", () => {
    expect(restoreWriteFromSnapshot({ ...known, on: false }).on).toBe(false);
  });

  it("writes known on", () => {
    expect(restoreWriteFromSnapshot(known).on).toBe(true);
  });
});
