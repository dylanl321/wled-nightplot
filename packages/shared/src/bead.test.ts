import { describe, expect, it } from "vitest";
import { beadForReportedOn, isLitBead, isUnknownBead } from "./bead.ts";

describe("beadForReportedOn", () => {
  it("keeps a colour when on is known true", () => {
    expect(beadForReportedOn(true, "#ffa000")).toBe("#ffa000");
    expect(isLitBead(beadForReportedOn(true, "#ffa000"))).toBe(true);
  });

  it("uses null for known off — not unknown-grey", () => {
    expect(beadForReportedOn(false, "#ffa000")).toBeNull();
    expect(beadForReportedOn(false, null)).toBeNull();
    expect(isUnknownBead(beadForReportedOn(false, null))).toBe(false);
  });

  it("uses unknown-grey when on is missing — not null-as-off", () => {
    expect(beadForReportedOn(null, null)).toBe("unknown");
    expect(beadForReportedOn(undefined, "#ffa000")).toBe("unknown");
    expect(isUnknownBead(beadForReportedOn(null, null))).toBe(true);
    expect(isLitBead(beadForReportedOn(null, null))).toBe(false);
  });
});
