import {
  hexToRgb,
  parseLiveLeds,
  restoreSegmentsFromSnapshot,
  type HostPort,
  type LiveRead,
  type LiveRestoreSnapshot,
  type WledSnapshot,
} from "@nightplot/shared";

export type WledStateWrite = {
  on?: boolean;
  bri?: number;
  seg?: { id?: number; start: number; stop: number; col?: number[][] }[];
};

export type WriteStateFn = (target: HostPort, body: WledStateWrite) => Promise<boolean>;
export type ReadLiveFn = (target: HostPort, ledCount: number) => Promise<LiveRead | null>;

const TIMEOUT_MS = 3000;

export function createWledWriter(fetchFn: typeof fetch = fetch): WriteStateFn {
  return (target, body) => writeWledState(target, body, fetchFn);
}

export function createWledLiveReader(fetchFn: typeof fetch = fetch): ReadLiveFn {
  return (target, ledCount) => readWledLive(target, ledCount, fetchFn);
}

export async function writeWledState(
  target: HostPort,
  body: WledStateWrite,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<boolean> {
  const url = `http://${hostForUrl(target.hostname)}:${target.port}/json/state`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "POST",
      signal: ac.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function readWledLive(
  target: HostPort,
  ledCount: number,
  fetchFn: typeof fetch = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<LiveRead | null> {
  const url = `http://${hostForUrl(target.hostname)}:${target.port}/json/live`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return parseLiveLeds(body, ledCount);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Preview / Blink restore writes power only when the snapshot knew it.
 * Info-only `on: null` (skipped or hung `/json/state`) stays omitted —
 * never `null → true`. That would invent power. Preview is not Apply.
 */
export function restoreOnField(on: boolean | null | undefined): Pick<WledStateWrite, "on"> {
  return typeof on === "boolean" ? { on } : {};
}

/**
 * Restore writes brightness only when the snapshot knew it.
 * Info-only `brightness: null` stays omitted — never `null → 128`.
 */
export function restoreBriField(
  brightness: number | null | undefined,
): Pick<WledStateWrite, "bri"> {
  return typeof brightness === "number" ? { bri: brightness } : {};
}

/**
 * Restore writes segment colour only when the snapshot knew it.
 * Info-only `segmentColor: null` stays omitted — never `null → #ffa000`.
 */
export function restoreColField(
  color: string | null | undefined,
): { col: [number, number, number][] } | Record<string, never> {
  const rgb = color ? hexToRgb(color) : null;
  return rgb ? { col: [rgb] } : {};
}

/**
 * Restore writes segments only when the snapshot knew them.
 * Info-only `segments: null` stays omitted — never `null → []` then a
 * whole-strip invent from colour. Known empty `[]` restores as empty.
 */
export function restoreSegField(
  segments: LiveRestoreSnapshot["segments"] | undefined,
  color: string | null | undefined,
): Pick<WledStateWrite, "seg"> {
  if (segments == null || segments.length === 0) return {};
  return {
    seg: segments.map((seg) => ({
      start: seg.start,
      stop: seg.stop,
      ...restoreColField(seg.color ?? color),
    })),
  };
}

export function restoreWrite(
  restore: Pick<LiveRestoreSnapshot, "on" | "brightness" | "color" | "segments">,
): WledStateWrite {
  return {
    ...restoreOnField(restore.on),
    ...restoreBriField(restore.brightness),
    ...restoreSegField(restore.segments, restore.color),
  };
}

export function restoreWriteFromSnapshot(snapshot: WledSnapshot): WledStateWrite {
  return restoreWrite({
    on: snapshot.on,
    brightness: snapshot.brightness,
    color: snapshot.segmentColor,
    segments: restoreSegmentsFromSnapshot(snapshot.segments, snapshot.segmentColor),
  });
}

export type ApplyRangesWriteResult =
  | { ok: true; body: WledStateWrite }
  | { ok: false; reason: "unknown-segment-count" };

/**
 * Apply writes declared ranges, then `stop: 0` leftover-segment clears for
 * ids from `ranges.length` .. `previousSegmentCount` when that count is known.
 * Unknown (`null`) is not zero — leftover clears are refused, not invented.
 * Colour is only attached when it is a known hex — never `null → #ffa000`.
 * Apply itself refuses unknown colour before this runs. Preview is not Apply.
 */
export function applyRangesWrite(
  ranges: { start: number; stop: number }[],
  previousSegmentCount: number | null,
  color: string,
): ApplyRangesWriteResult {
  if (previousSegmentCount === null) {
    return { ok: false, reason: "unknown-segment-count" };
  }
  const col = restoreColField(color);
  const seg: NonNullable<WledStateWrite["seg"]> = ranges.map((range, id) => ({
    id,
    start: range.start,
    stop: range.stop,
    ...col,
  }));
  for (let id = ranges.length; id < previousSegmentCount; id += 1) {
    seg.push({ id, start: 0, stop: 0, ...col });
  }
  return { ok: true, body: { seg } };
}

/**
 * Paint several spans and black every LED they do not cover, so the
 * controller matches the screen. Adjacent spans of the same colour merge.
 * An earlier span keeps LEDs that a later span also claims.
 */
export function previewWriteSpans(
  spans: { start: number; stop: number; color: string }[],
  brightness: number,
  ledCount: number,
): WledStateWrite {
  const ordered = [...spans]
    .filter((span) => span.stop > span.start)
    .sort((a, b) => a.start - b.start || a.stop - b.stop);
  const pieces: { start: number; stop: number; color: string }[] = [];
  let cursor = 0;
  for (const span of ordered) {
    const start = Math.max(span.start, cursor);
    const stop = Math.min(span.stop, ledCount);
    if (start > cursor) pieces.push({ start: cursor, stop: start, color: "#000000" });
    if (stop > start) pieces.push({ start, stop, color: span.color });
    cursor = Math.max(cursor, stop);
  }
  if (cursor < ledCount) pieces.push({ start: cursor, stop: ledCount, color: "#000000" });
  const merged: { start: number; stop: number; color: string }[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && prev.color === piece.color && prev.stop === piece.start) prev.stop = piece.stop;
    else merged.push({ ...piece });
  }
  return {
    on: true,
    bri: brightness,
    seg: merged.map((piece, id) => ({
      id,
      start: piece.start,
      stop: piece.stop,
      col: [hexToTriple(piece.color)],
    })),
  };
}

export function previewWrite(
  start: number,
  stop: number,
  color: string,
  brightness: number,
  ledCount?: number,
): WledStateWrite {
  const lit = hexToTriple(color);
  const off: [number, number, number] = [0, 0, 0];
  const seg: NonNullable<WledStateWrite["seg"]> = [];
  const blackRest = ledCount != null && ledCount > 0 && (start > 0 || stop < ledCount);
  if (blackRest && ledCount != null) {
    if (start > 0) seg.push({ id: seg.length, start: 0, stop: start, col: [off] });
    if (stop > start) seg.push({ id: seg.length, start, stop, col: [lit] });
    if (stop < ledCount) seg.push({ id: seg.length, start: stop, stop: ledCount, col: [off] });
  } else {
    seg.push({ start, stop, col: [lit] });
  }
  return { on: true, bri: brightness, seg };
}

function hexToTriple(hex: string): [number, number, number] {
  const raw = hex.replace(/^#/, "");
  return [
    Number.parseInt(raw.slice(0, 2), 16) || 0,
    Number.parseInt(raw.slice(2, 4), 16) || 0,
    Number.parseInt(raw.slice(4, 6), 16) || 0,
  ];
}

function hostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
