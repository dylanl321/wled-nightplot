import { describe, expect, it } from "vitest";
import {
  APPLY_UNKNOWN_COLOUR_REASON,
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  applyCaption,
  applyOutcome,
  applyRefuseReason,
  applyUnknownSegments,
  knownApplyColor,
  macsMatch,
  readdressContinuity,
  spansMatch,
} from "./apply.ts";

describe("apply refuse", () => {
  it("refuses Apply when offline, invalid, empty, or Preview is live", () => {
    expect(
      applyRefuseReason({ reachable: false, elementCount: 2 }),
    ).toMatch(/hasn’t answered/);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        issueMessage: "Overlaps Right run on LEDs 20–24.",
      }),
    ).toMatch(/Overlaps/);
    expect(applyRefuseReason({ reachable: true, elementCount: 0 })).toMatch(
      /at least one Element/,
    );
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
        busyKind: "preview",
      }),
    ).toMatch(/Preview is not Apply/);
  });

  it("refuses Apply when colour is unknown — never invents #ffa000", () => {
    expect(knownApplyColor(null)).toBeNull();
    expect(knownApplyColor(undefined)).toBeNull();
    expect(knownApplyColor("")).toBeNull();
    expect(knownApplyColor("unknown")).toBeNull();
    expect(knownApplyColor("#ffa000")).toBe("#ffa000");
    expect(
      applyRefuseReason({ reachable: true, elementCount: 2, segmentColor: null }),
    ).toBe(APPLY_UNKNOWN_COLOUR_REASON);
    expect(
      applyRefuseReason({ reachable: true, elementCount: 2 }),
    ).toBe(APPLY_UNKNOWN_COLOUR_REASON);
    expect(
      applyRefuseReason({
        reachable: true,
        elementCount: 2,
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
    expect(applyCaption("fixture")).toMatch(/Not Hardware Done/);
  });

  it("does not treat unknown reread segments as empty before outcome", () => {
    const sent = [{ label: "Right run", start: 24, stop: 50 }];
    const unknown = applyUnknownSegments(sent, "controller");
    expect(unknown.matched).toBe(false);
    expect(unknown.status).toBe("failed");
    expect(unknown.read).toBeNull();
    expect(unknown.rows).toEqual([]);
    expect(unknown.message).toBe(APPLY_UNKNOWN_SEGMENTS_MESSAGE);
    expect(unknown.caption).toMatch(/Not Hardware Done/);

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
