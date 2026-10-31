import type { StripAssistPlugin } from "./types.ts";

export const addPropAssist: StripAssistPlugin = {
  id: "add-prop",
  kind: "segment",
  label: "Add prop",
  implementation: "registered",
  wired: false,
  notes:
    "Shape-template helper on Segments. Walk a lit cursor, tap corners, then Apply writes every resulting Segment and reads back. A registered helper is not Hardware Done.",
};
