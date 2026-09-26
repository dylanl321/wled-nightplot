import type { StripDriverDescriptor } from "./types.ts";

export const ws281xStrip: StripDriverDescriptor = {
  id: "ws281x",
  label: "WS281x",
  chip: "WS281x RGB",
  implementation: "registered",
  wired: false,
  channels: ["r", "g", "b"],
  colorOrder: "GRB",
  bead: "rgb",
  notes:
    "First strip/driver member. A later RGBW member grows a second die on the bead; ranges stay untouched.",
};
