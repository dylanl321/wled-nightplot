import { describe, expect, it } from "vitest";
import { isLitBead, isUnknownBead } from "./bead.ts";
import { catalogSnapshot } from "./catalog.ts";
import { getController, listControllers } from "./controller/catalog.ts";
import { listDiscoveryMechanisms } from "./discovery/catalog.ts";
import { emptyLightsPayload } from "./lights.ts";
import { getStrip, listStripPresets, listStrips } from "./strip/catalog.ts";

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
    expect(wled?.capabilities.allOff).toBe(true);
    expect(wled?.capabilities.safe).toBe(true);
    expect(wled?.capabilities.provision).toBe(true);
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
    expect(listStrips().map((entry) => entry.id)).toEqual(["ws281x", "sk6812-rgbw"]);
  });

  it("registers SK6812 RGBW as a four-channel bead", () => {
    const strip = getStrip("sk6812-rgbw");
    expect(strip).toBeDefined();
    expect(strip?.implementation).toBe("registered");
    expect(strip?.wired).toBe(false);
    expect(strip?.bead).toBe("rgbw");
    expect(strip?.channels).toEqual(["r", "g", "b", "w"]);
    expect(strip?.colorOrder).toBe("GRBW");
    expect(strip?.notes).toMatch(/not Hardware Done/);
  });

  it("registers named strip presets as catalog data", () => {
    const presets = listStripPresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.every((entry) => entry.ledType === "ws281x")).toBe(true);
  });
});

describe("discovery catalog", () => {
  it("registers mDNS, SSDP, and address probe", () => {
    const ids = listDiscoveryMechanisms().map((entry) => entry.id);
    expect(ids).toEqual(["mdns", "ssdp", "address-probe"]);
    expect(
      listDiscoveryMechanisms().every((entry) => entry.implementation === "registered"),
    ).toBe(true);
    const notes = listDiscoveryMechanisms().map((entry) => entry.notes).join(" ");
    expect(notes).toMatch(/LOCATION/);
    expect(notes).toMatch(/SRV/);
    expect(notes).toMatch(/escape hatch/);
  });
});

describe("catalog snapshot", () => {
  it("packages the three seams for the server", () => {
    const snap = catalogSnapshot();
    expect(snap.slice).toBe("R6");
    expect(snap.controllers).toHaveLength(1);
    expect(snap.strips).toHaveLength(2);
    expect(snap.stripPresets.length).toBeGreaterThanOrEqual(3);
    expect(snap.ledProducts).toEqual([]);
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
  it("starts with no enrolled Lights or Segments", () => {
    expect(emptyLightsPayload.lights).toEqual([]);
    expect(emptyLightsPayload.elements).toEqual([]);
  });
});
