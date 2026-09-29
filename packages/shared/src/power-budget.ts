import type { Element } from "./lights.ts";
import { validateDeclaredRanges } from "./range.ts";

export type SegmentPowerColour = { hex: string; white: number };
export type SegmentPowerRow = { id: string; label: string; leds: number; milliAmps: number };
export type PowerScenario = {
  rows: SegmentPowerRow[];
  totalMa: number;
  limitMa: number | null;
  aboveLimit: boolean | null;
  uncoveredLeds: number;
};

/** Hypothetical 20 mA per full-brightness channel, not a live electrical measurement. */
export function estimatePowerScenario(input: {
  segments: Element[];
  ledCount: number;
  stripKind: string;
  colours: Record<string, SegmentPowerColour>;
  brightness: number;
  limitMa: number | null;
}): PowerScenario | null {
  const { segments, ledCount, colours, stripKind, brightness, limitMa } = input;
  if (!Number.isInteger(ledCount) || ledCount < 0 || !Number.isInteger(brightness) || brightness < 0 || brightness > 255 ||
    !["ws281x", "sk6812-rgbw"].includes(stripKind) || validateDeclaredRanges(segments, ledCount).length) return null;
  const rows: SegmentPowerRow[] = [];
  for (const segment of segments) {
    const colour = colours[segment.id];
    const match = colour?.hex.match(/^#([0-9a-f]{6})$/i);
    if (!colour || !match || !Number.isInteger(colour.white) || colour.white < 0 || colour.white > 255) return null;
    const rgb = [0, 2, 4].map((offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16));
    const white = stripKind === "sk6812-rgbw" ? colour.white : 0;
    rows.push({ id: segment.id, label: segment.label, leds: segment.stop - segment.start,
      milliAmps: (segment.stop - segment.start) * 20 * (rgb.reduce((sum, value) => sum + value, white) / 255) * (brightness / 255) });
  }
  const totalMa = rows.reduce((sum, row) => sum + row.milliAmps, 0);
  const knownLimit = typeof limitMa === "number" && Number.isFinite(limitMa) && limitMa > 0 ? limitMa : null;
  return { rows, totalMa, limitMa: knownLimit, aboveLimit: knownLimit === null ? null : totalMa > knownLimit,
    uncoveredLeds: ledCount - rows.reduce((sum, row) => sum + row.leds, 0) };
}
