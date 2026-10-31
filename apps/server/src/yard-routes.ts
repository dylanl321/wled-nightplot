import {
  FLEET_YARD_CONCURRENCY,
  YARD_CAPTION,
  YARD_SWEEP_CAPTION,
  buildYardCheckRow,
  isPresetId,
  parseLightIdList,
  parseWledPresets,
  parseWledProvision,
  runPresetSlot,
  validateLooksLibrary,
  validateSchedule,
  yardFixSummary,
  yardPushPlan,
  yardSweepSummary,
  type ActivityEntry,
  type BackupDocument,
  type HostPort,
  type Light,
  type SyncRow,
  type YardCheckRow,
  type YardUndoToken,
} from "@nightplot/shared";
import type { Hono } from "hono";
import { mapLimit } from "./discovery/map-limit.ts";
import { pushLooksToLight, type LookRouteDeps } from "./look-routes.ts";
import type { FileYardUndoStore } from "./store/yard-undo-store.ts";
import type { WriteWledNativeFiles } from "./wled/native-backup.ts";
import type { WriteStateFn } from "./wled/live.ts";

export type YardRouteDeps = LookRouteDeps & {
  undo: FileYardUndoStore;
  write: WriteStateFn;
  writeNativeFiles: WriteWledNativeFiles;
  backupsRead: (id: string) => BackupDocument | null;
  now: () => string;
};

const BUSY = "End Preview or Blink on this Light first. Nothing was sent.";
const OFFLINE = "WLED did not answer. Nothing was sent.";

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

export function registerYardRoutes(app: Hono, deps: YardRouteDeps) {
  app.get("/api/yard-check", async (c) => {
    const result = await checkYard(deps);
    return c.json(result);
  });

  app.get("/api/yard-check/undo", (c) => {
    const token = deps.undo.read();
    return c.json({
      undo: token,
      caption: token
        ? "Undo restores the native WLED files taken before the last Fix all. Not Hardware Done."
        : "There is no Yard Fix to undo.",
    });
  });

  app.post("/api/yard-check/fix", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lightIds?: unknown } | null;
    const requested = parseLightIdList(body);
    const document = deps.looks.read();
    const libraryError = validateLooksLibrary(document.looks, document.playlists);
    if (libraryError) return c.json({ error: "invalid-looks", message: libraryError }, 400);
    if (document.schedule?.enabled) {
      const scheduleError = validateSchedule(document.schedule, document.looks, document.playlists);
      if (scheduleError) return c.json({ error: "invalid-schedule", message: scheduleError }, 400);
    }

    let lightIds = requested;
    if (!lightIds) {
      const checked = await checkYard(deps);
      lightIds = checked.rows.filter((item) => item.canFix).map((item) => item.lightId);
    }
    if (!lightIds.length) {
      return c.json({
        kind: "yard-fix",
        rows: [],
        backupIds: [],
        undo: deps.undo.read(),
        message: "No Lights needed a fix. Nothing was sent.",
        caption: YARD_CAPTION,
      });
    }

    const rows = await mapLimit(lightIds, FLEET_YARD_CONCURRENCY, async (lightId) => {
      const stored = deps.store.findById(lightId);
      if (!stored) return row({ id: lightId, name: lightId }, "refused", "That Light is not on Lights. Nothing was sent.");
      if (deps.live.get(stored.id)) return row(stored, "refused", BUSY);
      const { light, live: snap } = await deps.refreshOne(stored);
      if (!snap || light.reachability !== "online") return row(light, "failed", OFFLINE);
      const plan = yardPushPlan({
        lastPush: light.lastLookPush,
        scheduleEnabled: document.schedule?.enabled === true,
      });
      let runSlot: number | null = null;
      if (plan.includeSchedule && document.schedule) {
        runSlot = runPresetSlot(document.schedule, document.looks, document.playlists);
        if (runSlot === null) {
          return row(light, "refused", "The Schedule does not name a Look or playlist in the library. Nothing was sent.");
        }
      }
      const release = deps.live.block(light.id);
      try {
        await deps.live.settle(light.id);
        if (deps.live.get(light.id)) return row(light, "refused", BUSY);
        return await pushLooksToLight(deps, {
          light,
          snap,
          document,
          includeSchedule: plan.includeSchedule,
          runSlot,
          udp: plan.udp ? { group: plan.udp.group, roles: { [light.id]: plan.udp.role } } : null,
          reason: "pre-yard-fix",
        });
      } finally {
        release();
      }
    });

    const backupIds = rows.flatMap((item) => (item.safetyBackupId ? [item.safetyBackupId] : []));
    const undo = backupIds.length
      ? deps.undo.save({ at: deps.now(), backupIds, lightIds: rows.map((item) => item.lightId) })
      : deps.undo.read();
    for (const done of rows) {
      const light = deps.store.findById(done.lightId) ?? { id: done.lightId, name: done.lightName };
      deps.record(light, "sync", readbackOf(done.status), `Yard fix: ${done.detail}`);
    }
    return c.json({
      kind: "yard-fix",
      rows,
      backupIds,
      undo,
      message: yardFixSummary(rows),
      caption: YARD_CAPTION,
    });
  });

  app.post("/api/yard-check/sweep", async (c) => {
    const document = deps.looks.read();
    const look = document.looks[0];
    if (!look || !isPresetId(look.slot)) {
      return c.json({ error: "looks-required", message: "Add a Look before sweeping the yard. Nothing was sent." }, 400);
    }
    const lights = deps.store.load();
    const rows = await mapLimit(lights.map((item) => item.id), FLEET_YARD_CONCURRENCY, async (lightId) => {
      const stored = deps.store.findById(lightId);
      if (!stored) return row({ id: lightId, name: lightId }, "refused", "That Light is not on Lights. Nothing was sent.");
      if (deps.live.get(stored.id)) return row(stored, "refused", BUSY);
      const { light, live: snap } = await deps.refreshOne(stored);
      if (!snap || light.reachability !== "online") return row(light, "failed", OFFLINE);
      const release = deps.live.block(light.id);
      try {
        await deps.live.settle(light.id);
        if (deps.live.get(light.id)) return row(light, "refused", BUSY);
        let presets;
        try { presets = parseWledPresets(await deps.readPresets(targetOf(light))); }
        catch (error) { return row(light, "failed", `WLED presets did not load. ${messageOf(error)} Nothing was sent.`); }
        if (!presets.ok) return row(light, "failed", `${presets.message} Nothing was sent.`);
        if (!presets.presets.some((entry) => entry.id === look.slot)) {
          return row(light, "refused", `This Light has no preset ${look.slot}. Push Looks first. Nothing was sent.`);
        }
        if (!(await deps.write(targetOf(light), { ps: look.slot, udpn: { nn: true } }))) {
          return row(light, "failed", "WLED did not accept the Look.");
        }
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 250));
          const { live: after } = await deps.refreshOne(deps.store.findById(light.id) ?? light);
          if (!after) return row(light, "unknown", "Sent, but WLED did not answer the reread.");
          if (after.preset === look.slot) return row(light, "matched", `Reports Look “${look.name}”.`);
        }
        return row(light, "unknown", `Sent Look “${look.name}”, but WLED did not report that preset. Not treating as a match.`);
      } finally {
        release();
      }
    });
    for (const done of rows) {
      const light = deps.store.findById(done.lightId) ?? { id: done.lightId, name: done.lightName };
      deps.record(light, "sync", readbackOf(done.status), `Yard sweep: ${done.detail}`);
    }
    return c.json({
      kind: "yard-sweep",
      rows,
      message: yardSweepSummary(rows),
      caption: YARD_SWEEP_CAPTION,
    });
  });

  app.post("/api/yard-check/undo", async (c) => {
    const token = deps.undo.read();
    if (!token || token.backupIds.length === 0) {
      return c.json({ error: "nothing-to-undo", message: "There is no Yard Fix to undo. Nothing was sent." }, 400);
    }
    const rows = await mapLimit(token.backupIds, FLEET_YARD_CONCURRENCY, async (backupId) => {
      const backup = deps.backupsRead(backupId);
      if (!backup) return row({ id: backupId, name: backupId }, "failed", "That safety backup is gone. Nothing was sent.");
      const lightId = backup.lightId;
      if (!lightId) return row({ id: backupId, name: backup.lightName ?? backupId }, "failed", "That backup is not tied to a Light. Nothing was sent.");
      const stored = deps.store.findById(lightId);
      if (!stored) return row({ id: lightId, name: backup.lightName ?? lightId }, "refused", "That Light is not on Lights. Nothing was sent.");
      if (deps.live.get(stored.id)) return row(stored, "refused", BUSY);
      const { light, live: snap } = await deps.refreshOne(stored);
      if (!snap || light.reachability !== "online") return row(light, "failed", OFFLINE);
      if (!backup.deviceFiles?.cfgJson || !backup.deviceFiles.presetsJson) {
        return row(light, "failed", "That safety backup has no complete WLED files. Nothing was sent.");
      }
      const release = deps.live.block(light.id);
      try {
        await deps.live.settle(light.id);
        if (deps.live.get(light.id)) return row(light, "refused", BUSY);
        await deps.writeNativeFiles(targetOf(light), {
          cfgJson: backup.deviceFiles.cfgJson,
          presetsJson: backup.deviceFiles.presetsJson,
        });
        return row(light, "matched", "Restored the pre-fix WLED files. Not Hardware Done.", backup.id);
      } catch (error) {
        return row(light, "failed", `WLED did not take the undo files. ${messageOf(error)}`.trim());
      } finally {
        release();
      }
    });
    deps.undo.clear();
    for (const done of rows) {
      const light = deps.store.findById(done.lightId) ?? { id: done.lightId, name: done.lightName };
      deps.record(light, "sync", readbackOf(done.status), `Yard undo: ${done.detail}`);
    }
    return c.json({
      kind: "yard-undo",
      rows,
      undo: null,
      message: rows.every((item) => item.status === "matched")
        ? "Undid the last Yard fix from its safety backups."
        : "Undo finished with some Lights not restored. Check the list.",
      caption: YARD_CAPTION,
    });
  });
}

async function checkYard(deps: YardRouteDeps): Promise<{
  rows: YardCheckRow[];
  checkedAt: string;
  caption: string;
  undo: YardUndoToken | null;
}> {
  const document = deps.looks.read();
  const lights = deps.store.load();
  const rows = await mapLimit(lights, FLEET_YARD_CONCURRENCY, async (stored) => {
    const { light, live } = await deps.refreshOne(stored);
    const reachable = light.reachability === "online" && live !== null;
    let cfg: unknown = null;
    let presetsRaw: string | null = null;
    let provision = null;
    if (reachable) {
      cfg = await deps.readCfg(targetOf(light));
      provision = cfg ? parseWledProvision(cfg, live?.firmware ?? light.firmware) : null;
      try { presetsRaw = await deps.readPresets(targetOf(light)); }
      catch { presetsRaw = null; }
    }
    return buildYardCheckRow({
      light,
      live,
      elements: deps.store.elementsFor(light.id),
      props: deps.store.propsFor(light.id),
      looks: document.looks,
      playlists: document.playlists,
      schedule: document.schedule,
      provision,
      presetsRaw,
      cfg,
    });
  });
  return { rows, checkedAt: deps.now(), caption: YARD_CAPTION, undo: deps.undo.read() };
}
