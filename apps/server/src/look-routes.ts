import {
  LOOK_CAPTION,
  buildManagedPresets,
  buildScheduleWrite,
  lookPushDigest,
  lookPushSummaryFor,
  lookSectionNotes,
  lookTargets,
  lookTargetsForLook,
  managedLookSlots,
  managedPresetSlotsMatch,
  mergeWledPresets,
  FLEET_LOOK_CONCURRENCY,
  parseLightIdList,
  parseWledPresets,
  pinLookProps,
  runPresetSlot,
  scheduleMatches,
  wledTimerDialect,
  validateLooksLibrary,
  validateSchedule,
  buildUdpSyncWrite,
  isNightlySchedule,
  isUdpSyncGroup,
  parseWledUdpSync,
  udpSyncMatches,
  isSupportedProvisionFirmware,
  type ActivityEntry,
  type BackupDocument,
  type BackupReason,
  type HostPort,
  type Light,
  type Look,
  type LookPlaylist,
  type LooksDocument,
  type NightlySchedule,
  type Prop,
  type SyncRow,
  type UdpSyncRole,
  type WledSnapshot,
} from "@nightplot/shared";
import type { Hono } from "hono";
import { mapLimit } from "./discovery/map-limit.ts";
import type { createLiveEngine } from "./live/engine.ts";
import type { FileLooksStore } from "./store/looks-store.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { ReadCfgFn, WriteCfgFn } from "./wled/cfg.ts";
import type { ReadWledLedmap, ReadWledPresets, WriteWledLedmap, WriteWledPresets } from "./wled/native-backup.ts";
import { writeAndVerifyLedmap } from "./wireframe-persist.ts";

export type LookRouteDeps = {
  store: FileLightsStore;
  looks: FileLooksStore;
  live: ReturnType<typeof createLiveEngine>;
  readCfg: ReadCfgFn;
  writeCfg: WriteCfgFn;
  readPresets: ReadWledPresets;
  writePresets: WriteWledPresets;
  readLedmap: ReadWledLedmap;
  writeLedmap: WriteWledLedmap;
  refreshOne: (stored: Light) => Promise<{ light: Light; live: WledSnapshot | null }>;
  captureDevice: (reason: BackupReason, light: Light, snap: WledSnapshot) => Promise<BackupDocument>;
  record: (
    light: Pick<Light, "id" | "name">,
    action: ActivityEntry["action"],
    readback: ActivityEntry["readback"],
    detail: string,
  ) => void;
};

const BUSY = "End Preview or Blink on this Light first. Nothing was sent.";
const OFFLINE = "WLED did not answer. Nothing was sent.";

type PushBody = {
  lightIds?: unknown;
  includeSchedule?: unknown;
  udp?: { group?: unknown; roles?: unknown };
};

function targetOf(light: Light): HostPort {
  return { hostname: light.hostname, port: light.port };
}

function row(
  light: Pick<Light, "id" | "name">,
  status: SyncRow["status"],
  detail: string,
  safetyBackupId?: string,
): SyncRow {
  return { lightId: light.id, lightName: light.name, status, detail, ...(safetyBackupId ? { safetyBackupId } : {}) };
}

function readbackOf(status: SyncRow["status"]): ActivityEntry["readback"] {
  return status === "matched" ? "match" : status === "mismatch" ? "mismatch" : status === "unknown" ? "unknown" : "not-checked";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function yardFrom(store: FileLightsStore): {
  lights: { id: string; name: string }[];
  props: (Prop & { lightName: string })[];
  elements: { id: string; lightId: string; label: string; start: number; stop: number; lightName: string }[];
} {
  const lights = store.load();
  const nameOf = (lightId: string) => lights.find((light) => light.id === lightId)?.name ?? lightId;
  return {
    lights: lights.map((light) => ({ id: light.id, name: light.name })),
    props: store.loadProps().map((prop) => ({
      ...prop,
      lightName: prop.lightId ? nameOf(prop.lightId) : "Not attached",
    })),
    elements: store.loadElements().map((element) => ({
      id: element.id,
      lightId: element.lightId,
      label: element.label,
      start: element.start,
      stop: element.stop,
      lightName: nameOf(element.lightId),
    })),
  };
}

export function registerLookRoutes(app: Hono, deps: LookRouteDeps) {
  app.get("/api/looks", (c) => {
    const document = deps.looks.read();
    return c.json({
      ...document,
      yard: yardFrom(deps.store),
      caption: LOOK_CAPTION,
    });
  });

  app.put("/api/looks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<LooksDocument> | null;
    const looks = Array.isArray(body?.looks) ? (body.looks as Look[]) : null;
    const playlists = Array.isArray(body?.playlists) ? (body.playlists as LookPlaylist[]) : null;
    if (!looks || !playlists) {
      return c.json({ error: "looks-required", message: "Send the Looks library and playlists. Nothing was saved." }, 400);
    }
    const libraryError = validateLooksLibrary(looks, playlists);
    if (libraryError) return c.json({ error: "invalid-looks", message: libraryError }, 400);
    let schedule: NightlySchedule | null = null;
    if (body?.schedule != null) {
      if (!isNightlySchedule(body.schedule)) {
        return c.json({ error: "invalid-schedule", message: "The Schedule is missing a field Nightplot understands." }, 400);
      }
      schedule = body.schedule;
      const scheduleError = validateSchedule(schedule, looks, playlists);
      if (scheduleError) return c.json({ error: "invalid-schedule", message: scheduleError }, 400);
    }
    // A Look saved without a prop list gets the props that exist now.
    const pinned = pinLookProps(looks, deps.store.loadProps().map((prop) => prop.id)).looks;
    const saved = deps.looks.save({ version: 1, looks: pinned, playlists, schedule });
    return c.json({ ...saved, yard: yardFrom(deps.store), caption: LOOK_CAPTION });
  });

  app.post("/api/looks/push", async (c) => {
    const body = (await c.req.json().catch(() => null)) as PushBody | null;
    const lightIds = parseLightIdList(body);
    if (!lightIds?.length) {
      return c.json({ error: "targets-required", message: "Choose at least one Light. Nothing was sent." }, 400);
    }
    const document = deps.looks.read();
    const libraryError = validateLooksLibrary(document.looks, document.playlists);
    if (libraryError) return c.json({ error: "invalid-looks", message: libraryError }, 400);
    const includeSchedule = body?.includeSchedule === true;
    let runSlot: number | null = null;
    if (includeSchedule) {
      if (!document.schedule?.enabled) {
        return c.json({ error: "schedule-disabled", message: "Turn the nightly Schedule on before pushing it. Nothing was sent." }, 400);
      }
      const scheduleError = validateSchedule(document.schedule, document.looks, document.playlists);
      if (scheduleError) return c.json({ error: "invalid-schedule", message: `${scheduleError} Nothing was sent.` }, 400);
      runSlot = runPresetSlot(document.schedule, document.looks, document.playlists);
      if (runSlot === null) {
        return c.json({ error: "invalid-schedule", message: "The Schedule does not name a Look or playlist in the library. Nothing was sent." }, 400);
      }
    }
    const udp = parseUdp(body?.udp);
    if (udp && "error" in udp) return c.json(udp.error, udp.status);

    const rows = await mapLimit(lightIds, FLEET_LOOK_CONCURRENCY, async (lightId) => {
      const stored = deps.store.findById(lightId);
      if (!stored) return { lightId, lightName: lightId, status: "refused" as const, detail: "That Light is not on Lights. Nothing was sent." };
      if (deps.live.get(stored.id)) return row(stored, "refused", BUSY);
      const { light, live: snap } = await deps.refreshOne(stored);
      if (!snap || light.reachability !== "online") return row(light, "failed", OFFLINE);
      const release = deps.live.block(light.id);
      try {
        await deps.live.settle(light.id);
        if (deps.live.get(light.id)) return row(light, "refused", BUSY);
        return await pushLooksToLight(deps, {
          light,
          snap,
          document,
          includeSchedule,
          runSlot,
          udp: udp && "group" in udp ? udp : null,
        });
      } finally {
        release();
      }
    });

    const kind = includeSchedule ? "looks+schedule" : "looks";
    for (const done of rows) {
      const light = deps.store.findById(done.lightId) ?? { id: done.lightId, name: done.lightName };
      deps.record(light, "sync", readbackOf(done.status), `Push Looks${includeSchedule ? " and Schedule" : ""}: ${done.detail}`);
    }
    return c.json({ kind, rows, message: lookPushSummaryFor(kind, rows), caption: LOOK_CAPTION });
  });
}

function parseUdp(value: PushBody["udp"]):
  | { group: number; roles: Record<string, UdpSyncRole> }
  | { error: { error: string; message: string }; status: 400 }
  | null {
  if (value == null) return null;
  if (!isUdpSyncGroup(value.group)) {
    return { error: { error: "group-required", message: "Choose a WLED sync group 1–8. Nothing was sent." }, status: 400 };
  }
  const roles = value.roles && typeof value.roles === "object" && !Array.isArray(value.roles)
    ? Object.entries(value.roles as Record<string, unknown>)
    : [];
  if (!roles.length || roles.some(([, role]) => role !== "leader" && role !== "follower" && role !== "off")) {
    return { error: { error: "roles-required", message: "Give each chosen Light a role: leader, follower or off. Nothing was sent." }, status: 400 };
  }
  if (roles.filter(([, role]) => role === "leader").length > 1) {
    return { error: { error: "one-leader", message: "Choose one leader per group, so followers do not fight. Nothing was sent." }, status: 400 };
  }
  return { group: value.group, roles: Object.fromEntries(roles) as Record<string, UdpSyncRole> };
}

export async function pushLooksToLight(
  deps: LookRouteDeps,
  input: {
    light: Light;
    snap: WledSnapshot;
    document: LooksDocument;
    includeSchedule: boolean;
    runSlot: number | null;
    udp: { group: number; roles: Record<string, UdpSyncRole> } | null;
    reason?: BackupReason;
  },
): Promise<SyncRow> {
  const { light, snap, document } = input;
  let safety: BackupDocument;
  try {
    safety = await deps.captureDevice(input.reason ?? "pre-sync", light, snap);
  } catch (error) {
    return row(light, "failed", `Safety backup failed: ${messageOf(error)} Nothing was sent.`);
  }

  let existing = "{}";
  try {
    existing = await deps.readPresets(targetOf(light));
  } catch (error) {
    return row(light, "failed", `WLED presets did not load. ${messageOf(error)} Nothing was sent.`, safety.id);
  }
  const parsedPresets = parseWledPresets(existing);
  if (!parsedPresets.ok && existing.trim() !== "{}") {
    return row(light, "failed", `${parsedPresets.message} Nothing was sent.`, safety.id);
  }

  const elements = deps.store.elementsFor(light.id);
  const props = deps.store.propsFor(light.id);
  const ledmap = await writeAndVerifyLedmap({
    light,
    props,
    readLedmap: deps.readLedmap,
    writeLedmap: deps.writeLedmap,
  });
  if (!ledmap.ok) {
    const status = ledmap.status === 422
      ? "refused"
      : ledmap.status === 503
        ? "failed"
        : ledmap.error.includes("unknown") || ledmap.error.includes("reread")
          ? "unknown"
          : "mismatch";
    return row(light, status, ledmap.message, safety.id);
  }

  const geometry = { ledCount: light.ledCount, elements, props };
  const targets = lookTargets(geometry);
  if (targets.length === 0) {
    return row(light, "refused", "This Light has no LEDs to address. Find the strip length first. Nothing was sent.", safety.id);
  }
  const most = Math.max(...document.looks.map((look) => lookTargetsForLook(look, geometry).length), targets.length);
  if (typeof snap.maxSegments === "number" && most > snap.maxSegments) {
    return row(
      light,
      "refused",
      `A Look needs ${most} segments on this Light and this controller holds ${snap.maxSegments}. Merge sections or Segments first. Nothing was sent.`,
      safety.id,
    );
  }
  const sectionNotes = lookSectionNotes(geometry);
  const managed = buildManagedPresets({
    looks: document.looks,
    playlists: document.playlists,
    targets,
    rgbw: light.rgbw,
    geometry,
  });
  const merged = mergeWledPresets(existing, managed);
  try {
    await deps.writePresets(targetOf(light), merged);
  } catch (error) {
    return row(light, "failed", `WLED did not take presets.json. ${messageOf(error)}`.trim(), safety.id);
  }
  let afterPresets: string;
  try {
    afterPresets = await deps.readPresets(targetOf(light));
  } catch {
    return row(light, "unknown", "Uploaded Looks, but presets.json did not reread. Not treating as a match.", safety.id);
  }
  const presetMatch = managedPresetSlotsMatch(managed, afterPresets, managedLookSlots(document.looks, document.playlists));
  if (presetMatch === null) {
    return row(light, "unknown", "Uploaded Looks, but presets.json did not reread as JSON. Not treating as a match.", safety.id);
  }
  if (presetMatch === false) {
    return row(light, "mismatch", "Uploaded Looks, but presets.json reads back different. Not treating as a match.", safety.id);
  }

  const notes: string[] = [`Reports the ${document.looks.length} Looks as the same preset numbers.`, ...sectionNotes];

  if (input.includeSchedule && document.schedule && input.runSlot !== null) {
    const planned = buildScheduleWrite(document.schedule, input.runSlot, wledTimerDialect(snap.firmware));
    if (!(await deps.writeCfg(targetOf(light), planned.body))) {
      return row(light, "failed", "Looks matched. WLED did not accept the Schedule (NTP / timers).", safety.id);
    }
    const cfg = await deps.readCfg(targetOf(light));
    const matched = scheduleMatches(planned.expectedNtp, planned.expectedTimers, cfg);
    if (matched === null) {
      return row(light, "unknown", "Looks matched. Schedule was written, but /json/cfg did not reread. Not treating as a match.", safety.id);
    }
    if (matched === false) {
      return row(light, "mismatch", "Looks matched. Schedule wrote, but /json/cfg reads back different timers or NTP. Not treating as a match.", safety.id);
    }
    notes.push("Reports the nightly Schedule.");
  }

  if (input.udp) {
    const role = input.udp.roles[light.id];
    if (role) {
      if (!isSupportedProvisionFirmware(snap.firmware)) {
        return row(light, "mismatch", `${notes.join(" ")} WLED sync was not written: ${snap.firmware} is not in Nightplot’s verified firmware table.`, safety.id);
      }
      const current = parseWledUdpSync(await deps.readCfg(targetOf(light)));
      if (!current) {
        return row(light, "mismatch", `${notes.join(" ")} WLED sync was not written: this firmware did not report sync settings.`, safety.id);
      }
      const planned = buildUdpSyncWrite(current, role, input.udp.group);
      if (!(await deps.writeCfg(targetOf(light), planned.body))) {
        return row(light, "failed", `${notes.join(" ")} WLED did not accept the sync settings.`, safety.id);
      }
      const matched = udpSyncMatches(planned.expected, parseWledUdpSync(await deps.readCfg(targetOf(light))));
      if (matched === true) notes.push(`Reports WLED sync group ${input.udp.group} (${role}).`);
      else if (matched === false) {
        return row(light, "mismatch", `${notes.join(" ")} Sync wrote, but /json/cfg reads back different. Not treating as a match.`, safety.id);
      } else {
        return row(light, "unknown", `${notes.join(" ")} Sync was written, but /json/cfg did not reread. Not treating as a match.`, safety.id);
      }
    }
  }

  const udpRole = input.udp?.roles[light.id];
  const digest = lookPushDigest({
    looks: document.looks,
    playlists: document.playlists,
    schedule: document.schedule,
    includeSchedule: input.includeSchedule,
    udp: input.udp && udpRole ? { group: input.udp.group, role: udpRole } : null,
  });
  const pushedAt = new Date().toISOString();
  deps.store.replace({
    ...light,
    lastLookPush: {
      at: pushedAt,
      includeSchedule: input.includeSchedule,
      ...(input.udp && udpRole ? { udp: { group: input.udp.group, role: udpRole } } : {}),
      digest,
    },
    ...(ledmap.digest ? { lastLedmap: { digest: ledmap.digest, at: pushedAt } } : {}),
  });
  return row(light, "matched", notes.join(" "), safety.id);
}
