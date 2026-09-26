import { describe, expect, it } from "vitest";
import { isLitBead, isUnknownBead } from "./bead.ts";
import { catalogSnapshot } from "./catalog.ts";
import { getController, listControllers } from "./controller/catalog.ts";
import { listDiscoveryMechanisms } from "./discovery/catalog.ts";
import { emptyLightsPayload } from "./lights.ts";
import { getStrip, listStrips } from "./strip/catalog.ts";

describe("controller catalog", () => {
  it("registers WLED with discover, snapshot, preview, blink, and apply", () => {
    const wled = getController("wled");
    expect(wled).toBeDefined();
    expect(wled?.implementation).toBe("registered");
    expect(wled?.wired).toBe(true);
    expect(wled?.capabilities.discover).toBe(true);
    expect(wled?.capabilities.snapshot).toBe(true);
    expect(wled?.capabilities.preview).toBe(true);
    expect(wled?.capabilities.blink).toBe(true);
    expect(wled?.capabilities.apply).toBe(true);
    expect(wled?.capabilities.allOff).toBe(false);
    expect(listControllers().map((entry) => entry.id)).toEqual(["wled"]);
  });
});

describe("strip catalog", () => {
  it("registers WS281x first as a single RGB bead", () => {
    const strip = getStrip("ws281x");
    expect(strip).toBeDefined();
    expect(strip?.implementation).toBe("registered");
    expect(strip?.bead).toBe("rgb");
    expect(strip?.channels).toEqual(["r", "g", "b"]);
    expect(listStrips().map((entry) => entry.id)).toEqual(["ws281x"]);
  });
});

describe("discovery catalog", () => {
  it("registers mDNS, SSDP, and address probe", () => {
    const ids = listDiscoveryMechanisms().map((entry) => entry.id);
    expect(ids).toEqual(["mdns", "ssdp", "address-probe"]);
    expect(
      listDiscoveryMechanisms().every((entry) => entry.implementation === "registered"),
    ).toBe(true);
  });
});

describe("catalog snapshot", () => {
  it("packages the three seams for the server", () => {
    const snap = catalogSnapshot();
    expect(snap.slice).toBe("R4");
    expect(snap.controllers).toHaveLength(1);
    expect(snap.strips).toHaveLength(1);
    expect(snap.discovery).toHaveLength(3);
  });
});

describe("bead honesty", () => {
  it("never treats unknown as lit", () => {
    expect(isLitBead("unknown")).toBe(false);
    expect(isUnknownBead("unknown")).toBe(true);
    expect(isLitBead(null)).toBe(false);
    expect(isLitBead("#ffc978")).toBe(true);
  });
});

describe("lights store", () => {
  it("starts with no enrolled Lights or Elements", () => {
    expect(emptyLightsPayload.lights).toEqual([]);
    expect(emptyLightsPayload.elements).toEqual([]);
  });
});
