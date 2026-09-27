import type { StripDriverDescriptor } from "./types.ts";
import { ws281xStrip } from "./ws281x.ts";

export {
  defaultStripPreset,
  getStripPreset,
  listStripPresets,
  matchingStripPresetId,
  provisionApplyBodyFromPreset,
  provisionDraftFromPreset,
  STRIP_PRESETS,
  type StripPreset,
} from "./presets.ts";

const strips: readonly StripDriverDescriptor[] = [ws281xStrip];

export function listStrips(): readonly StripDriverDescriptor[] {
  return strips;
}

export function getStrip(id: string): StripDriverDescriptor | undefined {
  return strips.find((entry) => entry.id === id);
}
