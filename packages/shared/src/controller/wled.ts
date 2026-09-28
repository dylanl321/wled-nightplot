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
    "Discover through Safe settings and first-time strip provision are live on WLED. Named strip presets fill type / length / GPIO; Apply still writes only reviewed /json/cfg bus fields this firmware actually exposed, then re-reads. A length change clips or drops declared Elements that no longer fit, and flags leftover coverage. A fixture report is software-green — not Hardware Done. A sim enroll is software path only — not Hardware Done.",
};
