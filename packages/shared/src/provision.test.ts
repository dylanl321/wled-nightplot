import { describe, expect, it } from "vitest";
import {
  WLED_WS281X_NATIVE_TYPE,
  buildProvisionWrite,
  parseWledProvision,
  provisionFieldsMatch,
  provisionRefuseReason,
  provisionSnapshotMatch,
  resolveWs281xMapping,
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
    });
    expect(read.caption).toMatch(/Not Hardware Done/);
    expect(read.refuse).toBeNull();
  });

  it("refuses a config with no ins list", () => {
    const read = parseWledProvision({ vid: 1903252, rev: [1, 0] }, "WLED 0.15.4");
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/isn’t a shape we write/);
  });

  it("refuses more than one bus", () => {
    const read = parseWledProvision(
      {
        hw: {
          led: {
            ins: [
              { start: 0, len: 30, pin: [16], type: 22 },
              { start: 30, len: 30, pin: [2], type: 22 },
            ],
          },
        },
      },
      "0.15.4",
    );
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/more than one bus/);
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
    expect(read.fingerprint.writable).toBe(false);
    expect(read.refuse).toMatch(/compatibility table/);
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
    expect(built.message).toMatch(/WS281x/);
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
