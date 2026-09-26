import type { ControllerDescriptor } from "./types.ts";

export const wledController: ControllerDescriptor = {
  id: "wled",
  label: "WLED",
  chip: "WLED",
  implementation: "registered",
  wired: true,
  capabilities: {
    discover: true,
    snapshot: true,
    blink: false,
    preview: false,
    apply: false,
    allOff: false,
  },
  notes:
    "Discover and snapshot (including reported segments) are live. Blink, Preview, Apply, and All Off are not. Not Hardware Done.",
};
