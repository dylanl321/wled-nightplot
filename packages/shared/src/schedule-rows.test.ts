import { describe, expect, it } from "vitest";
import { LOOK_OFF_SLOT } from "./look.ts";
import { WLED_SUNRISE_SLOT, WLED_SUNSET_SLOT, buildScheduleTimers, type NightlySchedule } from "./schedule.ts";
import { dateOfDay, dayOfYear, localSunsetMinutes, planSchedule, rowDays, scheduleRows, wledUtcOffsetMinutes, type ScheduleRow, type SunsetStep } from "./schedule-rows.ts";

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
    const minutes = localSunsetMinutes(ntp, 2026, dayOfYear({ month: 12, day: 21 }, 2026))!;
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

function covers(step: SunsetStep, month: number, day: number): boolean {
  const from = step.from.month * 100 + step.from.day;
  const to = step.to.month * 100 + step.to.day;
  const at = month * 100 + day;
  return from <= to ? at >= from && at <= to : at >= from || at <= to;
}

function fireAt(steps: SunsetStep[], month: number, day: number): number {
  const step = steps.find((row) => covers(row, month, day));
  if (!step) throw new Error(`no step covers ${month}/${day}`);
  return step.hour * 60 + step.minute;
}

describe("leap years and daylight saving", () => {
  it("counts 1 March as day 61 in a leap year and does not start before that sunset", () => {
    expect(dayOfYear({ month: 3, day: 1 }, 2024)).toBe(61);
    expect(dayOfYear({ month: 3, day: 1 }, 2023)).toBe(60);
    expect(dayOfYear({ month: 2, day: 29 }, 2024)).toBe(60);
    expect(dateOfDay(61, 2024)).toEqual({ month: 3, day: 1 });
    expect(rowDays(null, 2024)).toHaveLength(366);
    expect(rowDays(null, 1900)).toHaveLength(365);
    expect(rowDays({ from: { month: 2, day: 28 }, to: { month: 3, day: 1 } }, 2024)).toEqual([59, 60, 61]);
    expect(rowDays({ from: { month: 2, day: 28 }, to: { month: 3, day: 1 } }, 2023)).toEqual([59, 60]);
    const leap = localSunsetMinutes(ntp, 2024, 61)!;
    expect(leap).not.toBe(localSunsetMinutes(ntp, 2024, 60));
    const row: ScheduleRow = { ...nightly, id: "mar", dates: { from: { month: 3, day: 1 }, to: { month: 3, day: 1 } } };
    const plan = planSchedule({ ...base, rows: [row, nightly] }, slots, "slots", 2024);
    const step = plan.steps.mar![0]!;
    expect(step.from).toEqual({ month: 3, day: 1 });
    expect(step.to).toEqual({ month: 3, day: 1 });
    const fire = step.hour * 60 + step.minute;
    expect(fire).toBeGreaterThan(leap);
    expect(fire - leap).toBeLessThanOrEqual(SUNSET_MAX_LATE);
  });

  it("splits a dated sunset row on the earliest and latest daylight-saving days", () => {
    const march: ScheduleRow = { ...nightly, id: "m", dates: { from: { month: 3, day: 1 }, to: { month: 3, day: 31 } } };
    const fall: ScheduleRow = { ...nightly, id: "f", dates: { from: { month: 10, day: 20 }, to: { month: 11, day: 20 } } };
    for (const year of [2026, 2027]) {
      const plan = planSchedule({ ...base, rows: [march, nightly] }, slots, "slots", year);
      expect(plan.error).toBeNull();
      const steps = plan.steps.m!;
      const spans = (a: [number, number], b: [number, number]) => steps.some((step) => covers(step, a[0], a[1]) && covers(step, b[0], b[1]));
      expect(spans([3, 7], [3, 8])).toBe(false);
      expect(spans([3, 14], [3, 15])).toBe(false);
      const sunset = localSunsetMinutes(ntp, year, dayOfYear({ month: 3, day: 1 }, year))!;
      const at = fireAt(steps, 3, 1);
      expect(at).toBeGreaterThan(sunset);
      expect(at - sunset).toBeLessThanOrEqual(SUNSET_MAX_LATE);
    }
    // 2027's change is 14 March, so 10 March is still standard time. The plan uses the later offset.
    const later = planSchedule({ ...base, rows: [march, nightly] }, slots, "slots", 2027);
    const standard = localSunsetMinutes(ntp, 2027, dayOfYear({ month: 3, day: 10 }, 2027))!;
    expect(fireAt(later.steps.m!, 3, 10)).toBeGreaterThanOrEqual(standard + 50);

    const autumn = planSchedule({ ...base, rows: [fall, nightly] }, slots, "slots", 2026);
    const autumnSteps = autumn.steps.f!;
    const spansFall = (a: [number, number], b: [number, number]) => autumnSteps.some((step) => covers(step, a[0], a[1]) && covers(step, b[0], b[1]));
    expect(spansFall([10, 31], [11, 1])).toBe(false);
    expect(spansFall([11, 7], [11, 8])).toBe(false);
    // 2026 falls back on 1 November, so 2 November is standard time and the window still waits for the later sunset.
    const early = localSunsetMinutes(ntp, 2026, dayOfYear({ month: 11, day: 2 }, 2026))!;
    expect(fireAt(autumnSteps, 11, 2)).toBeGreaterThanOrEqual(early + 50);
  });
});
