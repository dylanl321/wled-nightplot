import {
  hexToRgb,
  parseLiveLeds,
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

export function restoreWrite(
  restore: Pick<LiveRestoreSnapshot, "on" | "brightness" | "color" | "segments"> & {
    ledCount: number;
  },
): WledStateWrite {
  const known = restore.segments;
  const segs =
    known.length > 0
      ? known
      : restore.color
        ? [{ start: 0, stop: restore.ledCount, color: restore.color }]
        : [];
  return {
    ...restoreOnField(restore.on),
    ...restoreBriField(restore.brightness),
    ...(segs.length > 0
      ? {
          seg: segs.map((seg) => ({
            start: seg.start,
            stop: seg.stop,
            ...restoreColField(seg.color ?? restore.color),
          })),
        }
      : {}),
  };
}

export function restoreWriteFromSnapshot(snapshot: WledSnapshot): WledStateWrite {
  return restoreWrite({
    on: snapshot.on,
    brightness: snapshot.brightness,
    color: snapshot.segmentColor,
    segments: (snapshot.segments ?? []).map((seg) => ({
      start: seg.start,
      stop: seg.stop,
      color: snapshot.segmentColor,
    })),
    ledCount: snapshot.ledCount,
  });
}

/**
 * Apply range write. Colour is only attached when it is a known hex —
 * never `null → #ffa000`. Apply itself refuses unknown colour before this
 * runs. Preview is not Apply.
 */
export function applyRangesWrite(
  ranges: { start: number; stop: number }[],
  previousSegmentCount: number,
  color: string,
): WledStateWrite {
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
  return { seg };
}

export function previewWrite(
  start: number,
  stop: number,
  color: string,
  brightness: number,
): WledStateWrite {
  return {
    on: true,
    bri: brightness,
    seg: [{ start, stop, col: [hexToTriple(color)] }],
  };
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
