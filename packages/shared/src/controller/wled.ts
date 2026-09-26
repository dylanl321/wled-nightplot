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
    allOff: false,
  },
  notes:
    "Discover, snapshot, Preview, Blink, and Apply ranges are live. Apply writes declared Elements, then re-reads the snapshot. A fixture match is software-green — not Hardware Done. All Off is not.",
};
