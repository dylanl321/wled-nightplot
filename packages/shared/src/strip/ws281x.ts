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
    "First strip/driver member. Three RGB channels. Ranges stay the same when SK6812 RGBW is selected.",
};
