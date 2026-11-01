import { describe, expect, it } from "vitest";
import { LOOK_OFF_SLOT } from "./look.ts";
import {
  WLED_SUNRISE_SLOT,
  WLED_SUNSET_HOUR,
  WLED_SUNSET_HOUR_V16,
  WLED_SUNSET_SLOT,
  buildScheduleTimers,
  buildScheduleWrite,
  parseWledNtp,
  parseWledTimers,
  scheduleMatches,
  timersMatch,
  validateSchedule,
  wledTimerDialect,
  type NightlySchedule,
  type WledTimer,
} from "./schedule.ts";

/**
 * WLED 0.15.1 `deserializeConfig` timers loop (wled00/cfg.cpp): walk `ins`
 * in order, and jump the first hour-255 entry in slots 0–7 to slot 8.
 */
function wled015Slots(ins: { hour: number; min: number; macro: number; en: boolean | number }[]) {
  const slots = Array.from({ length: 10 }, () => ({ hour: 0, min: 0, macro: 0, en: false as boolean | number }));
  let it = 0;
  for (const row of ins) {
    if (it > 9) break;
    if (it < 8 && row.hour === 255) it = 8;
    slots[it] = row;
    it += 1;
  }
  return slots;
}

/** WLED 0.15.1 `serializeConfig`: skip all-zero timers, `en` as 1 / 0. */
function wled015Saved(slots: { hour: number; min: number; macro: number; en: boolean | number; dow?: number }[]) {
  return slots
    .filter((row) => !(row.macro === 0 && row.hour === 0 && row.min === 0))
    .map((row) => ({ ...row, en: row.en ? 1 : 0, dow: row.dow ?? 127 }));
}

const schedule: NightlySchedule = {
  enabled: true,
  on: { kind: "sunset", offsetMinutes: -10 },
  off: { hour: 23, minute: 0 },
  run: { kind: "playlist", playlistId: "playlist-nightly" },
  ntp: { host: "1.wled.pool.ntp.org", tz: 8, utcOffsetSecs: 0, latitude: 42.3, longitude: -83.7 },
  weekdays: 127,
};

describe("buildScheduleTimers", () => {
  it("puts sunset on slot 9 and the off time on slot 1, never hour 255 in 0–7", () => {
    const timers = buildScheduleTimers(schedule, 16);
    expect(timers).toHaveLength(10);
    expect(timers[WLED_SUNSET_SLOT]).toMatchObject({
      enabled: true,
      hour: WLED_SUNSET_HOUR,
      minute: -10,
      macro: 16,
    });
    expect(timers[1]).toMatchObject({ enabled: true, hour: 23, minute: 0, macro: LOOK_OFF_SLOT });
    expect(timers.slice(0, 8).every((row) => row.hour !== WLED_SUNSET_HOUR)).toBe(true);
    expect(timers[0]?.enabled).toBe(false);
  });

  it("keeps sunrise (slot 8) disabled with no preset, so it cannot fire", () => {
    expect(WLED_SUNRISE_SLOT).toBe(8);
    expect(WLED_SUNSET_SLOT).toBe(9);
    for (const on of [schedule.on, { kind: "time" as const, hour: 17, minute: 30 }]) {
      const timers = buildScheduleTimers({ ...schedule, on }, 16);
      expect(timers[WLED_SUNRISE_SLOT]).toMatchObject({ enabled: false, hour: WLED_SUNSET_HOUR, macro: 0 });
    }
  });

  it("puts a clock-time on in slot 0", () => {
    const timers = buildScheduleTimers({ ...schedule, on: { kind: "time", hour: 17, minute: 30 } }, 3);
    expect(timers[0]).toMatchObject({ enabled: true, hour: 17, minute: 30, macro: 3 });
    expect(timers[WLED_SUNSET_SLOT]).toMatchObject({ enabled: false, macro: 0 });
  });

  it("lands sunset on WLED 0.15.1's slot 9 on write and again after a reboot reread", () => {
    const ins = (buildScheduleWrite(schedule, 16).body as {
      timers: { ins: { hour: number; min: number; macro: number; en: boolean }[] };
    }).timers.ins;
    const written = wled015Slots(ins);
    expect(written[9]).toMatchObject({ hour: 255, min: -10, macro: 16, en: true });
    expect(written[8]).toMatchObject({ hour: 255, macro: 0, en: false });
    // On boot WLED reads its own saved cfg.json, which has the empties left out.
    const rebooted = wled015Slots(wled015Saved(written));
    expect(rebooted[9]).toMatchObject({ hour: 255, min: -10, macro: 16 });
    expect(rebooted[8]).toMatchObject({ macro: 0 });
  });

  it("uses hour 254 for sunset on WLED 16.0.x", () => {
    expect(wledTimerDialect("0.15.1")).toBe("slots");
    expect(wledTimerDialect("0.14.4")).toBe("slots");
    expect(wledTimerDialect(null)).toBe("slots");
    expect(wledTimerDialect("16.0.1")).toBe("hours");
    const timers = buildScheduleTimers(schedule, 16, "hours");
    const sun = timers.filter((row) => row.hour >= WLED_SUNSET_HOUR_V16);
    expect(sun).toEqual([expect.objectContaining({ enabled: true, hour: WLED_SUNSET_HOUR_V16, minute: -10, macro: 16 })]);
  });
});

describe("buildScheduleWrite / parse / match", () => {
  it("round-trips NTP and timers from a WLED-shaped cfg", () => {
    const planned = buildScheduleWrite(schedule, 16);
    expect(planned.body).toMatchObject({
      if: { ntp: { en: true, tz: 8, lt: 42.3, ln: -83.7 } },
    });
    const ins = (planned.body as { timers: { ins: { hour: number }[] } }).timers.ins;
    expect(ins[WLED_SUNSET_SLOT]?.hour).toBe(WLED_SUNSET_HOUR);
    const cfg = planned.body;
    expect(parseWledNtp(cfg)).toMatchObject({ enabled: true, tz: 8, latitude: 42.3, longitude: -83.7 });
    expect(parseWledTimers(cfg)?.[1]).toMatchObject({ hour: 23, macro: LOOK_OFF_SLOT });
    expect(scheduleMatches(planned.expectedNtp, planned.expectedTimers, cfg)).toBe(true);
  });

  it("matches WLED 0.15.1's saved readback, which drops empty timers and reports en as 1 / 0", () => {
    const planned = buildScheduleWrite(schedule, 16);
    const ins = (planned.body as {
      timers: { ins: { hour: number; min: number; macro: number; en: boolean; dow: number }[] };
    }).timers.ins;
    const readback = { ...planned.body, timers: { ins: wled015Saved(wled015Slots(ins)) } };
    expect(readback.timers.ins).toHaveLength(3);
    expect(scheduleMatches(planned.expectedNtp, planned.expectedTimers, readback)).toBe(true);
  });

  it("flags a sunset left on the sunrise slot by an older push", () => {
    const planned = buildScheduleWrite(schedule, 16);
    const stale: WledTimer[] = [
      { enabled: true, hour: 23, minute: 0, macro: LOOK_OFF_SLOT, weekdays: 127 },
      { enabled: true, hour: 255, minute: -10, macro: 16, weekdays: 127 },
      { enabled: false, hour: 255, minute: 0, macro: 0, weekdays: 127 },
    ];
    expect(timersMatch(planned.expectedTimers, stale)).toBe(false);
  });

  it("does not treat a missing cfg as a match", () => {
    const planned = buildScheduleWrite(schedule, 16);
    expect(scheduleMatches(planned.expectedNtp, planned.expectedTimers, null)).toBeNull();
    expect(scheduleMatches(planned.expectedNtp, planned.expectedTimers, { if: { ntp: { en: true } } })).toBeNull();
  });
});

describe("validateSchedule", () => {
  it("refuses polar sunset and a 0,0 location only when the Schedule is on", () => {
    expect(validateSchedule(schedule, [], [{ id: "playlist-nightly" }])).toBeNull();
    expect(
      validateSchedule({ ...schedule, enabled: false, ntp: { ...schedule.ntp, latitude: 0, longitude: 0 } }, [], [{ id: "playlist-nightly" }]),
    ).toBeNull();
    expect(
      validateSchedule({ ...schedule, ntp: { ...schedule.ntp, latitude: 70 } }, [], [{ id: "playlist-nightly" }]),
    ).toMatch(/polar/);
    expect(
      validateSchedule({ ...schedule, ntp: { ...schedule.ntp, latitude: 0, longitude: 0 } }, [], [{ id: "playlist-nightly" }]),
    ).toMatch(/latitude and longitude/);
  });

  it("refuses a run target that is not in the library", () => {
    expect(validateSchedule(schedule, [], [])).toMatch(/playlist that is not in the library/);
  });
});
