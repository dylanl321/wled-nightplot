import type { StripDriverDescriptor } from "./types.ts";

/**
 * Second strip/driver member. Native WLED type is `TYPE_SK6812_RGBW` (30)
 * in `wled00/const.h` (v0.14.4, v0.15.0, v0.15.3, master). Colour order 0
 * is `COL_ORDER_GRB`, documented as GRB(w) — GRBW on this four-channel IC.
 * Registered is not Hardware Done.
 */
export const sk6812RgbwStrip: StripDriverDescriptor = {
  id: "sk6812-rgbw",
  label: "SK6812 RGBW",
  chip: "SK6812 RGBW",
  implementation: "registered",
  wired: false,
  channels: ["r", "g", "b", "w"],
  colorOrder: "GRBW",
  bead: "rgbw",
  notes:
    "Four channels per node (RGB + white). WLED native type 30, order 0 (GRBW). A registered member is not Hardware Done. Bead chrome for the second die is a later Inspect slice.",
};
