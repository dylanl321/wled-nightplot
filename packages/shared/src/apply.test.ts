import { describe, expect, it } from "vitest";
import {
  APPLY_ADOPT_EMPTY_REASON,
  APPLY_ADOPT_UNKNOWN_REASON,
  APPLY_UNKNOWN_COLOUR_REASON,
  APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE,
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  APPLY_EMPTY_READ_CAPTION,
  APPLY_UNREAD_CAPTION,
  adoptControllerRangesReason,
  adoptableControllerRanges,
  applyCaption,
  applyOutcome,
  applyRefuseReason,
  applyUnknownSegments,
  applyUnreadFailed,
  knownApplyColor,
  macsMatch,
  readdressContinuity,
  spansMatch,
} from "./apply.ts";

describe("apply refuse", () => {
  it("refuses Apply when offline, invalid, empty, or Preview is live", () => {
    expect(
      applyRefuseReason({ reachable: false, elementCount: 2, segmentCount: 1 }),
    ).toMatch(/hasn’t answered/);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        issueMessage: "Overlaps Right run on LEDs 20–24.",
        segmentCount: 1,
      }),
    ).toMatch(/Overlaps/);
    expect(
      applyRefuseReason({ reachable: true, elementCount: 0, segmentCount: 1 }),
    ).toMatch(/at least one Element/);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        busyKind: "preview",
        segmentCount: 1,
      }),
    ).toMatch(/Preview is not Apply/);
  });

  it("refuses leftover-segment clears when segment count is unknown — not zero", () => {
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        segmentCount: null,
        segmentColor: "#4f7dff",
      }),
    ).toBe(APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE);
    expect(
      applyRefuseReason({ reachable: false, elementCount: 2, segmentCount: null }),
    ).toMatch(/hasn’t answered/);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        segmentCount: 0,
        segmentColor: "#4f7dff",
      }),
    ).toBeNull();
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        segmentCount: 3,
        segmentColor: "#4f7dff",
      }),
    ).toBeNull();
  });

  it("refuses Apply when colour is unknown — never invents #ffa000", () => {
    expect(knownApplyColor(null)).toBeNull();
    expect(knownApplyColor(undefined)).toBeNull();
    expect(knownApplyColor("")).toBeNull();
    expect(knownApplyColor("unknown")).toBeNull();
    expect(knownApplyColor("#ffa000")).toBe("#ffa000");
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        segmentCount: 1,
        segmentColor: null,
      }),
    ).toBe(APPLY_UNKNOWN_COLOUR_REASON);
    expect(
      applyRefuseReason({ reachable: true, elementCount: 2, segmentCount: 1 }),
    ).toBe(APPLY_UNKNOWN_COLOUR_REASON);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        segmentCount: 1,
        segmentColor: "#4f7dff",
      }),
    ).toBeNull();
  });
});

describe("apply match", () => {
  it("treats the same spans as a match even if order differs", () => {
    expect(
      spansMatch(
        [
          { start: 24, stop: 50 },
          { start: 0, stop: 24 },
        ],
        [
          { start: 0, stop: 24 },
          { start: 24, stop: 50 },
        ],
      ),
    ).toBe(true);
    expect(
      spansMatch([{ start: 0, stop: 24 }], [{ start: 0, stop: 20 }]),
    ).toBe(false);
  });

  it("keeps a mismatch as failed copy — not Hardware Done", () => {
    const result = applyOutcome(
      [{ label: "Right run", start: 24, stop: 50 }],
      [{ start: 24, stop: 40 }],
      "fixture",
    );
    expect(result.matched).toBe(false);
    expect(result.status).toBe("mismatch");
    expect(result.message).toMatch(/didn’t stick/);
    expect(result.rows[0]?.matched).toBe(false);
    expect(result.caption).toBe(applyCaption("fixture", [{ start: 24, stop: 40 }]));
    expect(result.caption).toMatch(/Not Hardware Done/);
    expect(result.caption).not.toMatch(/controller reported these ranges/);
  });

  it("does not invent a known empty read when segments were not read", () => {
    const sent = [{ label: "Right run", start: 24, stop: 50 }];
    const writeFailed = applyUnreadFailed(
      sent,
      "The controller did not take the ranges. Nothing else changed.",
      "controller",
    );
    expect(writeFailed.matched).toBe(false);
    expect(writeFailed.status).toBe("failed");
    expect(writeFailed.read).toBeNull();
    expect(writeFailed.read).not.toEqual([]);
    expect(writeFailed.rows).toEqual([]);
    expect(writeFailed.caption).toBe(APPLY_UNREAD_CAPTION);
    expect(writeFailed.caption).not.toMatch(/controller reported these ranges/);
    expect(adoptControllerRangesReason(writeFailed)).toBe(APPLY_ADOPT_UNKNOWN_REASON);
    expect(adoptControllerRangesReason(writeFailed)).not.toBe(APPLY_ADOPT_EMPTY_REASON);

    const rereadFailed = applyUnreadFailed(
      sent,
      "Wrote, but could not re-read. Not treating as success.",
      "controller",
    );
    expect(rereadFailed.read).toBeNull();
    expect(rereadFailed.read).not.toEqual([]);
    expect(rereadFailed.caption).toBe(APPLY_UNREAD_CAPTION);
    expect(rereadFailed.caption).not.toMatch(/controller reported these ranges/);
    expect(adoptControllerRangesReason(rereadFailed)).toBe(APPLY_ADOPT_UNKNOWN_REASON);

    const knownEmpty = applyOutcome(sent, [], "controller");
    expect(knownEmpty.read).toEqual([]);
    expect(knownEmpty.status).toBe("mismatch");
    expect(knownEmpty.caption).toBe(APPLY_EMPTY_READ_CAPTION);
    expect(knownEmpty.caption).toMatch(/reported no ranges/);
    expect(knownEmpty.caption).toMatch(/until you look at the strip/);
    expect(knownEmpty.caption).not.toMatch(/these ranges/);
    expect(knownEmpty.caption).not.toMatch(/\bthem\b/);
    expect(knownEmpty.caption).not.toMatch(/until you see them/);
    expect(knownEmpty.caption).not.toBe(APPLY_UNREAD_CAPTION);
    expect(adoptControllerRangesReason(knownEmpty)).toBe(APPLY_ADOPT_EMPTY_REASON);
  });

  it("does not treat unknown reread segments as empty before outcome", () => {
    const sent = [{ label: "Right run", start: 24, stop: 50 }];
    const unknown = applyUnknownSegments(sent, "controller");
    expect(unknown.matched).toBe(false);
    expect(unknown.status).toBe("failed");
    expect(unknown.read).toBeNull();
    expect(unknown.rows).toEqual([]);
    expect(unknown.message).toBe(APPLY_UNKNOWN_SEGMENTS_MESSAGE);
    expect(unknown.caption).toBe(APPLY_UNREAD_CAPTION);
    expect(unknown.caption).not.toMatch(/controller reported these ranges/);

    const viaOutcome = applyOutcome(sent, null, "fixture");
    expect(viaOutcome).toEqual(applyUnknownSegments(sent, "fixture"));
    expect(viaOutcome.status).not.toBe("matched");
    expect(viaOutcome.status).not.toBe("mismatch");

    const emptyUnknown = applyOutcome([], null, "controller");
    expect(emptyUnknown.matched).toBe(false);
    expect(emptyUnknown.status).toBe("failed");
    expect(emptyUnknown.read).toBeNull();
  });

  it("still compares a known empty seg list as empty — distinct from unknown", () => {
    const emptyVsEmpty = applyOutcome([], [], "controller");
    expect(emptyVsEmpty.matched).toBe(true);
    expect(emptyVsEmpty.status).toBe("matched");
    expect(emptyVsEmpty.read).toEqual([]);
    expect(emptyVsEmpty.caption).toBe(APPLY_EMPTY_READ_CAPTION);
    expect(emptyVsEmpty.caption).not.toMatch(/these ranges/);
    expect(emptyVsEmpty.caption).not.toMatch(/\bthem\b/);

    const declaredVsEmpty = applyOutcome(
      [{ label: "Right run", start: 24, stop: 50 }],
      [],
      "controller",
    );
    expect(declaredVsEmpty.matched).toBe(false);
    expect(declaredVsEmpty.status).toBe("mismatch");
    expect(declaredVsEmpty.read).toEqual([]);
    expect(declaredVsEmpty.message).toMatch(/didn’t stick/);
    expect(declaredVsEmpty.message).not.toBe(APPLY_UNKNOWN_SEGMENTS_MESSAGE);
    expect(declaredVsEmpty.caption).toBe(APPLY_EMPTY_READ_CAPTION);
    expect(declaredVsEmpty.caption).not.toMatch(/these ranges/);
    expect(declaredVsEmpty.caption).not.toMatch(/\bthem\b/);
  });

  it("captions from the read, not the source — unread and known empty do not say these ranges", () => {
    expect(applyCaption("controller", null)).toBe(APPLY_UNREAD_CAPTION);
    expect(applyCaption("controller", null)).not.toMatch(/controller reported these ranges/);
    expect(applyCaption("fixture", null)).toMatch(/Software-green from the fixture/);
    expect(applyCaption("fixture", null)).not.toMatch(/controller reported these ranges/);
    expect(applyCaption("controller", [{ start: 0, stop: 24 }])).toMatch(
      /controller reported these ranges/,
    );
    expect(applyCaption("controller", [])).toBe(APPLY_EMPTY_READ_CAPTION);
    expect(applyCaption("controller", [])).toMatch(/reported no ranges/);
    expect(applyCaption("controller", [])).toMatch(/until you look at the strip/);
    expect(applyCaption("controller", [])).not.toMatch(/these ranges/);
    expect(applyCaption("controller", [])).not.toMatch(/\bthem\b/);
    expect(applyCaption("controller", [])).not.toMatch(/until you see them/);
    expect(applyCaption("controller", [])).not.toBe(APPLY_UNREAD_CAPTION);
    expect(applyCaption("fixture", [])).toMatch(/Software-green from the fixture/);
    expect(applyCaption("fixture", [{ start: 0, stop: 24 }])).toMatch(
      /Software-green from the fixture/,
    );
    expect(applyCaption("sim", [{ start: 0, stop: 24 }])).toMatch(/software path only/i);
    expect(applyCaption("sim", null)).toMatch(/Not Hardware Done/);
    expect(applyCaption("sim", [])).not.toMatch(/controller reported/);
  });

  it("offers adopt only when the reread named ranges", () => {
    const sent = [{ label: "Right run", start: 24, stop: 50 }];
    const unknown = applyUnknownSegments(sent, "controller");
    expect(adoptableControllerRanges(unknown)).toEqual([]);
    expect(adoptControllerRangesReason(unknown)).toBe(APPLY_ADOPT_UNKNOWN_REASON);

    const empty = applyOutcome(sent, [], "controller");
    expect(adoptableControllerRanges(empty)).toEqual([]);
    expect(adoptControllerRangesReason(empty)).toBe(APPLY_ADOPT_EMPTY_REASON);

    const mismatch = applyOutcome(sent, [{ start: 24, stop: 40 }], "controller");
    expect(adoptableControllerRanges(mismatch)).toEqual([{ start: 24, stop: 40 }]);
    expect(adoptControllerRangesReason(mismatch)).toBeNull();
  });
});

describe("re-address continuity", () => {
  it("switches only when the same MAC answers at the new host", () => {
    expect(
      readdressContinuity({
        enrolledMac: "02:00:00:00:00:01",
        snapshotMac: "02:00:00:00:00:01",
        sameHost: false,
      }).ok,
    ).toBe(true);
    const refused = readdressContinuity({
      enrolledMac: "02:00:00:00:00:01",
      snapshotMac: "aa:bb:cc:dd:ee:ff",
      sameHost: false,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe("mac-mismatch");
    expect(macsMatch("020000000001", "02:00:00:00:00:01")).toBe(true);
  });
});
