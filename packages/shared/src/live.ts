import type { BeadColor } from "./bead.ts";

export const PREVIEW_SWATCHES = [
  "#ffc978",
  "#ff4a3d",
  "#3dff7a",
  "#4f7dff",
  "#f4f1ea",
] as const;

export const BLINK_PULSE_MS = 3000;
export const BLINK_COLOR = "#f4f1ea";

export type LiveSessionKind = "preview" | "blink";
export type LiveSource = "fixture" | "sim" | "controller";
export type SeenByYou = "yes" | "no" | null;

/** Quiet caption for a sim enroll. Not Hardware Done. */
export const SOFTWARE_PATH_ONLY_CAPTION = "Software path only. Not Hardware Done.";

/** Quiet caption for the in-process fixture. Not Hardware Done. */
export const FIXTURE_SOFTWARE_GREEN_CAPTION =
  "Software-green from the fixture. Not Hardware Done.";

/**
 * Locate hop that did not re-read `/json/live`. Not Sent, not strip proof.
 * Preview is not Apply.
 */
export const PREVIEW_HOP_UNREAD_CAPTION =
  "Preview hop sent. Not read back — not Hardware Done.";

/**
 * First-locate leftover clears when the restore segment count is unknown.
 * Soft overlay write may still go (`firstLocateWrite(null)`). This is not
 * clear-as-success and not Apply. Never invent a leftover count.
 */
export const FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION =
  "Segments unknown. Leftover controller segments were not cleared. Not treating leftover lights as this locate.";

export function parseNightplotTag(tag: unknown): LiveSource {
  if (tag === "fixture") return "fixture";
  if (tag === "sim") return "sim";
  return "controller";
}

export function honestySource(source?: LiveSource | null): LiveSource {
  return source === "fixture" || source === "sim" ? source : "controller";
}

/** Prefer sim over fixture when All Off / manage saw more than one kind. */
export function foldHonestySource(
  current: LiveSource,
  incoming?: LiveSource | null,
): LiveSource {
  if (incoming === "sim") return "sim";
  if (incoming === "fixture" && current !== "sim") return "fixture";
  return current;
}

/** Fixture / sim Quiet captions. Null means use the controller wording. */
export function softwareHonestyCaption(source: LiveSource): string | null {
  if (source === "fixture") return FIXTURE_SOFTWARE_GREEN_CAPTION;
  if (source === "sim") return SOFTWARE_PATH_ONLY_CAPTION;
  return null;
}
export type LiveEndKind = "complete" | "error" | "cancel-without-restore";

export type LiveTarget = {
  elementId: string | null;
  label: string;
  start: number;
  stop: number;
};

export type LiveRestoreSegment = {
  start: number;
  stop: number;
  color: string | null;
};

export type LiveRestoreSnapshot = {
  on: boolean | null;
  brightness: number | null;
  color: string | null;
  /**
   * Reported ranges. `null` when unknown (info-only / missing `seg`) — not an
   * empty list. `[]` is a known empty report.
   */
  segments: LiveRestoreSegment[] | null;
};

/**
 * Keep unknown segments unknown through Preview restore.
 * Do not coalesce `null` to `[]` — that would look like a known empty list
 * and invent a whole-strip write from colour.
 */
export function restoreSegmentsFromSnapshot(
  segments: { start: number; stop: number }[] | null,
  color: string | null,
): LiveRestoreSnapshot["segments"] {
  if (segments === null) return null;
  return segments.map((seg) => ({
    start: seg.start,
    stop: seg.stop,
    color,
  }));
}

export type LiveSession = {
  id: string;
  kind: LiveSessionKind;
  lightId: string;
  target: LiveTarget;
  color: string;
  brightness: number;
  startedAt: string;
  restore: LiveRestoreSnapshot;
  source: LiveSource;
  seenByYou: SeenByYou;
  /**
   * First-locate leftover clears when restore segment count is unknown.
   * Soft overlay write may still have gone. Not clear-as-success.
   * Inspect / Light refresh must keep the unknown leftover caption while set.
   */
  leftoverClears?: "unknown";
};

export type LiveRead = {
  leds: (string | null)[];
  source: LiveSource;
};

export type ProofRung = {
  key: "sent" | "reported" | "person";
  label: string;
  done: boolean;
  detail?: string;
};

/** Live readback counts for one Preview / Blink target. Not range rails. */
export type LiveMatch = {
  matched: number;
  total: number;
};

export function parseHexColor(raw: string): string | null {
  const hex = raw.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const parsed = parseHexColor(hex);
  if (!parsed) return null;
  return [
    Number.parseInt(parsed.slice(1, 3), 16),
    Number.parseInt(parsed.slice(3, 5), 16),
    Number.parseInt(parsed.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function colorsMatch(a: string | null, b: string | null, slop = 8): boolean {
  if (!a || !b) return false;
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  if (!left || !right) return false;
  return left.every((n, i) => Math.abs(n - right[i]!) <= slop);
}

export function previewRefuseReason(input: {
  reachable: boolean;
  hasTarget: boolean;
  busyKind?: LiveSessionKind | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh it first.";
  }
  if (!input.hasTarget) {
    return "Pick an Element, or Preview the whole strip.";
  }
  if (input.busyKind === "blink") {
    return "A Blink is already running.";
  }
  return null;
}

export function blinkRefuseReason(input: {
  reachable: boolean;
  busyKind?: LiveSessionKind | null;
}): string | null {
  if (!input.reachable) {
    return "This Light hasn’t answered. Refresh it first.";
  }
  if (input.busyKind === "preview") {
    return "End the Preview first.";
  }
  if (input.busyKind === "blink") {
    return "A Blink is already running.";
  }
  return null;
}

/** Preview and Blink restore. All Off (R5) is the cancel-without-restore path. */
export function shouldRestoreOnEnd(end: LiveEndKind): boolean {
  return end !== "cancel-without-restore";
}

export function resolveLiveTarget(
  elements: { id: string; label: string; start: number; stop: number }[],
  ledCount: number,
  elementId?: string | null,
): LiveTarget {
  if (elementId) {
    const found = elements.find((element) => element.id === elementId);
    if (found) {
      return {
        elementId: found.id,
        label: found.label,
        start: found.start,
        stop: found.stop,
      };
    }
  }
  if (elements.length === 1 && !elementId) {
    const only = elements[0]!;
    return {
      elementId: only.id,
      label: only.label,
      start: only.start,
      stop: only.stop,
    };
  }
  return {
    elementId: null,
    label: "Whole strip",
    start: 0,
    stop: ledCount,
  };
}

export function parseLiveLeds(body: unknown, ledCount: number): LiveRead | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const raw = root.leds;
  if (!Array.isArray(raw) || ledCount < 1) return null;
  const source = parseNightplotTag(root.nightplot);

  if (raw.every((item) => typeof item === "string")) {
    return {
      source,
      leds: padLeds(
        raw.map((item) => parseHexColor(item)),
        ledCount,
      ),
    };
  }
  if (raw.every((item) => Array.isArray(item))) {
    return {
      source,
      leds: padLeds(
        raw.map((item) => {
          const rgb = item as unknown[];
          if (rgb.length < 3) return null;
          return rgbToHex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2]));
        }),
        ledCount,
      ),
    };
  }
  if (raw.every((item) => typeof item === "number") && raw.length >= ledCount * 3) {
    const leds: (string | null)[] = [];
    for (let i = 0; i < ledCount; i += 1) {
      leds.push(rgbToHex(Number(raw[i * 3]), Number(raw[i * 3 + 1]), Number(raw[i * 3 + 2])));
    }
    return { source, leds };
  }
  return null;
}

export function countRangeMatches(
  leds: (string | null)[],
  start: number,
  stop: number,
  color: string,
): { matched: number; total: number } {
  let matched = 0;
  let total = 0;
  for (let i = start; i < stop && i < leds.length; i += 1) {
    total += 1;
    if (colorsMatch(leds[i] ?? null, color)) matched += 1;
  }
  return { matched, total };
}

export function beadsFromLive(
  leds: (string | null)[] | null,
  ledCount: number,
  reachable: boolean,
): BeadColor[] {
  if (!reachable) return Array.from({ length: ledCount }, () => "unknown");
  if (!leds) return Array.from({ length: ledCount }, () => "unknown");
  return padLeds(leds, ledCount).map((led) => led ?? null);
}

export function fixtureCaption(source: LiveSource): string {
  return (
    softwareHonestyCaption(source) ??
    "The controller reported this. A person still has to confirm — not Hardware Done."
  );
}

/**
 * Caption when a Preview session hop skipped `/json/live`.
 * Fixture / sim keep their Quiet captions. A controller hop does not claim a report.
 */
export function previewHopCaption(source: LiveSource): string {
  return softwareHonestyCaption(source) ?? PREVIEW_HOP_UNREAD_CAPTION;
}

/**
 * First locate when restore `state.seg` length is unknown. Pairs the soft
 * overlay write with refuse-clear-as-success chrome. Fixture / sim keep
 * Quiet captions in front. Never “controller reported this” / Applied.
 * Preview is not Apply.
 */
export function firstLocateUnknownCaption(source: LiveSource): string {
  const software = softwareHonestyCaption(source);
  return software
    ? `${software} ${FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION}`
    : FIRST_LOCATE_UNKNOWN_SEGMENTS_CAPTION;
}

/** Locate hop caption. Unknown leftover count wins over a live-read claim. */
export function previewLocateCaption(input: {
  source: LiveSource;
  live: LiveRead | null;
  leftoverUnknown: boolean;
}): string {
  if (input.leftoverUnknown) return firstLocateUnknownCaption(input.source);
  return input.live ? fixtureCaption(input.source) : previewHopCaption(input.source);
}

/**
 * Inspect / Light refresh caption. First-locate unknown leftover chrome
 * wins over a live-read / fixture line while that Preview session is open.
 * Does not invent leftover counts. Named-Element leftover-count chrome is
 * out of scope. Preview is not Apply.
 */
export function decorateLiveCaption(input: {
  live: LiveRead | null;
  session: Pick<LiveSession, "source" | "leftoverClears"> | null | undefined;
}): string | null {
  if (input.session?.leftoverClears === "unknown") {
    return firstLocateUnknownCaption(input.live?.source ?? input.session.source);
  }
  if (input.live) return fixtureCaption(input.live.source);
  if (input.session) return fixtureCaption(input.session.source);
  return null;
}

export function proofLadder(input: {
  sentAt: string | null;
  reported: LiveMatch | null;
  seenByYou: SeenByYou;
  label: string;
}): ProofRung[] {
  return [
    {
      key: "sent",
      label: "Sent to controller",
      done: Boolean(input.sentAt),
      detail: input.sentAt ?? undefined,
    },
    {
      key: "reported",
      label: input.reported
        ? `Controller reports ${input.reported.matched} / ${input.reported.total} in ${input.label}`
        : "Controller reports",
      done: Boolean(input.reported && input.reported.total > 0 && input.reported.matched === input.reported.total),
      detail: input.reported && input.reported.matched !== input.reported.total
        ? "readback does not match yet"
        : input.reported
          ? "others untouched"
          : undefined,
    },
    {
      key: "person",
      label:
        input.seenByYou === "yes"
          ? "You said you see it"
          : input.seenByYou === "no"
            ? "You said no / not sure"
            : `Is ${input.label} that colour right now?`,
      done: input.seenByYou === "yes",
    },
  ];
}

function padLeds(leds: (string | null)[], ledCount: number): (string | null)[] {
  const out = leds.slice(0, ledCount);
  while (out.length < ledCount) out.push(null);
  return out;
}
