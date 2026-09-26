import { describe, expect, it } from "vitest";
import {
  applyCaption,
  applyOutcome,
  applyRefuseReason,
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
