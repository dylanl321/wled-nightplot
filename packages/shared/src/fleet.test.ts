import { describe, expect, it } from "vitest";
import {
  fleetApplySummary,
  fleetEnrollSummary,
  parseHostList,
  parseLightIdList,
} from "./fleet.ts";

describe("fleet parsers", () => {
  it("dedupes hosts and light ids", () => {
    expect(parseHostList({ hosts: ["192.168.1.80", " 192.168.1.80 ", "", "192.168.1.81"] })).toEqual([
      "192.168.1.80",
      "192.168.1.81",
    ]);
    expect(parseLightIdList({ lightIds: ["a", "a", "b"] })).toEqual(["a", "b"]);
    expect(parseHostList({ hosts: [] })).toBeNull();
    expect(parseLightIdList({})).toBeNull();
  });
});

describe("fleet summaries", () => {
  it("lists added / already enrolled / failed without inventing success", () => {
    expect(
      fleetEnrollSummary([
        { host: "a", status: "added" },
        { host: "b", status: "already-enrolled" },
        { host: "c", status: "failed", reason: "Didn’t answer." },
      ]),
    ).toBe("1 added · 1 already enrolled · 1 failed");
    expect(fleetEnrollSummary([])).toBe("Nothing to add.");
  });

  it("names mixed apply results", () => {
    expect(
      fleetApplySummary([
        { lightId: "a", name: "A", status: "applied" },
        { lightId: "b", name: "B", status: "failed", reason: "offline" },
      ]),
    ).toBe("Applied on 1. 1 failed.");
    expect(fleetApplySummary([{ lightId: "a", name: "A", status: "applied" }])).toBe("Applied on 1 Light.");
    expect(fleetApplySummary([{ lightId: "a", name: "A", status: "failed" }])).toBe("Nothing applied. 1 failed.");
  });
});
