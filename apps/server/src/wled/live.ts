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
  /**
   * Temporary transition in 100ms units (WLED `tt`). Locate frames send `0`
   * so HTTP hops do not fade-crawl while a segment start/stop moves.
   */
  tt?: number;
  seg?: { id?: number; start: number; stop: number; col?: number[][] }[];
};

export type PreviewSpan = { start: number; stop: number; color: string };
export type WledSegWrite = NonNullable<WledStateWrite["seg"]>[number];

/** Stable compare for Preview hop short-circuit. Same body → no controller POST. */
export function writeBodiesEqual(a: WledStateWrite, b: WledStateWrite): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

/**
 * End Preview restore after a locate overlay. Restore still writes known
 * fields only — never invents on / bri / restore ranges / colour. Append
 * `stop: 0` only for leftover overlay ids we authored on the last overlay
 * picture (`id > 0` and still lit). Id 0 stays the un-id’d restore slot
 * when restore names ranges. Unknown / empty restore still omits restore
 * ranges; leftover overlay ids are still cleared so they do not stay the
 * last overlay colour. Does not invent a leftover count. Preview is not Apply.
 */
export function restoreWriteLeavingOverlay(
  restore: Pick<LiveRestoreSnapshot, "on" | "brightness" | "color" | "segments">,
  previous: WledStateWrite | undefined,
): WledStateWrite {
  const desired = restoreWrite(restore);
  const leftovers = leftoverOverlayClears(previous);
  if (leftovers.length === 0) return desired;
  return { ...desired, seg: [...(desired.seg ?? []), ...leftovers] };
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
 * Lit pieces for a locate picture. Adjacent same-colour spans merge.
 * An earlier span keeps LEDs that a later span also claims.
 * Black gaps are not pieces — the overlay background covers them.
 */
export function locateLitPieces(spans: PreviewSpan[], ledCount: number): PreviewSpan[] {
  const ordered = [...spans]
    .filter((span) => span.stop > span.start)
    .sort((a, b) => a.start - b.start || a.stop - b.stop);
  const pieces: PreviewSpan[] = [];
  let cursor = 0;
  for (const span of ordered) {
    const start = Math.max(span.start, cursor);
    const stop = Math.min(span.stop, ledCount);
    if (stop > start && !isBlackTriple(hexToTriple(span.color))) {
      pieces.push({ start, stop, color: span.color });
    }
    cursor = Math.max(cursor, stop);
  }
  const merged: PreviewSpan[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    if (prev && prev.color === piece.color && prev.stop === piece.start) prev.stop = piece.stop;
    else merged.push({ ...piece });
  }
  return merged;
}

/**
 * Full locate picture over HTTP `/json/state` (not UDP, not websocket).
 * Segment 0 is the whole-strip black underlay when anything is unlit.
 * Lit pieces are 1… — no black-gap tiles, so a cursor hop does not
 * rewrite a three-piece black|lit|black table. Adjacent same-colour
 * merge stays. A first picture is ids 0…n. Later hops reuse previous
 * overlay ids when start/stop/col match (`stabilizeLocateOverlayIds`)
 * so a gap cursor between Elements does not remap later lit ids.
 * That is hop packing, not a persistent Element→seg identity.
 * First locate leftover controller ids use `firstLocateWrite` from a
 * known snapshot count — not invented here. Unknown count is a soft
 * picture write plus `unknown-segment-count` refuse, not a leftover invent.
 */
export function overlayLocatePicture(
  spans: PreviewSpan[],
  brightness: number,
  ledCount: number,
): WledStateWrite {
  const lit = locateLitPieces(spans, ledCount);
  const seg: WledSegWrite[] = [];
  const coversAll =
    lit.length === 1 && lit[0] != null && lit[0].start === 0 && lit[0].stop === ledCount;
  if (ledCount > 0 && !coversAll) {
    seg.push({ id: 0, start: 0, stop: ledCount, col: [[0, 0, 0]] });
  }
  for (const piece of lit) {
    seg.push({
      id: seg.length,
      start: piece.start,
      stop: piece.stop,
      col: [hexToTriple(piece.color)],
    });
  }
  if (seg.length === 0 && ledCount > 0) {
    seg.push({ id: 0, start: 0, stop: ledCount, col: [[0, 0, 0]] });
  }
  return { on: true, bri: brightness, tt: 0, seg };
}

/**
 * Keep overlay ids for unchanged start/stop/col. A gap cursor sorted
 * into `locateLitPieces` would otherwise take the next sequential id
 * and shift later Elements (Door 10–14: id 2→3). `locateHopWrite` keys
 * by id, so that remap would rewrite a range that did not change.
 * Unmatched pieces take vacated ids, then the next unused integer.
 * No previous overlay → the 0…n picture is unchanged. Not a stored
 * Element identity. Preview is not Apply.
 */
export function stabilizeLocateOverlayIds(
  desired: WledStateWrite,
  previous: WledStateWrite | undefined,
): WledStateWrite {
  const nextSegs = desired.seg;
  const prevSegs = previous?.seg;
  if (!nextSegs?.length || !prevSegs?.length) return desired;
  if (!nextSegs.every((seg) => seg.id != null) || !prevSegs.every((seg) => seg.id != null)) {
    return desired;
  }
  const remaining = [...prevSegs];
  const assigned: { next: WledSegWrite; id: number | null }[] = [];
  for (const next of nextSegs) {
    const matchAt = remaining.findIndex((prev) => segsGeometryEqual(prev, next));
    if (matchAt >= 0) {
      const prev = remaining.splice(matchAt, 1)[0]!;
      assigned.push({ next, id: prev.id ?? null });
    } else {
      assigned.push({ next, id: null });
    }
  }
  const used = new Set(
    assigned.map((row) => row.id).filter((id): id is number => id != null),
  );
  const vacated = remaining
    .map((seg) => seg.id)
    .filter((id): id is number => id != null && !used.has(id))
    .sort((a, b) => a - b);
  let nextId = 0;
  const allocId = (): number => {
    while (vacated.length > 0) {
      const id = vacated.shift()!;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    while (used.has(nextId)) nextId += 1;
    const id = nextId;
    used.add(id);
    nextId += 1;
    return id;
  };
  const seg = assigned.map((row) => ({
    ...row.next,
    id: row.id ?? allocId(),
  }));
  return { ...desired, seg };
}

/**
 * When only the cursor (or other lit) segments moved, POST those ids.
 * Leave the id-0 underlay unmentioned so WLED does not rebuild it.
 * Leftover ids from a shorter picture get `stop: 0`. Geometry-equal
 * pieces keep their previous ids first, so inserting a gap cursor
 * does not rewrite a later Element that still has the same range and
 * colour. HTTP is the ceiling here — a still-flashing metal strip is
 * a needs-split sibling, not UDP in this slice.
 */
export function locateHopWrite(
  desired: WledStateWrite,
  previous: WledStateWrite | undefined,
): WledStateWrite {
  const stable = stabilizeLocateOverlayIds(desired, previous);
  const nextSegs = stable.seg;
  const prevSegs = previous?.seg;
  if (!nextSegs || !prevSegs) return stable;
  if (!nextSegs.every((seg) => seg.id != null) || !prevSegs.every((seg) => seg.id != null)) {
    return stable;
  }
  const prevById = new Map(prevSegs.map((seg) => [seg.id, seg]));
  const nextIds = new Set(nextSegs.map((seg) => seg.id));
  const changed: WledSegWrite[] = [];
  for (const seg of nextSegs) {
    const prev = prevById.get(seg.id);
    if (!prev || !segsEqual(prev, seg)) changed.push(seg);
  }
  const leftovers: WledSegWrite[] = [];
  for (const prev of prevSegs) {
    if (prev.id != null && !nextIds.has(prev.id) && prev.stop > prev.start) {
      leftovers.push({ id: prev.id, start: 0, stop: 0 });
    }
  }
  const hopSegs = [...changed, ...leftovers];
  const underlayTouched = changed.some((seg) => seg.id === 0);
  if (underlayTouched) {
    return leftovers.length === 0 ? stable : { ...stable, seg: [...nextSegs, ...leftovers] };
  }
  if (hopSegs.length === 0) return stable;
  const hop: WledStateWrite = { tt: stable.tt ?? 0, seg: hopSegs };
  if (stable.on !== previous.on) hop.on = stable.on;
  if (stable.bri !== previous.bri) hop.bri = stable.bri;
  return hop;
}

/**
 * Last POST was a locate overlay picture (ids 0…n). Hops compare against that
 * picture. A named-Element / Blink write is un-id’d — not overlay.
 */
export function isLocateOverlayWrite(write: WledStateWrite | undefined): boolean {
  const segs = write?.seg;
  return Boolean(segs?.length && segs.every((seg) => seg.id != null));
}

export type FirstLocateWriteResult =
  | { ok: true; body: WledStateWrite }
  | { ok: false; reason: "unknown-segment-count"; body: WledStateWrite };

/**
 * First locate open: `stop: 0` leftover controller ids above the overlay
 * picture when `previousSegmentCount` is known and higher. Same leftover-id
 * class as Apply’s known-count clears — not leftover vs a prior locate
 * picture (`locateHopWrite`). Unknown (`null`) is not zero: leftover
 * clears refuse (`unknown-segment-count`) and the body stays the overlay
 * picture — soft write, never an invented leftover count. Known empty is
 * no leftover clears. Overlay ids stay 0…n; we do not invent a stable
 * segment identity. Preview is not Apply.
 */
export function firstLocateWrite(
  picture: WledStateWrite,
  previousSegmentCount: number | null,
): FirstLocateWriteResult {
  if (previousSegmentCount === null) {
    return { ok: false, reason: "unknown-segment-count", body: picture };
  }
  const segs = picture.seg;
  if (!segs?.length) return { ok: true, body: picture };
  const overlayCount = overlayAuthoredIdCount(segs);
  if (previousSegmentCount <= overlayCount) return { ok: true, body: picture };
  const leftovers: WledSegWrite[] = [];
  for (let id = overlayCount; id < previousSegmentCount; id += 1) {
    leftovers.push({ id, start: 0, stop: 0 });
  }
  return { ok: true, body: { ...picture, seg: [...segs, ...leftovers] } };
}

/**
 * Paint several spans. Locate uses the overlay picture (underlay + lit
 * pieces). Adjacent same-colour merge stays. Preview is not Apply.
 */
export function previewWriteSpans(
  spans: PreviewSpan[],
  brightness: number,
  ledCount: number,
): WledStateWrite {
  return overlayLocatePicture(spans, brightness, ledCount);
}

export function previewWrite(
  start: number,
  stop: number,
  color: string,
  brightness: number,
  ledCount?: number,
): WledStateWrite {
  const locateRest = ledCount != null && ledCount > 0 && (start > 0 || stop < ledCount);
  if (locateRest && ledCount != null) {
    return overlayLocatePicture([{ start, stop, color }], brightness, ledCount);
  }
  return { on: true, bri: brightness, seg: [{ start, stop, col: [hexToTriple(color)] }] };
}

/**
 * Named-Element / Blink Preview posts one un-id’d segment. WLED keeps leftover
 * overlay ids (underlay 0 + lit 1…) unless they are cleared. Append `stop: 0`
 * only for leftover ids we authored on the last overlay picture — never invent
 * a first-locate leftover count. First locate leftover controller ids are
 * `firstLocateWrite` from a known snapshot count (CONFIG-137). Id 0 stays
 * the un-id’d Preview slot. Preview is not Apply.
 */
export function previewWriteLeavingOverlay(
  desired: WledStateWrite,
  previous: WledStateWrite | undefined,
): WledStateWrite {
  const nextSegs = desired.seg;
  if (!nextSegs?.length) return desired;
  if (nextSegs.some((seg) => seg.id != null)) return desired;
  const leftovers = leftoverOverlayClears(previous);
  if (leftovers.length === 0) return desired;
  return { ...desired, seg: [...nextSegs, ...leftovers] };
}

/** Leftover overlay ids we authored (`id > 0`, still lit). Never invents a count. */
function leftoverOverlayClears(previous: WledStateWrite | undefined): WledSegWrite[] {
  const prevSegs = previous?.seg;
  if (!prevSegs?.length || !prevSegs.every((seg) => seg.id != null)) return [];
  const leftovers: WledSegWrite[] = [];
  for (const seg of prevSegs) {
    if (seg.id != null && seg.id > 0 && seg.stop > seg.start) {
      leftovers.push({ id: seg.id, start: 0, stop: 0 });
    }
  }
  return leftovers;
}

function hexToTriple(hex: string): [number, number, number] {
  const raw = hex.replace(/^#/, "");
  return [
    Number.parseInt(raw.slice(0, 2), 16) || 0,
    Number.parseInt(raw.slice(2, 4), 16) || 0,
    Number.parseInt(raw.slice(4, 6), 16) || 0,
  ];
}

function isBlackTriple(rgb: [number, number, number]): boolean {
  return rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0;
}

function overlayAuthoredIdCount(segs: WledSegWrite[]): number {
  const ids = segs.map((seg) => seg.id).filter((id): id is number => id != null);
  if (ids.length === 0) return segs.length;
  return Math.max(...ids) + 1;
}

function segsGeometryEqual(a: WledSegWrite, b: WledSegWrite): boolean {
  return (
    a.start === b.start &&
    a.stop === b.stop &&
    JSON.stringify(a.col ?? null) === JSON.stringify(b.col ?? null)
  );
}

function segsEqual(a: WledSegWrite, b: WledSegWrite): boolean {
  return a.id === b.id && segsGeometryEqual(a, b);
}

function hostForUrl(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}
