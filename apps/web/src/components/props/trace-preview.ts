import {
  countLayout,
  evenAlongM,
  formatLength,
  formatPurchaseLength,
  layoutStripLengthM,
  layoutWireLengthM,
  lightsOnLength,
  pointOnRun,
  type MergeNotice,
  type PropLayout,
} from "@nightplot/shared";
function runBadge(stringIndex: number, order: number): string {
  const letter = stringIndex >= 0 && stringIndex < 26 ? String.fromCharCode(65 + stringIndex) : String(stringIndex + 1);
  return `${letter}${order}`;
}

export type PreviewKind = "lit" | "wire";

/** What the rubber band says. `lights` is `lightsOnLength` for a lit run, else 0. */
export type RunPreview = {
  valid: boolean;
  lengthM: number;
  lights: number;
  lengthText: string;
  countText: string;
  dots: { x: number; y: number }[];
};

/**
 * The run the pointer would add. Dots are the same stations a committed run
 * draws (`evenAlongM` of `lightsOnLength`), so the preview count is the count
 * the sidebar will show.
 */
export function previewRun(input: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pitchM: number;
  kind: PreviewKind;
  units: PropLayout["units"];
}): RunPreview {
  const lengthM = Math.hypot(input.to.x - input.from.x, input.to.y - input.from.y);
  const valid = lengthM > 1e-4;
  const lights = valid && input.kind === "lit" ? lightsOnLength(lengthM, input.pitchM) : 0;
  const lengthText = input.units === "m" ? `${formatLength(lengthM, "m")} m` : formatLength(lengthM, "ft");
  const countText = input.kind === "wire" ? "dark · wire only" : `${lights} ${lights === 1 ? "light" : "lights"}`;
  const dots = !valid || input.kind === "wire"
    ? []
    : evenAlongM(lengthM, lights).map((along) => pointOnRun(input.from, input.to, along));
  return { valid, lengthM, lights, lengthText, countText, dots };
}

/** Header totals as they will read after this run is placed. Invalid runs add nothing. */
export function previewTotals(layout: PropLayout, preview: RunPreview, kind: PreviewKind): string {
  const add = preview.valid ? preview.lengthM : 0;
  const lights = countLayout(layout).total + (kind === "lit" ? preview.lights : 0);
  const strip = layoutStripLengthM(layout) + (kind === "lit" ? add : 0);
  const wire = layoutWireLengthM(layout) + add;
  return `${lights} lights · ${formatPurchaseLength(strip, layout.units)} of strip · ${formatPurchaseLength(wire, layout.units)} of wire`;
}

export function mergeToast(notice: MergeNotice): string {
  const left = runBadge(notice.stringIndex, notice.firstOrder);
  const right = runBadge(notice.stringIndex, notice.secondOrder);
  return notice.lit ? `Merged ${left}+${right} — now lit` : `Merged ${left}+${right} — dark`;
}
