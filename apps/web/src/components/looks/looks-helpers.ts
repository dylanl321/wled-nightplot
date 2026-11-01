import {
  LOOK_NAME_MAX,
  LOOK_OFF_SLOT,
  type Look,
  type LookPlaylist,
  type LooksDocument,
  type PropKind,
} from "@nightplot/shared";

type Lib = Pick<LooksDocument, "looks" | "playlists">;

/** The lowest WLED preset number no Look, playlist or the Off preset uses. */
export function freeSlot(doc: Lib): number | null {
  const used = new Set([...doc.looks.map((row) => row.slot), ...doc.playlists.map((row) => row.slot), LOOK_OFF_SLOT]);
  for (let slot = 1; slot < LOOK_OFF_SLOT; slot += 1) if (!used.has(slot)) return slot;
  return null;
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nextName(base: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function duplicateLook(doc: Lib, source: Look): Look | null {
  const slot = freeSlot(doc);
  if (slot === null) return null;
  let name = `${source.name} copy`.slice(0, LOOK_NAME_MAX);
  let n = 2;
  while (doc.looks.some((row) => row.name === name)) name = `${source.name} copy ${n++}`.slice(0, LOOK_NAME_MAX);
  return { ...structuredClone(source), id: newId("look"), name, slot };
}

export function newLook(doc: Lib, how: "on" | "off" | "copy", allPropIds: readonly string[], source?: Look): Look | null {
  const slot = freeSlot(doc);
  if (slot === null) return null;
  const name = nextName("Look", doc.looks.map((row) => row.name));
  if (how === "copy" && source) return { ...structuredClone(source), id: newId("look"), name, slot };
  return {
    id: newId("look"), name, slot,
    style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa040" },
    overrides: [],
    propIds: how === "on" ? [...allPropIds] : [],
    transitionTenths: 7,
  };
}

export function newPlaylist(doc: Lib): LookPlaylist | null {
  const slot = freeSlot(doc);
  const first = doc.looks[0];
  if (slot === null || !first) return null;
  return {
    id: newId("playlist"), name: nextName("Playlist", doc.playlists.map((row) => row.name)), slot,
    lookIds: [first.id], durationTenths: 6000, durationsTenths: [6000], transitionTenths: 7, repeat: true,
  };
}

const PLURAL: Record<PropKind, string> = {
  roofline: "rooflines", window: "windows", arch: "arches", tree: "trees", "stake-row": "stake rows",
  custom: "custom props", wireframe: "wireframes", spiral: "spirals", zigzag: "bushes",
};
export function kindPlural(kind: PropKind): string {
  return PLURAL[kind] ?? `${kind}s`;
}

/** Minutes each Look plays in a playlist. */
export function playlistMinutes(row: LookPlaylist): number[] {
  return row.lookIds.map((_, index) => Math.max(1, Math.round((row.durationsTenths?.[index] ?? row.durationTenths) / 600)));
}

const RECENT_KEY = "nightplot:looks:recent";
const DELETED_KEY = "nightplot:looks:deleted";
const DEFAULT_RECENT = ["#ff0000", "#ffffff", "#ffa040", "#00a020", "#ffc000", "#7a00ff"];

export function readRecent(): string[] {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(list) && list.every((c) => typeof c === "string") ? list.slice(0, 8) : DEFAULT_RECENT;
  } catch { return DEFAULT_RECENT; }
}

export function writeRecent(list: string[]) {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* per-browser convenience only */ }
}

export type DeletedLook = { look: Look; playlists: LookPlaylist[] };

export function rememberDeleted(look: Look, playlists: LookPlaylist[]) {
  try { window.sessionStorage.setItem(DELETED_KEY, JSON.stringify({ look, playlists: playlists.filter((row) => row.lookIds.includes(look.id)) })); } catch { /* undo is best effort */ }
}

export function takeDeleted(id: string): DeletedLook | null {
  try {
    const raw = window.sessionStorage.getItem(DELETED_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as DeletedLook;
    if (value.look?.id !== id) return null;
    window.sessionStorage.removeItem(DELETED_KEY);
    return value;
  } catch { return null; }
}
