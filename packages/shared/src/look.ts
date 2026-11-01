/**
 * Looks library: named colour/effect styles pushed as the same WLED preset
 * slot numbers on every selected controller. A Look has a whole-yard default
 * and optional overrides for a section of a Prop, a Prop, a Prop kind, or a
 * Segment. A Prop with sections is sent as one WLED segment per section range.
 *
 * Geometry comes from each Light’s own Props / Segments. The slot number is
 * what stays the same across the yard. A matched presets.json reread is not
 * Hardware Done.
 */

import { hexToRgb, parseHexColor } from "./live.ts";
import type { Element } from "./lights.ts";
import { isPropKind, isSharedPostRule, type Prop, type PropKind, type SharedPostRule } from "./prop/types.ts";
import { layoutStrings } from "./prop/layout.ts";
import { sectionIndexRanges } from "./prop/sections.ts";
import { compileWireframe, wireframeGroupForElement } from "./prop/wireframe.ts";
import type { NightlySchedule } from "./schedule.ts";
import { isPresetId, WLED_PRESET_MAX, WLED_PRESET_MIN } from "./sync.ts";
import { isUdpSyncGroup, type UdpSyncRole } from "./udp-sync.ts";

export const LOOK_NAME_MAX = 32;
export const LOOK_OFF_SLOT = 250;
export const LOOK_PLAYLIST_DEFAULT_SLOT = 16;
export const LOOK_DURATION_TENTHS_DEFAULT = 300;
export const LOOK_TRANSITION_TENTHS_DEFAULT = 7;

export const LOOK_CAPTION =
  "Each Light is listed by what it reported after the push. Looks are the same WLED preset numbers on every box. The nightly Schedule is WLED timers plus NTP, so it runs with Nightplot closed. Not Hardware Done.";

export type LookStyle = {
  /** WLED effect id (`seg.fx`). */
  fx: number;
  /** WLED palette id (`seg.pal`). */
  pal: number;
  /** Speed 0–255. */
  sx: number;
  /** Intensity 0–255. */
  ix: number;
  /** Preset brightness 1–255. */
  bri: number;
  /** Primary colour `#rrggbb`. */
  color: string;
  /** Optional second colour for two-colour effects / palettes. */
  color2?: string;
};

export type LookOverride = {
  style: LookStyle;
  /** Specific Prop on one Light. */
  propId?: string;
  /** Every Prop of this kind across the yard. */
  propKind?: PropKind;
  /** Segment fallback when that Light has no Props. */
  elementId?: string;
  /** Wireframe group on a Prop (face.N, tops, outline, …). */
  wireframeGroup?: string;
  /** How shared posts take colour for this Look. */
  sharedPostRule?: SharedPostRule;
  /** A section of `propId`. Section ids are only unique inside one Prop. */
  sectionId?: string;
  /** This target is dark in this Look (the section is not in the Look). */
  off?: true;
};

export type Look = {
  id: string;
  name: string;
  /** WLED preset slot 1–250. Same number on every controller. */
  slot: number;
  style: LookStyle;
  overrides: LookOverride[];
};

export type LookPlaylist = {
  id: string;
  name: string;
  slot: number;
  lookIds: string[];
  /** Time each Look is kept, WLED tenths of a second. */
  durationTenths: number;
  transitionTenths: number;
};

export type LooksDocument = {
  version: 1;
  looks: Look[];
  playlists: LookPlaylist[];
  schedule: NightlySchedule | null;
};

export type LookEffect = { fx: number; label: string };
export type LookPalette = { pal: number; label: string };

/** Stable 0.14+ effect ids used in the library. Unknown firmware may map them differently. */
export const LOOK_EFFECTS: readonly LookEffect[] = [
  { fx: 0, label: "Solid" },
  { fx: 2, label: "Breathe" },
  { fx: 9, label: "Rainbow cycle" },
  { fx: 13, label: "Theater chase" },
  { fx: 15, label: "Running lights" },
  { fx: 17, label: "Twinkle" },
  { fx: 43, label: "Rain" },
];

/** WLED built-in palettes used by the library. */
export const LOOK_PALETTES: readonly LookPalette[] = [
  { pal: 0, label: "Default" },
  { pal: 2, label: "Color 1" },
  { pal: 3, label: "Colors 1 & 2" },
  { pal: 4, label: "Color gradient" },
  { pal: 11, label: "Rainbow" },
];

export const DEFAULT_LOOKS: Look[] = [
  look("look-warm-white", "Warm white", 1, { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" }),
  look("look-cool-white", "Cool white", 2, { fx: 0, pal: 0, sx: 128, ix: 128, bri: 200, color: "#ffffff" }),
  look("look-candy-cane", "Candy cane", 3, { fx: 13, pal: 3, sx: 96, ix: 160, bri: 180, color: "#ff0000", color2: "#ffffff" }),
  look("look-twinkle", "Red green twinkle", 4, { fx: 17, pal: 3, sx: 140, ix: 180, bri: 170, color: "#ff0000", color2: "#00aa00" }),
  look("look-snowfall", "Snowfall", 5, { fx: 43, pal: 0, sx: 80, ix: 160, bri: 160, color: "#e8f4ff" }),
  look("look-rainbow", "Slow rainbow", 6, { fx: 9, pal: 11, sx: 40, ix: 128, bri: 160, color: "#ff0000" }),
  look("look-gold", "Gold shimmer", 7, { fx: 2, pal: 0, sx: 60, ix: 128, bri: 150, color: "#ffc000" }),
];

export const DEFAULT_PLAYLIST: LookPlaylist = {
  id: "playlist-nightly",
  name: "Nightly",
  slot: LOOK_PLAYLIST_DEFAULT_SLOT,
  lookIds: DEFAULT_LOOKS.map((row) => row.id),
  durationTenths: LOOK_DURATION_TENTHS_DEFAULT,
  transitionTenths: LOOK_TRANSITION_TENTHS_DEFAULT,
};

export function defaultLooksDocument(): LooksDocument {
  return { version: 1, looks: DEFAULT_LOOKS.map(cloneLook), playlists: [{ ...DEFAULT_PLAYLIST, lookIds: [...DEFAULT_PLAYLIST.lookIds] }], schedule: null };
}

export function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

export function isLookStyle(value: unknown): value is LookStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LookStyle>;
  if (!isByte(row.fx) || !isByte(row.pal) || !isByte(row.sx) || !isByte(row.ix)) return false;
  if (!isByte(row.bri) || row.bri < 1) return false;
  if (!parseHexColor(row.color ?? "")) return false;
  if (row.color2 !== undefined && !parseHexColor(row.color2)) return false;
  return true;
}

export function isLookOverride(value: unknown): value is LookOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LookOverride>;
  if (!isLookStyle(row.style)) return false;
  if (row.propId !== undefined && (typeof row.propId !== "string" || !row.propId)) return false;
  if (row.propKind !== undefined && !isPropKind(row.propKind)) return false;
  if (row.elementId !== undefined && (typeof row.elementId !== "string" || !row.elementId)) return false;
  if (row.wireframeGroup !== undefined && (typeof row.wireframeGroup !== "string" || !row.wireframeGroup)) return false;
  if (row.sharedPostRule !== undefined && !isSharedPostRule(row.sharedPostRule)) return false;
  if (row.sectionId !== undefined && (typeof row.sectionId !== "string" || !row.sectionId || !row.propId)) return false;
  if (row.off !== undefined && row.off !== true) return false;
  return Boolean(row.propId || row.propKind || row.elementId || row.wireframeGroup);
}

export function isLook(value: unknown): value is Look {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<Look>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.name === "string" &&
    row.name.trim().length > 0 &&
    isPresetId(row.slot) &&
    row.slot !== LOOK_OFF_SLOT &&
    isLookStyle(row.style) &&
    Array.isArray(row.overrides) &&
    row.overrides.every(isLookOverride)
  );
}

export function isLookPlaylist(value: unknown): value is LookPlaylist {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LookPlaylist>;
  return (
    typeof row.id === "string" &&
    row.id.length > 0 &&
    typeof row.name === "string" &&
    row.name.trim().length > 0 &&
    isPresetId(row.slot) &&
    row.slot !== LOOK_OFF_SLOT &&
    Array.isArray(row.lookIds) &&
    row.lookIds.length > 0 &&
    row.lookIds.every((id) => typeof id === "string" && id.length > 0) &&
    typeof row.durationTenths === "number" &&
    Number.isInteger(row.durationTenths) &&
    row.durationTenths >= 1 &&
    row.durationTenths <= 36000 &&
    typeof row.transitionTenths === "number" &&
    Number.isInteger(row.transitionTenths) &&
    row.transitionTenths >= 0 &&
    row.transitionTenths <= 36000
  );
}

export function normalizeLookStyle(style: LookStyle): LookStyle {
  const color = parseHexColor(style.color) ?? "#ffa000";
  const color2 = style.color2 ? parseHexColor(style.color2) : undefined;
  return {
    fx: style.fx,
    pal: style.pal,
    sx: style.sx,
    ix: style.ix,
    bri: style.bri,
    color,
    ...(color2 ? { color2 } : {}),
  };
}

export function normalizeLook(row: Look): Look {
  return {
    id: row.id,
    name: row.name.trim().slice(0, LOOK_NAME_MAX),
    slot: row.slot,
    style: normalizeLookStyle(row.style),
    overrides: row.overrides.map((entry) => ({
      style: normalizeLookStyle(entry.style),
      ...(entry.propId ? { propId: entry.propId } : {}),
      ...(entry.propKind ? { propKind: entry.propKind } : {}),
      ...(entry.elementId ? { elementId: entry.elementId } : {}),
      ...(entry.wireframeGroup ? { wireframeGroup: entry.wireframeGroup } : {}),
      ...(entry.sharedPostRule ? { sharedPostRule: entry.sharedPostRule } : {}),
      ...(entry.sectionId ? { sectionId: entry.sectionId } : {}),
      ...(entry.off ? { off: true as const } : {}),
    })),
  };
}

export function normalizePlaylist(row: LookPlaylist): LookPlaylist {
  return {
    id: row.id,
    name: row.name.trim().slice(0, LOOK_NAME_MAX),
    slot: row.slot,
    lookIds: [...row.lookIds],
    durationTenths: row.durationTenths,
    transitionTenths: row.transitionTenths,
  };
}

export function isLooksDocument(value: unknown): value is LooksDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LooksDocument>;
  if (row.version !== 1 || !Array.isArray(row.looks) || !Array.isArray(row.playlists)) return false;
  if (!row.looks.every(isLook) || !row.playlists.every(isLookPlaylist)) return false;
  if (row.schedule !== null && row.schedule !== undefined) {
    const schedule = row.schedule as unknown;
    if (!schedule || typeof schedule !== "object") return false;
  }
  return true;
}

export function validateLooksLibrary(looks: Look[], playlists: LookPlaylist[]): string | null {
  if (looks.length === 0) return "Add at least one Look before saving.";
  const ids = new Set<string>();
  const slots = new Set<number>([LOOK_OFF_SLOT]);
  for (const row of looks) {
    if (!isLook(row)) return "A Look is missing a name, slot, or style.";
    if (row.name.trim().length > LOOK_NAME_MAX) return `Look names are at most ${LOOK_NAME_MAX} characters.`;
    if (ids.has(row.id)) return "Two Looks share an id.";
    if (slots.has(row.slot)) return `Look “${row.name}” uses preset slot ${row.slot}, which is already taken.`;
    ids.add(row.id);
    slots.add(row.slot);
  }
  for (const row of playlists) {
    if (!isLookPlaylist(row)) return "A playlist needs a name, slot, and at least one Look.";
    if (row.name.trim().length > LOOK_NAME_MAX) return `Playlist names are at most ${LOOK_NAME_MAX} characters.`;
    if (ids.has(row.id) || playlists.filter((other) => other.id === row.id).length > 1) {
      return "Two playlists share an id.";
    }
    if (slots.has(row.slot)) return `Playlist “${row.name}” uses preset slot ${row.slot}, which is already taken.`;
    slots.add(row.slot);
    for (const lookId of row.lookIds) {
      if (!looks.some((look) => look.id === lookId)) return `Playlist “${row.name}” names a Look that is not in the library.`;
    }
  }
  return null;
}

export function nextLookSlot(used: readonly number[]): number | null {
  const taken = new Set(used);
  for (let slot = WLED_PRESET_MIN; slot <= WLED_PRESET_MAX; slot += 1) {
    if (slot === LOOK_OFF_SLOT) continue;
    if (!taken.has(slot)) return slot;
  }
  return null;
}

export type LookTarget = {
  start: number;
  stop: number;
  elementId?: string;
  prop: Prop | null;
  wireframeGroup?: string;
  /** A section of `prop`; the range is that section's lights on the Light. */
  sectionId?: string;
  /** The colour stored on that section. Used when no override names it. */
  sectionColor?: string;
};

export type PropSectionPlan = {
  targets: LookTarget[];
  /** Plain reasons the preset differs from what the sections ask for. */
  notes: string[];
};

/**
 * Where a sectioned Prop's sections land on its Light. Attach wrote one
 * Segment per section range starting at the Prop's first light, so the Prop's
 * origin is its first Segment minus its first range. Lights of the Prop that
 * no section names stay a plain Prop target. A wireframe Prop keeps its own
 * groups and is not planned here.
 */
export function propSectionPlan(prop: Prop, own: readonly Element[]): PropSectionPlan | null {
  if (!prop.layout || !prop.sections?.length || prop.wireframe || own.length === 0) return null;
  const firstId = layoutStrings(prop.layout)[0]?.id ?? "s1";
  const reports = sectionIndexRanges(prop.layout, prop.sections);
  const notes: string[] = [];
  const pieces: { start: number; stop: number; report: (typeof reports)[number] }[] = [];
  for (const report of reports) {
    if (report.errors.length > 0) {
      notes.push(`${prop.label} · ${report.name}: ${report.errors.join(" ")} It was not sent as its own segment.`);
      continue;
    }
    const onFirst = report.ranges.filter((range) => range.stop > range.start && (range.stringId ?? firstId) === firstId);
    if (onFirst.length < report.ranges.filter((range) => range.stop > range.start).length) {
      notes.push(`${prop.label} · ${report.name} has lights on another string. Only the first string is on this Light's segments, so those lights were not sent.`);
    }
    if (onFirst.length > 1) {
      notes.push(`${prop.label} · ${report.name} is ${onFirst.length} separate ranges, so it is sent as ${onFirst.length} segments and an effect restarts in each. One effect across them needs a ledmap, which Nightplot does not write for sections yet.`);
    }
    for (const range of onFirst) pieces.push({ start: range.start, stop: range.stop, report });
    for (const warning of report.warnings) {
      const line = `${prop.label}: ${warning} WLED draws the later segment on top.`;
      if (!notes.includes(line)) notes.push(line);
    }
  }
  if (pieces.length === 0) return null;
  const spanStart = Math.min(...own.map((row) => row.start));
  const spanStop = Math.max(...own.map((row) => row.stop));
  const origin = spanStart - Math.min(...pieces.map((piece) => piece.start));
  const targets: LookTarget[] = [];
  let clipped = false;
  for (const piece of pieces.sort((a, b) => a.start - b.start)) {
    const start = Math.max(spanStart, origin + piece.start);
    const stop = Math.min(spanStop, origin + piece.stop);
    if (start !== origin + piece.start || stop !== origin + piece.stop) clipped = true;
    if (stop <= start) continue;
    targets.push({
      start,
      stop,
      prop,
      sectionId: piece.report.sectionId,
      ...(piece.report.color ? { sectionColor: piece.report.color } : {}),
    });
  }
  // Lights of this Prop's Segments that no section covers keep a plain target.
  for (const row of own) {
    let cursor = row.start;
    const covering = targets.filter((target) => target.stop > row.start && target.start < row.stop).sort((a, b) => a.start - b.start);
    for (const target of covering) {
      if (target.start > cursor) targets.push({ start: cursor, stop: target.start, prop, elementId: row.id });
      cursor = Math.max(cursor, target.stop);
    }
    if (cursor < row.stop) targets.push({ start: cursor, stop: row.stop, prop, elementId: row.id });
  }
  const sameAsAttach = own.length === pieces.length && own.every((row) => targets.some((target) => target.sectionId && target.start === row.start && target.stop === row.stop));
  if (clipped || !sameAsAttach) {
    notes.push(`${prop.label}: the sections no longer match the Segments written at Attach. The Look follows the sections inside the Prop's lights; attach the Prop again so the controller's Segments agree.`);
  }
  return { targets: targets.sort((a, b) => a.start - b.start), notes };
}

/** Segments this Light will receive for a Look. Props own Segments; leftovers use the default. */
export function lookTargets(input: {
  ledCount: number;
  elements: readonly Element[];
  props: readonly Prop[];
}): LookTarget[] {
  const elements = input.elements.filter((row) => Number.isInteger(row.start) && Number.isInteger(row.stop) && row.stop > row.start);
  if (elements.length === 0) {
    const ledCount = Number.isInteger(input.ledCount) && input.ledCount > 0 ? input.ledCount : 0;
    return ledCount > 0 ? [{ start: 0, stop: ledCount, prop: null }] : [];
  }
  const out: LookTarget[] = [];
  const planned = new Set<string>();
  for (const element of elements) {
    const prop = input.props.find((row) => row.elementIds.includes(element.id)) ?? null;
    if (prop && planned.has(prop.id)) continue;
    if (prop) {
      const plan = propSectionPlan(prop, elements.filter((row) => prop.elementIds.includes(row.id)));
      if (plan) {
        planned.add(prop.id);
        out.push(...plan.targets);
        continue;
      }
    }
    out.push(plainTarget(element, prop));
  }
  return out;
}

/** Why a Look's preset on this Light is not exactly the sections, in words. Empty when it is. */
export function lookSectionNotes(input: {
  ledCount: number;
  elements: readonly Element[];
  props: readonly Prop[];
}): string[] {
  const elements = input.elements.filter((row) => Number.isInteger(row.start) && Number.isInteger(row.stop) && row.stop > row.start);
  return input.props.flatMap((prop) => propSectionPlan(prop, elements.filter((row) => prop.elementIds.includes(row.id)))?.notes ?? []);
}

function plainTarget(element: Element, prop: Prop | null): LookTarget {
  const group = prop?.wireframe ? wireframeGroupForElement(prop.id, element.id) : undefined;
  return {
    start: element.start,
    stop: element.stop,
    elementId: element.id,
    prop,
    ...(group ? { wireframeGroup: group } : {}),
  };
}

/**
 * A section override wins, then a wireframe group, then propId, then propKind,
 * then elementId. A section with none of those uses the Look's style in the
 * colour stored on the section. Otherwise the whole-yard default.
 */
export function resolveLookStyle(look: Look, target: LookTarget): LookStyle {
  return resolveLookTarget(look, target).style;
}

/** The style for a target and whether this Look turns it off. */
export function resolveLookTarget(look: Look, target: LookTarget): { style: LookStyle; off: boolean } {
  if (target.sectionId && target.prop) {
    const bySection = look.overrides.find((row) => row.sectionId === target.sectionId && row.propId === target.prop!.id);
    if (bySection) return { style: bySection.style, off: bySection.off === true };
  }
  const style = resolveWithoutSection(look, target);
  return { style, off: false };
}

function resolveWithoutSection(look: Look, target: LookTarget): LookStyle {
  if (target.wireframeGroup && target.prop) {
    const byGroup = look.overrides.find((row) =>
      row.wireframeGroup === target.wireframeGroup && (!row.propId || row.propId === target.prop!.id),
    );
    if (byGroup) return byGroup.style;
  }
  const byPropId = target.prop
    ? look.overrides.find((row) => row.propId && row.propId === target.prop!.id && !row.wireframeGroup && !row.sectionId)
    : undefined;
  if (byPropId) return byPropId.style;
  const byKind = target.prop
    ? look.overrides.find((row) => row.propKind && row.propKind === target.prop!.kind)
    : undefined;
  if (byKind) return byKind.style;
  const byElement = target.elementId
    ? look.overrides.find((row) => row.elementId && row.elementId === target.elementId)
    : undefined;
  if (byElement) return byElement.style;
  if (target.sectionColor) return { ...look.style, color: target.sectionColor };
  return look.style;
}

/** Face Segments plus extra group ranges requested by this Look’s overrides. */
export function lookTargetsForLook(look: Look, input: {
  ledCount: number;
  elements: readonly Element[];
  props: readonly Prop[];
}): LookTarget[] {
  const base = lookTargets(input);
  const extras: LookTarget[] = [];
  for (const prop of input.props) {
    if (!prop.wireframe) continue;
    const groups = new Set(
      look.overrides
        .filter((row) => row.wireframeGroup && (!row.propId || row.propId === prop.id))
        .map((row) => row.wireframeGroup!),
    );
    if (groups.size === 0) continue;
    const stored = new Set(base.filter((row) => row.prop?.id === prop.id).map((row) => row.wireframeGroup).filter(Boolean));
    const compiled = compileWireframe(prop.wireframe, input.ledCount);
    for (const groupId of groups) {
      if (stored.has(groupId)) continue;
      const group = compiled.groups.find((row) => row.id === groupId);
      if (!group) continue;
      for (const range of group.virtualRanges) {
        extras.push({ start: range.start, stop: range.stop, prop, wireframeGroup: groupId });
      }
    }
  }
  return [...base, ...extras];
}

export function styleColours(style: LookStyle, rgbw: boolean): number[][] {
  const primary = hexToRgb(style.color) ?? [255, 160, 0];
  const secondary = style.color2 ? hexToRgb(style.color2) ?? [0, 0, 0] : [0, 0, 0];
  const pad = (rgb: [number, number, number]) => (rgbw ? [...rgb, 0] : [...rgb]);
  return [pad(primary), pad(secondary as [number, number, number]), pad([0, 0, 0])];
}

export function buildLookPreset(look: Look, targets: readonly LookTarget[], rgbw: boolean): Record<string, unknown> {
  return {
    n: look.name.slice(0, LOOK_NAME_MAX),
    on: true,
    bri: look.style.bri,
    mainseg: 0,
    seg: targets.map((target, index) => {
      const { style, off } = resolveLookTarget(look, target);
      return {
        id: index,
        start: target.start,
        stop: target.stop,
        on: !off,
        col: styleColours(style, rgbw),
        fx: style.fx,
        sx: style.sx,
        ix: style.ix,
        pal: style.pal,
      };
    }),
  };
}

export function buildOffPreset(): Record<string, unknown> {
  return { n: "Off", on: false };
}

export function buildPlaylistPreset(playlist: LookPlaylist, looks: readonly Look[]): Record<string, unknown> | null {
  const slots = playlist.lookIds
    .map((id) => looks.find((look) => look.id === id)?.slot)
    .filter((slot): slot is number => typeof slot === "number");
  if (slots.length === 0) return null;
  return {
    n: playlist.name.slice(0, LOOK_NAME_MAX),
    on: true,
    playlist: {
      ps: slots,
      dur: slots.map(() => playlist.durationTenths),
      transition: slots.map(() => playlist.transitionTenths),
      repeat: 0,
      end: 0,
    },
  };
}

export function managedLookSlots(looks: readonly Look[], playlists: readonly LookPlaylist[]): number[] {
  return [...looks.map((row) => row.slot), ...playlists.map((row) => row.slot), LOOK_OFF_SLOT];
}

export function buildManagedPresets(input: {
  looks: readonly Look[];
  playlists: readonly LookPlaylist[];
  targets: readonly LookTarget[];
  rgbw: boolean;
  geometry?: { ledCount: number; elements: readonly Element[]; props: readonly Prop[] };
}): Record<string, unknown> {
  const out: Record<string, unknown> = { "0": {}, [String(LOOK_OFF_SLOT)]: buildOffPreset() };
  for (const row of input.looks) {
    const targets = input.geometry ? lookTargetsForLook(row, input.geometry) : input.targets;
    out[String(row.slot)] = buildLookPreset(row, targets, input.rgbw);
  }
  for (const row of input.playlists) {
    const preset = buildPlaylistPreset(row, input.looks);
    if (preset) out[String(row.slot)] = preset;
  }
  return out;
}

/** Keep operator slots Nightplot does not own; replace managed slots. */
export function mergeWledPresets(existingRaw: string, managed: Record<string, unknown>): string {
  let existing: Record<string, unknown> = { "0": {} };
  try {
    const parsed: unknown = JSON.parse(existingRaw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
  } catch { /* start from an empty WLED file */ }
  return JSON.stringify({ ...existing, ...managed });
}

export function managedPresetSlotsMatch(
  expected: Record<string, unknown>,
  readRaw: string,
  slots: readonly number[],
): boolean | null {
  let read: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    read = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const slot of slots) {
    const key = String(slot);
    if (canonical(expected[key]) !== canonical(read[key])) return false;
  }
  return true;
}

export function lookPushSummaryFor(kind: "looks" | "looks+schedule", rows: { status: string }[]): string {
  const matched = rows.filter((row) => row.status === "matched").length;
  const verb = kind === "looks+schedule" ? "report the Looks and Schedule" : "report the Looks";
  if (rows.length === 0) return "No Lights were chosen. Nothing was sent.";
  if (matched === rows.length) return `${matched} of ${rows.length} ${verb}.`;
  return `${matched} of ${rows.length} ${verb}. Check the Lights listed below.`;
}

/** What Nightplot last wrote to this Light. Missing is not “empty / in sync”. */
export type LastLookPush = {
  at: string;
  includeSchedule: boolean;
  udp?: { group: number; role: UdpSyncRole };
  digest: string;
};

export function isLastLookPush(value: unknown): value is LastLookPush {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<LastLookPush>;
  if (typeof row.at !== "string" || !row.at) return false;
  if (typeof row.includeSchedule !== "boolean") return false;
  if (typeof row.digest !== "string" || !row.digest) return false;
  if (row.udp !== undefined) {
    if (!row.udp || typeof row.udp !== "object") return false;
    if (!isUdpSyncGroup(row.udp.group)) return false;
    if (row.udp.role !== "leader" && row.udp.role !== "follower" && row.udp.role !== "off") return false;
  }
  return true;
}

export function lookPushDigest(input: {
  looks: readonly Look[];
  playlists: readonly LookPlaylist[];
  schedule: NightlySchedule | null;
  includeSchedule: boolean;
  udp?: { group: number; role: UdpSyncRole } | null;
}): string {
  return canonical({
    looks: input.looks.map(normalizeLook),
    playlists: input.playlists.map(normalizePlaylist),
    schedule: input.includeSchedule ? input.schedule : null,
    udp: input.udp ?? null,
  });
}

function look(id: string, name: string, slot: number, style: LookStyle): Look {
  return { id, name, slot, style, overrides: [] };
}

function cloneLook(row: Look): Look {
  return normalizeLook(row);
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
