import { describe, expect, it } from "vitest";
import { lightFromSnapshot } from "./domain.ts";

const snapshot = {
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

describe("lightFromSnapshot name", () => {
  const target = { hostname: "192.168.1.72", port: 80 };

  it("keeps a cfg-preferred name while /json/info still reports the stale one", () => {
    const enrolled = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    const afterWrite = {
      ...enrolled,
      name: "Porch rail",
      nameSource: "cfg" as const,
      staleInfoName: "WLED",
    };
    const refreshed = lightFromSnapshot(target, snapshot, "2026-09-26T18:01:00.000Z", afterWrite);
    expect(refreshed.name).toBe("Porch rail");
    expect(refreshed.nameSource).toBe("cfg");
    expect(refreshed.staleInfoName).toBe("WLED");
  });

  it("follows /json/info once it catches up", () => {
    const existing = {
      ...lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z"),
      name: "Porch rail",
      nameSource: "cfg" as const,
      staleInfoName: "WLED",
    };
    const refreshed = lightFromSnapshot(
      target,
      { ...snapshot, name: "Porch rail" },
      "2026-09-26T18:02:00.000Z",
      existing,
    );
    expect(refreshed.name).toBe("Porch rail");
    expect(refreshed.nameSource).toBe("info");
    expect(refreshed.staleInfoName).toBeNull();
  });

  it("keeps ledProductId across a snapshot refresh", () => {
    const enrolled = lightFromSnapshot(target, snapshot, "2026-09-26T18:00:00.000Z");
    expect(enrolled.ledProductId).toBeNull();
    const attached = { ...enrolled, ledProductId: "led-ws281x-60-gpio16" };
    const refreshed = lightFromSnapshot(target, snapshot, "2026-09-26T18:01:00.000Z", attached);
    expect(refreshed.ledProductId).toBe("led-ws281x-60-gpio16");
  });
});
