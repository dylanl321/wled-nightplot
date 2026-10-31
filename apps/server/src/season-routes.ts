import {
  FLEET_YARD_CONCURRENCY,
  SEASON_CAPTION,
  SEASON_KIND,
  SEASON_VERSION,
  applyHostMatch,
  deviceFilesFromNative,
  diffSeason,
  macsMatch,
  parseLightIdList,
  parseSeasonDocument,
  rematchSeasonHost,
  runPresetSlot,
  seasonDigest,
  validateLooksLibrary,
  validateSchedule,
  type ActivityEntry,
  type BackupDocument,
  type DiscoverRow,
  type HostPort,
  type Light,
  type SeasonDocument,
  type SyncRow,
} from "@nightplot/shared";
import type { Hono } from "hono";
import { mapLimit } from "./discovery/map-limit.ts";
import { pushLooksToLight, type LookRouteDeps } from "./look-routes.ts";
import { writeSeasonStoresConsistent } from "./store/nightplot-restore.ts";
import type { FileSetupProfilesStore } from "./store/setup-profiles-store.ts";
import type { ProbeFn } from "./wled/client.ts";
import type { ReadWledNativeFiles } from "./wled/native-backup.ts";

export type SeasonRouteDeps = LookRouteDeps & {
  profiles: FileSetupProfilesStore;
  probe: ProbeFn;
  readNativeFiles: ReadWledNativeFiles;
  discoverRows: () => DiscoverRow[];
  captureNightplot: (reason: "pre-season-restore") => BackupDocument;
  now: () => string;
};

function targetOf(light: Pick<Light, "hostname" | "port">): HostPort {
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

export function snapshotSeason(deps: SeasonRouteDeps): SeasonDocument {
  const looks = deps.looks.read();
  return {
    version: SEASON_VERSION,
    kind: SEASON_KIND,
    at: deps.now(),
    lights: deps.store.load(),
    elements: deps.store.loadElements(),
    props: deps.store.loadProps(),
    setupProfiles: deps.profiles.list(),
    looks,
    devices: [],
  };
}

export function registerSeasonRoutes(app: Hono, deps: SeasonRouteDeps) {
  app.get("/api/season/export", async (c) => {
    const includeDevices = c.req.query("includeDevices") === "1" || c.req.query("includeDevices") === "true";
    const document = snapshotSeason(deps);
    if (includeDevices) {
      document.devices = await mapLimit(document.lights, FLEET_YARD_CONCURRENCY, async (light) => {
        const outcome = await deps.probe(targetOf(light));
        if (outcome.kind !== "found") {
          return deviceFilesFromNative({ light, files: null });
        }
        try {
          const files = await deps.readNativeFiles(targetOf(light));
          return deviceFilesFromNative({ light: { ...light, firmware: outcome.snapshot.firmware, mac: outcome.snapshot.mac }, files });
        } catch {
          return deviceFilesFromNative({ light, files: null });
        }
      });
    }
    return c.json({
      document,
      digest: seasonDigest(document),
      caption: SEASON_CAPTION,
    });
  });

  app.post("/api/season/review", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { document?: unknown } | null;
    const parsed = parseSeasonDocument(body?.document ?? body);
    if (!parsed.ok) return c.json({ error: "invalid-season", message: parsed.message }, 422);
    const current = snapshotSeason(deps);
    const rematch = await rematchPreview(deps, parsed.document.lights);
    return c.json({
      ok: true,
      migratedFrom: parsed.migratedFrom,
      incoming: summaryOf(parsed.document),
      current: summaryOf(current),
      diff: diffSeason(current, parsed.document),
      expectedDigest: seasonDigest(parsed.document),
      expectedCurrentDigest: seasonDigest(current),
      looksMissing: parsed.document.looks === null,
      hostCollision: rematch.hostCollision,
      rematch: rematch.rows,
      message: parsed.document.looks
        ? "Review this season file. Restore replaces Nightplot Lights, Segments, Props, setup profiles, and Looks. Controllers are not written until you choose re-push."
        : "This file has no Looks. Restore will leave the current Looks library in place. Review the rest before continuing.",
      caption: SEASON_CAPTION,
    });
  });

  app.post("/api/season/restore", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      document?: unknown;
      expectedDigest?: unknown;
      expectedCurrentDigest?: unknown;
      confirm?: unknown;
      pushToControllers?: unknown;
      lightIds?: unknown;
    } | null;
    if (!body || body.confirm !== true || typeof body.expectedDigest !== "string" || typeof body.expectedCurrentDigest !== "string") {
      return c.json({
        error: "confirmation-required",
        message: "Review this season file and confirm its digest first. Nothing was restored.",
      }, 400);
    }
    const parsed = parseSeasonDocument(body.document);
    if (!parsed.ok) return c.json({ error: "invalid-season", message: parsed.message }, 422);
    if (parsed.document.looks) {
      const libraryError = validateLooksLibrary(parsed.document.looks.looks, parsed.document.looks.playlists);
      if (libraryError) return c.json({ error: "invalid-looks", message: libraryError }, 400);
      if (parsed.document.looks.schedule) {
        const scheduleError = validateSchedule(parsed.document.looks.schedule, parsed.document.looks.looks, parsed.document.looks.playlists);
        if (scheduleError) return c.json({ error: "invalid-schedule", message: scheduleError }, 400);
      }
    }
    if (deps.live.list().length) {
      return c.json({ error: "busy", message: "End Preview or Blink before restoring a season. Nothing was restored." }, 409);
    }
    const current = snapshotSeason(deps);
    if (seasonDigest(parsed.document) !== body.expectedDigest || seasonDigest(current) !== body.expectedCurrentDigest) {
      return c.json({ error: "changed", message: "The season file or current Nightplot data changed. Review again; nothing was restored." }, 409);
    }

    const rematch = await rematchPreview(deps, parsed.document.lights);
    const rematched = rematch.rematched;
    if (rematch.hostCollision) {
      return c.json({
        error: "host-collision",
        message: "Two Lights would share a host after MAC rematch. Nothing was restored.",
      }, 409);
    }

    const releases = deps.store.load().map((light) => deps.live.block(light.id));
    let safety: BackupDocument;
    try {
      await Promise.all(deps.store.load().map((light) => deps.live.settle(light.id)));
      if (deps.live.list().length) {
        return c.json({ error: "busy", message: "End Preview or Blink before restoring a season. Nothing was restored." }, 409);
      }
      try { safety = deps.captureNightplot("pre-season-restore"); }
      catch (error) {
        return c.json({
          error: "backup-failed",
          message: error instanceof Error
            ? `Safety backup failed: ${error.message} Nothing was restored.`
            : "Safety backup failed. Nothing was restored.",
        }, 503);
      }
      try {
        writeSeasonStoresConsistent({
          lights: deps.store.path,
          looks: parsed.document.looks ? deps.looks.path : undefined,
          profiles: deps.profiles.path,
        }, {
          lights: rematched.map((row) => row.light),
          elements: parsed.document.elements,
          props: parsed.document.props,
          looks: parsed.document.looks ?? undefined,
          profiles: parsed.document.setupProfiles,
        });
      } catch (error) {
        return c.json({
          error: "restore-failed",
          message: `Season restore did not finish. Safety backup ${safety.id} is kept. ${error instanceof Error ? error.message : ""}`,
        }, 500);
      }
    } finally {
      releases.forEach((release) => release());
    }

    const matches = rematched.map((row) => ({
      lightId: row.light.id,
      name: row.light.name,
      hostKey: row.light.hostKey,
      how: row.how,
    }));

    let pushRows: SyncRow[] = [];
    if (body.pushToControllers === true) {
      if (!parsed.document.looks) {
        return c.json({
          restored: true,
          safetyBackupId: safety.id,
          matches,
          rows: [],
          message: "Season restored in Nightplot. Looks were not in the file, so nothing was pushed to controllers.",
          caption: SEASON_CAPTION,
        });
      }
      const document = parsed.document.looks;
      const includeSchedule = document.schedule?.enabled === true;
      let runSlot: number | null = null;
      if (includeSchedule && document.schedule) {
        runSlot = runPresetSlot(document.schedule, document.looks, document.playlists);
      }
      const requested = parseLightIdList(body) ?? rematched.map((row) => row.light.id);
      pushRows = await mapLimit(requested, FLEET_YARD_CONCURRENCY, async (lightId) => {
        const stored = deps.store.findById(lightId);
        if (!stored) return row({ id: lightId, name: lightId }, "refused", "That Light is not on Lights after restore. Nothing was sent.");
        if (deps.live.get(stored.id)) return row(stored, "refused", "End Preview or Blink on this Light first. Nothing was sent.");
        const { light, live: snap } = await deps.refreshOne(stored);
        if (!snap || light.reachability !== "online") return row(light, "failed", "WLED did not answer. Nothing was sent.");
        const release = deps.live.block(light.id);
        try {
          await deps.live.settle(light.id);
          if (deps.live.get(light.id)) return row(light, "refused", "End Preview or Blink on this Light first. Nothing was sent.");
          return await pushLooksToLight(deps, {
            light,
            snap,
            document,
            includeSchedule,
            runSlot,
            udp: light.lastLookPush?.udp
              ? { group: light.lastLookPush.udp.group, roles: { [light.id]: light.lastLookPush.udp.role } }
              : null,
            reason: "pre-season-restore",
          });
        } finally {
          release();
        }
      });
      for (const done of pushRows) {
        const light = deps.store.findById(done.lightId) ?? { id: done.lightId, name: done.lightName };
        deps.record(light, "sync", readbackOf(done.status), `Season re-push: ${done.detail}`);
      }
    }

    return c.json({
      restored: true,
      safetyBackupId: safety.id,
      matches,
      rows: pushRows,
      message: body.pushToControllers === true
        ? "Season restored. Each Light is listed by the re-push result. Not Hardware Done."
        : "Season restored in Nightplot. No controller was written; use Yard check or Push Looks separately.",
      caption: SEASON_CAPTION,
    });
  });
}

function summaryOf(document: SeasonDocument) {
  return {
    lights: document.lights.length,
    segments: document.elements.length,
    props: document.props.length,
    profiles: document.setupProfiles.length,
    looks: document.looks?.looks.length ?? null,
    playlists: document.looks?.playlists.length ?? null,
    schedule: Boolean(document.looks?.schedule),
    devices: document.devices.length,
  };
}

async function rematchPreview(deps: SeasonRouteDeps, lights: Light[]) {
  const rematched = await rematchLights(deps, lights);
  const hostKeys = rematched.map((row) => row.light.hostKey);
  return {
    rematched,
    hostCollision: new Set(hostKeys).size !== hostKeys.length,
    rows: rematched.map((row) => ({
      lightId: row.light.id,
      name: row.light.name,
      hostKey: row.light.hostKey,
      how: row.how,
    })),
  };
}

async function rematchLights(deps: SeasonRouteDeps, lights: Light[]): Promise<{ light: Light; how: ReturnType<typeof rematchSeasonHost>["how"] }[]> {
  const discovered = deps.discoverRows();
  return mapLimit(lights, FLEET_YARD_CONCURRENCY, async (seasonLight) => {
    const seasonProbe = await deps.probe(targetOf(seasonLight));
    const seasonProbeMac = seasonProbe.kind === "found" ? seasonProbe.snapshot.mac : null;
    const enrolled = seasonLight.mac ? deps.store.findByMac(seasonLight.mac) ?? null : null;
    const enrolledByMac =
      enrolled && !(enrolled.hostname === seasonLight.hostname && enrolled.port === seasonLight.port)
        ? enrolled
        : null;
    const found = seasonLight.mac
      ? discovered.find((row) =>
        row.status === "found" &&
        row.mac &&
        row.port != null &&
        macsMatch(seasonLight.mac!, row.mac))
      : undefined;
    const match = rematchSeasonHost({
      season: seasonLight,
      seasonProbeMac,
      enrolledByMac,
      discoveredByMac: found && found.port != null
        ? { hostname: found.hostname, port: found.port }
        : null,
    });
    return { light: applyHostMatch(seasonLight, match), how: match.how };
  });
}
