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
    blink: true,
    preview: true,
    apply: false,
    allOff: false,
  },
  notes:
    "Discover, snapshot, Preview, and Blink are live. Preview writes a temporary look and reads /json/live back. Blink pulses then restores. Apply and All Off are not. A fixture readback is software-green — not Hardware Done.",
};
