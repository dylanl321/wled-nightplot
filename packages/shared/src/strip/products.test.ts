import { describe, expect, it } from "vitest";
import { getStrip } from "./catalog.ts";
import { defaultStripPreset, STRIP_PRESETS } from "./presets.ts";
import {
  inheritLedProductFields,
  LED_CATALOG_ATTACH_COPY,
  LED_CATALOG_DELETE_CAPTION,
  LED_CATALOG_DELETE_CLEARED,
  LED_CATALOG_DELETE_COPY,
  LED_CATALOG_DELETE_REFUSE_UNKNOWN,
  LED_CATALOG_PER_LIGHT_COPY,
  LED_CATALOG_PER_LIGHT_HEADING,
  LED_CATALOG_SHARED_COPY,
  LED_CATALOG_SHARED_HEADING,
  canDeleteCatalog,
  catalogDeleteChecks,
  catalogDeleteRefuseReason,
  countLedProductAttaches,
  decideLedProductDelete,
  parseLedProductAttach,
  parseLedProductInput,
  provisionApplyBodyFromProduct,
  provisionDraftFromProduct,
  provisionLedTypeForDriver,
  resolveLedProductAttach,
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

describe("LED product attach + draft fill", () => {
  it("fills ledType / length / GPIO from the product and its driver", () => {
    const product = seedLedProductsFromPresets().find(
      (row) => row.id === "led-ws281x-300-gpio2",
    );
    expect(product).toBeDefined();
    const filled = provisionDraftFromProduct(product!);
    expect(filled).toEqual({
      ok: true,
      draft: { ledType: "ws281x", length: 300, gpio: 2 },
    });
    const apply = provisionApplyBodyFromProduct(product!);
    expect(apply).toEqual({
      ok: true,
      body: { provision: { ledType: "ws281x", length: 300, gpio: 2 } },
    });
  });

  it("uses product defaults over fallback, then fallback over the seeded preset", () => {
    const withDefaults = provisionDraftFromProduct(
      {
        id: "eave-reel",
        label: "Eave reel",
        notes: "",
        formFactor: "diffused",
        driverId: "ws281x",
        defaultLength: 150,
        defaultGpio: 16,
      },
      { length: 99, gpio: 4 },
    );
    expect(withDefaults).toEqual({
      ok: true,
      draft: { ledType: "ws281x", length: 150, gpio: 16 },
    });

    const seeded = defaultStripPreset();
    const withoutDefaults = provisionDraftFromProduct(
      {
        id: "porch-cob",
        label: "Porch cob",
        notes: "",
        formFactor: "cob",
        driverId: "ws281x",
      },
      { length: 180, gpio: 5 },
    );
    expect(withoutDefaults).toEqual({
      ok: true,
      draft: { ledType: "ws281x", length: 180, gpio: 5 },
    });

    const noFallback = provisionDraftFromProduct({
      id: "manual-seed",
      label: "Manual seed",
      notes: "",
      formFactor: "discrete",
      driverId: "ws281x",
    });
    expect(noFallback).toEqual({
      ok: true,
      draft: { ledType: "ws281x", length: seeded.length, gpio: seeded.gpio },
    });
  });

  it("fills SK6812 RGBW ledType when the product names that driver", () => {
    const filled = provisionDraftFromProduct({
      id: "porch-sk6812",
      label: "Porch SK6812",
      notes: "",
      formFactor: "discrete",
      driverId: "sk6812-rgbw",
      defaultLength: 120,
      defaultGpio: 16,
    });
    expect(filled).toEqual({
      ok: true,
      draft: { ledType: "sk6812-rgbw", length: 120, gpio: 16 },
    });
    expect(provisionLedTypeForDriver("sk6812-rgbw")).toBe("sk6812-rgbw");
    expect(
      parseLedProductInput({
        label: "Porch SK6812",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      }),
    ).toMatchObject({ ok: true, product: { driverId: "sk6812-rgbw" } });
    expect(
      inheritLedProductFields({
        id: "porch-sk6812",
        label: "Porch SK6812",
        notes: "",
        formFactor: "discrete",
        driverId: "sk6812-rgbw",
      }),
    ).toEqual({
      channels: ["r", "g", "b", "w"],
      colorOrder: "GRBW",
      bead: "rgbw",
    });
  });

  it("fails closed when the driver is missing or not a provision LED type", () => {
    expect(provisionLedTypeForDriver("ws281x")).toBe("ws281x");
    expect(provisionLedTypeForDriver("apa102")).toBeNull();

    expect(
      provisionDraftFromProduct({
        id: "mystery",
        label: "Mystery",
        notes: "",
        formFactor: "discrete",
        driverId: "apa102",
      }),
    ).toMatchObject({ ok: false, error: "unknown_driver" });
  });

  it("names shared catalog vs this Light and keeps attach as bookkeeping", () => {
    expect(LED_CATALOG_SHARED_HEADING).toBe("Shared catalog");
    expect(LED_CATALOG_PER_LIGHT_HEADING).toBe("This Light");
    expect(LED_CATALOG_SHARED_COPY).toMatch(/LED type and IC recipe/i);
    expect(LED_CATALOG_PER_LIGHT_COPY).toMatch(/Length, GPIO, ranges/);
    expect(LED_CATALOG_PER_LIGHT_COPY).toMatch(/this Light/i);
    expect(LED_CATALOG_ATTACH_COPY).toMatch(/not Apply/);
    expect(LED_CATALOG_ATTACH_COPY).toMatch(/not a WLED write/);
    expect(LED_CATALOG_ATTACH_COPY).toMatch(/not Hardware Done/);
    expect(LED_CATALOG_DELETE_COPY).toMatch(/Unknown or partial attach counts refuse/);
    expect(LED_CATALOG_DELETE_COPY).toMatch(/I understand/);
    expect(LED_CATALOG_DELETE_COPY).toMatch(/not Hardware Done/);
    expect(LED_CATALOG_DELETE_CAPTION).toMatch(/Not Apply/);
    expect(LED_CATALOG_DELETE_CLEARED).toMatch(/Not a WLED write/);
  });

  it("counts attaches and refuses delete when refs are unknown, partial, or in use", () => {
    const productId = "led-ws281x-60-gpio16";
    expect(countLedProductAttaches([], productId)).toEqual({
      known: true,
      complete: true,
      count: 0,
      lights: [],
    });
    expect(decideLedProductDelete(countLedProductAttaches([], productId))).toEqual({
      ok: true,
      count: 0,
    });

    const attached = countLedProductAttaches(
      [
        { id: "light-garage", name: "Garage", ledProductId: productId },
        { id: "light-porch", name: "Porch", ledProductId: productId },
        { id: "light-eave", name: "Eave", ledProductId: null },
      ],
      productId,
    );
    expect(attached).toMatchObject({ known: true, complete: true, count: 2 });
    const inUse = decideLedProductDelete(attached);
    expect(inUse).toMatchObject({ ok: false, error: "in_use", attached: 2 });
    expect(inUse.ok).toBe(false);
    if (inUse.ok) return;
    expect(inUse.message).toMatch(/Garage and Porch still attach/);
    expect(inUse.message).toMatch(/no override/);

    const unknown = countLedProductAttaches({ lights: [] }, productId);
    expect(unknown).toMatchObject({ known: false, complete: false, error: "unknown" });
    expect(decideLedProductDelete(unknown)).toMatchObject({
      ok: false,
      error: "unknown_refs",
      attached: null,
    });
    expect(catalogDeleteRefuseReason(catalogDeleteChecks(unknown))).toBe(
      LED_CATALOG_DELETE_REFUSE_UNKNOWN,
    );
    expect(canDeleteCatalog(catalogDeleteChecks(unknown))).toBe(false);

    const partial = countLedProductAttaches(
      [{ id: "light-garage", name: "Garage", ledProductId: 12 }],
      productId,
    );
    expect(partial).toMatchObject({ known: false, complete: false, error: "partial" });
    expect(decideLedProductDelete(partial)).toMatchObject({
      ok: false,
      error: "unknown_refs",
    });
    expect(canDeleteCatalog(catalogDeleteChecks(partial))).toBe(false);

    const missingId = countLedProductAttaches(
      [{ name: "Garage", ledProductId: productId }],
      productId,
    );
    expect(missingId).toMatchObject({ known: false, complete: false, error: "partial" });

    const clear = catalogDeleteChecks(countLedProductAttaches([], productId));
    expect(canDeleteCatalog(clear)).toBe(true);
    expect(catalogDeleteRefuseReason(clear)).toBeNull();
    expect(clear[0]?.detail).toMatch(/catalog bookkeeping only/);
  });

  it("parses attach null and a catalog id; unknown ids fail closed", () => {
    expect(parseLedProductAttach({ ledProductId: null })).toEqual({
      ok: true,
      ledProductId: null,
    });
    expect(parseLedProductAttach({ ledProductId: "led-ws281x-60-gpio16" })).toEqual({
      ok: true,
      ledProductId: "led-ws281x-60-gpio16",
    });
    expect(parseLedProductAttach({})).toMatchObject({ ok: false, error: "invalid" });
    expect(parseLedProductAttach({ ledProductId: "" })).toMatchObject({
      ok: false,
      error: "invalid",
    });

    const catalog = seedLedProductsFromPresets();
    const lookup = (id: string) => catalog.find((row) => row.id === id);
    expect(resolveLedProductAttach(null, lookup)).toEqual({
      ok: true,
      ledProductId: null,
      product: null,
    });
    const first = catalog[0]!;
    expect(resolveLedProductAttach(first.id, lookup)).toEqual({
      ok: true,
      ledProductId: first.id,
      product: first,
    });
    expect(resolveLedProductAttach("no-such-sku", lookup)).toMatchObject({
      ok: false,
      error: "not_found",
    });
  });
});
