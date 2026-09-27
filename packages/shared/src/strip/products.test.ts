import { describe, expect, it } from "vitest";
import { getStrip } from "./catalog.ts";
import { STRIP_PRESETS } from "./presets.ts";
import {
  inheritLedProductFields,
  parseLedProductInput,
  seedLedProductsFromPresets,
  validateLedProduct,
} from "./products.ts";

describe("LED product catalog", () => {
  it("seeds 2–3 operator SKUs from strip presets without inheriting a WLED write", () => {
    const seeds = seedLedProductsFromPresets();
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(seeds.length).toBe(STRIP_PRESETS.length);
    const ids = new Set(seeds.map((row) => row.id));
    expect(ids.size).toBe(seeds.length);
    for (const product of seeds) {
      expect(product.driverId).toBe("ws281x");
      expect(getStrip(product.driverId)).toBeDefined();
      expect(product.formFactor).toBe("discrete");
      expect(product.notes).toMatch(/not written to WLED/i);
      expect(product.notes).toMatch(/not Hardware Done/);
      expect(product.channels).toBeUndefined();
      expect(product.colorOrder).toBeUndefined();
      expect(product.bead).toBeUndefined();
      const preset = STRIP_PRESETS.find((entry) => product.id === `led-${entry.id}`);
      expect(preset).toBeDefined();
      expect(product.defaultLength).toBe(preset?.length);
      expect(product.defaultGpio).toBe(preset?.gpio);
      expect(validateLedProduct(product)).toBeNull();
    }
  });

  it("inherits channels, color order, and bead from the registered driver", () => {
    const driver = getStrip("ws281x");
    expect(driver).toBeDefined();
    const inherited = inheritLedProductFields({
      id: "porch-reel",
      label: "Porch reel",
      notes: "",
      formFactor: "diffused",
      driverId: "ws281x",
    });
    expect(inherited).toEqual({
      channels: driver?.channels,
      colorOrder: driver?.colorOrder,
      bead: driver?.bead,
    });
  });

  it("keeps optional channel / color / bead overrides off the WLED path", () => {
    const parsed = parseLedProductInput({
      id: "rgbw-cob-sample",
      label: "COB sample",
      formFactor: "cob",
      driverId: "ws281x",
      channels: ["r", "g", "b", "w"],
      colorOrder: "grbw",
      bead: "rgbw",
      defaultLength: 60,
      defaultGpio: 16,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.product.colorOrder).toBe("GRBW");
    expect(inheritLedProductFields(parsed.product)).toEqual({
      channels: ["r", "g", "b", "w"],
      colorOrder: "GRBW",
      bead: "rgbw",
    });
  });

  it("fails closed on unknown driverId, bad formFactor, and bad defaults", () => {
    expect(parseLedProductInput({
      label: "Mystery",
      formFactor: "discrete",
      driverId: "apa102",
    })).toMatchObject({ ok: false, error: "unknown_driver" });

    expect(parseLedProductInput({
      label: "Mystery",
      formFactor: "tape",
      driverId: "ws281x",
    })).toMatchObject({ ok: false, error: "bad_form_factor" });

    expect(parseLedProductInput({
      label: "Too long",
      formFactor: "discrete",
      driverId: "ws281x",
      defaultLength: 4096,
    })).toMatchObject({ ok: false, error: "bad_defaults" });

    expect(parseLedProductInput({
      label: "Bad pin",
      formFactor: "discrete",
      driverId: "ws281x",
      defaultGpio: -1,
    })).toMatchObject({ ok: false, error: "bad_defaults" });

    expect(parseLedProductInput({
      label: "Bad channels",
      formFactor: "discrete",
      driverId: "ws281x",
      channels: ["r", "x"],
    })).toMatchObject({ ok: false, error: "bad_override" });

    expect(parseLedProductInput({
      label: "Bad order",
      formFactor: "discrete",
      driverId: "ws281x",
      colorOrder: "yes",
    })).toMatchObject({ ok: false, error: "bad_override" });
  });
});
