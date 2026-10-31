import { describe, expect, it } from "vitest";
import {
  WLED_FW1906_NATIVE_TYPE,
  WLED_SK6812_RGBW_NATIVE_TYPE,
  WLED_WS281X_NATIVE_TYPE,
  buildProvisionOutputsWrite,
  buildProvisionWrite,
  colorOrderFromNative,
  nativeTypeLabel,
  parseWledProvision,
  provisionFieldsMatch,
  provisionRefuseReason,
  provisionSnapshotMatch,
  resolveProvisionMapping,
  resolveWs281xMapping,
  stripColorOrderCopy,
} from "./provision.ts";

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

describe("parseWledProvision", () => {
  it("reads WS281x length and GPIO from hw.led.ins", () => {
    const read = parseWledProvision(cfg, "WLED 0.15.4", "fixture");
    expect(read.fingerprint.writable).toBe(true);
    expect(read.fingerprint.mappingId).toBe("wled-0.15-ws281x-rgb-grb");
    expect(read.settings).toEqual({
      ledType: "ws281x",
      length: 60,
      gpio: 16,
      nativeType: WLED_WS281X_NATIVE_TYPE,
      nativeOrder: 0,
      colorOrder: "GRB",
    });
    expect(read.caption).toMatch(/Not Hardware Done/);
    expect(read.refuse).toBeNull();
    expect(parseWledProvision(cfg, "WLED 0.15.4", "sim").caption).toMatch(/software path only/i);
  });

  it("refuses a config with no ins list", () => {
    const read = parseWledProvision({ vid: 1903252, rev: [1, 0] }, "WLED 0.15.4");
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/isn’t a shape we write/);
  });

  it("reads every understood bus on a multi-output controller", () => {
    const read = parseWledProvision(
      {
        hw: {
          led: {
            ins: [
              { start: 0, len: 30, pin: [16], type: 22, order: 0 },
              { start: 30, len: 45, pin: [2], type: 22, order: 1 },
            ],
          },
        },
      },
      "0.15.4",
    );
    expect(read.fingerprint.writable).toBe(true);
    expect(read.refuse).toBeNull();
    expect(read.buses).toBe(2);
    expect(read.settings).toMatchObject({ ledType: "ws281x", length: 30, gpio: 16 });
    expect(read.outputs).toHaveLength(2);
    expect(read.outputs[1]).toMatchObject({
      index: 1,
      writable: true,
      settings: { length: 45, gpio: 2, colorOrder: "RGB" },
    });
  });

  it("refuses analog / network bus types closed", () => {
    const read = parseWledProvision(
      { hw: { led: { ins: [{ start: 0, len: 8, pin: [2], type: 41 }] } } },
      "0.15.4",
    );
    expect(read.refuse).toMatch(/not a strip we provision/);
    expect(read.fingerprint.writable).toBe(false);
  });

  it("refuses firmware that is not in the compatibility table", () => {
    const read = parseWledProvision(cfg, "WLED 0.8.4");
    expect(resolveWs281xMapping("WLED 0.8.4")).toBeNull();
    expect(resolveProvisionMapping("WLED 0.8.4", "sk6812-rgbw")).toBeNull();
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/compatibility table/);
  });

  it("reads SK6812 RGBW native type 30 on supported firmware", () => {
    const rgbw = {
      hw: {
        led: {
          ins: [{ start: 0, len: 60, pin: [16], type: 30, order: 0 }],
        },
      },
    };
    const read = parseWledProvision(rgbw, "WLED 0.15.4", "fixture");
    expect(read.fingerprint.writable).toBe(true);
    expect(read.fingerprint.mappingId).toBe("wled-0.15-sk6812-rgbw-grbw");
    expect(read.settings).toEqual({
      ledType: "sk6812-rgbw",
      length: 60,
      gpio: 16,
      nativeType: WLED_SK6812_RGBW_NATIVE_TYPE,
      nativeOrder: 0,
      colorOrder: "GRBW",
    });
    expect(read.refuse).toBeNull();
    expect(read.caption).toMatch(/Not Hardware Done/);
  });

  it("decodes a non-GRBW SK6812 order and does not leave it blank", () => {
    const rgbw = {
      hw: {
        led: {
          ins: [{ start: 0, len: 60, pin: [16], type: 30, order: 1 }],
        },
      },
    };
    const read = parseWledProvision(rgbw, "WLED 0.15.4", "fixture");
    expect(read.settings.colorOrder).toBe("RGBW");
    expect(read.settings.nativeOrder).toBe(1);
    expect(stripColorOrderCopy(read.settings)).toMatch(/RGBW/);
    expect(stripColorOrderCopy(read.settings)).toMatch(/not GRBW/);
  });

  it("names an unknown numeric order instead of going blank", () => {
    expect(colorOrderFromNative(7, "sk6812-rgbw")).toBe("WLED order 7");
    expect(
      stripColorOrderCopy({
        colorOrder: colorOrderFromNative(7, "sk6812-rgbw"),
        ledType: "sk6812-rgbw",
        afterSameTypeApply: true,
      }),
    ).toBe(
      "Colour order on this bus: WLED order 7. This is not GRBW — Apply kept the order already on the box.",
    );
    expect(
      stripColorOrderCopy({
        colorOrder: null,
        ledType: "sk6812-rgbw",
      }),
    ).toBe("Colour order on this bus was not in /json/cfg.");
  });
});

describe("firmware table and native identity", () => {
  it("covers every released 0.14.x, 0.15.x and 16.0.x tag", () => {
    for (const version of ["0.14.1", "0.14.4", "0.14.4-fix1", "0.15.1", "0.15.2", "0.15.5", "16.0.0"]) {
      expect(resolveWs281xMapping(`WLED ${version}`), version).not.toBeNull();
      expect(resolveProvisionMapping(version, "sk6812-rgbw"), version).not.toBeNull();
    }
    expect(resolveWs281xMapping("0.16.0")).toBeNull();
  });

  it("maps FW1906 only on firmware whose const.h defines type 28", () => {
    expect(resolveProvisionMapping("0.14.4", "fw1906")).toBeNull();
    for (const version of ["0.15.0", "0.15.1", "0.15.4", "16.0.1"]) {
      expect(resolveProvisionMapping(version, "fw1906")?.native, version).toEqual({ type: 28, order: 0 });
    }
  });

  it("decodes WLED COL_ORDER 4 as BGR and 5 as GBR", () => {
    expect(colorOrderFromNative(4, "ws281x")).toBe("BGR");
    expect(colorOrderFromNative(5, "ws281x")).toBe("GBR");
    expect(colorOrderFromNative(4, "sk6812-rgbw")).toBe("BGRW");
  });

  it("names unmapped native bus types instead of a bare number", () => {
    expect(nativeTypeLabel(32)).toBe("WLED type 32 (WS2805 RGB+CCT)");
    expect(nativeTypeLabel(77)).toBe("WLED type 77");
    expect(nativeTypeLabel(null)).toBeNull();
  });

  it("reads a FW1906 COB bus on 0.15.1 as writable", () => {
    const cob = { hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 28, order: 0 }] } } };
    const read = parseWledProvision(cob, "WLED 0.15.1");
    expect(read.refuse).toBeNull();
    expect(read.fingerprint.writable).toBe(true);
    expect(read.fingerprint.mappingId).toBe("wled-0.15-fw1906-rgbcct-grb");
    expect(read.settings).toMatchObject({ ledType: "fw1906", nativeType: WLED_FW1906_NATIVE_TYPE, colorOrder: "GRB" });
  });
});

describe("provision write", () => {
  it("patches only pin / len and preserves unknown bus fields", () => {
    const read = parseWledProvision(cfg, "WLED 0.15.4");
    const built = buildProvisionWrite(
      { ledType: "ws281x", length: 150, gpio: 2 },
      cfg,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ins = (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins;
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({
      start: 0,
      len: 150,
      pin: [2],
      type: 22,
      order: 0,
      rev: false,
      skip: 0,
    });
    expect(built.body).toEqual({ hw: { led: { ins } } });
    expect(Object.keys(built.body)).toEqual(["hw"]);
  });

  it("writes the WS281x mapping when the live type is unknown", () => {
    const raw = {
      hw: { led: { ins: [{ start: 0, len: 30, pin: [16], type: 99, extra: "keep" }] } },
    };
    const read = parseWledProvision(raw, "0.15.4");
    expect(read.settings.ledType).toBe("unknown");
    const built = buildProvisionWrite(
      { ledType: "ws281x", length: 30, gpio: 16 },
      raw,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bus = (
      built.body as { hw: { led: { ins: Record<string, unknown>[] } } }
    ).hw.led.ins[0]!;
    expect(bus.type).toBe(22);
    expect(bus.order).toBe(0);
    expect(bus.extra).toBe("keep");
  });

  it("does not write an unknown LED type", () => {
    const read = parseWledProvision(cfg, "0.15.4");
    const built = buildProvisionWrite(
      { ledType: "apa102" as "ws281x", length: 60, gpio: 16 },
      cfg,
      read.fingerprint,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.message).toMatch(/mapped strip driver|Unknown types/);
  });

  it("writes SK6812 RGBW type 30 / order 0 when converting from WS281x", () => {
    const raw = {
      hw: {
        led: {
          ins: [{ start: 0, len: 60, pin: [16], type: 22, order: 2, extra: "keep" }],
        },
      },
    };
    const read = parseWledProvision(raw, "WLED 0.15.4");
    const built = buildProvisionWrite(
      { ledType: "sk6812-rgbw", length: 80, gpio: 2 },
      raw,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bus = (
      built.body as { hw: { led: { ins: Record<string, unknown>[] } } }
    ).hw.led.ins[0]!;
    expect(bus.type).toBe(WLED_SK6812_RGBW_NATIVE_TYPE);
    expect(bus.order).toBe(0);
    expect(bus.len).toBe(80);
    expect(bus.pin).toEqual([2]);
    expect(bus.extra).toBe("keep");
    expect(built.sent.ledType).toBe("sk6812-rgbw");
    expect(built.orderPreserved).toBe(false);
  });

  it("writes FW1906 type 28 / order 0 when converting, and keeps order on same-type writes", () => {
    const raw = { hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 22, order: 1 }] } } };
    const built = buildProvisionWrite({ ledType: "fw1906", length: 60, gpio: 16 }, raw,
      parseWledProvision(raw, "0.15.1").fingerprint);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bus = (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins[0]!;
    expect(bus).toMatchObject({ type: WLED_FW1906_NATIVE_TYPE, order: 0 });
    const cob = { hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 28, order: 3 }] } } };
    const same = buildProvisionWrite({ ledType: "fw1906", length: 90, gpio: 16 }, cob,
      parseWledProvision(cob, "0.15.1").fingerprint);
    expect(same.ok && same.orderPreserved).toBe(true);
    if (!same.ok) return;
    expect((same.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins[0]).toMatchObject({ type: 28, order: 3, len: 90 });
  });

  it("refuses FW1906 on 0.14 firmware, which has no type 28", () => {
    const raw = { hw: { led: { ins: [{ start: 0, len: 60, pin: [16], type: 22, order: 0 }] } } };
    const built = buildProvisionWrite({ ledType: "fw1906", length: 60, gpio: 16 }, raw,
      parseWledProvision(raw, "0.14.4").fingerprint);
    expect(built.ok).toBe(false);
  });

  it("preserves SK6812 order on a same-type length write", () => {
    const raw = {
      hw: {
        led: {
          ins: [{ start: 0, len: 60, pin: [16], type: 30, order: 1, extra: "keep" }],
        },
      },
    };
    const read = parseWledProvision(raw, "0.15.4");
    expect(read.settings.ledType).toBe("sk6812-rgbw");
    const built = buildProvisionWrite(
      { ledType: "sk6812-rgbw", length: 90, gpio: 16 },
      raw,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bus = (
      built.body as { hw: { led: { ins: Record<string, unknown>[] } } }
    ).hw.led.ins[0]!;
    expect(bus.type).toBe(30);
    expect(bus.order).toBe(1);
    expect(bus.len).toBe(90);
    expect(bus.extra).toBe("keep");
    expect(built.orderPreserved).toBe(true);
    expect(read.settings.colorOrder).toBe("RGBW");
    expect(
      stripColorOrderCopy({
        colorOrder: read.settings.colorOrder,
        ledType: read.settings.ledType,
        afterSameTypeApply: built.orderPreserved,
      }),
    ).toMatch(/Apply kept the order already on the box/);
  });

  it("preserves SK6812 order on a same-type GPIO write", () => {
    const raw = {
      hw: {
        led: {
          ins: [{ start: 0, len: 60, pin: [16], type: 30, order: 3 }],
        },
      },
    };
    const read = parseWledProvision(raw, "0.15.4");
    const built = buildProvisionWrite(
      { ledType: "sk6812-rgbw", length: 60, gpio: 2 },
      raw,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const bus = (
      built.body as { hw: { led: { ins: Record<string, unknown>[] } } }
    ).hw.led.ins[0]!;
    expect(bus.type).toBe(30);
    expect(bus.order).toBe(3);
    expect(bus.pin).toEqual([2]);
    expect(bus.len).toBe(60);
    expect(built.orderPreserved).toBe(true);
    expect(read.settings.colorOrder).toBe("RBGW");
  });

  it("refuses SK6812 writes on firmware outside the table", () => {
    const raw = {
      hw: { led: { ins: [{ start: 0, len: 30, pin: [16], type: 30, order: 0 }] } },
    };
    const read = parseWledProvision(raw, "WLED 0.8.4");
    const built = buildProvisionWrite(
      { ledType: "sk6812-rgbw", length: 30, gpio: 16 },
      raw,
      read.fingerprint,
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.message).toMatch(/compatibility table/);
  });

  it("matches a reread and treats snapshot length as part of the contract", () => {
    const read = parseWledProvision(cfg, "0.15.4");
    const built = buildProvisionWrite(
      { ledType: "ws281x", length: 120, gpio: 4 },
      cfg,
      read.fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const next = parseWledProvision(
      {
        hw: {
          led: {
            ins: [{ start: 0, len: 120, pin: [4], type: 22, order: 0 }],
          },
        },
      },
      "0.15.4",
    );
    expect(provisionFieldsMatch(built.sent, next.settings)).toBe(true);
    expect(provisionSnapshotMatch(built.sent, 120)).toBe(true);
    expect(provisionSnapshotMatch(built.sent, 60)).toBe(false);
  });

  it("writes the first understood bus and clones the others", () => {
    const raw = {
      hw: {
        led: {
          ins: [
            { start: 0, len: 30, pin: [16], type: 22, order: 0, extra: "keep-a" },
            { start: 30, len: 40, pin: [2], type: 22, order: 3, extra: "keep-b" },
          ],
        },
      },
    };
    const built = buildProvisionWrite(
      { ledType: "ws281x", length: 80, gpio: 4 },
      raw,
      parseWledProvision(raw, "0.15.4").fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ins = (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins;
    expect(ins).toHaveLength(2);
    expect(ins[0]).toMatchObject({ len: 80, pin: [4], type: 22, extra: "keep-a", start: 0 });
    expect(ins[1]).toMatchObject({ len: 40, pin: [2], type: 22, order: 3, extra: "keep-b", start: 80 });
  });

  it("writes every understood bus from a fleet draft", () => {
    const raw = {
      hw: {
        led: {
          ins: [
            { start: 0, len: 30, pin: [16], type: 22, order: 0 },
            { start: 30, len: 40, pin: [2], type: 22, order: 1 },
          ],
        },
      },
    };
    const built = buildProvisionOutputsWrite(
      [
        { index: 0, ledType: "ws281x", length: 50, gpio: 16, colorOrder: "RGB" },
        { index: 1, ledType: "ws281x", length: 60, gpio: 2 },
      ],
      raw,
      parseWledProvision(raw, "0.15.4").fingerprint,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ins = (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins;
    expect(ins[0]).toMatchObject({ len: 50, pin: [16], order: 1, start: 0 });
    expect(ins[1]).toMatchObject({ len: 60, pin: [2], order: 1, start: 50 });
    expect(built.orderPreserved).toBe(false);
  });
});

describe("provisionRefuseReason", () => {
  it("keeps Preview distinct from Apply", () => {
    const read = parseWledProvision(cfg, "0.15.4");
    expect(
      provisionRefuseReason({
        reachable: true,
        read,
        busyKind: "preview",
        draft: { ledType: "ws281x", length: 60, gpio: 16 },
      }),
    ).toMatch(/Preview is not Apply/);
  });
});
