import type { StripDriverDescriptor } from "./types.ts";
import { fw1906Strip } from "./fw1906.ts";
import { sk6812RgbwStrip } from "./sk6812-rgbw.ts";
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

const strips: readonly StripDriverDescriptor[] = [ws281xStrip, sk6812RgbwStrip, fw1906Strip];

export function listStrips(): readonly StripDriverDescriptor[] {
  return strips;
}

export function getStrip(id: string): StripDriverDescriptor | undefined {
  return strips.find((entry) => entry.id === id);
}
