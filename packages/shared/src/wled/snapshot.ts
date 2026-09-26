import type { RangeSpan } from "../range.ts";

export type WledSnapshot = {
  name: string;
  firmware: string;
  mac: string | null;
  ledCount: number;
  rgbw: boolean;
  on: boolean | null;
  brightness: number | null;
  segmentColor: string | null;
  segments: RangeSpan[];
};

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
  };
}

/** WLED stop is exclusive. Missing start/stop on a listed seg uses the strip defaults. */
function parseSegments(
  state: Record<string, unknown> | null,
  ledCount: number,
): RangeSpan[] {
  if (!state || !Array.isArray(state.seg)) return [];
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
