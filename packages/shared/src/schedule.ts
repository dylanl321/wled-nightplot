/**
 * Nightly Schedule stored as WLED timed presets plus NTP / location.
 *
 * `cfg.if.ntp` and `cfg.timers.ins` follow `wled00/cfg.cpp` and `ntp.cpp`.
 *
 * 0.14.x / 0.15.x keep ten fixed slots. Slots 0–7 are clock times, slot 8 is
 * sunrise and slot 9 is sunset, both hour 255 (`checkTimers` reads
 * `timerMinutes[8]` against sunrise and `[9]` against sunset). Reading
 * `ins`, WLED jumps the first hour-255 entry to slot 8, and writing `ins` it
 * drops every entry with macro, hour and minute all 0. So Nightplot writes a
 * full 10-slot list and keeps slot 8 as a disabled hour-255 sunrise, which
 * WLED always saves. Without it, a reboot would re-read the lone hour-255
 * sunset into slot 8 and fire it at sunrise.
 *
 * 16.0.x keeps a timer list and marks sunset by hour 254 (sunrise is 255),
 * so position does not matter there.
 *
 * The schedule runs on the controller. Nightplot being closed is the point.
 */

import { LOOK_OFF_SLOT } from "./look.ts";

export const WLED_TIMER_COUNT = 10;
export const WLED_CLOCK_TIMER_MAX = 7;
/** Sunrise / sunset hour marker on 0.14.x / 0.15.x. The slot decides which. */
export const WLED_SUNSET_HOUR = 255;
/** 16.0.x `TH_SUNRISE`. */
export const WLED_SUNRISE_HOUR_V16 = 255;
/** 16.0.x `TH_SUNSET`. */
export const WLED_SUNSET_HOUR_V16 = 254;
export const WLED_SUNRISE_SLOT = 8;
export const WLED_SUNSET_SLOT = 9;
export const WLED_SUNSET_OFFSET_MIN = -120;
export const WLED_SUNSET_OFFSET_MAX = 120;
export const WLED_LATITUDE_POLAR = 66.6;
export const WLED_NTP_HOST_DEFAULT = "1.wled.pool.ntp.org";
export const WLED_WEEKDAYS_ALL = 127;

/**
 * How a WLED build stores sunrise / sunset timers. `slots` is 0.14.x /
 * 0.15.x (hour 255, slot 8 sunrise, slot 9 sunset). `hours` is 16.0.x and
 * later (hour 255 sunrise, hour 254 sunset).
 */
export type WledTimerDialect = "slots" | "hours";

/** Unknown or unparsable firmware gets the 0.14 / 0.15 layout. */
export function wledTimerDialect(firmware: string | null | undefined): WledTimerDialect {
  const match = /(\d+)\.\d+/.exec(firmware ?? "");
  const major = match ? Number(match[1]) : 0;
  return major >= 16 ? "hours" : "slots";
}

export type ScheduleOn =
  | { kind: "sunset"; offsetMinutes: number }
  | { kind: "time"; hour: number; minute: number };

export type ScheduleOff = { hour: number; minute: number };

export type ScheduleRun =
  | { kind: "look"; lookId: string }
  | { kind: "playlist"; playlistId: string };

export type ScheduleNtp = {
  host: string;
  /** WLED `if.ntp.tz` — index in the Time & Macros dropdown. */
  tz: number;
  utcOffsetSecs: number;
  latitude: number;
  longitude: number;
};

export type NightlySchedule = {
  enabled: boolean;
  on: ScheduleOn;
  off: ScheduleOff;
  run: ScheduleRun;
  ntp: ScheduleNtp;
  /** WLED `dow` bitmask. 127 is every day. */
  weekdays: number;
};

export type WledNtp = {
  enabled: boolean;
  host: string | null;
  tz: number;
  utcOffsetSecs: number;
  latitude: number;
  longitude: number;
};

export type WledTimer = {
  enabled: boolean;
  hour: number;
  minute: number;
  macro: number;
  weekdays: number;
  startMonth?: number;
  startDay?: number;
  endMonth?: number;
  endDay?: number;
};

/**
 * WLED `if.ntp.tz` labels. Indices match the Time & Macros dropdown on
 * 0.14 / 0.15 (GMT-offset list). DST is WLED's, not Nightplot's.
 */
export const WLED_TIMEZONES: readonly { tz: number; label: string }[] = [
  { tz: 0, label: "UTC−12" },
  { tz: 1, label: "UTC−11" },
  { tz: 2, label: "UTC−10 Hawaii" },
  { tz: 3, label: "UTC−09 Alaska" },
  { tz: 4, label: "UTC−08 Pacific" },
  { tz: 5, label: "UTC−07 Mountain" },
  { tz: 6, label: "UTC−07 Arizona" },
  { tz: 7, label: "UTC−06 Central" },
  { tz: 8, label: "UTC−05 Eastern" },
  { tz: 9, label: "UTC−04 Atlantic" },
  { tz: 10, label: "UTC−03:30 Newfoundland" },
  { tz: 11, label: "UTC−03" },
  { tz: 12, label: "UTC−02" },
  { tz: 13, label: "UTC−01" },
  { tz: 14, label: "UTC" },
  { tz: 15, label: "UTC+01 Central Europe" },
  { tz: 16, label: "UTC+02" },
  { tz: 17, label: "UTC+03" },
  { tz: 18, label: "UTC+03:30" },
  { tz: 19, label: "UTC+04" },
  { tz: 20, label: "UTC+04:30" },
  { tz: 21, label: "UTC+05" },
  { tz: 22, label: "UTC+05:30 India" },
  { tz: 23, label: "UTC+05:45" },
  { tz: 24, label: "UTC+06" },
  { tz: 25, label: "UTC+06:30" },
  { tz: 26, label: "UTC+07" },
  { tz: 27, label: "UTC+08" },
  { tz: 28, label: "UTC+09" },
  { tz: 29, label: "UTC+09:30" },
  { tz: 30, label: "UTC+10" },
  { tz: 31, label: "UTC+11" },
  { tz: 32, label: "UTC+12" },
  { tz: 33, label: "UTC+13" },
];

export function wledTimezoneLabel(tz: number): string {
  return WLED_TIMEZONES.find((row) => row.tz === tz)?.label ?? `WLED timezone ${tz}`;
}

export function isClockHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

export function isMinute(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 59;
}

export function isNightlySchedule(value: unknown): value is NightlySchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<NightlySchedule>;
  if (typeof row.enabled !== "boolean") return false;
  if (!isScheduleOn(row.on) || !isScheduleOff(row.off) || !isScheduleRun(row.run)) return false;
  if (!isScheduleNtp(row.ntp)) return false;
  if (typeof row.weekdays !== "number" || !Number.isInteger(row.weekdays) || row.weekdays < 1 || row.weekdays > 127) {
    return false;
  }
  return true;
}

export function validateSchedule(
  schedule: NightlySchedule,
  looks: readonly { id: string }[],
  playlists: readonly { id: string }[],
): string | null {
  if (schedule.enabled && schedule.on.kind === "sunset") {
    if (Math.abs(schedule.ntp.latitude) > WLED_LATITUDE_POLAR) {
      return "Sunset needs a latitude inside 66.6° of the equator. WLED cannot calculate sunset in the polar circles.";
    }
    if (schedule.ntp.latitude === 0 && schedule.ntp.longitude === 0) {
      return "Sunset needs this yard’s latitude and longitude. Nothing was sent.";
    }
    if (
      schedule.on.offsetMinutes < WLED_SUNSET_OFFSET_MIN ||
      schedule.on.offsetMinutes > WLED_SUNSET_OFFSET_MAX
    ) {
      return `Sunset offset is ${WLED_SUNSET_OFFSET_MIN} to ${WLED_SUNSET_OFFSET_MAX} minutes.`;
    }
  }
  const run = schedule.run;
  if (run.kind === "look" && !looks.some((look) => look.id === run.lookId)) {
    return "The Schedule names a Look that is not in the library.";
  }
  if (run.kind === "playlist" && !playlists.some((row) => row.id === run.playlistId)) {
    return "The Schedule names a playlist that is not in the library.";
  }
  if (schedule.ntp.latitude < -90 || schedule.ntp.latitude > 90) return "Latitude is −90 to 90.";
  if (schedule.ntp.longitude < -180 || schedule.ntp.longitude > 180) return "Longitude is −180 to 180.";
  return null;
}

export function runPresetSlot(
  schedule: NightlySchedule,
  looks: readonly { id: string; slot: number }[],
  playlists: readonly { id: string; slot: number }[],
): number | null {
  const run = schedule.run;
  switch (run.kind) {
    case "look":
      return looks.find((look) => look.id === run.lookId)?.slot ?? null;
    case "playlist":
      return playlists.find((row) => row.id === run.playlistId)?.slot ?? null;
    default: {
      const _exhaustive: never = run;
      return _exhaustive;
    }
  }
}

export function disabledTimer(): WledTimer {
  return {
    enabled: false,
    hour: 0,
    minute: 0,
    macro: 0,
    weekdays: WLED_WEEKDAYS_ALL,
    startMonth: 1,
    startDay: 1,
    endMonth: 12,
    endDay: 31,
  };
}

/** A disabled sunrise / sunset placeholder. WLED saves it, so slot 9 stays slot 9. */
function disabledSunTimer(): WledTimer {
  return { enabled: false, hour: WLED_SUNSET_HOUR, minute: 0, macro: 0, weekdays: WLED_WEEKDAYS_ALL };
}

/**
 * Ten timer slots in WLED order. Slot 0 is clock-time on (when used). Slot 1
 * is off. Slot 9 is sunset on. Slot 8 (sunrise) is never used and is written
 * disabled with macro 0, which also clears a sunset that older Nightplot
 * builds put there. Unused slots are disabled so leftover WLED timers do not
 * fire after a push.
 */
export function buildScheduleTimers(
  schedule: NightlySchedule,
  runSlot: number,
  dialect: WledTimerDialect = "slots",
): WledTimer[] {
  const timers = Array.from({ length: WLED_TIMER_COUNT }, () => disabledTimer());
  if (dialect === "slots") {
    timers[WLED_SUNRISE_SLOT] = disabledSunTimer();
    timers[WLED_SUNSET_SLOT] = disabledSunTimer();
  }
  const off: WledTimer = {
    enabled: true,
    hour: schedule.off.hour,
    minute: schedule.off.minute,
    macro: LOOK_OFF_SLOT,
    weekdays: schedule.weekdays,
    startMonth: 1,
    startDay: 1,
    endMonth: 12,
    endDay: 31,
  };
  timers[1] = off;
  if (schedule.on.kind === "sunset") {
    timers[WLED_SUNSET_SLOT] = {
      enabled: true,
      hour: dialect === "hours" ? WLED_SUNSET_HOUR_V16 : WLED_SUNSET_HOUR,
      minute: schedule.on.offsetMinutes,
      macro: runSlot,
      weekdays: schedule.weekdays,
    };
  } else {
    timers[0] = {
      enabled: true,
      hour: schedule.on.hour,
      minute: schedule.on.minute,
      macro: runSlot,
      weekdays: schedule.weekdays,
      startMonth: 1,
      startDay: 1,
      endMonth: 12,
      endDay: 31,
    };
  }
  return timers;
}

export function buildScheduleWrite(
  schedule: NightlySchedule,
  runSlot: number,
  dialect: WledTimerDialect = "slots",
): {
  body: Record<string, unknown>;
  expectedNtp: WledNtp;
  expectedTimers: WledTimer[];
} {
  const timers = buildScheduleTimers(schedule, runSlot, dialect);
  const expectedNtp: WledNtp = {
    enabled: true,
    host: schedule.ntp.host.trim() || WLED_NTP_HOST_DEFAULT,
    tz: schedule.ntp.tz,
    utcOffsetSecs: schedule.ntp.utcOffsetSecs,
    latitude: schedule.ntp.latitude,
    longitude: schedule.ntp.longitude,
  };
  return {
    body: {
      if: {
        ntp: {
          en: true,
          host: expectedNtp.host,
          tz: expectedNtp.tz,
          offset: expectedNtp.utcOffsetSecs,
          ln: expectedNtp.longitude,
          lt: expectedNtp.latitude,
        },
      },
      timers: { ins: timers.map(timerBody) },
    },
    expectedNtp,
    expectedTimers: timers,
  };
}

export function parseWledNtp(cfg: unknown): WledNtp | null {
  const ntp = record(record(record(cfg)?.if)?.ntp);
  if (!ntp || typeof ntp.en !== "boolean") return null;
  const tz = integer(ntp.tz);
  const lat = finiteNumber(ntp.lt);
  const lon = finiteNumber(ntp.ln);
  if (tz === null || lat === null || lon === null) return null;
  return {
    enabled: ntp.en,
    host: typeof ntp.host === "string" && ntp.host.trim() ? ntp.host.trim() : null,
    tz,
    utcOffsetSecs: integer(ntp.offset) ?? 0,
    latitude: lat,
    longitude: lon,
  };
}

export function parseWledTimers(cfg: unknown): WledTimer[] | null {
  const ins = record(record(cfg)?.timers)?.ins;
  if (!Array.isArray(ins)) return null;
  const out: WledTimer[] = [];
  for (const row of ins) {
    const timer = record(row);
    if (!timer) return null;
    const hour = integer(timer.hour);
    const minute = integer(timer.min);
    const macro = integer(timer.macro);
    const weekdays = integer(timer.dow);
    if (hour === null || minute === null || macro === null || weekdays === null) return null;
    // 0.15.x and 16.0.x report `en` as 1 / 0, not a boolean.
    const enabled = typeof timer.en === "boolean" ? timer.en : timer.en === 1 ? true : timer.en === 0 ? false : null;
    if (enabled === null) return null;
    const start = record(timer.start);
    const end = record(timer.end);
    out.push({
      enabled,
      hour,
      minute,
      macro,
      weekdays,
      ...(start && integer(start.mon) !== null ? { startMonth: integer(start.mon)! } : {}),
      ...(start && integer(start.day) !== null ? { startDay: integer(start.day)! } : {}),
      ...(end && integer(end.mon) !== null ? { endMonth: integer(end.mon)! } : {}),
      ...(end && integer(end.day) !== null ? { endDay: integer(end.day)! } : {}),
    });
  }
  return out;
}

export function ntpMatches(expected: WledNtp, read: WledNtp | null): boolean | null {
  if (!read) return null;
  return (
    read.enabled === expected.enabled &&
    read.tz === expected.tz &&
    read.utcOffsetSecs === expected.utcOffsetSecs &&
    nearly(read.latitude, expected.latitude) &&
    nearly(read.longitude, expected.longitude) &&
    (expected.host === null || read.host === expected.host)
  );
}

/** WLED leaves out timers whose macro, hour and minute are all 0 when it saves `ins`. */
function savedByWled(timer: WledTimer): boolean {
  return !(timer.macro === 0 && timer.hour === 0 && timer.minute === 0);
}

/**
 * Compares what WLED reports with what it would report after taking
 * `expected`. Both sides drop the entries WLED does not save, so a readback
 * that lists only the used timers still lines up entry for entry.
 */
export function timersMatch(expected: readonly WledTimer[], read: WledTimer[] | null): boolean | null {
  if (!read) return null;
  const want = expected.filter(savedByWled);
  const got = read.filter(savedByWled);
  if (got.length !== want.length) return false;
  for (let index = 0; index < want.length; index += 1) {
    const a = want[index]!;
    const b = got[index]!;
    if (
      b.enabled !== a.enabled ||
      b.hour !== a.hour ||
      b.minute !== a.minute ||
      b.macro !== a.macro ||
      b.weekdays !== a.weekdays
    ) {
      return false;
    }
  }
  return true;
}

export function scheduleMatches(
  expectedNtp: WledNtp,
  expectedTimers: readonly WledTimer[],
  cfg: unknown,
): boolean | null {
  const ntp = ntpMatches(expectedNtp, parseWledNtp(cfg));
  const timers = timersMatch(expectedTimers, parseWledTimers(cfg));
  if (ntp === null || timers === null) return null;
  return ntp && timers;
}

function timerBody(timer: WledTimer): Record<string, unknown> {
  const body: Record<string, unknown> = {
    en: timer.enabled,
    hour: timer.hour,
    min: timer.minute,
    macro: timer.macro,
    dow: timer.weekdays,
  };
  if (timer.hour < WLED_SUNSET_HOUR_V16) {
    body.start = { mon: timer.startMonth ?? 1, day: timer.startDay ?? 1 };
    body.end = { mon: timer.endMonth ?? 12, day: timer.endDay ?? 31 };
  }
  return body;
}

function isScheduleOn(value: unknown): value is ScheduleOn {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScheduleOn> & { kind?: unknown };
  if (row.kind === "sunset") {
    return typeof row.offsetMinutes === "number" && Number.isInteger(row.offsetMinutes);
  }
  if (row.kind === "time") {
    return isClockHour((row as { hour?: unknown }).hour) && isMinute((row as { minute?: unknown }).minute);
  }
  return false;
}

function isScheduleOff(value: unknown): value is ScheduleOff {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScheduleOff>;
  return isClockHour(row.hour) && isMinute(row.minute);
}

function isScheduleRun(value: unknown): value is ScheduleRun {
  if (!value || typeof value !== "object") return false;
  const row = value as { kind?: unknown; lookId?: unknown; playlistId?: unknown };
  if (row.kind === "look") return typeof row.lookId === "string" && row.lookId.length > 0;
  if (row.kind === "playlist") return typeof row.playlistId === "string" && row.playlistId.length > 0;
  return false;
}

function isScheduleNtp(value: unknown): value is ScheduleNtp {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScheduleNtp>;
  return (
    typeof row.host === "string" &&
    typeof row.tz === "number" &&
    Number.isInteger(row.tz) &&
    row.tz >= 0 &&
    row.tz <= 255 &&
    typeof row.utcOffsetSecs === "number" &&
    Number.isInteger(row.utcOffsetSecs) &&
    typeof row.latitude === "number" &&
    Number.isFinite(row.latitude) &&
    typeof row.longitude === "number" &&
    Number.isFinite(row.longitude)
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

export function defaultScheduleDraft(looks: readonly { id: string }[], playlists: readonly { id: string }[]): NightlySchedule {
  const playlist = playlists[0];
  const look = looks[0];
  return {
    enabled: false,
    on: { kind: "sunset", offsetMinutes: 0 },
    off: { hour: 23, minute: 0 },
    run: playlist
      ? { kind: "playlist", playlistId: playlist.id }
      : { kind: "look", lookId: look?.id ?? "" },
    ntp: {
      host: WLED_NTP_HOST_DEFAULT,
      tz: 8,
      utcOffsetSecs: 0,
      latitude: 0,
      longitude: 0,
    },
    weekdays: WLED_WEEKDAYS_ALL,
  };
}
