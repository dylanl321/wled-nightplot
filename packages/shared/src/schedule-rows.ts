/**
 * The Schedule as rows: what runs, on which dates and days, when it turns on
 * (sunset ± minutes or a clock time) and when it turns off. The higher row
 * wins where two cover the same day.
 *
 * WLED runs the Schedule by itself with 8 clock timers (slots 0–7, each with
 * a date range), one sunrise timer and one sunset timer. Sunrise and sunset
 * take no date range (0.14.x / 0.15.x `checkTimers`; 16.0.x the same). So
 * one all-year sunset row gets the sunset timer, and a dated sunset row is
 * followed with clock timers: days whose sunset moves 10 minutes or less
 * share one, set a minute after the latest sunset in that run of days, so it
 * never starts before sunset.
 *
 * Sunset here is worked out the way WLED does (NOAA formula, the Light's
 * location and WLED time zone). It plans the clock times; the Light still
 * works out its own sunset for the sunset timer.
 */
import { LOOK_OFF_SLOT } from "./look.ts";
import {
  WLED_LATITUDE_POLAR,
  WLED_SUNRISE_SLOT,
  WLED_SUNSET_HOUR,
  WLED_SUNSET_HOUR_V16,
  WLED_SUNSET_OFFSET_MAX,
  WLED_SUNSET_OFFSET_MIN,
  WLED_SUNSET_SLOT,
  WLED_TIMER_COUNT,
  WLED_TIMEZONES,
  WLED_WEEKDAYS_ALL,
  disabledTimer,
  isClockHour,
  isMinute,
  type NightlySchedule,
  type ScheduleNtp,
  type ScheduleRun,
  type WledTimeChangeRule,
  type WledTimer,
  type WledTimerDialect,
} from "./schedule.ts";

export const WLED_CLOCK_TIMERS = 8;
/** Days in one clock timer may differ by this much in sunset time. */
export const SUNSET_STEP_MINUTES = 10;

export type ScheduleDate = { month: number; day: number };
export type ScheduleDates = { from: ScheduleDate; to: ScheduleDate };
export type ScheduleRowOn =
  | { kind: "sunset"; offsetMinutes: number }
  | { kind: "time"; hour: number; minute: number };
export type ScheduleRowOff =
  | { kind: "time"; hour: number; minute: number }
  | { kind: "sunrise" }
  | { kind: "none" };

export type ScheduleRow = {
  id: string;
  run: ScheduleRun;
  /** Null is all year. A range may wrap the new year (Nov 25 – Jan 6). */
  dates: ScheduleDates | null;
  /** WLED `dow` bitmask: bit 0 Monday … bit 6 Sunday. 127 is every day. */
  weekdays: number;
  on: ScheduleRowOn;
  off: ScheduleRowOff;
};

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isDate(value: unknown): value is ScheduleDate {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScheduleDate>;
  return Number.isInteger(row.month) && row.month! >= 1 && row.month! <= 12 &&
    Number.isInteger(row.day) && row.day! >= 1 && row.day! <= MONTH_DAYS[row.month! - 1]!;
}

export function isScheduleRow(value: unknown): value is ScheduleRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<ScheduleRow>;
  if (typeof row.id !== "string" || !row.id) return false;
  const run = row.run as Partial<ScheduleRun> | undefined;
  if (!run || !((run.kind === "look" && typeof (run as { lookId?: unknown }).lookId === "string") ||
    (run.kind === "playlist" && typeof (run as { playlistId?: unknown }).playlistId === "string"))) return false;
  if (row.dates !== null && !(row.dates && isDate(row.dates.from) && isDate(row.dates.to))) return false;
  if (!Number.isInteger(row.weekdays) || row.weekdays! < 1 || row.weekdays! > 127) return false;
  const on = row.on as Partial<ScheduleRowOn> | undefined;
  if (on?.kind === "sunset") {
    const offset = (on as { offsetMinutes?: unknown }).offsetMinutes;
    if (typeof offset !== "number" || !Number.isInteger(offset)) return false;
  } else if (on?.kind === "time") {
    if (!isClockHour((on as { hour?: unknown }).hour) || !isMinute((on as { minute?: unknown }).minute)) return false;
  } else return false;
  const off = row.off as Partial<ScheduleRowOff> | undefined;
  if (off?.kind === "time") {
    if (!isClockHour((off as { hour?: unknown }).hour) || !isMinute((off as { minute?: unknown }).minute)) return false;
  } else if (off?.kind !== "sunrise" && off?.kind !== "none") return false;
  return true;
}

/** The rows, or the one row an older Schedule stands for. */
export function scheduleRows(schedule: NightlySchedule): ScheduleRow[] {
  if (schedule.rows?.length) return schedule.rows;
  return [{
    id: "row-nightly",
    run: schedule.run,
    dates: null,
    weekdays: schedule.weekdays,
    on: schedule.on.kind === "sunset"
      ? { kind: "sunset", offsetMinutes: schedule.on.offsetMinutes }
      : { kind: "time", hour: schedule.on.hour, minute: schedule.on.minute },
    off: { kind: "time", hour: schedule.off.hour, minute: schedule.off.minute },
  }];
}

/**
 * Store rows. The older single fields follow the last all-year row (or the
 * last row), so an older build reading this file still sees a sensible plan.
 */
export function withScheduleRows(schedule: NightlySchedule, rows: ScheduleRow[]): NightlySchedule {
  const base = [...rows].reverse().find((row) => row.dates === null) ?? rows[rows.length - 1];
  if (!base) return { ...schedule, rows: [] };
  return {
    ...schedule,
    rows,
    run: base.run,
    weekdays: base.weekdays,
    on: base.on.kind === "sunset" ? { kind: "sunset", offsetMinutes: base.on.offsetMinutes } : { kind: "time", hour: base.on.hour, minute: base.on.minute },
    off: base.off.kind === "time" ? { hour: base.off.hour, minute: base.off.minute } : schedule.off,
  };
}

// ---------------------------------------------------------------- dates

export function dayOfYear(date: ScheduleDate): number {
  return MONTH_DAYS.slice(0, date.month - 1).reduce((sum, days) => sum + days, 0) + date.day;
}

export function dateOfDay(doy: number): ScheduleDate {
  let rest = ((Math.round(doy) - 1) % 365 + 365) % 365 + 1;
  let month = 0;
  while (rest > MONTH_DAYS[month]!) { rest -= MONTH_DAYS[month]!; month += 1; }
  return { month: month + 1, day: rest };
}

export function formatScheduleDate(date: ScheduleDate): string {
  return `${MONTH_NAMES[date.month - 1]} ${date.day}`;
}

/** Day numbers (1–365, no leap day) a row covers, in order from its first date. */
export function rowDays(dates: ScheduleDates | null): number[] {
  if (!dates) return Array.from({ length: 365 }, (_, index) => index + 1);
  const from = dayOfYear(dates.from);
  const to = dayOfYear(dates.to);
  const out: number[] = [];
  if (from <= to) for (let day = from; day <= to; day += 1) out.push(day);
  else {
    for (let day = from; day <= 365; day += 1) out.push(day);
    for (let day = 1; day <= to; day += 1) out.push(day);
  }
  return out;
}

export function formatClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${((hour + 11) % 12) + 1}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------- sunset

function ruleDayUtcMs(year: number, rule: WledTimeChangeRule, offsetBefore: number): number {
  // Local time of the change, then back to UTC with the offset in force before it.
  let date: Date;
  if (rule.week === 0) {
    const last = new Date(Date.UTC(year, rule.month, 0));
    date = new Date(Date.UTC(year, rule.month - 1, last.getUTCDate() - last.getUTCDay()));
  } else {
    const first = new Date(Date.UTC(year, rule.month - 1, 1));
    const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
    date = new Date(Date.UTC(year, rule.month - 1, firstSunday + (rule.week - 1) * 7));
  }
  return date.getTime() + rule.hour * 3_600_000 - offsetBefore * 60_000;
}

/** WLED's UTC offset (minutes) at a UTC moment, from its zone rules plus the extra offset. */
export function wledUtcOffsetMinutes(ntp: Pick<ScheduleNtp, "tz" | "utcOffsetSecs">, utcMs: number): number {
  const zone = WLED_TIMEZONES.find((row) => row.tz === ntp.tz) ?? WLED_TIMEZONES[0]!;
  const extra = Math.round((ntp.utcOffsetSecs ?? 0) / 60);
  const { daylight, standard } = zone;
  if (daylight.offset === standard.offset) return standard.offset + extra;
  const year = new Date(utcMs).getUTCFullYear();
  const start = ruleDayUtcMs(year, daylight, standard.offset);
  const end = ruleDayUtcMs(year, standard, daylight.offset);
  const summer = start < end ? utcMs >= start && utcMs < end : utcMs >= start || utcMs < end;
  return (summer ? daylight.offset : standard.offset) + extra;
}

/**
 * Local sunset, minutes after midnight, for a day of the year. Same NOAA
 * formula and zenith (90.833°) WLED uses. Null in the polar circles.
 */
export function localSunsetMinutes(ntp: ScheduleNtp, year: number, doy: number): number | null {
  if (Math.abs(ntp.latitude) > WLED_LATITUDE_POLAR) return null;
  const rad = Math.PI / 180;
  const n = doy;
  const lngHour = ntp.longitude / 15;
  const t = n + (18 - lngHour) / 24;
  const m = 0.9856 * t - 3.289;
  let l = m + 1.916 * Math.sin(m * rad) + 0.020 * Math.sin(2 * m * rad) + 282.634;
  l = ((l % 360) + 360) % 360;
  let ra = Math.atan(0.91764 * Math.tan(l * rad)) / rad;
  ra = ((ra % 360) + 360) % 360;
  ra += Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90;
  ra /= 15;
  const sinDec = 0.39782 * Math.sin(l * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(ntp.latitude * rad)) / (cosDec * Math.cos(ntp.latitude * rad));
  if (cosH < -1 || cosH > 1) return null;
  const h = Math.acos(cosH) / rad / 15;
  const ut = (((h + ra - 0.06571 * t - 6.622 - lngHour) % 24) + 24) % 24;
  const date = dateOfDay(doy);
  const utcMs = Date.UTC(year, date.month - 1, date.day) + ut * 3_600_000;
  return ut * 60 + wledUtcOffsetMinutes(ntp, utcMs);
}

// ---------------------------------------------------------------- plan

export type SunsetStep = { from: ScheduleDate; to: ScheduleDate; hour: number; minute: number; latestMinutesAfter: number };

export type SchedulePlan = {
  /** All ten WLED timer slots, ready to write. */
  timers: WledTimer[];
  clockUsed: number;
  sunsetRowId: string | null;
  sunriseUsed: boolean;
  steps: Record<string, SunsetStep[]>;
  notes: Record<string, string[]>;
  /** Why this Schedule cannot be sent. Null when it fits. */
  error: string | null;
};

type Slots = { looks: readonly { id: string; slot: number; name?: string }[]; playlists: readonly { id: string; slot: number; name?: string }[] };

export function rowRunSlot(row: Pick<ScheduleRow, "run">, slots: Slots): number | null {
  return row.run.kind === "look"
    ? slots.looks.find((look) => look.id === (row.run as { lookId: string }).lookId)?.slot ?? null
    : slots.playlists.find((list) => list.id === (row.run as { playlistId: string }).playlistId)?.slot ?? null;
}

export function rowRunName(row: Pick<ScheduleRow, "run">, slots: Slots): string {
  if (row.run.kind === "look") {
    const id = row.run.lookId;
    return slots.looks.find((look) => look.id === id)?.name ?? "A deleted Look";
  }
  const id = row.run.playlistId;
  const name = slots.playlists.find((list) => list.id === id)?.name;
  return name ? `${name} playlist` : "A deleted playlist";
}

function clock(hour: number, minute: number, macro: number, weekdays: number, dates: ScheduleDates | null): WledTimer {
  return {
    enabled: true, hour, minute, macro, weekdays,
    startMonth: dates?.from.month ?? 1, startDay: dates?.from.day ?? 1,
    endMonth: dates?.to.month ?? 12, endDay: dates?.to.day ?? 31,
  };
}

function sunTimer(hour: number): WledTimer {
  return { enabled: false, hour, minute: 0, macro: 0, weekdays: WLED_WEEKDAYS_ALL };
}

/**
 * Turn the rows into WLED timers. Clock timers go in slots 0–7 in row order
 * (on timers first, then shared off timers). Slot 8 is sunrise (used for an
 * off at sunrise), slot 9 sunset.
 */
export function planSchedule(
  schedule: NightlySchedule,
  slots: Slots,
  dialect: WledTimerDialect = "slots",
  year = new Date().getFullYear(),
): SchedulePlan {
  const rows = scheduleRows(schedule);
  const notes: Record<string, string[]> = {};
  const steps: Record<string, SunsetStep[]> = {};
  const clocks: WledTimer[] = [];
  let error: string | null = null;
  const usesSun = rows.some((row) => row.on.kind === "sunset" || row.off.kind === "sunrise");
  if (usesSun) {
    if (Math.abs(schedule.ntp.latitude) > WLED_LATITUDE_POLAR) {
      error = "Sunset needs a latitude inside 66.6° of the equator. WLED cannot work out sunset in the polar circles.";
    } else if (schedule.ntp.latitude === 0 && schedule.ntp.longitude === 0) {
      error = "Sunset needs this yard’s latitude and longitude.";
    }
  }
  const allYearSunset = rows.filter((row) => row.dates === null && row.on.kind === "sunset");
  const sunsetRow = allYearSunset[allYearSunset.length - 1] ?? null;
  let sunsetTimer: WledTimer = sunTimer(dialect === "hours" ? WLED_SUNSET_HOUR_V16 : WLED_SUNSET_HOUR);
  let sunriseTimer: WledTimer = sunTimer(WLED_SUNSET_HOUR);

  for (const row of rows) {
    notes[row.id] = [];
    const macro = rowRunSlot(row, slots);
    if (macro === null) {
      error ??= `A Schedule row runs ${rowRunName(row, slots).toLowerCase()}. Pick what it runs.`;
      continue;
    }
    if (row.on.kind === "time") {
      clocks.push(clock(row.on.hour, row.on.minute, macro, row.weekdays, row.dates));
      continue;
    }
    if (row.on.offsetMinutes < WLED_SUNSET_OFFSET_MIN || row.on.offsetMinutes > WLED_SUNSET_OFFSET_MAX) {
      error ??= `Minutes after sunset are ${WLED_SUNSET_OFFSET_MIN} to ${WLED_SUNSET_OFFSET_MAX}.`;
    }
    if (row === sunsetRow) {
      sunsetTimer = { enabled: true, hour: dialect === "hours" ? WLED_SUNSET_HOUR_V16 : WLED_SUNSET_HOUR,
        minute: row.on.offsetMinutes, macro, weekdays: row.weekdays };
      notes[row.id]!.push("Uses WLED’s sunset timer.");
      continue;
    }
    if (error && usesSun && /latitude/.test(error)) continue;
    const runs: { from: number; to: number; lo: number; hi: number }[] = [];
    let current: (typeof runs)[number] | null = null;
    for (const day of rowDays(row.dates)) {
      const sunset = localSunsetMinutes(schedule.ntp, year, day);
      if (sunset === null) continue;
      const at = sunset + row.on.offsetMinutes;
      if (current && Math.max(current.hi, at) - Math.min(current.lo, at) <= SUNSET_STEP_MINUTES && day === current.to + 1 - (current.to === 365 ? 365 : 0)) {
        current.to = day; current.hi = Math.max(current.hi, at); current.lo = Math.min(current.lo, at);
      } else {
        current = { from: day, to: day, lo: at, hi: at };
        runs.push(current);
      }
    }
    const list = runs.map((run) => {
      const fire = Math.min(1439, Math.ceil(run.hi + 1));
      return { from: dateOfDay(run.from), to: dateOfDay(run.to), hour: Math.floor(fire / 60), minute: fire % 60,
        latestMinutesAfter: Math.round(fire - run.lo) };
    });
    steps[row.id] = list;
    for (const step of list) clocks.push(clock(step.hour, step.minute, macro, row.weekdays, { from: step.from, to: step.to }));
    const late = Math.max(0, ...list.map((step) => step.latestMinutesAfter));
    notes[row.id]!.push(`Follows sunset with ${list.length} clock time${list.length === 1 ? "" : "s"}: ${list
      .map((step) => `${formatClock(step.hour * 60 + step.minute)} from ${formatScheduleDate(step.from)}`).join(", ")}. Starts at most ${late} minutes after sunset.`);
    if (sunsetRow) notes[row.id]!.push(`${rowRunName(sunsetRow, slots)} starts at sunset on these days too, then this row takes over.`);
  }

  // Off timers. Rows with the same off time and days share one; a dated row
  // whose off matches an all-year row's off uses that one.
  const offs: WledTimer[] = [];
  let sunriseDays = 0;
  for (const row of rows) {
    if (row.off.kind === "none") continue;
    if (row.off.kind === "sunrise") { sunriseDays |= row.weekdays; continue; }
    const { hour, minute } = row.off;
    const covered = offs.some((timer) => timer.hour === hour && timer.minute === minute && (timer.weekdays & row.weekdays) === row.weekdays &&
      ((timer.startMonth === 1 && timer.startDay === 1 && timer.endMonth === 12 && timer.endDay === 31) ||
        (row.dates && timer.startMonth === row.dates.from.month && timer.startDay === row.dates.from.day &&
          timer.endMonth === row.dates.to.month && timer.endDay === row.dates.to.day)));
    if (covered) continue;
    const allYear = row.dates === null ? null : rows.find((other) => other.dates === null && other.off.kind === "time" &&
      other.off.hour === hour && other.off.minute === minute && (other.weekdays & row.weekdays) === row.weekdays);
    if (allYear) continue;
    offs.push(clock(hour, minute, LOOK_OFF_SLOT, row.weekdays, row.dates));
  }
  // An all-year off may have been pushed after a dated one it covers; drop the dated duplicates.
  const offTimers = offs.filter((timer, index) => !offs.some((other, otherIndex) => otherIndex !== index &&
    other.startMonth === 1 && other.startDay === 1 && other.endMonth === 12 && other.endDay === 31 &&
    !(timer.startMonth === 1 && timer.startDay === 1 && timer.endMonth === 12 && timer.endDay === 31) &&
    other.hour === timer.hour && other.minute === timer.minute && (other.weekdays & timer.weekdays) === timer.weekdays));
  if (sunriseDays) {
    sunriseTimer = { enabled: true, hour: WLED_SUNSET_HOUR, minute: 0, macro: LOOK_OFF_SLOT, weekdays: sunriseDays };
  }

  const all = [...clocks, ...offTimers];
  const clockUsed = all.length;
  if (clockUsed > WLED_CLOCK_TIMERS) {
    error ??= `This needs ${clockUsed} clock timers and WLED has ${WLED_CLOCK_TIMERS}. Use a clock time instead of sunset on a dated row, or fewer rows.`;
  }
  const timers = Array.from({ length: WLED_TIMER_COUNT }, () => disabledTimer());
  all.slice(0, WLED_CLOCK_TIMERS).forEach((timer, index) => { timers[index] = timer; });
  timers[WLED_SUNRISE_SLOT] = sunriseTimer;
  timers[WLED_SUNSET_SLOT] = sunsetTimer;
  return { timers, clockUsed, sunsetRowId: sunsetRow?.id ?? null, sunriseUsed: sunriseDays > 0, steps, notes, error };
}
