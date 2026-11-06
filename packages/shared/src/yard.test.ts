import { describe, expect, it } from "vitest";
import { formatLedmapJson, ledmapDigest } from "./prop/wireframe.ts";
import type { Light } from "./lights.ts";
import { buildManagedPresets, lookPushDigest, type LastLookPush, type Look } from "./look.ts";
import type { ProvisionRead } from "./provision.ts";
import {
  buildYardCheckRow,
  compareFirmware,
  compareLit,
  compareLooks,
  compareOutputs,
  compareLedmap,
  compareSchedule,
  compareSync,
  yardHasDrift,
  yardPushPlan,
} from "./yard.ts";

const look: Look = {
  id: "look-warm",
  name: "Warm white",
  slot: 1,
  style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" },
  overrides: [],
};

const light: Light = {
  id: "porch",
  name: "Porch",
  controllerKind: "wled",
  stripKind: "ws281x",
  hostname: "192.168.1.40",
  port: 80,
  hostKey: "192.168.1.40:80",
  mac: "aa:bb:cc:dd:ee:ff",
  firmware: "WLED 0.15.4",
  ledCount: 60,
  rgbw: false,
  reachability: "online",
  lastSeenAt: "2026-10-31T12:00:00.000Z",
  on: true,
  brightness: 128,
  enrolledAt: "2026-10-01T00:00:00.000Z",
  ledProductId: null,
  outputs: [{
    id: "porch:out:0",
    index: 0,
    start: 0,
    ledCount: 60,
    stripKind: "ws281x",
    gpio: 16,
    nativeType: 22,
    nativeOrder: 0,
    colorOrder: "GRB",
  }],
};

const lastPush: LastLookPush = {
  at: "2026-10-31T11:00:00.000Z",
  includeSchedule: true,
  udp: { group: 2, role: "leader" },
  digest: "old",
};

function provision(length = 60): ProvisionRead {
  return {
    settings: { ledType: "ws281x", length, gpio: 16, nativeType: 22, nativeOrder: 0, colorOrder: "GRB" },
    outputs: [{
      index: 0,
      start: 0,
      settings: { ledType: "ws281x", length, gpio: 16, nativeType: 22, nativeOrder: 0, colorOrder: "GRB" },
      refuse: null,
      writable: true,
    }],
    fingerprint: { firmware: "WLED 0.15.4", source: "cfg", writable: true, mappingId: "x", fields: ["ledType", "length", "gpio"] },
    caption: "",
    refuse: null,
    buses: 1,
  };
}

describe("Yard check compares", () => {
  it("does not treat an unread firmware or bus list as a match", () => {
    expect(compareFirmware("WLED 0.15.4", null, false).status).toBe("unknown");
    expect(compareFirmware("WLED 0.15.4", "WLED 0.15.1", true).status).toBe("mismatch");
    expect(compareOutputs({
      light,
      provision: null,
      snapshotLedCount: null,
      reachable: true,
    }).status).toBe("unknown");
    expect(compareOutputs({
      light,
      provision: provision(80),
      snapshotLedCount: 80,
      reachable: true,
    }).status).toBe("mismatch");
    expect(compareOutputs({
      light,
      provision: provision(60),
      snapshotLedCount: 60,
      reachable: true,
    }).status).toBe("match");
  });

  it("treats a Light that was never pushed as not-pushed, not empty-match", () => {
    const looks = compareLooks({
      lastPush: null,
      currentDigest: "now",
      expected: { "1": { n: "Warm white" } },
      slots: [1, 250],
      readRaw: JSON.stringify({ "1": { n: "Warm white" } }),
      reachable: true,
    });
    expect(looks.status).toBe("not-pushed");
    expect(looks.detail).toMatch(/not a match/);
    expect(compareSchedule({
      lastPush: null,
      schedule: {
        enabled: true,
        on: { kind: "time", hour: 17, minute: 0 },
        off: { hour: 23, minute: 0 },
        run: { kind: "look", lookId: "look-warm" },
        ntp: { host: "1.wled.pool.ntp.org", tz: 8, utcOffsetSecs: 0, latitude: 42, longitude: -83 },
        weekdays: 127,
      },
      looks: [look],
      playlists: [],
      cfg: {},
      reachable: true,
    }).status).toBe("not-pushed");
    expect(compareSync({ lastPush: null, cfg: {}, reachable: true }).status).toBe("not-pushed");
  });

  it("reports unknown when presets or cfg do not reread after a last push", () => {
    expect(compareLooks({
      lastPush,
      currentDigest: lastPush.digest,
      expected: { "1": { n: "Warm white" } },
      slots: [1],
      readRaw: null,
      reachable: true,
    }).status).toBe("unknown");
    expect(compareSchedule({
      lastPush,
      schedule: {
        enabled: true,
        on: { kind: "time", hour: 17, minute: 0 },
        off: { hour: 23, minute: 0 },
        run: { kind: "look", lookId: "look-warm" },
        ntp: { host: "1.wled.pool.ntp.org", tz: 8, utcOffsetSecs: 0, latitude: 42, longitude: -83 },
        weekdays: 127,
      },
      looks: [look],
      playlists: [],
      cfg: null,
      reachable: true,
    }).status).toBe("unknown");
  });

  it("keeps unreachable power unknown, never the last colour", () => {
    expect(compareLit({ reachable: false, on: true, preset: 1 })).toMatchObject({
      status: "unknown",
      on: null,
    });
    expect(compareLit({ reachable: true, on: null, preset: null }).status).toBe("unknown");
    expect(compareLit({ reachable: true, on: false, preset: null }).status).toBe("off");
  });

  it("builds a row that can fix Looks drift only when the Light answered", () => {
    const expected = { "0": {}, "1": { n: "Warm white", on: true, bri: 180, mainseg: 0, seg: [] }, "250": { n: "Off", on: false } };
    const row = buildYardCheckRow({
      light: { ...light, lastLookPush: lastPush },
      live: {
        name: "Porch",
        firmware: "WLED 0.15.4",
        mac: "aa:bb:cc:dd:ee:ff",
        ledCount: 60,
        rgbw: false,
        on: true,
        brightness: 128,
        segmentColor: "#ffa000",
        segments: [{ start: 0, stop: 60 }],
      },
      elements: [],
      props: [{ id: "window", lightId: "porch", label: "Front window", kind: "window", elementIds: ["el"] }],
      looks: [look],
      playlists: [],
      schedule: null,
      provision: provision(60),
      presetsRaw: JSON.stringify({ "1": { n: "Different" } }),
      cfg: { if: { ntp: { en: true, tz: 8, offset: 0, lt: 42, ln: -83 }, sync: { send: { en: true, dir: true, grp: 2 }, recv: { grp: 0 } } } },
    });
    expect(row.looks.status).toBe("mismatch");
    expect(row.canFix).toBe(true);
    expect(row.canBlink).toBe(true);
    expect(row.props[0]?.label).toBe("Front window");
    expect(yardHasDrift(row)).toBe(true);
    const matched = buildYardCheckRow({
      light: { ...light, lastLookPush: { ...lastPush, includeSchedule: false, udp: undefined } },
      live: {
        name: "Porch",
        firmware: "WLED 0.15.4",
        mac: "aa:bb:cc:dd:ee:ff",
        ledCount: 60,
        rgbw: false,
        on: true,
        brightness: 128,
        segmentColor: "#ffa000",
        segments: [{ start: 0, stop: 60 }],
      },
      elements: [],
      props: [],
      looks: [look],
      playlists: [],
      schedule: null,
      provision: provision(60),
      presetsRaw: JSON.stringify(buildManagedPresets({
        looks: [look],
        playlists: [],
        targets: [{ start: 0, stop: 60, prop: null }],
        rgbw: false,
      })),
      cfg: {},
    });
    expect(matched.looks.status).toBe("match");
    expect(matched.canFix).toBe(false);
  });

  describe("compareLedmap compares every map file", () => {
    const wire = (n: number) => Array.from({ length: n }, (_, index) => index);
    const file = (slot: number, map: number[]) => ({ slot, map, digest: ledmapDigest(map) });
    const base = wire(6);
    const up = [5, 4, 3, 2, 1, 0];
    const out = [2, 3, 0, 1, 4, 5];
    const expected = [file(0, base), file(1, up), file(2, out)];
    const reads = (list: Record<number, number[] | null | undefined>) =>
      Object.fromEntries(Object.entries(list).map(([slot, map]) => [slot, map ? formatLedmapJson(map) : map]));
    const check = (over: Partial<Parameters<typeof compareLedmap>[0]> = {}) =>
      compareLedmap({ expected, ledCount: 6, reads: reads({ 0: base, 1: up, 2: out }), reachable: true, ...over });

    it("matches only when every file matches", () => {
      expect(check().status).toBe("match");
      expect(check().detail).toMatch(/All 3 light maps \(ledmap\.json, ledmap1\.json, ledmap2\.json\)/);
    });

    it("reports a mismatch in a non-zero slot even when ledmap.json matches", () => {
      const result = check({ reads: reads({ 0: base, 1: up, 2: up }) });
      expect(result.status).toBe("mismatch");
      expect(result.detail).toMatch(/ledmap2\.json differs/);
      expect(result.detail).not.toMatch(/ledmap1\.json/);
    });

    it("says a file that is not on the controller is a mismatch", () => {
      const result = check({ reads: reads({ 0: base, 1: up, 2: null }) });
      expect(result.status).toBe("mismatch");
      expect(result.detail).toMatch(/ledmap2\.json is not on the controller/);
    });

    it("never treats a file that did not read, or is not a map, as a match", () => {
      expect(check({ reads: reads({ 0: base, 1: up }) }).status).toBe("unknown");
      expect(check({ reads: { 0: formatLedmapJson(base), 1: formatLedmapJson(up), 2: "not json" } }).status).toBe("unknown");
      expect(check({ reachable: false }).status).toBe("unknown");
      expect(check({ expected: null, refused: "A Prop does not fit." }).detail).toMatch(/does not fit/);
    });

    it("a mismatch beats an unread file", () => {
      expect(check({ reads: reads({ 0: out, 1: up }) }).status).toBe("mismatch");
    });

    it("says when the controller still holds what the last push wrote", () => {
      const result = check({
        reads: reads({ 0: base, 1: up, 2: up }),
        recorded: [{ slot: 2, digest: ledmapDigest(up), at: "x" }],
      });
      expect(result.detail).toMatch(/ledmap2\.json is what the last push wrote, but the drawing or the Looks have changed/);
    });

    it("gives a clear reason for a Light pushed before motion maps (single legacy record)", () => {
      const result = check({
        reads: reads({ 0: base, 1: null, 2: null }),
        recorded: { digest: ledmapDigest(base), at: "x" },
      });
      expect(result.status).toBe("mismatch");
      expect(result.detail).toMatch(/ledmap1\.json, ledmap2\.json are not on the controller.*record lists only ledmap\.json.*before motion maps/);
    });

    describe("with no map needed", () => {
      const none = { expected: [] as never[] };
      const rec = [{ slot: 0, digest: "d", at: "x" }];

      it("flags a leftover bent ledmap.json as a mismatch", () => {
        const result = check({ ...none, reads: reads({ 0: up }) });
        expect(result.status).toBe("mismatch");
        expect(result.detail).toMatch(/bends the wire order/);
      });

      it("matches a leftover straight ledmap.json", () => {
        expect(check({ ...none, reads: reads({ 0: base }) }).status).toBe("match");
      });

      it("matches a 404, because the controller holds no map", () => {
        expect(check({ ...none, reads: reads({ 0: null }) }).status).toBe("match");
        expect(check({ ...none, reads: reads({ 0: null }), recorded: rec }).status).toBe("match");
      });

      it("is unknown, never a match, when WLED did not answer", () => {
        expect(check({ ...none, reachable: false, reads: {} }).status).toBe("unknown");
        expect(check({ ...none, reachable: false, reads: {}, recorded: rec }).status).toBe("unknown");
      });

      it("is unknown, never a match, when ledmap.json did not read, with or without a record", () => {
        expect(check({ ...none, reads: {} }).status).toBe("unknown");
        expect(check({ ...none, reads: {} }).detail).toMatch(/leftover map cannot be ruled out/);
        const recorded = check({ ...none, reads: {}, recorded: rec });
        expect(recorded.status).toBe("unknown");
        expect(recorded.detail).toMatch(/a push left ledmap\.json here/);
      });

      it("is unknown when ledmap.json is not a map", () => {
        expect(check({ ...none, reads: { 0: "nope" } }).status).toBe("unknown");
      });
    });
  });

  it("plans a fix that writes the current Schedule only when it is enabled", () => {
    expect(yardPushPlan({ lastPush, scheduleEnabled: true })).toEqual({
      includeSchedule: true,
      udp: { group: 2, role: "leader" },
    });
    expect(yardPushPlan({ lastPush: null, scheduleEnabled: true }).includeSchedule).toBe(true);
    expect(yardPushPlan({ lastPush, scheduleEnabled: false }).includeSchedule).toBe(false);
    expect(lookPushDigest({
      looks: [look],
      playlists: [],
      schedule: null,
      includeSchedule: false,
      udp: null,
    })).toBe(lookPushDigest({
      looks: [look],
      playlists: [],
      schedule: null,
      includeSchedule: false,
      udp: null,
    }));
  });
});
