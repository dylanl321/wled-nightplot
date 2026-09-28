import { describe, expect, it } from "vitest";
import type { WledSnapshot } from "@nightplot/shared";
import {
  applyRangesWrite,
  firstLocateWrite,
  isLocateOverlayWrite,
  locateHopWrite,
  locateLitPieces,
  overlayLocatePicture,
  previewWrite,
  previewWriteLeavingOverlay,
  previewWriteSpans,
  stabilizeLocateOverlayIds,
  restoreBriField,
  restoreColField,
  restoreOnField,
  restoreSegField,
  restoreWrite,
  restoreWriteFromSnapshot,
  restoreWriteLeavingOverlay,
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

describe("locate write shape (CONFIG-126)", () => {
  const lit = "#fff4dc";
  const peach = "#d4a574";

  it("uses a whole-strip underlay plus one lit piece — not black|lit|black tiles", () => {
    const write = previewWrite(4, 5, lit, 180, 10);
    expect(write.tt).toBe(0);
    expect(write.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
    ]);
    expect(write.seg).toHaveLength(2);
  });

  it("named-Segment / Blink Preview stays one segment — no locate overlay", () => {
    const write = previewWrite(0, 10, "#4f7dff", 180);
    expect(write.tt).toBeUndefined();
    expect(write.seg).toEqual([{ start: 0, stop: 10, col: [[79, 125, 255]] }]);
    expect(write.seg?.[0]).not.toHaveProperty("id");
  });

  it("merges adjacent same-colour spans and does not emit black-gap tiles", () => {
    const write = previewWriteSpans(
      [
        { start: 0, stop: 4, color: peach },
        { start: 4, stop: 8, color: peach },
        { start: 10, stop: 11, color: lit },
      ],
      180,
      16,
    );
    expect(locateLitPieces(
      [
        { start: 0, stop: 4, color: peach },
        { start: 4, stop: 8, color: peach },
        { start: 10, stop: 11, color: lit },
      ],
      16,
    )).toEqual([
      { start: 0, stop: 8, color: peach },
      { start: 10, stop: 11, color: lit },
    ]);
    expect(write.seg).toEqual([
      { id: 0, start: 0, stop: 16, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 8, col: [[212, 165, 116]] },
      { id: 2, start: 10, stop: 11, col: [[255, 244, 220]] },
    ]);
    expect(write.seg?.some((seg) => seg.col?.[0]?.every((n) => n === 0) && seg.id !== 0)).toBe(
      false,
    );
  });

  it("keeps an earlier span when a later span claims the same LEDs", () => {
    const write = overlayLocatePicture(
      [
        { start: 0, stop: 6, color: peach },
        { start: 4, stop: 5, color: lit },
      ],
      180,
      10,
    );
    expect(write.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 6, col: [[212, 165, 116]] },
    ]);
  });

  it("posts only the gap cursor when hold Segments did not move", () => {
    const first = previewWriteSpans(
      [
        { start: 0, stop: 4, color: peach },
        { start: 10, stop: 11, color: lit },
      ],
      180,
      16,
    );
    const next = previewWriteSpans(
      [
        { start: 0, stop: 4, color: peach },
        { start: 11, stop: 12, color: lit },
      ],
      180,
      16,
    );
    expect(first.seg).toEqual([
      { id: 0, start: 0, stop: 16, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 4, col: [[212, 165, 116]] },
      { id: 2, start: 10, stop: 11, col: [[255, 244, 220]] },
    ]);
    expect(locateHopWrite(next, first).seg).toEqual([
      { id: 2, start: 11, stop: 12, col: [[255, 244, 220]] },
    ]);
  });

  it("posts only the moved cursor segment when the underlay did not change", () => {
    const first = previewWrite(4, 5, lit, 180, 10);
    const next = previewWrite(5, 6, lit, 180, 10);
    const hop = locateHopWrite(next, first);
    expect(hop.seg).toEqual([{ id: 1, start: 5, stop: 6, col: [[255, 244, 220]] }]);
    expect(hop.seg).toHaveLength(1);
    expect(hop.tt).toBe(0);
    expect(hop).not.toHaveProperty("on");
    expect(hop).not.toHaveProperty("bri");
    expect(hop.seg?.some((seg) => seg.id === 0)).toBe(false);
  });

  it("does not invent segment ids beyond the overlay picture", () => {
    const write = previewWriteSpans(
      [
        { start: 0, stop: 4, color: peach },
        { start: 4, stop: 5, color: lit },
        { start: 5, stop: 8, color: peach },
      ],
      180,
      10,
    );
    expect(write.seg?.map((seg) => seg.id)).toEqual([0, 1, 2, 3]);
    expect(write.seg?.[0]).toMatchObject({ start: 0, stop: 10, col: [[0, 0, 0]] });
    expect(Math.max(...(write.seg ?? []).map((seg) => seg.id ?? -1))).toBe(3);
  });

  it("clears a leftover overlay id with stop:0 when the picture shrinks", () => {
    const first = overlayLocatePicture(
      [
        { start: 0, stop: 4, color: peach },
        { start: 4, stop: 5, color: lit },
        { start: 5, stop: 8, color: peach },
      ],
      180,
      10,
    );
    const next = overlayLocatePicture([{ start: 6, stop: 7, color: lit }], 180, 10);
    const hop = locateHopWrite(next, first);
    expect(hop.seg).toEqual([
      { id: 1, start: 6, stop: 7, col: [[255, 244, 220]] },
      { id: 2, start: 0, stop: 0 },
      { id: 3, start: 0, stop: 0 },
    ]);
    expect(hop.seg?.some((seg) => seg.id === 0)).toBe(false);
  });

  it("rewrites the full picture when the underlay itself changes", () => {
    const first = overlayLocatePicture([{ start: 0, stop: 10, color: peach }], 180, 10);
    const next = previewWrite(4, 5, lit, 180, 10);
    expect(first.seg).toEqual([{ id: 0, start: 0, stop: 10, col: [[212, 165, 116]] }]);
    expect(locateHopWrite(next, first)).toEqual(next);
  });
});

describe("locate overlay gap-cursor ids (CONFIG-138)", () => {
  const peach = "#d4a574";
  const teal = "#7ee0d0";
  const lit = "#fff4dc";
  const windowSpan = { start: 0, stop: 4, color: peach };
  const doorSpan = { start: 10, stop: 14, color: teal };
  const gapCursor = { start: 6, stop: 7, color: lit };

  it("assigns sequential 0…n on a first picture — Door is id 2", () => {
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    expect(parked.seg).toEqual([
      { id: 0, start: 0, stop: 16, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 4, col: [[212, 165, 116]] },
      { id: 2, start: 10, stop: 14, col: [[126, 224, 208]] },
    ]);
  });

  it("sorts a gap cursor into the lit-piece table so a sequential picture remaps Door", () => {
    const sequential = overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16);
    expect(locateLitPieces([windowSpan, doorSpan, gapCursor], 16)).toEqual([
      { start: 0, stop: 4, color: peach },
      { start: 6, stop: 7, color: lit },
      { start: 10, stop: 14, color: teal },
    ]);
    expect(sequential.seg?.find((seg) => seg.start === 10)?.id).toBe(3);
    expect(sequential.seg?.map((seg) => seg.id)).toEqual([0, 1, 2, 3]);
  });

  it("reuses Door’s overlay id when start/stop/col match — hop packing, not Segment identity", () => {
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    const sequential = overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16);
    const stable = stabilizeLocateOverlayIds(sequential, parked);
    expect(stable.seg).toEqual([
      { id: 0, start: 0, stop: 16, col: [[0, 0, 0]] },
      { id: 1, start: 0, stop: 4, col: [[212, 165, 116]] },
      { id: 3, start: 6, stop: 7, col: [[255, 244, 220]] },
      { id: 2, start: 10, stop: 14, col: [[126, 224, 208]] },
    ]);
    expect(stable.seg?.find((seg) => seg.start === 10)?.id).toBe(2);
  });

  it("posts only the gap cursor when Door’s range and colour did not change", () => {
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    const inGap = overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16);
    const hop = locateHopWrite(inGap, parked);
    expect(hop.seg).toEqual([{ id: 3, start: 6, stop: 7, col: [[255, 244, 220]] }]);
    expect(hop.seg?.some((seg) => seg.start === 10 || seg.start === 0)).toBe(false);
    expect(hop.tt).toBe(0);
  });

  it("clears only the gap cursor when leaving — Door stays unmentioned", () => {
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    const inGap = stabilizeLocateOverlayIds(
      overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16),
      parked,
    );
    const leave = locateHopWrite(parked, inGap);
    expect(leave.seg).toEqual([{ id: 3, start: 0, stop: 0 }]);
    expect(leave.seg?.some((seg) => seg.start === 10)).toBe(false);
  });

  it("moves only the cursor id when the gap LED hops and Door still matches", () => {
    const parked = overlayLocatePicture([windowSpan, doorSpan], 180, 16);
    const firstGap = stabilizeLocateOverlayIds(
      overlayLocatePicture([windowSpan, doorSpan, gapCursor], 180, 16),
      parked,
    );
    const nextGap = overlayLocatePicture(
      [windowSpan, doorSpan, { start: 7, stop: 8, color: lit }],
      180,
      16,
    );
    const hop = locateHopWrite(nextGap, firstGap);
    expect(hop.seg).toEqual([{ id: 3, start: 7, stop: 8, col: [[255, 244, 220]] }]);
    expect(hop.seg?.some((seg) => seg.start === 10)).toBe(false);
  });
});

describe("first locate leftover controller segs (CONFIG-137)", () => {
  const lit = "#fff4dc";

  it("appends stop:0 leftover clears when snapshot count is known and higher", () => {
    const picture = overlayLocatePicture([{ start: 4, stop: 5, color: lit }], 180, 10);
    expect(picture.seg?.map((seg) => seg.id)).toEqual([0, 1]);
    const write = firstLocateWrite(picture, 3);
    expect(write.ok).toBe(true);
    if (!write.ok) throw new Error("known count must write leftover clears");
    expect(write.body.seg).toEqual([
      { id: 0, start: 0, stop: 10, col: [[0, 0, 0]] },
      { id: 1, start: 4, stop: 5, col: [[255, 244, 220]] },
      { id: 2, start: 0, stop: 0 },
    ]);
  });

  it("refuses leftover clears when previous segment count is unknown — soft picture only", () => {
    const picture = previewWrite(4, 5, lit, 180, 10);
    const refused = firstLocateWrite(picture, null);
    expect(refused).toEqual({ ok: false, reason: "unknown-segment-count", body: picture });
    expect(refused.body).toEqual(picture);
    expect(refused.body.seg?.some((seg) => seg.stop === 0)).toBe(false);
    expect(picture.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("writes no leftover stop:0 when previous count is known empty — distinct from unknown", () => {
    const picture = overlayLocatePicture([{ start: 4, stop: 5, color: lit }], 180, 10);
    const planned = firstLocateWrite(picture, 0);
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("known empty must write");
    expect(planned.body).toEqual(picture);
    expect(planned.body.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("writes no leftover stop:0 when overlay already covers the known count", () => {
    const picture = overlayLocatePicture([{ start: 4, stop: 5, color: lit }], 180, 10);
    expect(picture.seg).toHaveLength(2);
    const planned = firstLocateWrite(picture, 2);
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error("covered count must write");
    expect(planned.body).toEqual(picture);
  });

  it("clears several leftover ids from a known higher Apply count", () => {
    const picture = previewWriteSpans([{ start: 4, stop: 5, color: lit }], 180, 10);
    const write = firstLocateWrite(picture, 5);
    expect(write.ok).toBe(true);
    if (!write.ok) throw new Error("known higher count must write leftover clears");
    expect(write.body.seg?.filter((seg) => seg.stop === 0).map((seg) => seg.id)).toEqual([2, 3, 4]);
  });

  it("does not treat a named-Segment write as a locate overlay picture", () => {
    const named = previewWrite(0, 10, "#4f7dff", 180);
    expect(isLocateOverlayWrite(named)).toBe(false);
    expect(isLocateOverlayWrite(previewWrite(4, 5, lit, 180, 10))).toBe(true);
    expect(isLocateOverlayWrite(undefined)).toBe(false);
  });
});

describe("leaving locate overlay (CONFIG-136)", () => {
  const lit = "#fff4dc";

  it("previewWrite without ledCount stays one un-id’d segment — no leftover invent", () => {
    const write = previewWrite(24, 50, "#4f7dff", 180);
    expect(write.seg).toEqual([{ start: 24, stop: 50, col: [[79, 125, 255]] }]);
    expect(write.seg?.[0]).not.toHaveProperty("id");
    expect(write.seg?.some((seg) => seg.stop === 0)).toBe(false);
  });

  it("clears leftover overlay ids we authored when Preview names a Segment", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    const named = previewWrite(0, 10, "#4f7dff", 180);
    const write = previewWriteLeavingOverlay(named, overlay);
    expect(overlay.seg?.map((seg) => seg.id)).toEqual([0, 1]);
    expect(write.seg).toEqual([
      { start: 0, stop: 10, col: [[79, 125, 255]] },
      { id: 1, start: 0, stop: 0 },
    ]);
    expect(write.seg?.[0]).not.toHaveProperty("id");
    expect(write.seg?.map((seg) => seg.id).filter((id) => id != null)).toEqual([1]);
  });

  it("clears leftover hold overlay ids, not the un-id’d Preview slot", () => {
    const overlay = previewWriteSpans(
      [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 10, stop: 11, color: lit },
      ],
      180,
      16,
    );
    const named = previewWrite(0, 16, "#4f7dff", 180);
    const write = previewWriteLeavingOverlay(named, overlay);
    expect(overlay.seg?.map((seg) => seg.id)).toEqual([0, 1, 2]);
    expect(write.seg).toEqual([
      { start: 0, stop: 16, col: [[79, 125, 255]] },
      { id: 1, start: 0, stop: 0 },
      { id: 2, start: 0, stop: 0 },
    ]);
  });

  it("does not invent leftover ids when there is no previous overlay", () => {
    const named = previewWrite(0, 10, "#4f7dff", 180);
    expect(previewWriteLeavingOverlay(named, undefined)).toEqual(named);
    expect(previewWriteLeavingOverlay(named, named)).toEqual(named);
  });

  it("does not invent a first-locate leftover count from an overlay picture", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    expect(previewWriteLeavingOverlay(overlay, undefined)).toEqual(overlay);
    expect(overlay.seg?.some((seg) => seg.stop === 0)).toBe(false);
    expect(Math.max(...(overlay.seg ?? []).map((seg) => seg.id ?? -1))).toBe(1);
  });
});

describe("End Preview restore after locate overlay (CONFIG-140)", () => {
  const lit = "#fff4dc";

  it("clears leftover overlay ids we authored when restore names un-id’d ranges", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    const restore = restoreWrite({
      on: true,
      brightness: 40,
      color: "#ffa000",
      segments: [{ start: 0, stop: 10, color: "#ffa000" }],
    });
    const write = restoreWriteLeavingOverlay(
      {
        on: true,
        brightness: 40,
        color: "#ffa000",
        segments: [{ start: 0, stop: 10, color: "#ffa000" }],
      },
      overlay,
    );
    expect(overlay.seg?.map((seg) => seg.id)).toEqual([0, 1]);
    expect(restore.seg).toEqual([{ start: 0, stop: 10, col: [[255, 160, 0]] }]);
    expect(write.seg).toEqual([
      { id: 1, start: 0, stop: 0 },
      { id: 0, start: 0, stop: 10, col: [[255, 160, 0]] },
    ]);
    expect(write.on).toBe(true);
    expect(write.bri).toBe(40);
  });

  it("names two restore ranges and leftover-first so leftover id:1 cannot drop the second", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    const write = restoreWriteLeavingOverlay(
      {
        on: true,
        brightness: 40,
        color: "#ffa000",
        segments: [
          { start: 0, stop: 3, color: "#ffa000" },
          { start: 3, stop: 7, color: "#ffa000" },
        ],
      },
      overlay,
    );
    expect(write.seg).toEqual([
      { id: 1, start: 0, stop: 0 },
      { id: 0, start: 0, stop: 3, col: [[255, 160, 0]] },
      { id: 1, start: 3, stop: 7, col: [[255, 160, 0]] },
    ]);
    expect(write.seg?.[0]).toMatchObject({ id: 1, stop: 0 });
    expect(write.seg?.[1]).toMatchObject({ id: 0, start: 0, stop: 3 });
    expect(write.seg?.[2]).toMatchObject({ id: 1, start: 3, stop: 7 });
  });

  it("clears leftover hold overlay ids on restore, not the un-id’d restore slot", () => {
    const overlay = previewWriteSpans(
      [
        { start: 0, stop: 4, color: "#d4a574" },
        { start: 10, stop: 11, color: lit },
      ],
      180,
      16,
    );
    const write = restoreWriteLeavingOverlay(
      {
        on: true,
        brightness: 40,
        color: "#ffa000",
        segments: [{ start: 0, stop: 16, color: "#ffa000" }],
      },
      overlay,
    );
    expect(overlay.seg?.map((seg) => seg.id)).toEqual([0, 1, 2]);
    expect(write.seg).toEqual([
      { id: 1, start: 0, stop: 0 },
      { id: 2, start: 0, stop: 0 },
      { id: 0, start: 0, stop: 16, col: [[255, 160, 0]] },
    ]);
  });

  it("clears leftover overlay ids when restore omits ranges — no whole-strip invent", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    const write = restoreWriteLeavingOverlay(
      { on: true, brightness: 40, color: "#ffa000", segments: null },
      overlay,
    );
    expect(write.on).toBe(true);
    expect(write.bri).toBe(40);
    expect(write.seg).toEqual([{ id: 1, start: 0, stop: 0 }]);
    expect(JSON.stringify(write)).not.toContain('"start":0,"stop":10');
    expect(write.seg?.some((seg) => seg.start === 0 && seg.stop === 10)).toBe(false);
  });

  it("does not invent leftover ids when there is no previous overlay", () => {
    const restore = {
      on: true,
      brightness: 40,
      color: "#ffa000",
      segments: [{ start: 0, stop: 10, color: "#ffa000" }],
    };
    const named = previewWrite(0, 10, "#4f7dff", 180);
    expect(restoreWriteLeavingOverlay(restore, undefined)).toEqual(restoreWrite(restore));
    expect(restoreWriteLeavingOverlay(restore, named)).toEqual(restoreWrite(restore));
    expect(restoreWriteLeavingOverlay(restore, named).seg?.some((seg) => seg.stop === 0)).toBe(
      false,
    );
  });

  it("does not invent leftover ids from an unknown previous picture", () => {
    const restore = {
      on: true,
      brightness: 40,
      color: "#ffa000",
      segments: [{ start: 0, stop: 10, color: "#ffa000" }],
    };
    expect(restoreWriteLeavingOverlay(restore, { on: true, bri: 180 })).toEqual(
      restoreWrite(restore),
    );
  });

  it("does not invent a first-locate leftover count from overlay size", () => {
    const overlay = previewWrite(4, 5, lit, 180, 10);
    const write = restoreWriteLeavingOverlay(
      { on: true, brightness: 40, color: "#ffa000", segments: null },
      overlay,
    );
    expect(write.seg?.map((seg) => seg.id)).toEqual([1]);
    expect(write.seg?.some((seg) => seg.id === 2)).toBe(false);
    expect(Math.max(...(overlay.seg ?? []).map((seg) => seg.id ?? -1))).toBe(1);
  });
});
