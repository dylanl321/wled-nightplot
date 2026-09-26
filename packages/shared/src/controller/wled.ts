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
  },
  notes:
    "Discover through All Off are live on WLED. All Off cancels Preview/Blink without restoring, then powers off each reachable Light. A fixture report is software-green — not Hardware Done.",
};
