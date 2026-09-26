import type { ControllerDescriptor } from "./types.ts";

export const wledController: ControllerDescriptor = {
  id: "wled",
  label: "WLED",
  chip: "WLED",
  implementation: "registered",
  wired: false,
  capabilities: {
    discover: false,
    snapshot: false,
    blink: false,
    preview: false,
    apply: false,
    allOff: false,
  },
  notes:
    "First controller member. Protocol, snapshot, blink, and live output are later slices. Registered is not Hardware Done.",
};
