import { lightsOnLength, METRES_PER_FOOT, METRES_PER_INCH, type LayoutUnits } from "./layout.ts";

export type TraceLength = {
  metres: number;
  /** Set when the text was a light count (`24L`, `#24`). */
  lights: number | null;
};

export type TraceLengthResult =
  | { ok: true; value: TraceLength }
  | { ok: false; error: string };

/**
 * A length typed while tracing.
 * A bare number uses the current unit. A suffix overrides it.
 * `24L` and `#24` are that many spaces, so `lightsOnLength` returns that count.
 */
export function parseTraceLength(text: string, units: LayoutUnits, pitchM: number): TraceLengthResult {
  const raw = text.trim().replace(/[′’]/g, "'").replace(/[″“”]/g, '"').replace(/\s+/g, " ");
  if (!raw) return { ok: false, error: "Type a length." };
  const lights = /^(?:#\s*(\d+)|(\d+)\s*l)$/i.exec(raw);
  if (lights) {
    const count = Number(lights[1] ?? lights[2]);
    if (!(count > 0) || !Number.isInteger(count)) return { ok: false, error: "That light count is not a whole number." };
    if (!(pitchM > 0)) return { ok: false, error: "Set a spacing before counting lights." };
    const metres = count * pitchM;
    if (lightsOnLength(metres, pitchM) !== count) return { ok: false, error: "That count does not land on the spacing." };
    return { ok: true, value: { metres, lights: count } };
  }
  const metres = readMetres(raw, units);
  if (metres == null) return { ok: false, error: "Could not read that length." };
  if (!(metres > 0)) return { ok: false, error: "Length has to be more than zero." };
  return { ok: true, value: { metres, lights: null } };
}

function readMetres(raw: string, units: LayoutUnits): number | null {
  const mm = /^(\d+(?:\.\d+)?)\s*mm$/i.exec(raw);
  if (mm) return Number(mm[1]) / 1000;
  const cm = /^(\d+(?:\.\d+)?)\s*cm$/i.exec(raw);
  if (cm) return Number(cm[1]) / 100;
  const metres = /^(\d+(?:\.\d+)?)\s*m$/i.exec(raw);
  if (metres) return Number(metres[1]);
  const inches = /^(\d+(?:\.\d+)?)\s*"$/.exec(raw);
  if (inches) return Number(inches[1]) * METRES_PER_INCH;
  const feetWord = /^(\d+(?:\.\d+)?)\s*ft$/i.exec(raw);
  if (feetWord) return Number(feetWord[1]) * METRES_PER_FOOT;
  const feetInches = /^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/.exec(raw);
  if (feetInches) {
    const feet = Number(feetInches[1]);
    const inch = feetInches[2] == null || feetInches[2] === "" ? 0 : Number(feetInches[2]);
    if (!Number.isFinite(inch) || inch < 0) return null;
    return feet * METRES_PER_FOOT + inch * METRES_PER_INCH;
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return units === "ft" ? n * METRES_PER_FOOT : n;
  }
  return null;
}
