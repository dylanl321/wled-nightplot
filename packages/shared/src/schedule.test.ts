import { describe, expect, it } from "vitest";
import { LOOK_OFF_SLOT } from "./look.ts";
import {
  WLED_SUNSET_HOUR,
  WLED_SUNSET_SLOT,
  buildScheduleTimers,
  buildScheduleWrite,
  parseWledNtp,
  parseWledTimers,
  scheduleMatches,
  validateSchedule,
  type NightlySchedule,
} from "./schedule.ts";

const schedule: NightlySchedule = {
  enabled: true,
  on: { kind: "sunset", offsetMinutes: -10 },
  off: { hour: 23, minute: 0 },
  run: { kind: "playlist", playlistId: "playlist-nightly" },
  ntp: { host: "1.wled.pool.ntp.org", tz: 8, utcOffsetSecs: 0, latitude: 42.3, longitude: -83.7 },
  weekdays: 127,
};

describe("buildScheduleTimers", () => {
  it("puts sunset on slot 8 and the off time on slot 1, never hour 255 in 0–7", () => {
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

  it("puts a clock-time on in slot 0", () => {
    const timers = buildScheduleTimers({ ...schedule, on: { kind: "time", hour: 17, minute: 30 } }, 3);
    expect(timers[0]).toMatchObject({ enabled: true, hour: 17, minute: 30, macro: 3 });
    expect(timers[WLED_SUNSET_SLOT]?.enabled).toBe(false);
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
