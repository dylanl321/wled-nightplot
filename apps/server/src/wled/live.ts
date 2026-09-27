import {
  parseLiveLeds,
  type HostPort,
  type LiveRead,
  type WledSnapshot,
} from "@nightplot/shared";

export type WledStateWrite = {
  on?: boolean;
  bri?: number;
  seg?: { id?: number; start: number; stop: number; col: number[][] }[];
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

export function restoreWriteFromSnapshot(snapshot: WledSnapshot): WledStateWrite {
  const color = snapshot.segmentColor ?? "#ffa000";
  const rgb = hexToTriple(color);
  const segs =
    snapshot.segments.length > 0
      ? snapshot.segments
      : [{ start: 0, stop: snapshot.ledCount }];
  return {
    ...restoreOnField(snapshot.on),
    bri: snapshot.brightness ?? 128,
    seg: segs.map((seg) => ({ start: seg.start, stop: seg.stop, col: [rgb] })),
  };
}

export function applyRangesWrite(
  ranges: { start: number; stop: number }[],
  previousSegmentCount: number,
  color: string,
): WledStateWrite {
  const rgb = hexToTriple(color);
  const seg: NonNullable<WledStateWrite["seg"]> = ranges.map((range, id) => ({
    id,
    start: range.start,
    stop: range.stop,
    col: [rgb],
  }));
  for (let id = ranges.length; id < previousSegmentCount; id += 1) {
    seg.push({ id, start: 0, stop: 0, col: [rgb] });
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
