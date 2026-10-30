/**
 * WLED's built-in UDP sync (Settings → Sync Interfaces → WLED Broadcast).
 *
 * A leader broadcasts brightness, colour, effect and palette changes to its
 * sync group; followers in that group apply them. Fields follow `cfg.json`
 * `if.sync` in `wled00/cfg.cpp` (0.14.4, 0.15.x, 16.0.1). Nightplot writes the
 * group once; after that the controllers follow each other without Nightplot.
 * Followers never take segment bounds (`recv.sb`), so Nightplot ranges stay.
 * A fresh WLED receives group 1, so group 1 reaches every untouched controller.
 */

export type UdpSyncRole = "leader" | "follower" | "off";

export type WledUdpSync = {
  /** `send.en` — broadcast on change. */
  send: boolean;
  /** `send.dir` — also broadcast changes made through the JSON API / UI. */
  sendDirect: boolean;
  /** `send.grp` bitmask, groups 1–8. */
  sendGroups: number;
  /** `recv.grp` bitmask. 0 means receive nothing. */
  receiveGroups: number;
  receiveBrightness: boolean;
  receiveColor: boolean;
  receiveEffects: boolean;
  receivePalette: boolean;
  /** `recv.sb` — take segment bounds from the leader. */
  receiveSegmentBounds: boolean;
  /** `port0`, the WLED broadcast port. Lights only hear each other on the same port. */
  port: number | null;
};

export const UDP_SYNC_GROUP_MIN = 1;
export const UDP_SYNC_GROUP_MAX = 8;

export const UDP_SYNC_CAPTION =
  "Read back from /json/cfg. WLED sync uses UDP broadcast, so Lights must share a subnet and port. Not Hardware Done.";

export function isUdpSyncGroup(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= UDP_SYNC_GROUP_MIN && value <= UDP_SYNC_GROUP_MAX;
}

export function groupBit(group: number): number {
  return 1 << (group - 1);
}

/** Group numbers set in a WLED bitmask. */
export function groupsFromMask(mask: number): number[] {
  const out: number[] = [];
  for (let group = UDP_SYNC_GROUP_MIN; group <= UDP_SYNC_GROUP_MAX; group += 1) if (mask & groupBit(group)) out.push(group);
  return out;
}

/** `cfg.if.sync` → typed read. Null when the firmware did not report that shape. */
export function parseWledUdpSync(cfg: unknown): WledUdpSync | null {
  const sync = record(record(record(cfg)?.if)?.sync);
  const send = record(sync?.send);
  const recv = record(sync?.recv);
  if (!sync || !send || !recv) return null;
  const sendGroups = byte(send.grp);
  const receiveGroups = byte(recv.grp);
  if (typeof send.en !== "boolean" || sendGroups === null || receiveGroups === null) return null;
  return {
    send: send.en,
    sendDirect: send.dir === true,
    sendGroups,
    receiveGroups,
    receiveBrightness: recv.bri === true,
    receiveColor: recv.col === true,
    receiveEffects: recv.fx === true,
    receivePalette: recv.pal === true,
    receiveSegmentBounds: recv.sb === true,
    port: typeof sync.port0 === "number" && Number.isInteger(sync.port0) ? sync.port0 : null,
  };
}

/** What a read means for one group. A Light can be in several groups; this names only `group`. */
export function udpSyncRole(read: WledUdpSync, group: number): UdpSyncRole {
  const bit = groupBit(group);
  if (read.send && (read.sendGroups & bit)) return "leader";
  if (read.receiveGroups & bit) return "follower";
  return "off";
}

/**
 * The `/json/cfg` patch for one Light's role in `group`. Other groups this
 * Light already sends or receives are kept. Follower receives brightness,
 * colour, effects and palette, never segment bounds.
 */
export function buildUdpSyncWrite(current: WledUdpSync, role: UdpSyncRole, group: number): {
  body: { if: { sync: { send: Record<string, unknown>; recv: Record<string, unknown> } } };
  expected: WledUdpSync;
} {
  const bit = groupBit(group);
  const expected: WledUdpSync = { ...current, receiveSegmentBounds: false };
  if (role === "leader") {
    // With broadcast off, the stored send groups are inert (WLED's default is
    // group 1, which every fresh WLED also receives). Start from this group only.
    expected.sendGroups = (current.send ? current.sendGroups : 0) | bit;
    expected.send = true;
    expected.sendDirect = true;
    expected.receiveGroups = current.receiveGroups & ~bit;
  } else if (role === "follower") {
    expected.sendGroups = current.sendGroups & ~bit;
    expected.send = expected.sendGroups !== 0 && current.send;
    expected.receiveGroups = current.receiveGroups | bit;
    expected.receiveBrightness = true;
    expected.receiveColor = true;
    expected.receiveEffects = true;
    expected.receivePalette = true;
  } else {
    expected.sendGroups = current.sendGroups & ~bit;
    expected.send = expected.sendGroups !== 0 && current.send;
    expected.receiveGroups = current.receiveGroups & ~bit;
  }
  return {
    body: { if: { sync: {
      send: { en: expected.send, dir: expected.sendDirect, grp: expected.sendGroups },
      recv: { grp: expected.receiveGroups, bri: expected.receiveBrightness, col: expected.receiveColor,
        fx: expected.receiveEffects, pal: expected.receivePalette, sb: false },
    } } },
    expected,
  };
}

export function udpSyncMatches(expected: WledUdpSync, read: WledUdpSync | null): boolean | null {
  if (!read) return null;
  return expected.send === read.send && expected.sendDirect === read.sendDirect &&
    expected.sendGroups === read.sendGroups && expected.receiveGroups === read.receiveGroups &&
    expected.receiveBrightness === read.receiveBrightness && expected.receiveColor === read.receiveColor &&
    expected.receiveEffects === read.receiveEffects && expected.receivePalette === read.receivePalette &&
    read.receiveSegmentBounds === false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function byte(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
}
