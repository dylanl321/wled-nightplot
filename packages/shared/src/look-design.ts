/**
 * Designing Looks on the yard: each prop is Follow, Own style or Off in a
 * Look, and each section is Follow prop, Own style or Off. These map onto the
 * stored `propIds` and overrides, so no new fields are needed for them.
 *
 * Also: which Looks, playlists and the Schedule each Light has not been sent
 * yet, the WLED effect catalog read from a Light, and the drawing sampler.
 * A drawing is not a lit strip. Preview is temporary. Send persists.
 */
import { parseHexColor } from "./live.ts";
import {
  lookIncludesProp,
  normalizeLook,
  normalizePlaylist,
  type LastLookPush,
  type Look,
  type LookOverride,
  type LookStyle,
  type LooksDocument,
} from "./look.ts";
import type { Prop } from "./prop/types.ts";

export type LookMode = "follow" | "own" | "off";

function isPlainPropOverride(row: LookOverride, propId: string): boolean {
  return row.propId === propId && !row.sectionId && !row.wireframeGroup && !row.elementId;
}

function sectionOverride(look: Look, propId: string, sectionId: string): LookOverride | undefined {
  return look.overrides.find((row) => row.propId === propId && row.sectionId === sectionId);
}

/** Follow, Own style or Off for a prop. A rule naming its kind counts as Own. */
export function propMode(look: Look, prop: Pick<Prop, "id" | "kind">): LookMode {
  if (!lookIncludesProp(look, prop.id)) return "off";
  if (look.overrides.some((row) => isPlainPropOverride(row, prop.id))) return "own";
  if (look.overrides.some((row) => row.propKind && row.propKind === prop.kind && !row.propId)) return "own";
  return "follow";
}

export function sectionMode(look: Look, propId: string, sectionId: string): LookMode {
  const row = sectionOverride(look, propId, sectionId);
  if (!row) return "follow";
  return row.off ? "off" : "own";
}

/** The style a prop shows in this Look (ignores Off). */
export function propStyle(look: Look, prop: Pick<Prop, "id" | "kind">): LookStyle {
  const own = look.overrides.find((row) => isPlainPropOverride(row, prop.id));
  if (own) return own.style;
  const byKind = look.overrides.find((row) => row.propKind && row.propKind === prop.kind && !row.propId);
  if (byKind) return byKind.style;
  return look.style;
}

/** The style a section shows (its own, else its prop's). Null when it is off. */
export function sectionStyle(look: Look, prop: Pick<Prop, "id" | "kind">, sectionId: string): LookStyle | null {
  if (!lookIncludesProp(look, prop.id)) return null;
  const row = sectionOverride(look, prop.id, sectionId);
  if (row?.off) return null;
  return row ? row.style : propStyle(look, prop);
}

/** True while no section of the prop has its own style or is off. */
export function sectionsFollow(look: Look, propId: string): boolean {
  return !look.overrides.some((row) => row.propId === propId && row.sectionId);
}

function listWith(look: Look, allPropIds: readonly string[], propId: string, on: boolean): string[] {
  const list = look.propIds ?? [...allPropIds];
  const without = list.filter((id) => id !== propId);
  return on ? [...without, propId] : without;
}

export function setPropMode(
  look: Look,
  allPropIds: readonly string[],
  prop: Pick<Prop, "id" | "kind">,
  mode: LookMode,
): Look {
  if (mode === "off") return { ...look, propIds: listWith(look, allPropIds, prop.id, false) };
  const propIds = listWith(look, allPropIds, prop.id, true);
  if (mode === "follow") {
    return { ...look, propIds, overrides: look.overrides.filter((row) => !isPlainPropOverride(row, prop.id)) };
  }
  if (look.overrides.some((row) => isPlainPropOverride(row, prop.id))) return { ...look, propIds };
  return { ...look, propIds, overrides: [...look.overrides, { propId: prop.id, style: { ...propStyle(look, prop) } }] };
}

export function setSectionMode(
  look: Look,
  allPropIds: readonly string[],
  prop: Pick<Prop, "id" | "kind">,
  sectionId: string,
  mode: LookMode,
): Look {
  const others = look.overrides.filter((row) => !(row.propId === prop.id && row.sectionId === sectionId));
  const base = lookIncludesProp(look, prop.id) ? look : { ...look, propIds: listWith(look, allPropIds, prop.id, true) };
  if (mode === "follow") return { ...base, overrides: others };
  const seed = sectionStyle(base, prop, sectionId) ?? propStyle(base, prop);
  return {
    ...base,
    overrides: [...others, { propId: prop.id, sectionId, style: { ...seed }, ...(mode === "off" ? { off: true as const } : {}) }],
  };
}

/** Change one or more fields of the style a target uses, making it Own if it followed. */
export function patchStyle(
  look: Look,
  allPropIds: readonly string[],
  target: { prop?: Pick<Prop, "id" | "kind">; sectionId?: string },
  patch: Partial<LookStyle>,
): Look {
  if (!target.prop) return { ...look, style: { ...look.style, ...patch } };
  if (target.sectionId) {
    const own = sectionMode(look, target.prop.id, target.sectionId) === "own"
      ? look
      : setSectionMode(look, allPropIds, target.prop, target.sectionId, "own");
    return {
      ...own,
      overrides: own.overrides.map((row) =>
        row.propId === target.prop!.id && row.sectionId === target.sectionId ? { ...row, style: { ...row.style, ...patch } } : row),
    };
  }
  const own = look.overrides.some((row) => isPlainPropOverride(row, target.prop!.id))
    ? look
    : setPropMode(look, allPropIds, target.prop, "own");
  return {
    ...own,
    overrides: own.overrides.map((row) => (isPlainPropOverride(row, target.prop!.id) ? { ...row, style: { ...row.style, ...patch } } : row)),
  };
}

/**
 * Looks used to fall back to the colour stored on a section. Copy that into
 * each Look as the section's own style, once, so nothing on the lights changes
 * when sections start following their prop.
 */
export function migrateSectionColours(document: LooksDocument, props: readonly Prop[]): LooksDocument {
  if (document.sectionColoursMigrated) return document;
  const looks = document.looks.map((look) => {
    const added: LookOverride[] = [];
    for (const prop of props) {
      if (!prop.sections?.length || prop.wireframe) continue;
      for (const section of prop.sections) {
        if (!section.color) continue;
        if (look.overrides.some((row) => row.propId === prop.id && row.sectionId === section.id)) continue;
        // The old order: prop override, then kind, then the section colour on the Look style.
        const byProp = look.overrides.find((row) => isPlainPropOverride(row, prop.id));
        const byKind = look.overrides.find((row) => row.propKind && row.propKind === prop.kind);
        if (byProp || byKind) continue;
        added.push({ propId: prop.id, sectionId: section.id, style: { ...look.style, color: section.color } });
      }
    }
    return added.length ? { ...look, overrides: [...look.overrides, ...added] } : look;
  });
  return { ...document, looks, sectionColoursMigrated: true };
}

// ---------------------------------------------------------------- what each Light has not been sent

export type LookItemKey = `look:${string}` | `playlist:${string}` | "schedule";
export type LookChange = { key: LookItemKey; name: string; kind: "new" | "changed" | "deleted" };

/** One digest per Look, playlist and the Schedule. */
export function lookItemDigests(document: Pick<LooksDocument, "looks" | "playlists" | "schedule">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const look of document.looks) out[`look:${look.id}`] = canonical(normalizeLook(look));
  for (const row of document.playlists) out[`playlist:${row.id}`] = canonical(normalizePlaylist(row));
  out.schedule = canonical(document.schedule ?? null);
  return out;
}

/** Names for keys that may no longer be in the library. */
export type LookItemNames = Record<string, string>;

export function lookItemNames(document: Pick<LooksDocument, "looks" | "playlists">): LookItemNames {
  const out: LookItemNames = { schedule: "Schedule" };
  for (const look of document.looks) out[`look:${look.id}`] = look.name;
  for (const row of document.playlists) out[`playlist:${row.id}`] = `${row.name} playlist`;
  return out;
}

/**
 * What this Light has not been sent. A Light Nightplot never sent to has
 * everything unsent: unknown is not up to date.
 */
export function lookChangesFor(
  document: Pick<LooksDocument, "looks" | "playlists" | "schedule">,
  last: Pick<LastLookPush, "items" | "names"> | null | undefined,
): LookChange[] {
  const now = lookItemDigests(document);
  const names = lookItemNames(document);
  const was = last?.items ?? {};
  const out: LookChange[] = [];
  for (const [key, digest] of Object.entries(now)) {
    if (key === "schedule" && document.schedule === null && was.schedule === undefined) continue;
    if (was[key] === digest) continue;
    out.push({ key: key as LookItemKey, name: names[key] ?? key, kind: was[key] === undefined ? "new" : "changed" });
  }
  for (const key of Object.keys(was)) {
    if (now[key] !== undefined || key === "schedule") continue;
    out.push({ key: key as LookItemKey, name: last?.names?.[key] ?? key.replace(/^\w+:/, ""), kind: "deleted" });
  }
  return out;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

// ---------------------------------------------------------------- effect catalog read from a Light

export type LookEffectInfo = {
  fx: number;
  name: string;
  category: LookEffectCategory;
  /** Label for each of WLED's three colour slots; null when the effect does not use it. */
  colours: [string | null, string | null, string | null];
  /** Labels for speed (`sx`) and intensity (`ix`); null hides the slider. */
  sliders: [string | null, string | null];
  palette: boolean;
  /** Needs a 2D matrix or a microphone. Not offered for props. */
  hidden: boolean;
};

export type LookPaletteInfo = { pal: number; name: string; stops?: string[] };

export const LOOK_EFFECT_CATEGORIES = ["Still", "Glow & fade", "Chase", "Twinkle & sparkle", "Colour cycle", "Fire & weather", "More"] as const;
export type LookEffectCategory = (typeof LOOK_EFFECT_CATEGORIES)[number];

const CATEGORY_BY_NAME: [RegExp, LookEffectCategory][] = [
  [/^solid$|^static/i, "Still"],
  [/breath|fade|candle|glow|heartbeat|dissolve|pride/i, "Glow & fade"],
  [/twinkl|sparkl|glitter|flash|star|firework|popcorn|starburst|fairy/i, "Twinkle & sparkle"],
  [/fire|rain|drip|lightning|ripple|sinelon|aurora|lake|ocean|pacifica|flow/i, "Fire & weather"],
  [/rainbow|colorloop|color ?wave|palette|cycle|hue|pride|plasma|noise/i, "Colour cycle"],
  [/chase|running|wipe|scan|meteor|comet|theater|scanner|larson|bounc|sweep|android|police|railway|traffic|tri|blink|strobe/i, "Chase"],
];

function categoryOf(name: string): LookEffectCategory {
  for (const [pattern, category] of CATEGORY_BY_NAME) if (pattern.test(name)) return category;
  return "More";
}

/**
 * Parse WLED's `/json/eff` names and `/json/fxdata` metadata. Each fxdata
 * string is `<sliders>;<colours>;<palette>;<flags>;<defaults>`. A missing
 * slider section means speed and intensity; a missing palette section means a
 * palette is used; flags `2` without `1`, `v` or `f` hide the effect for props.
 * Names starting with `RSVD` or `-` are reserved slots.
 */
export function parseWledEffects(names: readonly unknown[], fxdata: readonly unknown[] | null): LookEffectInfo[] {
  const out: LookEffectInfo[] = [];
  names.forEach((raw, fx) => {
    if (typeof raw !== "string" || !raw.trim() || /^RSVD$|^-$/.test(raw.trim())) return;
    const name = raw.trim();
    const data = typeof fxdata?.[fx] === "string" ? (fxdata[fx] as string) : null;
    const parts = data === null ? null : data.split(";");
    const sliderPart = parts?.[0];
    const colourPart = parts?.[1];
    const palettePart = parts?.[2];
    const flags = parts?.[3] ?? "1";
    const sliderLabels = sliderPart === undefined ? ["!", "!"] : sliderPart.split(",");
    const sliders: [string | null, string | null] = [
      labelOf(sliderLabels[0], "Speed"),
      labelOf(sliderLabels[1], "Intensity"),
    ];
    const colourLabels = colourPart === undefined ? ["!", "!", "!"] : colourPart.split(",");
    const colours: [string | null, string | null, string | null] = [
      labelOf(colourLabels[0], "Colour"),
      labelOf(colourLabels[1], "Background"),
      labelOf(colourLabels[2], "Third colour"),
    ];
    const palette = palettePart === undefined ? true : palettePart.trim() !== "";
    const hidden = (/2/.test(flags) && !/1/.test(flags)) || /[vf]/.test(flags);
    out.push({ fx, name, category: fx === 0 ? "Still" : categoryOf(name), colours, sliders, palette, hidden });
  });
  return out;
}

function labelOf(raw: string | undefined, fallback: string): string | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!text) return null;
  if (text === "!") return fallback;
  return text.replace(/^!/, "").trim() || fallback;
}

/** WLED `/json/pal` names. Reserved or empty names are left out. */
export function parseWledPalettes(names: readonly unknown[]): LookPaletteInfo[] {
  return names.flatMap((raw, pal) => (typeof raw === "string" && raw.trim() ? [{ pal, name: raw.replace(/^\*\s*/, "").trim() }] : []));
}

/** Effects every Light offers, keeping the first Light's names. */
export function intersectEffects(lists: readonly (readonly LookEffectInfo[])[]): LookEffectInfo[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return first!.filter((row) => rest.every((list) => list.some((other) => other.fx === row.fx && other.name === row.name)));
}

/** Built-in stand-in until a Light answers: the common 0.14+ ids. */
export const FALLBACK_EFFECTS: readonly LookEffectInfo[] = [
  fx(0, "Solid", "Still", ["Colour", null, null], [null, null], false),
  fx(2, "Breathe", "Glow & fade", ["Colour", "Background", null], ["Speed", null], false),
  fx(12, "Fade", "Glow & fade", ["From", "To", null], ["Speed", null], false),
  fx(88, "Candle", "Glow & fade", ["Flame", "Background", null], ["Flicker speed", "Flicker amount"], false),
  fx(1, "Blink", "Chase", ["On", "Off", null], ["Speed", "On time"], false),
  fx(13, "Theater chase", "Chase", ["Stripe", "Gap", null], ["Speed", "Stripe width"], false),
  fx(15, "Running lights", "Chase", ["Wave", "Background", null], ["Speed", "Wave width"], false),
  fx(3, "Wipe", "Chase", ["Wipe", "Background", null], ["Speed", null], false),
  fx(10, "Scan", "Chase", ["Dot", "Background", null], ["Speed", "Dot size"], false),
  fx(76, "Meteor", "Chase", ["Meteor", null, null], ["Speed", "Trail"], true),
  fx(17, "Twinkle", "Twinkle & sparkle", ["Twinkle", "Background", null], ["Speed", "How many"], true),
  fx(80, "Twinklefox", "Twinkle & sparkle", [null, "Background", null], ["Speed", "Twinkle rate"], true),
  fx(20, "Sparkle", "Twinkle & sparkle", ["Sparkle", "Background", null], ["Speed", "How many"], false),
  fx(43, "Rain", "Fire & weather", ["Drop", "Background", null], ["Speed", "Drops"], true),
  fx(66, "Fire 2012", "Fire & weather", [null, null, null], ["Cooling", "Sparking"], true),
  fx(9, "Rainbow", "Colour cycle", [null, null, null], ["Speed", "Band size"], true),
  fx(67, "Colorwaves", "Colour cycle", [null, null, null], ["Speed", "Hue spread"], true),
];

function fx(
  id: number,
  name: string,
  category: LookEffectCategory,
  colours: [string | null, string | null, string | null],
  sliders: [string | null, string | null],
  palette: boolean,
): LookEffectInfo {
  return { fx: id, name, category, colours, sliders, palette, hidden: false };
}

/** WLED built-in palettes with approximate gradient stops for the drawing. */
export const LOOK_PALETTE_STOPS: Record<number, { name: string; stops?: string[] }> = {
  0: { name: "Effect default" },
  2: { name: "Colour 1" },
  3: { name: "Colours 1 & 2" },
  4: { name: "Colour gradient" },
  5: { name: "Colours only" },
  6: { name: "Party", stops: ["#5500ab", "#84007c", "#b5004b", "#e5001b", "#e81700", "#b84700", "#ab7700", "#abab00", "#ab5500", "#dd2200", "#f2000e", "#c2003e", "#8f0071", "#5f00a1", "#2f00d0", "#0007f9"] },
  8: { name: "Lava", stops: ["#000000", "#120000", "#710000", "#8e0300", "#af1100", "#d52c00", "#ff5200", "#ff7300", "#ff9c00", "#ffcb00", "#fff631", "#ffffff"] },
  9: { name: "Ocean", stops: ["#191970", "#00008b", "#000080", "#0000ff", "#008b8b", "#5f9ea0", "#7fffd4", "#008080", "#87ceeb"] },
  10: { name: "Forest", stops: ["#006400", "#556b2f", "#008000", "#2e8b57", "#6b8e23", "#32cd32", "#9acd32", "#90ee90", "#7cfc00", "#66cdaa"] },
  11: { name: "Rainbow", stops: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] },
  13: { name: "Sunset", stops: ["#780000", "#b31600", "#ff6800", "#a71601", "#640067", "#100082", "#000082"] },
  20: { name: "Pastel", stops: ["#3d87b1", "#77c6ff", "#ffffe7", "#ffbbc6", "#c69bff", "#3d87b1"] },
  31: { name: "Jul", stops: ["#e2000f", "#e2000f", "#1d5a12", "#1d5a12", "#e2000f"] },
  35: { name: "Fire", stops: ["#000000", "#460000", "#a80000", "#ff2a00", "#ff8800", "#ffdd33", "#ffffff"] },
  36: { name: "Icefire", stops: ["#000000", "#003366", "#0099ff", "#ffffff", "#ff9900", "#ff3300", "#000000"] },
  39: { name: "Autumn", stops: ["#5a0e05", "#8b290d", "#64681f", "#899852", "#77300d", "#8b290d", "#e2b05e"] },
  48: { name: "C9", stops: ["#b80400", "#b80400", "#902c02", "#902c02", "#046002", "#046002", "#070758", "#070758", "#d4a20b"] },
  50: { name: "Aurora", stops: ["#011232", "#00ff3c", "#0063ff", "#aa00ff", "#00ff14", "#011232"] },
  57: { name: "Candy", stops: ["#f3f200", "#ff0b00", "#f3f200", "#ff0b00", "#ff00aa", "#f3f200"] },
};

export const FALLBACK_PALETTES: readonly LookPaletteInfo[] = [0, 2, 3, 4, 5, 31, 48, 11, 6, 35, 8, 36, 9, 10, 13, 39, 57, 50, 20]
  .map((pal) => ({ pal, name: LOOK_PALETTE_STOPS[pal]!.name, ...(LOOK_PALETTE_STOPS[pal]!.stops ? { stops: LOOK_PALETTE_STOPS[pal]!.stops } : {}) }));

// ---------------------------------------------------------------- drawing sampler

type Rgb = [number, number, number];

function rgb(hex: string | undefined, fallback: Rgb = [0, 0, 0]): Rgb {
  const parsed = hex ? parseHexColor(hex) : null;
  if (!parsed) return fallback;
  return [parseInt(parsed.slice(1, 3), 16), parseInt(parsed.slice(3, 5), 16), parseInt(parsed.slice(5, 7), 16)];
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const fract = (x: number) => x - Math.floor(x);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const hash = (i: number) => fract(Math.sin(i * 127.1 + 311.7) * 43758.5453);

const PALETTE_DEFAULT_FOR: Record<number, number> = { 80: 31, 66: 35, 9: 11, 67: 6 };

export function paletteColourAt(style: LookStyle, position: number): Rgb {
  const x = fract(position);
  const c1 = rgb(style.color), c2 = rgb(style.color2), c3 = rgb(style.color3);
  let pal = style.pal;
  if (pal === 0) pal = PALETTE_DEFAULT_FOR[style.fx] ?? 2;
  if (pal === 2) return c1;
  if (pal === 3) return x < 0.5 ? c1 : c2;
  if (pal === 4) return x < 0.5 ? mix(c1, c2, x * 2) : mix(c2, c3, (x - 0.5) * 2);
  if (pal === 5) return [c1, c2, c3][Math.floor(x * 3) % 3]!;
  const stops = LOOK_PALETTE_STOPS[pal]?.stops ?? LOOK_PALETTE_STOPS[11]!.stops!;
  const f = x * (stops.length - 1);
  const i = Math.floor(f);
  return mix(rgb(stops[i]), rgb(stops[Math.min(i + 1, stops.length - 1)]), f - i);
}

/**
 * An approximate colour for light `index` of `count` at `t` seconds. Effects
 * Nightplot does not draw show their colours drifting slowly; the caller says
 * the drawing is approximate.
 */
export function sampleLookStyle(style: LookStyle, index: number, count: number, t: number): Rgb {
  let i = index;
  let u = count > 1 ? index / (count - 1) : 0;
  if (style.dir === "rev") { u = 1 - u; i = count - 1 - index; }
  if (style.dir === "mirror") { u = u < 0.5 ? u * 2 : (1 - u) * 2; i = Math.round((u * (count - 1)) / 2); }
  const c1 = rgb(style.color), c2 = rgb(style.color2);
  const sp = 0.15 + (style.sx / 255) * 2.4, k = style.ix / 255;
  const level = (style.opacity ?? 255) / 255;
  const out = ((): Rgb => {
    switch (style.fx) {
      case 0: return c1;
      case 2: return mix(c2, c1, 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * sp * 2)));
      case 12: return mix(c1, c2, 0.5 + 0.5 * Math.sin(t * sp * 1.5));
      case 88: { const fl = 0.55 + 0.45 * k * Math.sin(t * sp * 9 + hash(i) * 30) * Math.sin(t * sp * 5.3 + i * 0.7); return mix(c2, c1, clamp(0.45 + fl * 0.6, 0, 1)); }
      case 1: return fract(t * sp) < 0.15 + 0.7 * k ? c1 : c2;
      case 13: { const w = 1 + Math.round(k * 6); return ((i + Math.floor(t * sp * 8)) % (2 * w)) < w ? c1 : c2; }
      case 15: { const w = 3 + (1 - k) * 25; const v = 0.5 + 0.5 * Math.sin((i / w - t * sp) * Math.PI * 2); return mix(c2, c1, v * v); }
      case 3: { const p = fract(t * sp * 0.25); const odd = Math.floor(t * sp * 0.25) % 2; return u < p ? (odd ? c2 : c1) : (odd ? c1 : c2); }
      case 10: { const p = 1 - Math.abs(fract(t * sp * 0.3) * 2 - 1); return Math.abs(u - p) * count < 1 + k * 6 ? c1 : c2; }
      case 76: { const p = fract(t * sp * 0.3); let d = p - u; if (d < 0) d += 1; const tr = 0.03 + k * 0.4; return d < tr ? scale(style.pal === 0 ? c1 : paletteColourAt(style, u), Math.pow(1 - d / tr, 2)) : [0, 0, 0]; }
      case 17: { const h = hash(i); if (h > 0.15 + k * 0.85) return c2; const v = Math.pow(Math.max(0, Math.sin(t * sp * 1.6 + h * 40)), 3); return mix(c2, style.pal === 0 ? c1 : paletteColourAt(style, h * 3), v); }
      case 80: { const h = hash(i + 7); const v = Math.pow(Math.max(0, Math.sin(t * sp * (0.6 + k) + h * 50)), 2); return mix(c2, paletteColourAt(style, h * 2.7), v); }
      case 20: return hash(i * 13 + Math.floor(t * sp * 12)) > 1 - (0.02 + k * 0.15) ? c1 : c2;
      case 43: { const p = fract(t * sp * 0.35 + hash(Math.floor(i / 12))); const d = Math.abs(fract(u * 4) - p); return d < 0.05 * (0.5 + k) ? (style.pal === 0 ? c1 : paletteColourAt(style, u)) : c2; }
      case 66: { const heat = clamp(0.25 + 0.75 * Math.abs(Math.sin(i * 0.37 + t * sp * 3.1) * Math.sin(i * 0.11 - t * sp * 1.7)) * (0.6 + k * 0.6), 0, 1); return paletteColourAt(style, heat * 0.85); }
      case 9: return paletteColourAt({ ...style, pal: style.pal || 11 }, u * (0.3 + k * 2) - t * sp * 0.2);
      case 67: { const v = 0.6 + 0.4 * Math.sin(u * 9 + t * sp * 2); return scale(paletteColourAt({ ...style, pal: style.pal || 6 }, u * (0.5 + k) + Math.sin(t * sp * 0.3) * 0.5), v); }
      default: {
        const base = style.pal ? paletteColourAt(style, u + t * sp * 0.05) : mix(c1, c2.some((v) => v > 0) ? c2 : c1, 0.5 + 0.5 * Math.sin(u * 6 + t * sp));
        return base;
      }
    }
  })();
  return scale(out, level);
}

/** Effects the drawing draws closely. Anything else says "drawing approximate". */
export const SAMPLED_EFFECTS: ReadonlySet<number> = new Set([0, 1, 2, 3, 9, 10, 12, 13, 15, 17, 20, 43, 66, 67, 76, 80, 88]);

/** A dot colour for lists: colour 1 when the effect uses it, else the brightest sampled light. */
export function styleDotColour(style: LookStyle | null, effect?: Pick<LookEffectInfo, "colours"> | null): string | null {
  if (!style) return null;
  if (effect ? effect.colours[0] !== null : style.pal === 0 || style.pal === 2) return style.color;
  let best: Rgb = [0, 0, 0];
  for (let i = 0; i < 12; i += 1) {
    const c = sampleLookStyle(style, i, 12, 0.7);
    if (c[0] + c[1] + c[2] > best[0] + best[1] + best[2]) best = c;
  }
  return `#${best.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}
