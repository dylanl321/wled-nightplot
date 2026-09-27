/**
 * Bead / Inspect chrome for a Light follows the attached LED product, then
 * the persisted strip driver. It does not invent a WS281x RGBW label from
 * `/json/info` `leds.rgbw`. A registered driver is not Hardware Done.
 */

import { getStrip } from "./catalog.ts";
import { inheritLedProductFields, type LedProduct } from "./products.ts";
import type { StripBead } from "./types.ts";
import { ws281xStrip } from "./ws281x.ts";

export type StripHonestySource = "product" | "driver";

export type StripHonesty = {
  driverId: string;
  bead: StripBead;
  rgbw: boolean;
  chipLabel: string;
  source: StripHonestySource;
};

export function knownStripKind(value: string | null | undefined): string {
  return value && getStrip(value) ? value : ws281xStrip.id;
}

export function stripHonestyForLight(input: {
  stripKind?: string | null;
  product?: LedProduct | null;
}): StripHonesty {
  const inherited = input.product ? inheritLedProductFields(input.product) : null;
  if (input.product && inherited) {
    const driver = getStrip(input.product.driverId) ?? ws281xStrip;
    return {
      driverId: driver.id,
      bead: inherited.bead,
      rgbw: inherited.bead === "rgbw",
      chipLabel: driver.chip,
      source: "product",
    };
  }
  const driver = getStrip(knownStripKind(input.stripKind)) ?? ws281xStrip;
  return {
    driverId: driver.id,
    bead: driver.bead,
    rgbw: driver.bead === "rgbw",
    chipLabel: driver.chip,
    source: "driver",
  };
}

export function stripBeadCaption(bead: StripBead): string {
  return bead === "rgbw" ? "RGBW" : "RGB";
}
