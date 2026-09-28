import type { RangeSpan } from "../range.ts";

export type WledNativeSegment = {
  id: number; start: number; stop: number; col: number[][]; frz: boolean;
  [key: string]: unknown;
};
export type WledNativeRestore = { on: boolean; bri: number; seg: WledNativeSegment[] };

export type WledSnapshot = {
  name: string;
  firmware: string;
  mac: string | null;
  ledCount: number;
  rgbw: boolean;
  on: boolean | null;
  brightness: number | null;
  segmentColor: string | null;
  /**
   * Reported `state.seg` spans. `null` when state was skipped/hung or `seg`
   * was not an array — unknown, not zero. `[]` is a known empty list.
   */
  segments: RangeSpan[] | null;
  /** Restorable state for individual-pixel Preview. Never derived from an RGB bead. */
  nativeRestore?: WledNativeRestore;
};

/** Unknown when `segments` is null. Distinct from a known empty `[]`. */
export function snapshotSegmentCount(
  snapshot: Pick<WledSnapshot, "segments"> | null | undefined,
): number | null {
  if (!snapshot || snapshot.segments === null) return null;
  return snapshot.segments.length;
}

export function parseWledPayload(body: unknown): WledSnapshot | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const info = isRecord(root.info) ? root.info : looksLikeInfo(root) ? root : null;
  const state = isRecord(root.state) ? root.state : isRecord(root.on) ? root : null;
  if (!info) return null;

  const leds = isRecord(info.leds) ? info.leds : null;
  const count = typeof leds?.count === "number" ? leds.count : null;
  const ver = typeof info.ver === "string" ? info.ver : null;
  if (count === null || count < 0 || !ver) return null;
  if (!looksLikeWled(info, root)) return null;

  const name =
    (typeof info.name === "string" && info.name.trim()) ||
    (typeof info.mac === "string" && info.mac ? `WLED-${info.mac.slice(-4)}` : "WLED");

  const on = state && typeof state.on === "boolean" ? state.on : null;
  const brightness =
    state && typeof state.bri === "number" ? clampByte(state.bri) : null;
  const segmentColor = on ? colorFromState(state) : null;

  const nativeRestore = readNativeRestore(state);
  return {
    name,
    firmware: ver.startsWith("0") || ver.includes(".") ? `WLED ${ver}` : ver,
    mac: typeof info.mac === "string" ? formatMac(info.mac) : null,
    ledCount: count,
    rgbw: Boolean(leds?.rgbw),
    on,
    brightness,
    segmentColor,
    segments: parseSegments(state, count),
    ...(nativeRestore ? { nativeRestore } : {}),
  };
}

function readNativeRestore(state: Record<string, unknown> | null): WledNativeRestore | null {
  if (!state || typeof state.on !== "boolean" || !Number.isInteger(state.bri)
    || Number(state.bri) < 0 || Number(state.bri) > 255 || !Array.isArray(state.seg) || !state.seg.length) return null;
  // A playlist or frozen pixel buffer cannot be reconstructed from segment JSON.
  if (typeof state.pl === "number" && state.pl >= 0) return null;
  const segments: WledNativeSegment[] = [];
  const ids = new Set<number>();
  for (const raw of state.seg) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || Number(raw.id) < 0 || ids.has(Number(raw.id))
      || !Number.isInteger(raw.start) || !Number.isInteger(raw.stop) || Number(raw.stop) <= Number(raw.start)
      || Number(raw.start) < 0 || typeof raw.on !== "boolean" || typeof raw.rev !== "boolean" || typeof raw.mi !== "boolean"
      || !["bri", "grp", "spc", "of"].every((key) => Number.isInteger(raw[key]))
      || raw.frz !== false || !Array.isArray(raw.col) || !raw.col.length
      || !raw.col.every((color) => Array.isArray(color) && color.length >= 3 && color.length <= 4
        && color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255))) return null;
    ids.add(Number(raw.id));
    const segment: WledNativeSegment = {
      id: Number(raw.id), start: Number(raw.start), stop: Number(raw.stop),
      col: raw.col.map((color) => [...color]), frz: false,
    };
    for (const key of ["on", "bri", "cct", "grp", "spc", "of", "rev", "mi", "fx", "sx", "ix", "pal",
      "c1", "c2", "c3", "o1", "o2", "o3", "sel", "set", "m12", "si", "n"]) {
      const value = raw[key];
      if (typeof value === "boolean" || typeof value === "string"
        || (typeof value === "number" && Number.isFinite(value))) segment[key] = value;
    }
    segments.push(segment);
  }
  return { on: state.on, bri: Number(state.bri), seg: segments };
}

/** WLED stop is exclusive. Missing start/stop on a listed seg uses the strip defaults. */
function parseSegments(
  state: Record<string, unknown> | null,
  ledCount: number,
): RangeSpan[] | null {
  if (!state || !Array.isArray(state.seg)) return null;
  const out: RangeSpan[] = [];
  for (const raw of state.seg) {
    if (!isRecord(raw)) continue;
    const start = typeof raw.start === "number" ? raw.start : 0;
    const stop = typeof raw.stop === "number" ? raw.stop : ledCount;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    out.push({ start, stop });
  }
  return out;
}

function looksLikeWled(info: Record<string, unknown>, root: Record<string, unknown>): boolean {
  const brand = typeof info.brand === "string" ? info.brand.toLowerCase() : "";
  const product = typeof info.product === "string" ? info.product.toLowerCase() : "";
  if (brand.includes("wled") || product.includes("wled")) return true;
  if (typeof info.ver === "string" && isRecord(info.leds) && "mac" in info) return true;
  if (isRecord(root.info) && isRecord(root.state) && isRecord(info.leds)) return true;
  return false;
}

function looksLikeInfo(root: Record<string, unknown>): boolean {
  return isRecord(root.leds) && typeof root.ver === "string";
}

function colorFromState(state: Record<string, unknown> | null): string | null {
  if (!state) return null;
  const segs = Array.isArray(state.seg) ? state.seg : [];
  const first = segs[0];
  if (!isRecord(first) || !Array.isArray(first.col) || !Array.isArray(first.col[0])) {
    return null;
  }
  const rgb = first.col[0];
  const r = Number(rgb[0]);
  const g = Number(rgb[1]);
  const b = Number(rgb[2]);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return `#${[r, g, b].map((n) => clampByte(n).toString(16).padStart(2, "0")).join("")}`;
}

function formatMac(raw: string): string {
  const hex = raw.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (hex.length !== 12) return raw;
  return hex.match(/.{2}/g)?.join(":") ?? raw;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
