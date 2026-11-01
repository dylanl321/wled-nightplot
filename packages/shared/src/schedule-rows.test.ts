import { describe, expect, it } from "vitest";
import { LOOK_OFF_SLOT } from "./look.ts";
import { WLED_SUNRISE_SLOT, WLED_SUNSET_SLOT, buildScheduleTimers, type NightlySchedule } from "./schedule.ts";
import { dayOfYear, localSunsetMinutes, planSchedule, scheduleRows, wledUtcOffsetMinutes, type ScheduleRow } from "./schedule-rows.ts";

const ntp = { host: "", tz: 4, utcOffsetSecs: 0, latitude: 39.96, longitude: -83.0 };
const base: NightlySchedule = {
  enabled: true,
  on: { kind: "sunset", offsetMinutes: 0 },
  off: { hour: 23, minute: 0 },
  run: { kind: "playlist", playlistId: "nightly" },
  ntp,
  weekdays: 127,
};
const slots = {
  looks: [{ id: "warm", slot: 1, name: "Warm white" }],
  playlists: [{ id: "nightly", slot: 16, name: "Nightly" }, { id: "xmas", slot: 17, name: "Christmas" }],
};
const nightly: ScheduleRow = { id: "n", run: { kind: "playlist", playlistId: "nightly" }, dates: null, weekdays: 127,
  on: { kind: "sunset", offsetMinutes: 0 }, off: { kind: "time", hour: 23, minute: 0 } };
const christmas: ScheduleRow = { id: "x", run: { kind: "playlist", playlistId: "xmas" },
  dates: { from: { month: 11, day: 25 }, to: { month: 1, day: 6 } }, weekdays: 127,
  on: { kind: "sunset", offsetMinutes: 0 }, off: { kind: "time", hour: 23, minute: 0 } };

describe("WLED time zones", () => {
  it("US Eastern is UTC−4 in July and UTC−5 in December, as WLED's rules say", () => {
    expect(wledUtcOffsetMinutes(ntp, Date.UTC(2026, 6, 1))).toBe(-240);
    expect(wledUtcOffsetMinutes(ntp, Date.UTC(2026, 11, 1))).toBe(-300);
  });

  it("works out a local sunset close to the published one (Columbus, Dec 21: 5:08 PM)", () => {
    const minutes = localSunsetMinutes(ntp, 2026, dayOfYear({ month: 12, day: 21 }))!;
    expect(Math.abs(minutes - (17 * 60 + 8))).toBeLessThanOrEqual(3);
  });
});

describe("planSchedule", () => {
  it("an older Schedule plans the same timers it always sent", () => {
    const plan = planSchedule(base, slots, "slots", 2026);
    const used = (list: typeof plan.timers) => list.filter((timer) => timer.enabled || timer.hour >= 254);
    expect(used(plan.timers)).toEqual(used(buildScheduleTimers(base, 16)));
    expect(plan.timers[WLED_SUNSET_SLOT]).toEqual(buildScheduleTimers(base, 16)[WLED_SUNSET_SLOT]);
    expect(scheduleRows(base)).toHaveLength(1);
  });

  it("a dated sunset row follows sunset with a few clock times and shares the 11 PM off", () => {
    const plan = planSchedule({ ...base, rows: [christmas, nightly] }, slots, "slots", 2026);
    expect(plan.error).toBeNull();
    expect(plan.sunsetRowId).toBe("n");
    const steps = plan.steps.x!;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps[0]!.from).toEqual({ month: 11, day: 25 });
    expect(steps[steps.length - 1]!.to).toEqual({ month: 1, day: 6 });
    expect(Math.max(...steps.map((step) => step.latestMinutesAfter))).toBeLessThanOrEqual(SUNSET_MAX_LATE);
    expect(plan.clockUsed).toBe(steps.length + 1);
    expect(plan.timers[WLED_SUNSET_SLOT]).toMatchObject({ enabled: true, macro: 16 });
    expect(plan.timers.filter((timer) => timer.enabled && timer.macro === LOOK_OFF_SLOT)).toHaveLength(1);
    expect(plan.timers[0]).toMatchObject({ enabled: true, macro: 17, startMonth: 11, startDay: 25 });
  });

  it("off at sunrise uses the sunrise slot; sunset on 16.x is hour 254", () => {
    const plan = planSchedule({ ...base, rows: [{ ...nightly, off: { kind: "sunrise" } }] }, slots, "hours", 2026);
    expect(plan.timers[WLED_SUNRISE_SLOT]).toMatchObject({ enabled: true, hour: 255, macro: LOOK_OFF_SLOT });
    expect(plan.timers[WLED_SUNSET_SLOT]).toMatchObject({ enabled: true, hour: 254 });
    expect(plan.clockUsed).toBe(0);
  });

  it("refuses a plan that needs more than 8 clock timers", () => {
    const allYearTwo = { ...nightly, id: "m", run: { kind: "look" as const, lookId: "warm" } };
    const plan = planSchedule({ ...base, rows: [allYearTwo, nightly] }, slots, "slots", 2026);
    expect(plan.clockUsed).toBeGreaterThan(8);
    expect(plan.error).toMatch(/8/);
  });
});

const SUNSET_MAX_LATE = 12;
