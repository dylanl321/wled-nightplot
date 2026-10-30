/**
 * On-demand sync across Lights: copy WLED presets, copy the current colours
 * and effects, or turn on one preset everywhere.
 *
 * Nightplot pushes once and rereads. It does not keep controllers in step
 * afterwards, and a matched reread is not Hardware Done.
 */

import type { WledNativeRestore } from "./wled/snapshot.ts";

export type SyncKind = "presets" | "look" | "preset";

export type WledPresetSummary = {
  /** WLED preset slot, 1–250. Slot 0 is WLED's placeholder and is never listed. */
  id: number;
  name: string;
  kind: "preset" | "playlist";
};

export type SyncRowStatus = "matched" | "mismatch" | "unknown" | "failed" | "refused";

export type SyncRow = {
  lightId: string;
  lightName: string;
  status: SyncRowStatus;
  detail: string;
  safetyBackupId?: string;
};

export type SyncWarning = { lightId: string; lightName: string; message: string };

export type SyncResult = {
  kind: SyncKind;
  sourceLightId: string | null;
  rows: SyncRow[];
  message: string;
  caption: string;
};

export const SYNC_CAPTION =
  "Each Light is listed by what it reported after the push. Nightplot does not keep them in step afterwards. Not Hardware Done.";

export const WLED_PRESET_MIN = 1;
export const WLED_PRESET_MAX = 250;

/**
 * Per-segment look fields WLED reports in `state.seg[]` and accepts back.
 * Geometry (`start`, `stop`, `grp`, `spc`, `of`, `rev`, `mi`) and identity
 * (`id`, `n`, `sel`) stay with each target's own Segments.
 */
export const SYNC_LOOK_KEYS = [
  "on", "bri", "col", "cct", "fx", "sx", "ix", "pal", "c1", "c2", "c3", "o1", "o2", "o3", "si", "m12",
] as const;

export function isPresetId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= WLED_PRESET_MIN && value <= WLED_PRESET_MAX;
}

/** WLED `presets.json` → listed slots. Malformed slots are skipped, not guessed. */
export function parseWledPresets(raw: string): { ok: true; presets: WledPresetSummary[] } | { ok: false; message: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { ok: false, message: "WLED presets.json was not JSON." }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, message: "WLED presets.json was not a JSON object." };
  const presets: WledPresetSummary[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = Number(key);
    if (!isPresetId(id) || String(id) !== key) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).length === 0) continue;
    const name = typeof entry.n === "string" && entry.n.trim() ? entry.n.trim() : `Preset ${id}`;
    presets.push({ id, name, kind: entry.playlist && typeof entry.playlist === "object" ? "playlist" : "preset" });
  }
  presets.sort((a, b) => a.id - b.id);
  return { ok: true, presets };
}

/** Same presets file, independent of whitespace and key order. */
export function presetsMatch(a: string, b: string): boolean | null {
  try { return canonical(JSON.parse(a)) === canonical(JSON.parse(b)); }
  catch { return null; }
}

export type SyncLookSegment = {
  id: number;
  col?: number[][];
  on?: boolean; o1?: boolean; o2?: boolean; o3?: boolean;
  bri?: number; cct?: number; fx?: number; sx?: number; ix?: number; pal?: number;
  c1?: number; c2?: number; c3?: number; si?: number; m12?: number;
};

export type SyncLookWrite = { on: boolean; bri: number; seg: SyncLookSegment[] };

const BOOLEAN_LOOK_KEYS: ReadonlySet<string> = new Set(["on", "o1", "o2", "o3"]);

/**
 * Copy the source look onto the target's own segments. Target segment N takes
 * source segment N; extra target segments take the source's last segment.
 * White is dropped for an RGB-only target and padded with 0 for RGBW.
 */
export function buildSyncLookWrite(
  source: WledNativeRestore,
  target: WledNativeRestore,
  targetRgbw: boolean,
): SyncLookWrite | null {
  if (!source.seg.length || !target.seg.length) return null;
  return {
    on: source.on,
    bri: source.bri,
    seg: target.seg.map((segment, index) => {
      const from = source.seg[Math.min(index, source.seg.length - 1)]!;
      const row: Record<string, unknown> = { id: segment.id, col: fitColours(from.col, targetRgbw) };
      for (const key of SYNC_LOOK_KEYS) {
        if (key === "col") continue;
        const value = from[key];
        if (BOOLEAN_LOOK_KEYS.has(key) ? typeof value === "boolean" : typeof value === "number" && Number.isFinite(value))
          row[key] = value;
      }
      return row as SyncLookSegment;
    }),
  };
}

/** True only when every sent field is reported back unchanged. */
export function syncLookMatches(sent: SyncLookWrite, read: WledNativeRestore | null | undefined): boolean | null {
  if (!read) return null;
  if (read.on !== sent.on || read.bri !== sent.bri) return false;
  for (const row of sent.seg) {
    const got = read.seg.find((segment) => segment.id === row.id);
    if (!got) return false;
    for (const [key, value] of Object.entries(row)) {
      if (key === "id") continue;
      if (canonical(got[key]) !== canonical(value)) return false;
    }
  }
  return true;
}

/** Differences that make a copy land differently on the target. Nothing is refused for these alone. */
export function syncWarnings(input: {
  kind: SyncKind;
  source: { ledCount: number; firmware: string | null; segmentCount: number | null };
  target: { lightId: string; lightName: string; ledCount: number; firmware: string | null; segmentCount: number | null };
}): SyncWarning[] {
  const { source, target, kind } = input;
  const out: SyncWarning[] = [];
  const push = (message: string) => out.push({ lightId: target.lightId, lightName: target.lightName, message });
  if (kind === "presets" && source.ledCount !== target.ledCount)
    push(`${target.lightName} has ${target.ledCount} LEDs; the source has ${source.ledCount}. WLED clips or leaves gaps in preset segments that do not fit.`);
  if (kind === "presets" && source.firmware && target.firmware && source.firmware !== target.firmware)
    push(`${target.lightName} runs ${target.firmware}; the source runs ${source.firmware}. Presets may use fields that firmware handles differently.`);
  if (kind === "look" && source.segmentCount !== null && target.segmentCount !== null && source.segmentCount !== target.segmentCount)
    push(`${target.lightName} has ${target.segmentCount} WLED segments; the source has ${source.segmentCount}. Segments are matched in order and extras take the source’s last segment.`);
  return out;
}

export function syncSummary(kind: SyncKind, rows: SyncRow[]): string {
  const matched = rows.filter((row) => row.status === "matched").length;
  const verb = kind === "presets" ? "have the copied presets" : kind === "look" ? "report the copied look" : "report the preset on";
  if (rows.length === 0) return "No Lights were chosen. Nothing was sent.";
  if (matched === rows.length) return `${matched} of ${rows.length} ${verb}.`;
  return `${matched} of ${rows.length} ${verb}. Check the Lights listed below.`;
}

function fitColours(col: number[][], rgbw: boolean): number[][] {
  return col.map((colour) => rgbw ? [...colour.slice(0, 3), colour[3] ?? 0] : colour.slice(0, 3));
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}
