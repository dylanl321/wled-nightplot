import { describe, expect, it } from "vitest";
import { parseWledHealth } from "./health.ts";

describe("WLED health", () => {
  it("reads optional /json/info metrics without inventing missing readings", () => {
    expect(parseWledHealth({ uptime: 91234, freeheap: 120000, wifi: { signal: 85, rssi: -57 } }, "0.15.4"))
      .toEqual({ uptimeSeconds: 91234, freeHeapBytes: 120000, wifiSignalPercent: 85,
        wifiRssiDbm: -57, compatibilityNotice: null });
    expect(parseWledHealth({ wifi: { signal: -1, rssi: "-90" }, uptime: "3" }, "0.15.4"))
      .toMatchObject({ uptimeSeconds: null, freeHeapBytes: null, wifiSignalPercent: null, wifiRssiDbm: null });
  });

  it("warns for older and unverified Strip firmware without claiming newer is too old", () => {
    expect(parseWledHealth({}, "0.13.3").compatibilityNotice).toMatch(/predates/);
    expect(parseWledHealth({}, "0.15.2").compatibilityNotice).toMatch(/not in Nightplot/);
    expect(parseWledHealth({}, "16.0.1").compatibilityNotice).toBeNull();
  });
});
