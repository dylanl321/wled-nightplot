import type { StripAssistPlugin } from "./types.ts";

export const findLengthAssist: StripAssistPlugin = {
  id: "find-length",
  kind: "length",
  label: "Find length",
  implementation: "registered",
  wired: false,
  notes:
    "Walk-the-strip length helper on Strip. Lights one output through Preview, then writes that output through provision. A registered helper is not Hardware Done.",
};
