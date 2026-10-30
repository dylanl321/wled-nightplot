import type { StripDriverDescriptor } from "./types.ts";

/**
 * Third strip/driver member. Native WLED type is `TYPE_FW1906` (28) in
 * `wled00/const.h` (v0.15.0, v0.15.3, main): RGB + CW + WW + one unused
 * channel, six channels per IC. Common on COB strips. WLED drives both whites
 * from the white value and segment CCT, so Nightplot carries one white value.
 * Order 0 is `COL_ORDER_GRB`. Registered is not Hardware Done.
 */
export const fw1906Strip: StripDriverDescriptor = {
  id: "fw1906",
  label: "FW1906 RGB+CCT",
  chip: "FW1906 RGB+CCT",
  implementation: "registered",
  wired: false,
  channels: ["r", "g", "b", "w"],
  colorOrder: "GRB",
  bead: "rgbw",
  notes:
    "RGB plus warm and cold white, often on COB strips. WLED native type 28, order 0 (GRB). One white value is sent; WLED splits it across the two whites by segment CCT. Not in WLED 0.14. A registered member is not Hardware Done.",
};
