import { describe, expect, it } from "vitest";
import {
  buildProvisionWrite,
  parseWledProvision,
  validateProvisionDraft,
} from "../provision.ts";
import {
  defaultStripPreset,
  getStripPreset,
  listStripPresets,
  matchingStripPresetId,
  provisionApplyBodyFromPreset,
  provisionDraftFromPreset,
} from "./presets.ts";

const cfg = {
  hw: {
    led: {
      maxpwr: 850,
      total: 60,
      ins: [
        {
          start: 0,
          len: 60,
          pin: [16],
          type: 22,
          order: 0,
          rev: false,
          skip: 0,
        },
      ],
    },
  },
};

describe("strip preset catalog", () => {
  it("registers at least three named WS281x defaults", () => {
    const presets = listStripPresets();
    expect(presets.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(presets.map((entry) => entry.id));
    expect(ids.size).toBe(presets.length);
    for (const preset of presets) {
      expect(preset.ledType).toBe("ws281x");
      expect(preset.label).toMatch(/WS281x/);
      expect(preset.label).toContain(String(preset.length));
      expect(preset.label).toContain(String(preset.gpio));
      expect(preset.notes).toMatch(/documented default/i);
      expect(preset.notes).not.toMatch(/Hardware Done/i);
      expect(getStripPreset(preset.id)).toEqual(preset);
    }
    expect(defaultStripPreset()).toEqual(presets[0]);
  });

  it("maps each preset to the CONFIG-40 form draft and Apply payload", () => {
    const read = parseWledProvision(cfg, "WLED 0.15.4");
    expect(read.fingerprint.writable).toBe(true);

    for (const preset of listStripPresets()) {
      const draft = provisionDraftFromPreset(preset);
      expect(draft).toEqual({
        ledType: preset.ledType,
        length: preset.length,
        gpio: preset.gpio,
      });
      expect(validateProvisionDraft(draft)).toBeNull();
      expect(matchingStripPresetId(draft)).toBe(preset.id);

      const body = provisionApplyBodyFromPreset(preset);
      expect(body).toEqual({ provision: draft });

      const built = buildProvisionWrite(draft, cfg, read.fingerprint);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      expect(built.sent).toEqual(draft);
      const bus = (
        built.body as { hw: { led: { ins: Record<string, unknown>[] } } }
      ).hw.led.ins[0]!;
      expect(bus.len).toBe(preset.length);
      expect(bus.pin).toEqual([preset.gpio]);
    }
  });

  it("does not treat an overridden draft as still that preset", () => {
    const preset = defaultStripPreset();
    const draft = {
      ...provisionDraftFromPreset(preset),
      length: preset.length + 1,
    };
    expect(matchingStripPresetId(draft)).toBeNull();
    expect(validateProvisionDraft(draft)).toBeNull();
  });
});
