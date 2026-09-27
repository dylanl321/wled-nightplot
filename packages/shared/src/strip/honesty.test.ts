import { describe, expect, it } from "vitest";
import {
  knownStripKind,
  needsInspectStripKindSeed,
  stripBeadCaption,
  stripHonestyForLight,
} from "./honesty.ts";
import type { LedProduct } from "./products.ts";

const rgbwProduct: LedProduct = {
  id: "porch-sk6812",
  label: "Porch SK6812",
  notes: "Catalog attach — not a WLED write, not Hardware Done.",
  formFactor: "discrete",
  driverId: "sk6812-rgbw",
  defaultLength: 60,
  defaultGpio: 16,
};

const rgbProduct: LedProduct = {
  id: "eave-ws281x",
  label: "Eave WS281x",
  notes: "",
  formFactor: "discrete",
  driverId: "ws281x",
};

describe("strip honesty", () => {
  it("follows an attached SK6812 product — not snapshot rgbw, not a WS281x label", () => {
    const honesty = stripHonestyForLight({
      stripKind: "ws281x",
      product: rgbwProduct,
    });
    expect(honesty).toEqual({
      driverId: "sk6812-rgbw",
      bead: "rgbw",
      rgbw: true,
      chipLabel: "SK6812 RGBW",
      source: "product",
    });
    expect(honesty.chipLabel).not.toMatch(/WS281x RGBW/);
  });

  it("follows an attached WS281x product as a single RGB bead", () => {
    const honesty = stripHonestyForLight({
      stripKind: "sk6812-rgbw",
      product: rgbProduct,
    });
    expect(honesty.bead).toBe("rgb");
    expect(honesty.rgbw).toBe(false);
    expect(honesty.chipLabel).toBe("WS281x RGB");
    expect(honesty.source).toBe("product");
  });

  it("follows the persisted strip driver when no product is attached", () => {
    expect(stripHonestyForLight({ stripKind: "sk6812-rgbw" })).toEqual({
      driverId: "sk6812-rgbw",
      bead: "rgbw",
      rgbw: true,
      chipLabel: "SK6812 RGBW",
      source: "driver",
    });
    expect(stripHonestyForLight({ stripKind: "ws281x" }).chipLabel).toBe("WS281x RGB");
    expect(stripHonestyForLight({}).chipLabel).toBe("WS281x RGB");
  });

  it("does not treat snapshot rgbw as a driver — unknown stripKind stays WS281x RGB", () => {
    const honesty = stripHonestyForLight({ stripKind: "not-a-driver" });
    expect(honesty.bead).toBe("rgb");
    expect(honesty.chipLabel).toBe("WS281x RGB");
    expect(knownStripKind("sk6812-rgbw")).toBe("sk6812-rgbw");
    expect(knownStripKind("mystery")).toBe("ws281x");
  });

  it("keeps a product bead override as catalog metadata", () => {
    const honesty = stripHonestyForLight({
      stripKind: "ws281x",
      product: { ...rgbProduct, bead: "rgbw" },
    });
    expect(honesty.bead).toBe("rgbw");
    expect(honesty.chipLabel).toBe("WS281x RGB");
    expect(honesty.source).toBe("product");
  });

  it("captions rgb vs rgbw without claiming Hardware Done", () => {
    expect(stripBeadCaption("rgb")).toBe("RGB");
    expect(stripBeadCaption("rgbw")).toBe("RGBW");
  });

  it("seeds Inspect stripKind only when default, unattached, and reachable", () => {
    expect(
      needsInspectStripKindSeed({
        stripKind: "ws281x",
        ledProductId: null,
        reachable: true,
      }),
    ).toBe(true);
    expect(
      needsInspectStripKindSeed({
        stripKind: "sk6812-rgbw",
        ledProductId: null,
        reachable: true,
      }),
    ).toBe(false);
    expect(
      needsInspectStripKindSeed({
        stripKind: "ws281x",
        ledProductId: "porch-sk6812",
        reachable: true,
      }),
    ).toBe(false);
    expect(
      needsInspectStripKindSeed({
        stripKind: "ws281x",
        ledProductId: null,
        reachable: false,
      }),
    ).toBe(false);
  });
});
