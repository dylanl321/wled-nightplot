import { describe, expect, it, vi } from "vitest";
import {
  displayBead,
  inspectPowerHow,
  lightPowerStatus,
} from "@/lib/power-status";

describe("lightPowerStatus", () => {
  it("keeps last-seen copy when unreachable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T20:00:00.000Z"));
    expect(
      lightPowerStatus({
        reachability: "no-answer",
        on: null,
        brightness: null,
        lastSeenAt: "2026-09-26T18:00:00.000Z",
      }),
    ).toBe("No answer · last seen 2 h ago");
  });

  it("names known on and known off", () => {
    expect(
      lightPowerStatus({
        reachability: "online",
        on: true,
        brightness: 128,
        lastSeenAt: "2026-09-26T18:00:00.000Z",
      }),
    ).toBe("Online · on · 50%");
    expect(
      lightPowerStatus({
        reachability: "online",
        on: false,
        brightness: 0,
        lastSeenAt: "2026-09-26T18:00:00.000Z",
      }),
    ).toBe("Online · off");
  });

  it("does not say Online · off when on is missing", () => {
    const copy = lightPowerStatus({
      reachability: "online",
      on: null,
      brightness: null,
      lastSeenAt: "2026-09-26T18:00:00.000Z",
    });
    expect(copy).toBe("Online · unknown");
    expect(copy).not.toMatch(/off/i);
  });
});

describe("inspectPowerHow", () => {
  it("keeps known off distinct from missing on", () => {
    expect(
      inspectPowerHow({
        reachability: "online",
        on: false,
        brightness: 0,
      }),
    ).toBe("Answering. Off.");
    expect(
      inspectPowerHow({
        reachability: "online",
        on: null,
        brightness: null,
      }),
    ).toBe("Answering. Power unknown. Beads stay grey — not a last colour.");
  });
});

describe("displayBead", () => {
  it("uses unknown-grey when on is missing — not null-as-off", () => {
    expect(
      displayBead({
        reachability: "online",
        on: null,
        bead: null,
      }),
    ).toBe("unknown");
    expect(
      displayBead({
        reachability: "online",
        on: null,
        bead: "#ffa000",
      }),
    ).toBe("unknown");
  });

  it("keeps known off as null and known on as the reported colour", () => {
    expect(
      displayBead({
        reachability: "online",
        on: false,
        bead: null,
      }),
    ).toBeNull();
    expect(
      displayBead({
        reachability: "online",
        on: true,
        bead: "#ffa000",
      }),
    ).toBe("#ffa000");
  });
});
