import { describe, expect, it } from "vitest";
import { backupNeedsControllerConfirmation, parseSegmentBackup } from "./segment-backup.ts";

const backup = {
  kind: "nightplot-segments", version: 1, exportedAt: "2026-09-28T18:00:00.000Z",
  source: { lightId: "porch", lightName: "Porch", mac: "AA:BB", ledCount: 60 },
  segments: [{ label: "Door", start: 0, stop: 20 }, { label: "Roof", start: 20, stop: 60 }],
};

describe("Segment backups", () => {
  it("accepts a versioned range layout and checks controller identity", () => {
    const parsed = parseSegmentBackup(backup);
    expect(parsed).not.toBeNull();
    expect(backupNeedsControllerConfirmation(parsed!, { id: "other", mac: "aa:bb" })).toBe(false);
    expect(backupNeedsControllerConfirmation(parsed!, { id: "porch", mac: "different" })).toBe(true);
    expect(backupNeedsControllerConfirmation(parsed!, { id: "other", mac: null })).toBe(true);
  });

  it("refuses wrong version, malformed indexes, overlap, and past-strip ranges", () => {
    expect(parseSegmentBackup({ ...backup, version: 2 })).toBeNull();
    expect(parseSegmentBackup({ ...backup, segments: [{ label: "Half", start: 0.5, stop: 20 }] })).toBeNull();
    expect(parseSegmentBackup({ ...backup, segments: [{ label: "Too far", start: 0, stop: 61 }] })).toBeNull();
    expect(parseSegmentBackup({ ...backup, segments: [...backup.segments, { label: "Overlap", start: 10, stop: 30 }] })).toBeNull();
  });
});
