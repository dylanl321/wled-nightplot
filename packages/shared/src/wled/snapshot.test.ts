import { describe, expect, it } from "vitest";
import { parseWledPayload, snapshotSegmentCount } from "./snapshot.ts";

const wledJson = {
  info: {
    ver: "0.15.4",
    name: "WLED-7F2A",
    mac: "e89f6d7f2a04",
    brand: "WLED",
    leds: { count: 60, rgbw: false },
  },
  state: {
    on: true,
    bri: 128,
    seg: [{ col: [[255, 160, 0]] }],
  },
};

describe("snapshotSegmentCount", () => {
  it("is null for missing or unknown segments — not zero", () => {
    expect(snapshotSegmentCount(null)).toBeNull();
    expect(snapshotSegmentCount(undefined)).toBeNull();
    expect(snapshotSegmentCount({ segments: null })).toBeNull();
    expect(snapshotSegmentCount({ segments: [] })).toBe(0);
    expect(snapshotSegmentCount({ segments: [{ start: 0, stop: 24 }] })).toBe(1);
  });
});

describe("parseWledPayload", () => {
  it("carries live health from /json/info without filling absent fields", () => {
    const snap = parseWledPayload({ ...wledJson, info: { ...wledJson.info, uptime: 120,
      freeheap: 20480, wifi: { signal: 75, rssi: -60 } } });
    expect(snap?.health).toMatchObject({ uptimeSeconds: 120, freeHeapBytes: 20480,
      wifiSignalPercent: 75, wifiRssiDbm: -60 });
    expect(parseWledPayload(wledJson)?.health?.uptimeSeconds).toBeNull();
  });
  it("retains why native Preview cannot restore a frozen controller or playlist", () => {
    const frozen = parseWledPayload({
      ...wledJson, state: { ...wledJson.state, seg: [{ id: 0, start: 0, stop: 60, frz: true }] },
    });
    expect(frozen?.nativeRestoreUnavailable).toBe("frozen");
    expect(frozen?.nativeRestore).toBeUndefined();
    expect(parseWledPayload({ ...wledJson, state: { ...wledJson.state, pl: 1 } })?.nativeRestoreUnavailable).toBe("playlist");
    expect(parseWledPayload(wledJson)?.nativeRestoreUnavailable).toBeUndefined();
  });

  it("captures sparse native IDs and RGBW colors without mutating the source", () => {
    const seg = {
      id: 3, start: 0, stop: 60, frz: false, on: true, bri: 120,
      grp: 2, spc: 1, of: 3, rev: true, mi: false, fx: 9,
      col: [[30, 40, 50, 60], [1, 2, 3, 4]],
    };
    const state = { on: false, bri: 128, seg: [seg], pl: -1 };
    const native = parseWledPayload({ ...wledJson, state })?.nativeRestore;
    expect(parseWledPayload({ ...wledJson, state })?.segmentColors).toEqual([
      { start: 0, stop: 60, hex: "#1e2832", white: 60, hasWhite: true },
    ]);
    expect(native).toEqual({ on: false, bri: 128, seg: [seg] });
    expect(native?.seg[0]?.col).not.toBe(seg.col);
    for (const unsafe of [
      { ...state, pl: 1 },
      { ...state, seg: [{ ...seg, frz: true }] },
      { ...state, seg: [{ ...seg, frz: undefined }] },
      { ...state, seg: [{ ...seg, grp: undefined }] },
      { ...state, seg: [seg, seg] },
    ]) expect(parseWledPayload({ ...wledJson, state: unsafe })?.nativeRestore).toBeUndefined();
    const frozen = { ...state, seg: [{ ...seg, frz: true }] };
    expect(parseWledPayload({ ...wledJson, state: frozen })?.frozenSegments).toEqual([{ id: 3, start: 0, stop: 60 }]);
    for (const unsafe of [
      { ...frozen, pl: 1 },
      { ...frozen, seg: [{ ...seg, frz: true, grp: undefined }] },
      { ...frozen, seg: [{ ...seg, frz: true, stop: 61 }] },
      { ...frozen, seg: [{ ...seg, frz: true }, { ...seg, frz: true }] },
    ]) expect(parseWledPayload({ ...wledJson, state: unsafe })?.frozenSegments).toBeUndefined();
  });
  it("reads a combined /json snapshot", () => {
    const snap = parseWledPayload(wledJson);
    expect(snap).toMatchObject({
      name: "WLED-7F2A",
      firmware: "WLED 0.15.4",
      mac: "e8:9f:6d:7f:2a:04",
      ledCount: 60,
      on: true,
      segmentColor: "#ffa000",
      segments: [{ start: 0, stop: 60 }],
    });
  });

  it("reads reported segment bounds from state.seg", () => {
    const snap = parseWledPayload({
      ...wledJson,
      state: {
        on: true,
        bri: 128,
        seg: [
          { start: 0, stop: 24, col: [[255, 160, 0]] },
          { start: 24, stop: 55, col: [[255, 160, 0]] },
        ],
      },
    });
    expect(snap?.segments).toEqual([
      { start: 0, stop: 24 },
      { start: 24, stop: 55 },
    ]);
  });

  it("reads identity from /json/info when state is missing", () => {
    const snap = parseWledPayload({ info: wledJson.info });
    expect(snap).toMatchObject({
      name: "WLED-7F2A",
      firmware: "WLED 0.15.4",
      mac: "e8:9f:6d:7f:2a:04",
      ledCount: 60,
      on: null,
      brightness: null,
      segmentColor: null,
      segments: null,
    });
    expect(snapshotSegmentCount(snap)).toBeNull();
    expect(snap?.segmentColors).toBeNull();
  });

  it("treats a known empty seg list as zero — not unknown", () => {
    const snap = parseWledPayload({
      info: wledJson.info,
      state: { on: true, bri: 128, seg: [] },
    });
    expect(snap?.segments).toEqual([]);
    expect(snapshotSegmentCount(snap)).toBe(0);
  });

  it("treats state without a seg array as segments unknown", () => {
    const snap = parseWledPayload({
      info: wledJson.info,
      state: { on: false, bri: 0 },
    });
    expect(snap?.on).toBe(false);
    expect(snap?.segments).toBeNull();
    expect(snapshotSegmentCount(snap)).toBeNull();
  });

  it("rejects HTML or a non-WLED JSON box", () => {
    expect(parseWledPayload({ ok: true, server: "nginx" })).toBeNull();
    expect(parseWledPayload("<html>not wled</html>")).toBeNull();
  });
});
