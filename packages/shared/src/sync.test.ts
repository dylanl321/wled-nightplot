import { describe, expect, it } from "vitest";
import {
  buildSyncLookWrite,
  parseWledPresets,
  presetsMatch,
  syncLookMatches,
  syncSummary,
  syncWarnings,
} from "./sync.ts";
import type { WledNativeRestore } from "./wled/snapshot.ts";

const segment = (id: number, start: number, stop: number, extra: Record<string, unknown> = {}) => ({
  id, start, stop, frz: false, on: true, bri: 255, grp: 1, spc: 0, of: 0, rev: false, mi: false,
  col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]], fx: 0, sx: 128, ix: 128, pal: 0, ...extra,
});

describe("parseWledPresets", () => {
  it("lists named slots, skips WLED's empty slot 0 and malformed keys", () => {
    const parsed = parseWledPresets(JSON.stringify({
      "0": {}, "2": { n: "Warm", on: true }, "1": { on: true }, "7": { n: "Loop", playlist: { ps: [1, 2] } },
      "300": { n: "Too high" }, "x": { n: "Bad key" }, "3": {},
    }));
    expect(parsed).toEqual({ ok: true, presets: [
      { id: 1, name: "Preset 1", kind: "preset" },
      { id: 2, name: "Warm", kind: "preset" },
      { id: 7, name: "Loop", kind: "playlist" },
    ] });
  });

  it("refuses non-object files", () => {
    expect(parseWledPresets("[]").ok).toBe(false);
    expect(parseWledPresets("{").ok).toBe(false);
  });

  it("compares files independent of whitespace and key order", () => {
    expect(presetsMatch('{"1":{"n":"A","on":true}}', '{ "1": { "on": true, "n": "A" } }')).toBe(true);
    expect(presetsMatch('{"1":{"n":"A"}}', '{"1":{"n":"B"}}')).toBe(false);
    expect(presetsMatch("{", "{}")).toBeNull();
  });
});

describe("buildSyncLookWrite", () => {
  const source: WledNativeRestore = { on: true, bri: 90, seg: [
    segment(0, 0, 30, { fx: 9, pal: 11, col: [[10, 20, 30, 40], [0, 0, 0, 0], [0, 0, 0, 0]] }),
    segment(1, 30, 60, { fx: 2, n: "Source name" }),
  ] };

  it("keeps the target's ids and geometry and copies look fields in order", () => {
    const target: WledNativeRestore = { on: false, bri: 10, seg: [segment(4, 0, 50), segment(5, 50, 80), segment(6, 80, 100)] };
    const sent = buildSyncLookWrite(source, target, false)!;
    expect(sent.on).toBe(true);
    expect(sent.bri).toBe(90);
    expect(sent.seg.map((row) => [row.id, row.fx])).toEqual([[4, 9], [5, 2], [6, 2]]);
    expect(sent.seg[0]).not.toHaveProperty("start");
    expect(sent.seg[1]).not.toHaveProperty("n");
    expect(sent.seg[0]!.col).toEqual([[10, 20, 30], [0, 0, 0], [0, 0, 0]]);
  });

  it("pads white for an RGBW target", () => {
    const target: WledNativeRestore = { on: true, bri: 10, seg: [segment(0, 0, 60)] };
    const rgbSource: WledNativeRestore = { on: true, bri: 50, seg: [segment(0, 0, 60)] };
    expect(buildSyncLookWrite(rgbSource, target, true)!.seg[0]!.col).toEqual([[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  });

  it("matches only when every sent field rereads unchanged", () => {
    const target: WledNativeRestore = { on: true, bri: 10, seg: [segment(0, 0, 60)] };
    const sent = buildSyncLookWrite(source, target, false)!;
    const read: WledNativeRestore = { on: true, bri: 90, seg: [{ ...segment(0, 0, 60), ...sent.seg[0]! }] };
    expect(syncLookMatches(sent, read)).toBe(true);
    expect(syncLookMatches(sent, { ...read, bri: 91 })).toBe(false);
    expect(syncLookMatches(sent, { ...read, seg: [{ ...read.seg[0]!, fx: 0 }] })).toBe(false);
    expect(syncLookMatches(sent, null)).toBeNull();
  });
});

describe("syncWarnings and summary", () => {
  const target = { lightId: "t", lightName: "Shelf", ledCount: 90, firmware: "WLED 0.15.1", segmentCount: 2 };
  it("warns on preset length and firmware differences, and look segment count", () => {
    expect(syncWarnings({ kind: "presets", source: { ledCount: 60, firmware: "WLED 0.15.4", segmentCount: 1 }, target })
      .map((entry) => entry.message)).toEqual([
      expect.stringMatching(/90 LEDs; the source has 60/),
      expect.stringMatching(/runs WLED 0.15.1/),
    ]);
    expect(syncWarnings({ kind: "look", source: { ledCount: 60, firmware: null, segmentCount: 1 }, target })).toHaveLength(1);
    expect(syncWarnings({ kind: "preset", source: { ledCount: 60, firmware: null, segmentCount: 1 }, target })).toEqual([]);
  });

  it("does not round a partial result up", () => {
    expect(syncSummary("presets", [])).toMatch(/Nothing was sent/);
    expect(syncSummary("look", [
      { lightId: "a", lightName: "A", status: "matched", detail: "" },
      { lightId: "b", lightName: "B", status: "unknown", detail: "" },
    ])).toBe("1 of 2 report the copied look. Check the Lights listed below.");
  });
});
