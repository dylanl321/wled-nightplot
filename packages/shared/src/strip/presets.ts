/**
 * Built-in strip provision presets (CONFIG-41).
 *
 * Catalog data for common WS281x length / GPIO combos. Selecting one fills
 * the CONFIG-40 form; fields still override. These are documented defaults,
 * not a confirmed install pinout.
 */
import {
  type ProvisionLedType,
  type WledStripProvisionDraft,
} from "../provision.ts";

export type StripPreset = {
  id: string;
  label: string;
  ledType: ProvisionLedType;
  length: number;
  gpio: number;
  notes: string;
};

/**
 * Sensible documented defaults — WLED’s common ESP32 / ESP8266 data pins
 * and typical reel lengths. Not Hardware Done. Not a site pinout list.
 */
export const STRIP_PRESETS: readonly StripPreset[] = [
  {
    id: "ws281x-60-gpio16",
    label: "WS281x · 60 nodes · GPIO 16",
    ledType: "ws281x",
    length: 60,
    gpio: 16,
    notes:
      "WLED’s common ESP32 default data pin with a 60-node first length (1 m at 60/m or 2 m at 30/m). Documented default — not a confirmed install pinout.",
  },
  {
    id: "ws281x-150-gpio16",
    label: "WS281x · 150 nodes · GPIO 16",
    ledType: "ws281x",
    length: 150,
    gpio: 16,
    notes:
      "Same ESP32 default pin with 150 nodes (5 m at 30/m). Documented default — not a confirmed install pinout.",
  },
  {
    id: "ws281x-300-gpio2",
    label: "WS281x · 300 nodes · GPIO 2",
    ledType: "ws281x",
    length: 300,
    gpio: 2,
    notes:
      "WLED’s common ESP8266 default data pin (also used as an alternate ESP32 pin) with 300 nodes (5 m at 60/m). Documented default — not a confirmed install pinout.",
  },
];

export function listStripPresets(): readonly StripPreset[] {
  return STRIP_PRESETS;
}

export function getStripPreset(id: string): StripPreset | undefined {
  return STRIP_PRESETS.find((entry) => entry.id === id);
}

export function defaultStripPreset(): StripPreset {
  const first = STRIP_PRESETS[0];
  if (!first) {
    throw new Error("Strip preset catalog is empty.");
  }
  return first;
}

export function provisionDraftFromPreset(preset: StripPreset): WledStripProvisionDraft {
  return {
    ledType: preset.ledType,
    length: preset.length,
    gpio: preset.gpio,
  };
}

/** POST /api/lights/:id/provision body filled from a catalog member. */
export function provisionApplyBodyFromPreset(preset: StripPreset): {
  provision: WledStripProvisionDraft;
} {
  return { provision: provisionDraftFromPreset(preset) };
}

export function matchingStripPresetId(
  draft: Pick<WledStripProvisionDraft, "ledType" | "length" | "gpio">,
): string | null {
  return (
    STRIP_PRESETS.find(
      (entry) =>
        entry.ledType === draft.ledType &&
        entry.length === draft.length &&
        entry.gpio === draft.gpio,
    )?.id ?? null
  );
}
