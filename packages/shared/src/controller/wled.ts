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
  },
  notes:
    "Discover through Safe settings are live on WLED. Safe settings write only /json/cfg fields this firmware actually exposed. A fixture report is software-green — not Hardware Done.",
};
