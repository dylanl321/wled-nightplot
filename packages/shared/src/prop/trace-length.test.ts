import { describe, expect, it } from "vitest";
import { lightsOnLength, METRES_PER_FOOT, METRES_PER_INCH } from "./layout.ts";
import { parseTraceLength } from "./trace-length.ts";

describe("parseTraceLength", () => {
  it("reads the current unit, feet, metres, and a light count", () => {
    expect(parseTraceLength("6", "ft", 0.1)).toMatchObject({
      ok: true,
      value: { metres: 6 * METRES_PER_FOOT, lights: null },
    });
    expect(parseTraceLength("6", "m", 0.1)).toMatchObject({ ok: true, value: { metres: 6, lights: null } });
    expect(parseTraceLength("6'", "m", 0.1)).toMatchObject({ ok: true, value: { metres: 6 * METRES_PER_FOOT } });
    expect(parseTraceLength("6ft", "m", 0.1)).toMatchObject({ ok: true, value: { metres: 6 * METRES_PER_FOOT } });
    expect(parseTraceLength("6' 4\"", "m", 0.1)).toMatchObject({
      ok: true,
      value: { metres: 6 * METRES_PER_FOOT + 4 * METRES_PER_INCH },
    });
    expect(parseTraceLength("6'4", "m", 0.1)).toMatchObject({
      ok: true,
      value: { metres: 6 * METRES_PER_FOOT + 4 * METRES_PER_INCH },
    });
    expect(parseTraceLength('76"', "m", 0.1)).toMatchObject({ ok: true, value: { metres: 76 * METRES_PER_INCH } });
    expect(parseTraceLength("1.5m", "ft", 0.1)).toMatchObject({ ok: true, value: { metres: 1.5 } });
    expect(parseTraceLength("150cm", "ft", 0.1)).toMatchObject({ ok: true, value: { metres: 1.5 } });
    expect(parseTraceLength("1500mm", "ft", 0.1)).toMatchObject({ ok: true, value: { metres: 1.5 } });
    const counted = parseTraceLength("24L", "m", 0.1);
    expect(counted.ok).toBe(true);
    if (counted.ok) {
      expect(counted.value.lights).toBe(24);
      expect(lightsOnLength(counted.value.metres, 0.1)).toBe(24);
    }
    const hash = parseTraceLength("#24", "ft", 0.1);
    expect(hash.ok).toBe(true);
    if (hash.ok) {
      expect(hash.value.lights).toBe(24);
      expect(hash.value.metres).toBeCloseTo(2.4, 6);
    }
  });

  it("rejects garbage and does not invent a length", () => {
    const bad = parseTraceLength("about yea long", "m", 0.1);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.length).toBeGreaterThan(0);
    expect(parseTraceLength("0", "m", 0.1).ok).toBe(false);
  });
});
