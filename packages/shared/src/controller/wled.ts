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
    apply: true,
    allOff: true,
    safe: true,
    provision: true,
  },
  notes:
    "Discover through Safe settings and first-time strip provision are live on WLED. Provision writes only reviewed /json/cfg bus fields (WS281x type, length, GPIO) this firmware actually exposed. A fixture report is software-green — not Hardware Done.",
};
