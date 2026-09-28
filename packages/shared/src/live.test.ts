import { describe, expect, it } from "vitest";
import {
  BLINK_COLOR,
  beadsFromLive,
  blinkRefuseReason,
  countRangeMatches,
  fixtureCaption,
  FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION,
  firstLocateUnknownCaption,
  PREVIEW_HOP_UNREAD_CAPTION,
  parseHexColor,
  previewHopCaption,
  previewLocateCaption,
  parseLiveLeds,
  previewRefuseReason,
  proofLadder,
  resolveLiveTarget,
  restoreSegmentsFromSnapshot,
  shouldRestoreOnEnd,
} from "./live.ts";

describe("preview / blink refuse", () => {
  it("refuses Preview and Blink when the Light is offline", () => {
    expect(
      previewRefuseReason({ reachable: false, hasTarget: true }),
    ).toMatch(/hasn’t answered/);
    expect(blinkRefuseReason({ reachable: false })).toMatch(/hasn’t answered/);
  });

  it("refuses Preview without a target and while Blink is running", () => {
    expect(previewRefuseReason({ reachable: true, hasTarget: false })).toMatch(
      /Pick an Element/,
    );
    expect(
      previewRefuseReason({ reachable: true, hasTarget: true, busyKind: "blink" }),
    ).toMatch(/Blink is already running/);
  });
});

describe("session restore contract", () => {
  it("restores Preview and Blink, never on All Off cancel", () => {
    expect(shouldRestoreOnEnd("complete")).toBe(true);
    expect(shouldRestoreOnEnd("error")).toBe(true);
    expect(shouldRestoreOnEnd("cancel-without-restore")).toBe(false);
  });

  it("keeps unknown segments unknown — not an empty list", () => {
    expect(restoreSegmentsFromSnapshot(null, "#ffa000")).toBeNull();
    expect(restoreSegmentsFromSnapshot(null, null)).toBeNull();
  });

  it("keeps a known empty report empty, and maps known spans", () => {
    expect(restoreSegmentsFromSnapshot([], "#ffa000")).toEqual([]);
    expect(restoreSegmentsFromSnapshot([{ start: 0, stop: 60 }], "#ffa000")).toEqual([
      { start: 0, stop: 60, color: "#ffa000" },
    ]);
    expect(restoreSegmentsFromSnapshot([{ start: 4, stop: 12 }], null)).toEqual([
      { start: 4, stop: 12, color: null },
    ]);
  });
});

describe("live readback", () => {
  it("parses fixture /json/live hex and counts a Preview range", () => {
    const leds = Array.from({ length: 60 }, (_, i) =>
      i >= 24 && i < 50 ? "#4f7dff" : "#ffa000",
    );
    const read = parseLiveLeds({ leds, nightplot: "fixture" }, 60);
    expect(read?.source).toBe("fixture");
    expect(countRangeMatches(read!.leds, 24, 50, "#4f7dff")).toEqual({
      matched: 26,
      total: 26,
    });
    expect(fixtureCaption("fixture")).toMatch(/Not Hardware Done/);
    const sim = parseLiveLeds({ leds, nightplot: "sim" }, 60);
    expect(sim?.source).toBe("sim");
    expect(fixtureCaption("sim")).toMatch(/software path only/i);
    expect(fixtureCaption("sim")).toMatch(/Not Hardware Done/);
    expect(previewHopCaption("fixture")).toMatch(/Software-green from the fixture/);
    expect(previewHopCaption("sim")).toMatch(/software path only/i);
    expect(previewHopCaption("controller")).toBe(PREVIEW_HOP_UNREAD_CAPTION);
    expect(previewHopCaption("controller")).not.toMatch(/controller reported/);
  });

  it("captions first-locate unknown leftover count — not clear-as-success", () => {
    expect(firstLocateUnknownCaption("controller")).toBe(FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION);
    expect(firstLocateUnknownCaption("controller")).toMatch(/Segments unknown/);
    expect(firstLocateUnknownCaption("controller")).toMatch(
      /Leftover controller segments were not cleared/,
    );
    expect(firstLocateUnknownCaption("controller")).toMatch(/Not treating leftover lights as this locate/);
    expect(firstLocateUnknownCaption("controller")).not.toMatch(/controller reported/);
    expect(firstLocateUnknownCaption("controller")).not.toMatch(/Applied/);
    expect(firstLocateUnknownCaption("fixture")).toMatch(/Software-green from the fixture/);
    expect(firstLocateUnknownCaption("fixture")).toMatch(/Leftover controller segments were not cleared/);
    expect(firstLocateUnknownCaption("fixture")).toMatch(/Not Hardware Done/);
    expect(firstLocateUnknownCaption("sim")).toMatch(/software path only/i);
    expect(firstLocateUnknownCaption("sim")).toMatch(/Leftover controller segments were not cleared/);
    expect(
      previewLocateCaption({
        source: "controller",
        live: { source: "controller", leds: ["#fff4dc"] },
        leftoverUnknown: true,
      }),
    ).toBe(FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION);
    expect(
      previewLocateCaption({
        source: "controller",
        live: { source: "controller", leds: ["#fff4dc"] },
        leftoverUnknown: true,
      }),
    ).not.toMatch(/controller reported/);
    expect(
      previewLocateCaption({
        source: "controller",
        live: null,
        leftoverUnknown: false,
      }),
    ).toBe(PREVIEW_HOP_UNREAD_CAPTION);
    expect(
      previewLocateCaption({
        source: "controller",
        live: { source: "controller", leds: ["#fff4dc"] },
        leftoverUnknown: false,
      }),
    ).toBe(fixtureCaption("controller"));
  });

  it("keeps unreachable beads unknown — never a last colour", () => {
    const beads = beadsFromLive(
      Array.from({ length: 10 }, () => BLINK_COLOR),
      10,
      false,
    );
    expect(beads.every((bead) => bead === "unknown")).toBe(true);
  });
});

describe("target + proof ladder", () => {
  it("uses the only Element, or the whole strip", () => {
    expect(resolveLiveTarget([], 60, null)).toEqual({
      elementId: null,
      label: "Whole strip",
      start: 0,
      stop: 60,
    });
    expect(
      resolveLiveTarget([{ id: "a", label: "Door", start: 0, stop: 90 }], 90, null),
    ).toMatchObject({ elementId: "a", label: "Door" });
  });

  it("leaves the last rung for a person", () => {
    const rungs = proofLadder({
      sentAt: "2026-09-26T19:00:00.000Z",
      reported: { matched: 26, total: 26 },
      seenByYou: null,
      label: "Right run",
    });
    expect(rungs[0]?.done).toBe(true);
    expect(rungs[1]?.done).toBe(true);
    expect(rungs[2]?.done).toBe(false);
    expect(rungs[2]?.label).toMatch(/Right run/);
  });
});

describe("hex", () => {
  it("normalizes #RGB hex", () => {
    expect(parseHexColor("4F7DFF")).toBe("#4f7dff");
    expect(parseHexColor("nope")).toBeNull();
  });
});
