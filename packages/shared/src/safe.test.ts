import { describe, expect, it } from "vitest";
import {
  buildSafeWrite,
  parseWledCfg,
  safeFieldsMatch,
  safeRefuseReason,
  transitionUnitsFromMs,
} from "./safe.ts";

const cfg = {
  id: { name: "WLED" },
  def: { on: true, bri: 128, ps: 0 },
  light: { tr: { dur: 7 } },
  hw: { led: { maxpwr: 850 } },
};

describe("parseWledCfg", () => {
  it("fingerprints the six Safe settings fields from /json/cfg", () => {
    const read = parseWledCfg(cfg, "WLED 0.15.4", "fixture");
    expect(read.fingerprint.writable).toBe(true);
    expect(read.fingerprint.fields).toEqual([
      "displayName",
      "turnOnAtBoot",
      "bootBrightness",
      "bootPreset",
      "defaultTransition",
      "currentLimitMa",
    ]);
    expect(read.settings).toEqual({
      displayName: "WLED",
      turnOnAtBoot: true,
      bootBrightness: 128,
      bootPreset: 0,
      defaultTransition: 7,
      currentLimitMa: 850,
    });
    expect(read.caption).toMatch(/Not Hardware Done/);
    expect(transitionUnitsFromMs(700)).toBe(7);
  });

  it("refuses a config with none of the known paths", () => {
    const read = parseWledCfg({ vid: 1903252, rev: [1, 0] }, "WLED 0.8.4");
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/isn’t a shape we write/);
    const write = buildSafeWrite({ displayName: "Porch" }, read.fingerprint);
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.message).toMatch(/isn’t a shape we write/);
  });
});

describe("safe write", () => {
  it("builds only understood fields and matches a reread", () => {
    const read = parseWledCfg(cfg, "WLED 0.15.4");
    const built = buildSafeWrite(
      { displayName: "Porch rail", bootBrightness: 180, defaultTransition: 10 },
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body).toEqual({
      id: { name: "Porch rail" },
      def: { bri: 180 },
      light: { tr: { dur: 10 } },
    });
    const next = parseWledCfg(
      {
        ...cfg,
        id: { name: "Porch rail" },
        def: { ...cfg.def, bri: 180 },
        light: { tr: { dur: 10 } },
      },
      "WLED 0.15.4",
    );
    expect(safeFieldsMatch(built.sent, next.settings)).toBe(true);
  });

  it("does not write a field the fingerprint does not understand", () => {
    const partial = parseWledCfg({ id: { name: "WLED" } }, "WLED 0.11.0");
    expect(partial.fingerprint.fields).toEqual(["displayName"]);
    expect(
      safeRefuseReason({
        reachable: true,
        read: partial,
        draft: { currentLimitMa: 850 },
      }),
    ).toMatch(/global current limit/);
    const write = buildSafeWrite({ currentLimitMa: 850 }, partial.fingerprint);
    expect(write.ok).toBe(false);
  });
});
