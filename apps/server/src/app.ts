import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CURRENT_SLICE,
  allOffNoAnswerReason,
  allOffSummary,
  APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE,
  applyOutcome,
  backupNeedsControllerConfirmation,
  APPLY_UNKNOWN_COLOUR_REASON,
  applyRefuseReason,
  applyUnknownSegments,
  applyUnreadFailed,
  knownApplyColor,
  snapshotSegmentCount,
  buildDeleteChecks,
  canDelete,
  catalogSnapshot,
  compareLastApply,
  LED_CATALOG_DELETE_CAPTION,
  LED_CATALOG_DELETE_CLEARED,
  ledProductDeleteImpact,
  parseLedProductAttach,
  parseLedProductInput,
  resolveLedProductAttach,
  unknownLedProductDeleteImpact,
  deleteRefuseReason,
  decideProbeAddress,
  displayHost,
  decorateLiveCaption,
  foldHonestySource,
  honestySource,
  manageCaption,
  macsMatch,
  normalizeHostKey,
  normalizeMac,
  parseHexColor,
  getStrip,
  resolveApplyColors,
  reportedColorsMatch,
  parseSegmentBackup,
  parseWledCfg,
  readdressContinuity,
  applyResolvedName,
  applyNamePattern,
  buildProvisionOutputsWrite,
  buildSafeWrite,
  FLEET_BULK_CAPTION,
  FLEET_ENROLL_CONCURRENCY,
  FLEET_PROFILE_CONCURRENCY,
  fleetApplySummary,
  fleetEnrollSummary,
  isProvisionLedType,
  mergeSetupProfile,
  normalizeSetupProfile,
  outputsFromProvision,
  parseHostList,
  parseLightIdList,
  provisionOutputsMatch,
  provisionWriteExpectedLedCount,
  setupProfileWritesSafe,
  setupProfileWritesStrip,
  validateDeclaredRangesForLight,
  validateSetupProfile,
  withMigratedOutputs,
  needsInspectStripKindSeed,
  parseProvisionBody,
  parseWledProvision,
  provisionFieldsMatch,
  provisionMismatchNote,
  provisionOutputWriteRows,
  provisionRefuseReason,
  provisionSnapshotMatch,
  setupProfileTargetIndexes,
  rangeLengthStory,
  reconcileDeclaredRangesForLedCount,
  resolveLightName,
  safeFieldsMatch,
  safeInfoNameLagNote,
  safeRefuseReason,
  shortMac,
  validateDeclaredRanges,
  type AllOffCancelled,
  type AllOffResult,
  type AllOffRow,
  type ActivityEntry,
  buildWledBackupFiles,
  reviewWledNativeRestore,
  WLED_NATIVE_BACKUP_CAPTION,
  WLED_NATIVE_RESTORE_CAPTION,
  type BackupData,
  type BackupReason,
  type ControllerReference,
  type DiscoverRow,
  type DraftRange,
  type Element,
  type HostPort,
  type LedProduct,
  type Light,
  type LightDetail,
  type LightView,
  type LightsPayload,
  isNightplotSettings,
  type LiveEndKind,
  type LiveSource,
  type ReaddressStep,
  type BulkEnrollRow,
  type ProvisionRead,
  type SafeRead,
  type SetupApplyRow,
  type SetupProfile,
  type SetupProfileDraft,
  type WledStripProvisionOutputDraft,
  type SafeWriteResult,
  type SegmentBackup,
  type WledSafeSettings,
  type WledSnapshot,
  type ParsedProvisionBody,
  type Prop,
  type WledStripProvisionDraft,
  nextPropLabel,
  parsePropKind,
  parsePropTaps,
  defaultWireframeSpec,
  segmentsFromPropTaps,
} from "@nightplot/shared";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { resolveCorsOrigins } from "./cors-origins.ts";
import type { CollectFn } from "./discovery/collect.ts";
import {
  ALL_OFF_PROBE_CONCURRENCY,
  FIND_PROBE_CONCURRENCY,
  mapLimit,
  mapLimitSettled,
} from "./discovery/map-limit.ts";
import {
  lightDetail,
  lightFromSnapshot,
  markUnreachable,
  needsPortRow,
  refusedRow,
  rowFromProbe,
} from "./domain.ts";
import { createLiveEngine, previewDisplaySnapshot } from "./live/engine.ts";
import { FileActivityStore } from "./store/activity-store.ts";
import { backupDigest, FileBackupStore } from "./store/backup-store.ts";
import { writeNightplotStoresConsistent } from "./store/nightplot-restore.ts";
import { FileLedProductsStore } from "./store/led-products-store.ts";
import { FileSettingsStore } from "./store/settings-store.ts";
import { StoreUnreadableError } from "./store/store-error.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import { FileLooksStore } from "./store/looks-store.ts";
import { FileSetupProfilesStore } from "./store/setup-profiles-store.ts";
import { registerLookRoutes } from "./look-routes.ts";
import { registerSeasonRoutes } from "./season-routes.ts";
import { registerYardRoutes } from "./yard-routes.ts";
import { FileYardUndoStore } from "./store/yard-undo-store.ts";
import type { ProbeFn } from "./wled/client.ts";
import type { ReadCfgFn, WriteCfgFn } from "./wled/cfg.ts";
import {
  createWledConfigExportReader,
  createWledNativeFilesReader,
  createWledNativeFilesWriter,
  createWledLedmapReader,
  createWledLedmapWriter,
  createWledPresetsReader,
  createWledPresetsWriter,
  type ReadWledConfigExport,
  type ReadWledLedmap,
  type ReadWledNativeFiles,
  type ReadWledPresets,
  type WriteWledLedmap,
  type WriteWledNativeFiles,
  type WriteWledPresets,
} from "./wled/native-backup.ts";
import { persistWireframeOnLight, specFromBody, writeAndVerifyLedmap } from "./wireframe-persist.ts";
import { registerSyncRoutes } from "./sync-routes.ts";
import { applyRangesWrite, type ReadLiveFn, type WriteStateFn } from "./wled/live.ts";

export type AppDeps = {
  store: FileLightsStore;
  activity?: FileActivityStore;
  backups?: FileBackupStore;
  settings?: FileSettingsStore;
  products?: FileLedProductsStore;
  profiles?: FileSetupProfilesStore;
  looks?: FileLooksStore;
  probe: ProbeFn;
  collect: CollectFn;
  write: WriteStateFn;
  readLive: ReadLiveFn;
  readCfg: ReadCfgFn;
  readNativeFiles?: ReadWledNativeFiles;
  writeNativeFiles?: WriteWledNativeFiles;
  readConfigExport?: ReadWledConfigExport;
  readPresets?: ReadWledPresets;
  writePresets?: WriteWledPresets;
  readLedmap?: ReadWledLedmap;
  writeLedmap?: WriteWledLedmap;
  writeCfg: WriteCfgFn;
  now?: () => Date;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const products =
    deps.products ??
    new FileLedProductsStore(join(tmpdir(), `nightplot-led-products-${randomUUID()}.json`));
  const activity = deps.activity ?? new FileActivityStore(join(tmpdir(), `nightplot-activity-${randomUUID()}.json`));
  const settings = deps.settings ?? new FileSettingsStore(join(tmpdir(), `nightplot-settings-${randomUUID()}.json`));
  const profiles =
    deps.profiles ??
    new FileSetupProfilesStore(join(tmpdir(), `nightplot-setup-profiles-${randomUUID()}.json`));
  const looks =
    deps.looks ??
    new FileLooksStore(join(tmpdir(), `nightplot-looks-${randomUUID()}.json`));
  const backups = deps.backups ?? new FileBackupStore(join(tmpdir(), `nightplot-backups-${randomUUID()}`), () => settings.read().backupRetention);
  const readNativeFiles = deps.readNativeFiles ?? createWledNativeFilesReader();
  const writeNativeFiles = deps.writeNativeFiles ?? createWledNativeFilesWriter();
  const readConfigExport = deps.readConfigExport ?? createWledConfigExportReader();
  const readLedmap = deps.readLedmap ?? createWledLedmapReader();
  const writeLedmap = deps.writeLedmap ?? createWledLedmapWriter();
  const session: { rows: DiscoverRow[] } = { rows: [] };
  const nowIso = () => (deps.now ?? (() => new Date()))().toISOString();
  function record(light: Pick<Light, "id" | "name">, action: ActivityEntry["action"],
    readback: ActivityEntry["readback"], detail: string) {
    activity.append({ id: randomUUID(), at: nowIso(), lightId: light.id,
      lightName: light.name, action, readback, detail });
  }

  function currentBackupData(): BackupData {
    const saved = deps.store.snapshotForBackup();
    return { ...saved, products: products.snapshotForBackup(), activity: activity.list().reverse(), settings: settings.read() };
  }

  function capture(reason: BackupReason, light?: Light, controller?: ControllerReference) {
    return backups.create({ at: nowIso(), reason, lightId: light?.id, lightName: light?.name,
      data: currentBackupData(), controller });
  }

  async function captureDevice(reason: BackupReason, light: Light, snap: WledSnapshot,
    settings?: { safe?: Record<string, unknown>; strip?: Record<string, unknown> }) {
    if (light.mac && snap.mac && !macsMatch(light.mac, snap.mac))
      throw new Error("Controller MAC changed; no device backup was saved.");
    const raw = await readNativeFiles({ hostname: light.hostname, port: light.port });
    const deviceFiles = buildWledBackupFiles({
      cfgJson: raw.cfgJson,
      presetsJson: raw.presetsJson,
      light,
      liveMac: snap.mac,
      liveFirmware: snap.firmware,
      capturedAt: nowIso(),
    });
    return backups.create({ at: nowIso(), reason, lightId: light.id, lightName: light.name,
      data: currentBackupData(), controller: controllerReference(light, snap, settings), deviceFiles });
  }

  function controllerReference(light: Light, snap: WledSnapshot,
    settings?: { safe?: Record<string, unknown>; strip?: Record<string, unknown> }): ControllerReference {
    return { hostKey: light.hostKey, mac: snap.mac, ledCount: snap.ledCount,
      reported: { on: snap.on, brightness: snap.brightness,
        segments: snap.segments, segmentColor: snap.segmentColor },
      ...(settings?.safe ? { safeSettings: settings.safe } : {}),
      ...(settings?.strip ? { stripSettings: settings.strip } : {}) };
  }

  function departingControllerReference(light: Light): ControllerReference {
    return light.lastSnapshot
      ? controllerReference(light, light.lastSnapshot)
      : { hostKey: light.hostKey, mac: light.mac, ledCount: light.ledCount,
        reported: { on: light.on, brightness: light.brightness, segments: null, segmentColor: null } };
  }

  function backupFailure(error: unknown) {
    return { error: "backup-failed", message: error instanceof Error ?
      `Safety backup failed: ${error.message} The requested change was not made; nothing was sent to WLED.` :
      "Safety backup failed. The requested change was not made; nothing was sent to WLED." };
  }
  const live = createLiveEngine({
    // Preview and Blink belong to one Light: `udpn.nn` stops a WLED sync
    // leader from broadcasting them to its followers.
    write: (target, body) => deps.write(target, { ...body, udpn: { nn: true } }),
    readLive: deps.readLive,
    findLight: (id) => deps.store.findById(id),
  });

  function catalogDeleteFromStore(productId: string) {
    const raw = deps.store.tryLoadRaw();
    if (!raw.ok) return unknownLedProductDeleteImpact();
    return ledProductDeleteImpact(raw.lights, productId);
  }

  app.onError((error, c) => {
    if (error instanceof StoreUnreadableError)
      return c.json({ error: "store-unreadable", store: error.store, message: error.message }, 503);
    throw error;
  });

  app.use(
    "*",
    cors({
      origin: resolveCorsOrigins(),
    }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "nightplot-configure",
      slice: CURRENT_SLICE,
    }),
  );

  app.get("/api/catalogs", (c) => c.json(catalogSnapshot(products.list())));

  app.get("/api/settings", (c) => c.json({ settings: settings.read() }));
  app.get("/api/lights/:id/config", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const target = { hostname: stored.hostname, port: stored.port };
    const found = await deps.probe(target);
    if (found.kind !== "found") return c.json({ error: "unreachable", message: "WLED did not answer. Configuration was not loaded." }, 503);
    if (!stored.mac || !found.snapshot.mac || !macsMatch(stored.mac, found.snapshot.mac))
      return c.json({ error: "identity-unknown", message: "Controller MAC is missing or changed. Configuration was not loaded." }, 409);
    try {
      const raw = await readConfigExport(target);
      const after = await deps.probe(target);
      if (after.kind !== "found" || !after.snapshot.mac || !macsMatch(stored.mac, after.snapshot.mac) ||
        after.snapshot.firmware !== found.snapshot.firmware)
        return c.json({ error: "source-changed", message: "WLED identity or firmware changed while reading configuration. Nothing was loaded or sent." }, 409);
      const config: unknown = JSON.parse(raw);
      return c.json({ lightId: stored.id, mac: found.snapshot.mac, firmware: found.snapshot.firmware,
        sourceDigest: createHash("sha256").update(raw).digest("hex"), config,
        message: "Fresh WLED cfg.json export. Passwords are excluded by WLED. Nothing was sent." });
    } catch {
      return c.json({ error: "config-unavailable", message: "WLED cfg.json could not be read. Nothing was sent." }, 503);
    }
  });
  app.patch("/api/settings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isNightplotSettings(body.settings)) return c.json({ error: "invalid",
      message: "Invalid Nightplot preferences. Nothing was saved or sent to WLED." }, 422);
    if (body.settings.defaultLedProductId && !products.findById(body.settings.defaultLedProductId))
      return c.json({ error: "invalid", message: "That default LED product is not in the catalog." }, 422);
    const result = settings.save(body.settings);
    if (result.error === "conflict") return c.json({ error: "conflict",
      message: "Preferences changed in another browser. Reload and review before saving." }, 409);
    return c.json({ settings: result.settings, message: "Nightplot preferences saved. Nothing was sent to WLED." });
  });

  app.get("/api/backups", (c) => {
    try { return c.json({ backups: backups.list() }); }
    catch (error) {
      return c.json({ error: "invalid-backup",
        message: error instanceof Error ? error.message : "A stored backup could not be read; nothing was ignored or overwritten." }, 500);
    }
  });
  app.get("/api/backups/rotation-preview", (c) => c.json(backups.rotationPreview()));
  app.post("/api/backups/rotation-preview", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isNightplotSettings(body.settings))
      return c.json({ error: "invalid", message: "Invalid retention settings." }, 422);
    return c.json(backups.rotationPreview(body.settings.backupRetention));
  });
  app.post("/api/backups", (c) => {
    try { return c.json({ backup: capture("manual") }, 201); }
    catch (error) { return c.json(backupFailure(error), 503); }
  });
  app.post("/api/lights/:id/backups", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const { light, live: snap } = await refreshOne(stored);
    if (!snap || light.reachability !== "online") return c.json({ error: "unreachable",
      message: "WLED did not answer. A complete device backup was not saved." }, 503);
    try { return c.json({ backup: await captureDevice("manual", light, snap) }, 201); }
    catch (error) { return c.json(backupFailure(error), 503); }
  });
  app.get("/api/backups/:id", (c) => {
    const backup = backups.read(c.req.param("id"));
    return backup ? c.json({ backup }) : c.json({ error: "not_found", message: "Backup not found." }, 404);
  });
  app.get("/api/backups/:id/cfg.json", (c) => nativeFileDownload(c, "cfgJson", "cfg.json"));
  app.get("/api/backups/:id/presets.json", (c) => nativeFileDownload(c, "presetsJson", "presets.json"));

  function nativeFileDownload(c: Context, field: "cfgJson" | "presetsJson", filename: string) {
    const backup = backups.read(c.req.param("id") ?? "");
    if (!backup) return c.json({ error: "not_found", message: "Backup not found." }, 404);
    const text = backup.deviceFiles?.[field];
    if (!text) return c.json({ error: "missing-device-files",
      message: "This backup has no complete WLED configuration and presets files." }, 404);
    return c.body(text, { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    } });
  }
  app.patch("/api/backups/:id/pin", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.pinned !== "boolean") return c.json({ error: "invalid", message: "Choose pinned or unpinned." }, 422);
    const backup = backups.setPinned(c.req.param("id") ?? "", body.pinned);
    return backup ? c.json({ backup }) : c.json({ error: "not_found", message: "Backup not found." }, 404);
  });
  app.delete("/api/backups/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || body.confirmId !== id) return c.json({ error: "confirmation-required",
      message: "Confirm the exact backup id before clearing it. Nothing was removed." }, 400);
    const removed = backups.remove(id);
    return removed ? c.json({ removed: true, id, message: "Backup cleared from local storage; download a copy first if needed." }) :
      c.json({ error: "not_found", message: "Backup not found." }, 404);
  });

  function restoreReview(id: string) {
    const backup = backups.read(id);
    if (!backup) return { ok: false as const, error: "not_found", message: "Backup not found." };
    const data = backup.data;
    if ((data.settings !== undefined && !isNightplotSettings(data.settings)) ||
      !deps.store.validBackup(data) || !products.validBackup(data.products) ||
      !activity.validBackup(data.activity)) return { ok: false as const, error: "invalid-backup",
        message: "Backup data did not validate; nothing was restored." };
    return { ok: true as const, backup, data };
  }

  app.post("/api/backups/:id/restore/check", (c) => {
    const reviewed = restoreReview(c.req.param("id"));
    if (!reviewed.ok) return c.json(reviewed, reviewed.error === "not_found" ? 404 : 422);
    const current = currentBackupData();
    return c.json({ backup: { id: reviewed.backup.id, at: reviewed.backup.at, reason: reviewed.backup.reason,
      lights: reviewed.data.lights.length, segments: reviewed.data.elements.length,
      products: reviewed.data.products.length, activity: reviewed.data.activity.length,
      settings: Boolean(reviewed.data.settings) },
      current: { lights: current.lights.length, segments: current.elements.length,
        products: current.products.length, activity: current.activity.length,
        settings: Boolean(current.settings) },
      expectedDigest: backupDigest(reviewed.data), expectedCurrentDigest: backupDigest(current),
      message: "Review these counts. Restore replaces Nightplot data only; it does not write any controller. Preferences in this backup replace Settings; an older backup without them leaves current Settings in place. A safety backup is created first." });
  });

  app.post("/api/backups/:id/restore", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || body.confirmId !== id || typeof body.expectedDigest !== "string" ||
      typeof body.expectedCurrentDigest !== "string") return c.json({ error: "confirmation-required",
        message: "Review this backup and confirm its exact id first. Nothing was restored." }, 400);
    const reviewed = restoreReview(id);
    if (!reviewed.ok) return c.json(reviewed, reviewed.error === "not_found" ? 404 : 422);
    if (live.list().length) return c.json({ error: "busy", message: "End Preview or Blink before restoring Nightplot data." }, 409);
    const saved = deps.store.load();
    const releases = saved.map((light) => live.block(light.id));
    try {
      await Promise.all(saved.map((light) => live.settle(light.id)));
      if (live.list().length) return c.json({ error: "busy", message: "End Preview or Blink before restoring Nightplot data." }, 409);
      const current = currentBackupData();
      if (backupDigest(reviewed.data) !== body.expectedDigest ||
        backupDigest(current) !== body.expectedCurrentDigest) return c.json({ error: "changed",
          message: "Backup or current Nightplot data changed. Review again; nothing was restored." }, 409);
      let safety;
      try { safety = capture("pre-restore"); }
      catch (error) { return c.json(backupFailure(error), 503); }
      try {
        writeNightplotStoresConsistent({
          lights: deps.store.path,
          products: products.path,
          activity: activity.path,
          settings: settings.path,
        }, reviewed.data);
      } catch (error) {
        return c.json({ error: "restore-failed",
          message: `Restore did not finish. Nightplot data was not replaced. Safety backup ${safety.id} is kept. ${error instanceof Error ? error.message : ""}` }, 500);
      }
      return c.json({ restored: true, safetyBackupId: safety.id,
        message: "Nightplot data restored. No WLED controller was changed; inspect Lights and use Apply separately." });
    } finally { releases.forEach((release) => release()); }
  });

  app.post("/api/backups/:id/restore-wled/check", async (c) => {
    const backup = backups.read(c.req.param("id"));
    if (!backup) return c.json({ error: "not_found", message: "Backup not found." }, 404);
    const body = await c.req.json().catch(() => null);
    const lightId = body && typeof body === "object" && typeof (body as { lightId?: unknown }).lightId === "string"
      ? (body as { lightId: string }).lightId
      : backup.lightId;
    if (!lightId) return c.json({ error: "light-required",
      message: "Choose the Light that should receive these WLED files. Nothing was sent." }, 400);
    const stored = deps.store.findById(lightId);
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const { light, live: snap } = await refreshOne(stored);
    if (!snap || light.reachability !== "online") return c.json({ error: "unreachable",
      message: "WLED did not answer. Native files were not uploaded." }, 503);
    const review = reviewWledNativeRestore({
      backup, light, liveMac: snap.mac, liveFirmware: snap.firmware,
    });
    return c.json({
      ...review,
      backupId: backup.id,
      lightId: light.id,
      lightName: light.name,
      caption: WLED_NATIVE_BACKUP_CAPTION,
    }, review.ok ? 200 : review.error === "missing-device-files" ? 422 : 409);
  });

  app.post("/api/backups/:id/restore-wled", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const typed = body && typeof body === "object" ? body as {
      lightId?: unknown; confirmId?: unknown; confirmFirmwareMismatch?: unknown;
    } : null;
    if (!typed || typed.confirmId !== id || typeof typed.lightId !== "string") {
      return c.json({ error: "confirmation-required",
        message: "Review this WLED export and confirm the backup id and Light first. Nothing was sent." }, 400);
    }
    const backup = backups.read(id);
    if (!backup) return c.json({ error: "not_found", message: "Backup not found." }, 404);
    const stored = deps.store.findById(typed.lightId);
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    if (live.get(stored.id)) return c.json({ error: "busy",
      message: "End Preview or Blink before uploading WLED files. Nothing was sent." }, 409);
    const release = live.block(stored.id);
    try {
      await live.settle(stored.id);
      if (live.get(stored.id)) return c.json({ error: "busy",
        message: "End Preview or Blink before uploading WLED files. Nothing was sent." }, 409);
      const { light, live: snap } = await refreshOne(stored);
      if (!snap || light.reachability !== "online") return c.json({ error: "unreachable",
        message: "WLED did not answer. Native files were not uploaded." }, 503);
      const review = reviewWledNativeRestore({
        backup, light, liveMac: snap.mac, liveFirmware: snap.firmware,
      });
      if (!review.ok) {
        return c.json(review, review.error === "missing-device-files" ? 422 : 409);
      }
      if (review.requiresFirmwareConfirm && typed.confirmFirmwareMismatch !== true) {
        return c.json({ ...review, error: "firmware-mismatch",
          message: "Firmware differs from the export. Confirm that before uploading. Nothing was sent." }, 409);
      }
      let safety;
      try { safety = await captureDevice("pre-restore", light, snap); }
      catch (error) { return c.json(backupFailure(error), 503); }
      try {
        await writeNativeFiles(
          { hostname: light.hostname, port: light.port },
          { cfgJson: backup.deviceFiles!.cfgJson, presetsJson: backup.deviceFiles!.presetsJson },
        );
      } catch (error) {
        return c.json({ error: "wled-restore-failed",
          message: `WLED did not accept the uploaded files. Nightplot data is unchanged. Safety backup ${safety.id} is kept. ${error instanceof Error ? error.message : ""}` }, 502);
      }
      return c.json({
        restored: true,
        kind: "wled-native",
        safetyBackupId: safety.id,
        lightId: light.id,
        message: WLED_NATIVE_RESTORE_CAPTION,
      });
    } finally { release(); }
  });

  registerSyncRoutes(app, {
    store: deps.store,
    live,
    write: deps.write,
    readCfg: deps.readCfg,
    writeCfg: deps.writeCfg,
    readPresets: deps.readPresets ?? createWledPresetsReader(),
    writePresets: deps.writePresets ?? createWledPresetsWriter(),
    refreshOne,
    captureDevice: (reason, light, snap) => captureDevice(reason, light, snap),
    record,
  });

  const lookDeps = {
    store: deps.store,
    looks,
    live,
    readCfg: deps.readCfg,
    writeCfg: deps.writeCfg,
    readPresets: deps.readPresets ?? createWledPresetsReader(),
    writePresets: deps.writePresets ?? createWledPresetsWriter(),
    readLedmap,
    writeLedmap,
    refreshOne,
    captureDevice: (reason: Parameters<typeof captureDevice>[0], light: Light, snap: WledSnapshot) =>
      captureDevice(reason, light, snap),
    record,
  };
  registerLookRoutes(app, lookDeps);
  const yardUndo = new FileYardUndoStore(join(dirname(deps.store.path), "yard-undo.json"));
  registerYardRoutes(app, {
    ...lookDeps,
    undo: yardUndo,
    write: deps.write,
    writeNativeFiles,
    backupsRead: (id) => backups.read(id),
    now: nowIso,
  });
  registerSeasonRoutes(app, {
    ...lookDeps,
    profiles,
    probe: deps.probe,
    readNativeFiles,
    discoverRows: () => session.rows,
    captureNightplot: (reason) => capture(reason),
    now: nowIso,
  });

  app.get("/api/activity", (c) => c.json({ entries: activity.list(c.req.query("lightId")) }));

  app.get("/api/led-products", (c) => c.json({ products: products.list() }));

  app.get("/api/led-products/:id/delete-checks", (c) => {
    const product = products.findById(c.req.param("id"));
    if (!product) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    const impact = catalogDeleteFromStore(product.id);
    return c.json({
      productId: product.id,
      checks: impact.checks,
      attached: impact.count.known ? impact.count.count : null,
      lights: impact.count.known ? impact.count.lights : [],
      caption: LED_CATALOG_DELETE_CAPTION,
    });
  });

  app.get("/api/led-products/:id", (c) => {
    const product = products.findById(c.req.param("id"));
    if (!product) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    return c.json({ product });
  });

  app.post("/api/led-products", async (c) => {
    const body = await c.req.json().catch(() => null);
    const raw =
      body && typeof body === "object" && "product" in (body as object)
        ? (body as { product?: unknown }).product
        : body;
    const parsed = parseLedProductInput(raw);
    if (!parsed.ok) {
      const status = parsed.error === "invalid" ? 400 : 422;
      return c.json({ error: parsed.error, message: parsed.message }, status);
    }
    const id = parsed.product.id || randomUUID();
    if (products.findById(id)) {
      return c.json(
        { error: "duplicate", message: "A product with that id is already in the catalog." },
        409,
      );
    }
    const product = { ...parsed.product, id };
    try { capture("pre-catalog"); }
    catch (error) { return c.json(backupFailure(error), 503); }
    products.create(product);
    return c.json({ product }, 201);
  });

  app.patch("/api/led-products/:id", async (c) => {
    const existing = products.findById(c.req.param("id"));
    if (!existing) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    const body = await c.req.json().catch(() => null);
    const raw =
      body && typeof body === "object" && "product" in (body as object)
        ? (body as { product?: unknown }).product
        : body;
    if (raw && typeof raw === "object" && raw !== null && "id" in raw) {
      const sentId = (raw as { id?: unknown }).id;
      if (typeof sentId === "string" && sentId.trim() && sentId.trim() !== existing.id) {
        return c.json(
          { error: "invalid", message: "id cannot change. Create a new catalog row." },
          400,
        );
      }
    }
    const parsed = parseLedProductInput(raw);
    if (!parsed.ok) {
      const status = parsed.error === "invalid" ? 400 : 422;
      return c.json({ error: parsed.error, message: parsed.message }, status);
    }
    const product = { ...parsed.product, id: existing.id };
    try { capture("pre-catalog"); }
    catch (error) { return c.json(backupFailure(error), 503); }
    const updated = products.update(product);
    if (!updated) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    return c.json({ product: updated });
  });

  app.delete("/api/led-products/:id", (c) => {
    const existing = products.findById(c.req.param("id"));
    if (!existing) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    const impact = catalogDeleteFromStore(existing.id);
    if (!impact.decision.ok) {
      const status = impact.decision.error === "in_use" ? 409 : 422;
      return c.json(
        {
          error: impact.decision.error,
          message: impact.decision.message,
          attached: impact.decision.attached,
          lights: impact.decision.lights,
          checks: impact.checks,
          caption: LED_CATALOG_DELETE_CAPTION,
        },
        status,
      );
    }
    try { capture("pre-catalog"); }
    catch (error) { return c.json(backupFailure(error), 503); }
    const removed = products.remove(existing.id);
    if (!removed) {
      return c.json(
        { error: "not_found", message: "That LED product is not in the catalog." },
        404,
      );
    }
    return c.json({
      deleted: true,
      product: removed,
      attached: 0,
      message: LED_CATALOG_DELETE_CLEARED,
      caption: LED_CATALOG_DELETE_CAPTION,
    });
  });

  app.get("/api/lights", async (c) => {
    const payload = await listLights();
    return c.json(payload);
  });

  app.get("/api/discover", (c) =>
    c.json({
      slice: CURRENT_SLICE,
      candidates: session.rows,
    }),
  );

  app.post("/api/discover", async (c) => {
    const now = nowIso();
    const collected = await deps.collect();
    const enrolled = new Set(deps.store.load().map((light) => light.hostKey));
    const rows: DiscoverRow[] = new Array(collected.length);
    const probeJobs: { index: number; target: HostPort; via: (typeof collected)[number]["via"] }[] =
      [];

    for (let i = 0; i < collected.length; i += 1) {
      const item = collected[i]!;
      if (item.port == null) {
        rows[i] = needsPortRow(item.hostname, item.via, now);
        continue;
      }
      const decision = decideProbeAddress(
        item.port === 80 ? item.hostname : `${item.hostname}:${item.port}`,
      );
      if (!decision.ok) {
        rows[i] = refusedRow(item.hostname, item.via, now, decision.reason);
        continue;
      }
      const key = normalizeHostKey(decision.target);
      if (enrolled.has(key)) {
        const light = deps.store.findByHostKey(key);
        rows[i] = {
          key,
          hostname: decision.target.hostname,
          port: decision.target.port,
          displayHost: `${decision.target.hostname}${decision.target.port === 80 ? "" : `:${decision.target.port}`}`,
          via: item.via,
          status: "already-added",
          reason: "Already added",
          reasonCode: "already-added",
          name: light?.name ?? null,
          ledCount: light?.ledCount ?? null,
          firmware: light?.firmware ?? null,
          mac: light?.mac ?? null,
          on: light?.on ?? null,
          bead: null,
          foundAt: now,
        };
        continue;
      }
      probeJobs.push({ index: i, target: decision.target, via: item.via });
    }

    const probed = await mapLimit(probeJobs, FIND_PROBE_CONCURRENCY, async (job) => {
      const outcome = await deps.probe(job.target);
      return rowFromProbe(job.target, job.via, outcome, now, false);
    });
    for (let j = 0; j < probeJobs.length; j += 1) {
      rows[probeJobs[j]!.index] = probed[j]!;
    }

    for (const light of deps.store.load()) {
      if (rows.some((row) => row.key === light.hostKey)) continue;
      rows.push({
        key: light.hostKey,
        hostname: light.hostname,
        port: light.port,
        displayHost: `${light.hostname}${light.port === 80 ? "" : `:${light.port}`}`,
        via: "address-probe",
        status: "already-added",
        reason: "Already added",
        reasonCode: "already-added",
        name: light.name,
        ledCount: light.ledCount,
        firmware: light.firmware,
        mac: light.mac,
        on: light.on,
        bead: null,
        foundAt: now,
      });
    }

    session.rows = rows;
    return c.json({
      slice: CURRENT_SLICE,
      candidates: rows,
    });
  });

  app.post("/api/discover/probe", async (c) => {
    const body = await readHostBody(c);
    if (!body) return c.json({ error: "invalid", message: "Send { host }." }, 400);
    const row = await probeAddress(body.host, "address-probe");
    mergeSession(row);
    return c.json({ candidate: row });
  });

  app.post("/api/lights", async (c) => {
    const body = await readHostBody(c);
    if (!body) return c.json({ error: "invalid", message: "Send { host }." }, 400);
    const result = await enrollHost(body.host);
    if (result.status === "added") {
      return c.json({ light: result.light }, 201);
    }
    if (result.status === "already-enrolled") {
      return c.json({ error: "already-added", message: result.reason }, 409);
    }
    const status = result.error === "disallowed-address" ? 403 : 422;
    return c.json(
      {
        error: result.error ?? "failed",
        message: result.reason,
        ...(result.candidate ? { candidate: result.candidate } : {}),
      },
      status,
    );
  });

  app.post("/api/lights/bulk", async (c) => {
    const body = await c.req.json().catch(() => null);
    const hosts = parseHostList(body);
    if (!hosts) return c.json({ error: "invalid", message: "Send { hosts: string[] }." }, 400);
    const settled = await mapLimit(hosts, FLEET_ENROLL_CONCURRENCY, (host) => enrollHost(host));
    const results: BulkEnrollRow[] = settled.map((row) => {
      switch (row.status) {
        case "added":
          return { host: row.host, status: row.status, lightId: row.lightId, name: row.name };
        case "already-enrolled":
          return {
            host: row.host,
            status: row.status,
            reason: row.reason,
            lightId: row.lightId,
            name: row.name,
          };
        case "failed":
          return { host: row.host, status: row.status, reason: row.reason };
        default: {
          const _exhaustive: never = row;
          throw new Error(`unexpected enroll status: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });
    return c.json({
      results,
      message: fleetEnrollSummary(results),
      caption: FLEET_BULK_CAPTION,
    });
  });

  app.get("/api/setup-profiles", (c) => c.json({ profiles: profiles.list() }));

  app.post("/api/setup-profiles", async (c) => {
    const body = await c.req.json().catch(() => null);
    const draft = readSetupProfileDraft(body);
    if (!draft) return c.json({ error: "invalid", message: "Send a setup profile." }, 400);
    const invalid = validateSetupProfile(draft);
    if (invalid) return c.json({ error: "invalid", message: invalid }, 422);
    const profile = normalizeSetupProfile(draft, randomUUID());
    profiles.upsert(profile);
    return c.json({ profile }, 201);
  });

  app.patch("/api/setup-profiles/:id", async (c) => {
    const existing = profiles.findById(c.req.param("id"));
    if (!existing) return c.json({ error: "not_found", message: "That setup profile is not saved." }, 404);
    const body = await c.req.json().catch(() => null);
    const draft = readSetupProfileDraft(body);
    if (!draft) return c.json({ error: "invalid", message: "Send a setup profile." }, 400);
    const merged = mergeSetupProfile(existing, draft);
    if (!merged) return c.json({ error: "invalid", message: "Send a setup profile." }, 400);
    const invalid = validateSetupProfile(merged);
    if (invalid) return c.json({ error: "invalid", message: invalid }, 422);
    const profile = normalizeSetupProfile(merged, existing.id);
    profiles.upsert(profile);
    return c.json({ profile });
  });

  app.delete("/api/setup-profiles/:id", (c) => {
    if (!profiles.remove(c.req.param("id"))) {
      return c.json({ error: "not_found", message: "That setup profile is not saved." }, 404);
    }
    return c.json({ deleted: true });
  });

  app.post("/api/lights/setup-profile", async (c) => {
    const body = await c.req.json().catch(() => null);
    const lightIds = parseLightIdList(body);
    if (!lightIds) return c.json({ error: "invalid", message: "Send { lightIds: string[] }." }, 400);
    const raw = body && typeof body === "object" ? (body as { profileId?: unknown; profile?: unknown }) : {};
    const saved =
      typeof raw.profileId === "string" ? profiles.findById(raw.profileId) ?? null : null;
    if (typeof raw.profileId === "string" && !saved) {
      return c.json({ error: "not_found", message: "That setup profile is not saved." }, 404);
    }
    const overlay = raw.profile && typeof raw.profile === "object"
      ? readSetupProfileDraft({ profile: raw.profile })
      : null;
    const merged = mergeSetupProfile(saved, overlay);
    if (!merged) {
      return c.json({ error: "invalid", message: "Send a saved profileId or an inline profile." }, 400);
    }
    const invalid = validateSetupProfile(merged);
    if (invalid) return c.json({ error: "invalid", message: invalid }, 422);
    const profile = normalizeSetupProfile(merged, saved?.id ?? "inline");
    const settled = await mapLimit(lightIds, FLEET_PROFILE_CONCURRENCY, async (lightId, index) =>
      applySetupProfileToLight(lightId, profile, index + 1),
    );
    const results: SetupApplyRow[] = settled;
    return c.json({
      results,
      backupIds: results.flatMap((row) => (row.backupId ? [row.backupId] : [])),
      message: fleetApplySummary(results),
      caption: FLEET_BULK_CAPTION,
    });
  });

  app.get("/api/lights/:id", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap, elapsedMs } = await refreshOne(stored);
    const next = await seedStripKindFromInspect(light, snap);
    return c.json(await decorateDetail(next, snap, undefined, elapsedMs));
  });

  app.get("/api/lights/:id/segments/backup", (c) => {
    const light = deps.store.findById(c.req.param("id"));
    if (!light) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const saved = deps.store.elementsFor(light.id);
    if (validateDeclaredRanges(saved, light.ledCount).length) return c.json({
      error: "invalid-layout",
      message: "Saved Segments do not fit this Light's current length. Fix the layout before downloading a restorable backup.",
    }, 409);
    const backup: SegmentBackup = {
      kind: "nightplot-segments", version: 1, exportedAt: nowIso(),
      source: { lightId: light.id, lightName: light.name, mac: light.mac, ledCount: light.ledCount },
      segments: saved.map(({ label, start, stop, color }) => ({ label, start, stop, ...(color ? { color } : {}) })),
    };
    return c.json(backup);
  });

  app.post("/api/lights/:id/segments/restore", async (c) => {
    const light = deps.store.findById(c.req.param("id"));
    if (!light) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const raw = await c.req.json().catch(() => null);
    const backup = parseSegmentBackup(raw && typeof raw === "object" ? (raw as { backup?: unknown }).backup : null);
    if (!backup) return c.json({ error: "invalid-backup", message: "This is not a valid Nightplot Segment backup. Nothing was saved or sent." }, 422);
    if (backup.source.ledCount !== light.ledCount) return c.json({
      error: "length-mismatch",
      message: `This backup is for ${backup.source.ledCount} LEDs; ${light.name} has ${light.ledCount}. Match the strip length first. Nothing was saved or sent.`,
    }, 422);
    if (live.get(light.id)) return c.json({
      error: "preview-active", message: "End Preview or Blink before restoring Segments. Nothing was saved or sent.",
    }, 409);
    if (backupNeedsControllerConfirmation(backup, light) && (raw as { confirmDifferentController?: unknown }).confirmDifferentController !== true) {
      return c.json({ error: "different-controller",
        message: "This backup came from a different controller. Confirm the target Light before restoring. Nothing was saved or sent.",
      }, 409);
    }
    const elements: Element[] = backup.segments.map((segment) => ({
      ...segment, id: randomUUID(), lightId: light.id,
    }));
    try { capture("pre-restore", light); }
    catch (error) { return c.json(backupFailure(error), 503); }
    deps.store.replaceElements(light.id, elements);
    return c.json({
      ...lightDetail(light, null, elements, attachedProduct(light), deps.store.propsFor(light.id)),
      message: "Segments restored to Nightplot. Preview and Apply were not started; use Apply separately to write the controller.",
    });
  });

  app.patch("/api/lights/:id/elements", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const drafts = await readElementsBody(c);
    if (!drafts) {
      return c.json({ error: "invalid", message: "Send { elements: [{ label, start, stop }] }." }, 400);
    }
    const issues = validateDeclaredRangesForLight(drafts, {
      ledCount: light.ledCount,
      outputs: light.outputs,
    });
    if (issues.length > 0) {
      return c.json(
        {
          error: issues[0]!.code,
          message: issues[0]!.message,
          issues,
        },
        422,
      );
    }
    const existingIds = new Set(deps.store.elementsFor(light.id).map((element) => element.id));
    const previous = deps.store.elementsFor(light.id);
    const elements: Element[] = drafts.map((draft, index) => ({
      id:
        draft.id && existingIds.has(draft.id)
          ? draft.id
          : draft.id && looksLikeId(draft.id)
            ? draft.id
            : randomUUID(),
      lightId: light.id,
      label: draft.label.trim() || `Segment ${index + 1}`,
      start: draft.start,
      stop: draft.stop,
      ...(draft.color ? { color: draft.color } :
        previous.find((item) => item.id === draft.id)?.color ? { color: previous.find((item) => item.id === draft.id)!.color } : {}),
      ...(draft.outputId ? { outputId: draft.outputId } :
        previous.find((item) => item.id === draft.id)?.outputId
          ? { outputId: previous.find((item) => item.id === draft.id)!.outputId }
          : {}),
    }));
    deps.store.replaceElements(light.id, elements);
    return c.json(await decorateDetail(light, snap, elements));
  });

  app.post("/api/lights/:id/apply", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const drafts = await readApplyDrafts(c, light.id);
    if (!drafts) {
      return c.json({ error: "invalid", message: "Send { elements: [{ label, start, stop }] }." }, 400);
    }
    const result = await applyDraftsToController(light, snap, drafts);
    return c.json(result.body, result.status);
  });

  app.post("/api/lights/:id/props", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const raw = await c.req.json().catch(() => null);
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const kind = parsePropKind(row?.kind);
    if (kind === "wireframe") {
      const existingProps = deps.store.propsFor(light.id);
      const label = typeof row?.label === "string" && row.label.trim()
        ? row.label.trim().slice(0, 64)
        : nextPropLabel(kind, existingProps);
      const spec = specFromBody(row?.wireframe) ?? defaultWireframeSpec();
      const saved = persistWireframeOnLight({
        store: deps.store,
        light,
        propId: randomUUID(),
        label,
        spec,
        palette: settings.read().palette,
      });
      if (!saved.ok) {
        return c.json({ error: "invalid-wireframe", message: saved.message }, 422);
      }
      const wantApply = row?.apply === true;
      if (!wantApply) {
        return c.json({
          ...(await decorateDetail(light, snap, saved.elements)),
          prop: saved.prop,
          compiled: wireframeCompileView(saved.compiled),
          message: "Prop saved in Nightplot. Apply was not sent.",
        });
      }
      const drafts: DraftRange[] = saved.elements.map((element) => ({
        id: element.id,
        label: element.label,
        start: element.start,
        stop: element.stop,
        ...(element.color ? { color: element.color } : {}),
        ...(element.outputId ? { outputId: element.outputId } : {}),
      }));
      const result = await applyDraftsToController(light, snap, drafts);
      return c.json({ ...result.body, prop: saved.prop, compiled: wireframeCompileView(saved.compiled) }, result.status);
    }
    const taps = parsePropTaps(row?.taps);
    if (!kind || !taps) {
      return c.json({ error: "invalid", message: "Send { kind, taps: [{ index }] } or { kind: \"wireframe\", wireframe }." }, 400);
    }
    const existingProps = deps.store.propsFor(light.id);
    const label = typeof row?.label === "string" && row.label.trim()
      ? row.label.trim().slice(0, 64)
      : nextPropLabel(kind, existingProps);
    const built = segmentsFromPropTaps({
      kind,
      label,
      taps,
      ledCount: light.ledCount,
      outputs: light.outputs ?? [],
    });
    if (!built.ok) {
      return c.json({ error: "invalid-taps", message: built.message }, 422);
    }
    const palette = settings.read().palette;
    const existing = deps.store.elementsFor(light.id);
    const created: Element[] = built.segments.map((segment, index) => ({
      id: randomUUID(),
      lightId: light.id,
      label: segment.label,
      start: segment.start,
      stop: segment.stop,
      color: { hex: palette[index % palette.length]!.hex, white: 0 },
      ...(segment.outputId ? { outputId: segment.outputId } : {}),
    }));
    const merged = [...existing, ...created];
    const issues = validateDeclaredRangesForLight(merged, {
      ledCount: light.ledCount,
      outputs: light.outputs,
    });
    if (issues.length > 0) {
      return c.json({ error: issues[0]!.code, message: issues[0]!.message, issues }, 422);
    }
    const wantApply = row?.apply === true;
    if (wantApply) {
      const colors = snap ? resolveApplyColors(merged, snap) : null;
      const color = knownApplyColor(colors?.[0]?.hex ?? snap?.segmentColor);
      const reason = applyRefuseReason({
        reachable: light.reachability === "online" && snap !== null,
        issueMessage: null,
        elementCount: merged.length,
        busyKind: live.get(light.id)?.kind ?? null,
        segmentCount: snapshotSegmentCount(snap),
        segmentColor: color,
        maxSegments: snap?.maxSegments ?? null,
      });
      if (reason || !color) {
        return c.json({ error: "refused", message: reason ?? APPLY_UNKNOWN_COLOUR_REASON }, 422);
      }
      if (!colors) {
        return c.json({
          error: "colour-unknown",
          message: "An unset Segment has no unique fresh WLED colour at its exact range. Choose a colour, then Save before Apply. Nothing was sent.",
        }, 422);
      }
    }
    const prop: Prop = {
      id: randomUUID(),
      lightId: light.id,
      label,
      kind,
      elementIds: created.map((element) => element.id),
    };
    deps.store.replaceElements(light.id, merged);
    deps.store.replaceProps(light.id, [...existingProps, prop]);
    if (!wantApply) {
      return c.json({
        ...(await decorateDetail(light, snap, merged)),
        prop,
        message: "Prop saved in Nightplot. Apply was not sent.",
      });
    }
    const drafts: DraftRange[] = merged.map((element) => ({
      id: element.id,
      label: element.label,
      start: element.start,
      stop: element.stop,
      ...(element.color ? { color: element.color } : {}),
      ...(element.outputId ? { outputId: element.outputId } : {}),
    }));
    const result = await applyDraftsToController(light, snap, drafts);
    return c.json({ ...result.body, prop }, result.status);
  });

  app.patch("/api/lights/:id/props/:propId", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const propId = c.req.param("propId");
    const existing = deps.store.propsFor(stored.id);
    const prop = existing.find((row) => row.id === propId);
    if (!prop) {
      return c.json({ error: "not_found", message: "That Prop is not on this Light." }, 404);
    }
    const raw = await c.req.json().catch(() => null);
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const label = typeof row?.label === "string" ? row.label.trim().slice(0, 64) : "";
    if (prop.kind === "wireframe" && (row?.wireframe !== undefined || row?.apply === true)) {
      const nextLabel = label || prop.label;
      const spec = specFromBody(row?.wireframe, prop.wireframe);
      if (!spec) {
        return c.json({ error: "invalid", message: "Send a wireframe spec Nightplot understands." }, 400);
      }
      const saved = persistWireframeOnLight({
        store: deps.store,
        light: stored,
        propId: prop.id,
        label: nextLabel,
        spec,
        palette: settings.read().palette,
      });
      if (!saved.ok) {
        return c.json({ error: "invalid-wireframe", message: saved.message }, 422);
      }
      const { light, live: snap } = await refreshOne(stored);
      if (row?.apply !== true) {
        return c.json({
          ...(await decorateDetail(light, snap, saved.elements)),
          prop: saved.prop,
          compiled: wireframeCompileView(saved.compiled),
          message: "Prop saved in Nightplot. Apply was not sent.",
        });
      }
      const drafts: DraftRange[] = saved.elements.map((element) => ({
        id: element.id,
        label: element.label,
        start: element.start,
        stop: element.stop,
        ...(element.color ? { color: element.color } : {}),
        ...(element.outputId ? { outputId: element.outputId } : {}),
      }));
      const result = await applyDraftsToController(light, snap, drafts);
      return c.json({ ...result.body, prop: saved.prop, compiled: wireframeCompileView(saved.compiled) }, result.status);
    }
    if (!label) {
      return c.json({ error: "invalid", message: "Send { label }." }, 400);
    }
    const prefix = `${prop.label} · `;
    const elements = deps.store.elementsFor(stored.id).map((element) => {
      if (!prop.elementIds.includes(element.id)) return element;
      const side = element.label.startsWith(prefix) ? element.label.slice(prefix.length) : element.label;
      return { ...element, label: `${label} · ${side}` };
    });
    deps.store.replaceElements(stored.id, elements);
    deps.store.replaceProps(stored.id, existing.map((row) => (row.id === propId ? { ...row, label } : row)));
    const { light, live: snap } = await refreshOne(stored);
    return c.json({
      ...(await decorateDetail(light, snap, elements)),
      prop: { ...prop, label },
    });
  });

  app.delete("/api/lights/:id/props/:propId", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const propId = c.req.param("propId");
    const existing = deps.store.propsFor(stored.id);
    const prop = existing.find((row) => row.id === propId);
    if (!prop) {
      return c.json({ error: "not_found", message: "That Prop is not on this Light." }, 404);
    }
    const drop = new Set(prop.elementIds);
    const elements = deps.store.elementsFor(stored.id).filter((element) => !drop.has(element.id));
    deps.store.replaceElements(stored.id, elements);
    deps.store.replaceProps(stored.id, existing.filter((row) => row.id !== propId));
    const { light, live: snap } = await refreshOne(stored);
    return c.json({
      ...(await decorateDetail(light, snap, elements)),
      message: "Prop removed from Nightplot. Apply was not sent.",
    });
  });

  async function applyDraftsToController(
    light: Light,
    snap: WledSnapshot | null,
    drafts: DraftRange[],
  ): Promise<{ status: 200 | 409 | 422 | 503; body: Record<string, unknown> }> {
    const issues = validateDeclaredRangesForLight(drafts, {
      ledCount: light.ledCount,
      outputs: light.outputs,
    });
    const previousSegmentCount = snapshotSegmentCount(snap);
    const colors = snap ? resolveApplyColors(drafts, snap) : null;
    const color = knownApplyColor(colors?.[0]?.hex ?? snap?.segmentColor);
    const reason = applyRefuseReason({
      reachable: light.reachability === "online" && snap !== null,
      issueMessage: issues[0]?.message ?? null,
      elementCount: drafts.length,
      busyKind: live.get(light.id)?.kind ?? null,
      segmentCount: previousSegmentCount,
      segmentColor: color,
      maxSegments: snap?.maxSegments ?? null,
    });
    if (reason || !color) {
      return { status: 422, body: { error: "refused", message: reason ?? APPLY_UNKNOWN_COLOUR_REASON } };
    }
    if (!colors) {
      return {
        status: 422,
        body: {
          error: "colour-unknown",
          message: "An unset Segment has no unique fresh WLED colour at its exact range. Choose a colour, then Save before Apply. Nothing was sent.",
        },
      };
    }
    const rgbw = getStrip(light.stripKind)?.bead === "rgbw";
    if (colors.some((entry) => entry.white && !rgbw)) {
      return {
        status: 422,
        body: {
          error: "unsupported-white",
          message: "This Light is not configured as RGBW. White-channel Apply was not sent.",
        },
      };
    }
    const sent = drafts.map((row) => ({
      label: row.label.trim() || "Untitled",
      start: row.start,
      stop: row.stop,
    }));
    const sentDescription = sent.map((row) => `${row.label} (${row.start}–${row.stop})`).join(", ");
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const planned = applyRangesWrite(sent, previousSegmentCount, color, colors, rgbw);
    if (!planned.ok) {
      return { status: 422, body: { error: "refused", message: APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE } };
    }
    try { await captureDevice("pre-apply", light, snap!); }
    catch (error) { return { status: 503, body: backupFailure(error) }; }
    const ledmap = await writeAndVerifyLedmap({
      light,
      props: deps.store.propsFor(light.id),
      readLedmap,
      writeLedmap,
    });
    if (!ledmap.ok) {
      return { status: ledmap.status, body: { error: ledmap.error, message: ledmap.message } };
    }
    const written = await deps.write(dest, planned.body);
    if (!written) {
      record(light, "apply", "unknown", `Apply write was not confirmed for ${sentDescription}; ranges were not read back.`);
      const outcome = applyUnreadFailed(
        sent,
        "The controller did not take the ranges. Nothing else changed.",
        "controller",
      );
      return { status: 422, body: { error: "write-failed", message: outcome.message, apply: outcome } };
    }
    const reread = await deps.probe(dest);
    if (reread.kind !== "found") {
      record(light, "apply", "unknown", `Apply sent ${sentDescription}, but the controller did not answer the readback.`);
      const outcome = applyUnreadFailed(
        sent,
        "Wrote, but could not re-read. Not treating as success.",
        "controller",
      );
      return { status: 409, body: { error: "reread-failed", message: outcome.message, apply: outcome } };
    }
    if (light.mac && (!reread.snapshot.mac || !macsMatch(light.mac, reread.snapshot.mac))) {
      const outcome = applyUnreadFailed(sent, "Apply was sent, but the readback controller identity is missing or changed. Not treating this as success.", "controller");
      record(light, "apply", "unknown", outcome.message);
      return { status: 409, body: { error: "controller-changed", message: outcome.message, apply: outcome } };
    }
    const liveRead = await live.read({ ...light, reachability: "online" });
    const source = honestySource(liveRead?.source);
    const read = reread.snapshot.segments;
    const next = lightFromSnapshot(dest, reread.snapshot, nowIso(), light);
    if (read === null) {
      const outcome = applyUnknownSegments(sent, source);
      deps.store.replace(next);
      record(next, "apply", "unknown", `Apply sent ${sentDescription}; controller Segments were not reported. ${outcome.caption}`);
      return {
        status: 409,
        body: {
          error: "reread-unknown-segments",
          message: outcome.message,
          ...(await decorateDetail(next, reread.snapshot)),
          apply: outcome,
        },
      };
    }
    const outcome = applyOutcome(sent, read, source);
    const colorMatch = reread.snapshot.segmentColors?.some((entry) => Boolean(entry.hasWhite) !== rgbw) ? false :
      reportedColorsMatch(drafts, colors, reread.snapshot.segmentColors);
    if (outcome.matched && colorMatch !== true && reread.snapshot.segmentColors !== undefined) {
      deps.store.replace(next);
      const uncertain = { ...outcome, status: "mismatch" as const, matched: false,
        message: colorMatch === null ? "Ranges matched, but Segment colours were not reported. Sent but unverified." :
          "Ranges matched, but Segment colours differ on readback. Apply is not confirmed." };
      record(next, "apply", "unknown", uncertain.message);
      return {
        status: 409,
        body: { ...(await decorateDetail(next, reread.snapshot)), apply: uncertain, message: uncertain.message },
      };
    }
    if (outcome.matched) {
      next.lastSnapshot = reread.snapshot;
      next.lastSnapshotAt = next.lastSeenAt;
      next.lastApply = next.mac ? { at: next.lastSeenAt ?? nowIso(), mac: next.mac,
        ledCount: next.ledCount, ranges: sent.map(({ start, stop }) => ({ start, stop })), color,
        ...(reread.snapshot.segmentColors ? { colors } : {}) } : null;
      if (ledmap.digest) next.lastLedmap = { digest: ledmap.digest, at: next.lastSeenAt ?? nowIso() };
      deps.store.replace(next);
      const elements = persistDrafts(light.id, drafts);
      record(next, "apply", "match", `Applied ${sentDescription}; reported ranges match. ${outcome.caption}`);
      return {
        status: 200,
        body: {
          ...(await decorateDetail(next, reread.snapshot, elements)),
          apply: outcome,
        },
      };
    }
    deps.store.replace(next);
    record(next, "apply", "mismatch", `Applied ${sentDescription}; reported ranges differ. ${outcome.caption}`);
    return {
      status: 409,
      body: {
        ...(await decorateDetail(next, reread.snapshot)),
        apply: outcome,
      },
    };
  }

  app.post("/api/lights/:id/readdress", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const body = await readHostBody(c);
    if (!body) return c.json({ error: "invalid", message: "Send { host }." }, 400);
    const decision = decideProbeAddress(body.host);
    if (!decision.ok) {
      return c.json({ error: decision.reasonCode, message: decision.reason, switched: false }, 403);
    }
    const nextKey = normalizeHostKey(decision.target);
    const occupant = deps.store.findByHostKey(nextKey);
    if (occupant && occupant.id !== stored.id) {
      return c.json(
        {
          error: "already-added",
          message: "That address is already a Light. Kept the current host.",
          switched: false,
        },
        409,
      );
    }
    const outcome = await deps.probe(decision.target);
    const previous = displayHost(stored);
    const incoming = displayHost(decision.target);
    if (outcome.kind !== "found") {
      return c.json(
        {
          error: outcome.kind,
          message: outcome.reason,
          switched: false,
          steps: [
            {
              done: false,
              text: `Nothing we trust answered at ${incoming}. Kept ${previous}.`,
            },
          ] satisfies ReaddressStep[],
        },
        422,
      );
    }
    const continuity = readdressContinuity({
      enrolledMac: stored.mac,
      snapshotMac: outcome.snapshot.mac,
      sameHost: nextKey === stored.hostKey,
    });
    const answered: ReaddressStep = {
      done: true,
      text: `Something answered at ${incoming}`,
    };
    if (!continuity.ok) {
      return c.json(
        {
          error: continuity.error,
          message: continuity.message,
          switched: false,
          answered: true,
          steps: [
            answered,
            {
              done: false,
              text: `Same controller? ${shortMac(stored.mac)} — kept ${previous} until it matches.`,
            },
          ] satisfies ReaddressStep[],
        },
        422,
      );
    }
    const next = lightFromSnapshot(decision.target, outcome.snapshot, nowIso(), stored);
    next.lastSnapshot = outcome.snapshot;
    next.lastSnapshotAt = next.lastSeenAt;
    deps.store.replace(next);
    return c.json({
      ...(await decorateDetail(next, outcome.snapshot)),
      readdress: {
        switched: true,
        sameMac: continuity.sameMac,
        previousHost: previous,
        nextHost: incoming,
        steps: [
          answered,
          {
            done: true,
            text: continuity.sameMac
              ? `Same controller — MAC ${shortMac(outcome.snapshot.mac)} matched. Address is now ${incoming}.`
              : `Address is now ${incoming}. Identity is from this snapshot, not the old one.`,
          },
        ] satisfies ReaddressStep[],
      },
    });
  });

  app.post("/api/lights/:id/replacement/check", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const body = await readHostBody(c);
    if (!body) return c.json({ error: "invalid", message: "Send { host }." }, 400);
    const checked = await replacementCandidate(stored, body.host);
    if (!checked.ok) return c.json({ error: checked.error, message: checked.message }, checked.status);
    return c.json({
      previous: { hostKey: stored.hostKey, mac: stored.mac, name: stored.name },
      replacement: { hostKey: normalizeHostKey(checked.target), mac: checked.snapshot.mac,
        name: checked.snapshot.name, ledCount: checked.snapshot.ledCount },
      segmentCount: deps.store.elementsFor(stored.id).length,
      message: "A different WLED controller answered. Review its address and MAC before replacing this Light. Nothing was saved or sent.",
    });
  });

  app.post("/api/lights/:id/replacement", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const raw = await c.req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    if (!body || body.confirm !== true || typeof body.host !== "string" ||
      typeof body.expectedHostKey !== "string" || typeof body.expectedMac !== "string" ||
      !(body.previousMac === null || typeof body.previousMac === "string") ||
      typeof body.previousHostKey !== "string" || !normalizeMac(body.expectedMac)) {
      return c.json({ error: "confirmation-required", message: "Check the replacement first, then explicitly confirm its address and MAC. Nothing was saved or sent." }, 400);
    }
    if (stored.hostKey !== body.previousHostKey || normalizeMac(stored.mac) !== normalizeMac(body.previousMac)) {
      return c.json({ error: "source-changed", message: "This Light changed since the check. Check again. Nothing was saved or sent." }, 409);
    }
    if (live.get(stored.id)) return c.json({ error: "busy", message: "End Preview or Blink before replacing this controller. Nothing was saved or sent." }, 409);
    const release = live.block(stored.id);
    try {
      await live.settle(stored.id);
      if (live.get(stored.id)) return c.json({ error: "busy", message: "End Preview or Blink before replacing this controller. Nothing was saved or sent." }, 409);
      const checked = await replacementCandidate(stored, body.host);
      if (!checked.ok) return c.json({ error: checked.error, message: checked.message }, checked.status);
      const targetKey = normalizeHostKey(checked.target);
      if (targetKey !== body.expectedHostKey || !macsMatch(checked.snapshot.mac, body.expectedMac)) {
        return c.json({ error: "replacement-changed", message: "The controller address or MAC changed since the check. Check again. Nothing was saved or sent." }, 409);
      }
      const current = deps.store.findById(stored.id);
      if (!current || current.hostKey !== stored.hostKey || normalizeMac(current.mac) !== normalizeMac(stored.mac)) {
        return c.json({ error: "source-changed", message: "This Light changed while checking. Check again. Nothing was saved or sent." }, 409);
      }
      const next = lightFromSnapshot(checked.target, checked.snapshot, nowIso(), stored);
      // A snapshot from the old controller is not a baseline for this one.
      next.lastSnapshot = null;
      next.lastSnapshotAt = null;
      next.lastApply = null;
      try {
        const raw = await readNativeFiles({ hostname: stored.hostname, port: stored.port });
        backups.create({
          at: nowIso(),
          reason: "pre-replacement",
          lightId: stored.id,
          lightName: stored.name,
          data: currentBackupData(),
          controller: departingControllerReference(stored),
          deviceFiles: buildWledBackupFiles({
            cfgJson: raw.cfgJson,
            presetsJson: raw.presetsJson,
            light: stored,
            liveMac: stored.mac,
            liveFirmware: stored.firmware,
            capturedAt: nowIso(),
          }),
          deviceCaptureStatus: "complete",
        });
      } catch (error) {
        try {
          backups.create({
            at: nowIso(),
            reason: "pre-replacement",
            lightId: stored.id,
            lightName: stored.name,
            data: currentBackupData(),
            controller: departingControllerReference(stored),
            deviceFiles: null,
            deviceCaptureStatus: "incomplete",
            deviceCaptureError: error instanceof Error
              ? error.message
              : "WLED did not return both native configuration and presets files.",
          });
        } catch (persistError) { return c.json(backupFailure(persistError), 503); }
      }
      deps.store.replace(next);
      record(next, "replacement", "not-checked",
        `Controller changed from ${stored.hostKey} (${shortMac(stored.mac)}) to ${targetKey} (${shortMac(next.mac)}). Saved Segments stayed on this Light; nothing was Applied.`);
      return c.json({
        ...lightDetail(next, checked.snapshot, deps.store.elementsFor(next.id), attachedProduct(next), deps.store.propsFor(next.id)),
        replacement: { previousHost: stored.hostKey, previousMac: stored.mac,
          nextHost: targetKey, nextMac: next.mac, movedSegments: deps.store.elementsFor(next.id).length },
        message: "Controller replaced on this Light. Saved Segments remain; inspect Strip and use Apply separately when ready. Nothing was written to WLED.",
      });
    } finally {
      release();
    }
  });

  app.get("/api/lights/:id/live", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    return c.json(await decorateDetail(light, snap));
  });

  app.post("/api/lights/:id/preview", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const revision = live.revision(stored.id);
    const body = await readPreviewBody(c);
    if (body.invalidPixels) return c.json({
      error: "invalid-pixels", message: "Preview needs valid color ranges (at most 512). Nothing was sent.",
    }, 422);
    if (body.invalidWhite) return c.json({ error: "invalid-white",
      message: "White channel must be a whole number from 0 to 255. Nothing was sent." }, 422);
    if ((body.white !== undefined || body.spans?.some((span) => span.white !== undefined)) &&
      getStrip(stored.stripKind)?.bead !== "rgbw")
      return c.json({ error: "unsupported-white", message: "This Light is not configured as RGBW. White-channel Preview was not sent." }, 422);
    const existing = live.get(stored.id);
    const updating = existing?.kind === "preview";
    let light = stored;
    let snap: WledSnapshot | null = null;
    if (updating) {
      // Do not refreshOne — that would snapshot the Preview paint.
      snap = previewDisplaySnapshot(stored, existing.restore);
    } else {
      const refreshed = await refreshOne(stored);
      light = refreshed.light;
      snap = refreshed.live;
    }
    const result = await live.startPreview({
      light,
      live: snap,
      elements: deps.store.elementsFor(light.id),
      elementId: body.elementId,
      range: body.range,
      spans: body.spans,
      color: body.color ?? settings.read().preview.hex,
      white: body.white,
      brightness: body.brightness ?? (snap?.brightness == null ? settings.read().preview.brightness : undefined),
      reread: body.reread,
      pixels: body.pixels,
      revision,
    });
    if (!result.ok) return c.json(result, result.status);
    const target = result.session?.target;
    if (!updating) record(light, "preview", "not-checked",
      `Preview${target ? ` ${target.label} (${target.start}–${target.stop})` : ""} started; ` +
      (result.wrote ? "temporary look sent. Not Apply." : "no new look was sent. Not Apply."));
    if (updating) {
      const detail = lightDetail(
        light,
        snap,
        deps.store.elementsFor(light.id),
        attachedProduct(light),
        deps.store.propsFor(light.id),
      );
      return c.json({
        ...detail,
        session: result.session,
        liveLeds: result.live?.leds ?? null,
        liveCaption: result.caption,
        liveMatch: result.reported,
      });
    }
    const detail = await decorateDetail(light, snap);
    return c.json({
      ...detail,
      session: result.session,
      liveLeds: result.live?.leds ?? null,
      liveCaption: result.caption,
      // Keep Inspect range rails. Match counts are not `reported`.
      liveMatch: result.reported,
    });
  });

  app.post("/api/lights/:id/preview/end", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const restore = (body as { restore?: unknown }).restore;
    const kind: LiveEndKind = restore === false ? "cancel-without-restore" : "complete";
    return endLive(c.req.param("id"), kind);
  });

  app.post("/api/lights/:id/preview/recover", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || body.discardFrozenPixels !== true) return c.json({
      error: "confirmation-required", sent: false,
      message: "Clearing frozen LEDs discards their current per-LED colours. Confirm that recovery action first. Nothing was sent.",
    }, 400);
    const result = await live.recoverFrozen(stored, deps.probe);
    if (!result.ok) return c.json(result, result.status);
    const next = lightFromSnapshot(
      { hostname: stored.hostname, port: stored.port }, result.snapshot, nowIso(), stored,
    );
    deps.store.replace(next);
    return c.json({
      ...(await decorateDetail(next, result.snapshot)),
      recovery: { cleared: true, wrote: result.wrote, restored: false, message: result.message },
    });
  });

  app.post("/api/lights/:id/preview/seen", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const seen = body && typeof body === "object" ? (body as { seen?: unknown }).seen : null;
    if (seen !== "yes" && seen !== "no") {
      return c.json({ error: "invalid", message: "Send { seen: \"yes\" | \"no\" }." }, 400);
    }
    const session = live.seen(stored.id, seen);
    if (!session) {
      return c.json({ error: "not_found", message: "Nothing live on this Light." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    return c.json(await decorateDetail(light, snap));
  });

  app.post("/api/lights/:id/blink", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const revision = live.revision(stored.id);
    const { light, live: snap } = await refreshOne(stored);
    const body = await readPreviewBody(c);
    const result = await live.startBlink({
      light,
      revision,
      live: snap,
      elements: deps.store.elementsFor(light.id),
      elementId: body.elementId,
    });
    if (!result.ok) return c.json(result, result.status);
    const detail = await decorateDetail(light, snap);
    return c.json({
      ...detail,
      session: result.session,
      liveLeds: result.live?.leds ?? null,
      liveCaption: result.caption,
      // Keep Inspect range rails. Match counts are not `reported`.
      liveMatch: result.reported,
    });
  });

  app.post("/api/lights/:id/blink/end", async (c) => endLive(c.req.param("id"), "complete"));

  app.post("/api/discover/blink", async (c) => {
    const body = await readHostBody(c);
    if (!body) return c.json({ error: "invalid", message: "Send { host }." }, 400);
    const decision = decideProbeAddress(body.host);
    if (!decision.ok) {
      return c.json({ error: decision.reasonCode, message: decision.reason }, 403);
    }
    const outcome = await deps.probe(decision.target);
    if (outcome.kind !== "found") {
      return c.json({ error: outcome.kind, message: outcome.reason }, 422);
    }
    const result = await live.identifyHost(
      decision.target,
      outcome.snapshot.ledCount,
      outcome.snapshot,
    );
    if (!result.ok) return c.json(result, result.status);
    return c.json({
      pulsed: result.live,
      restored: result.restored ?? false,
      caption: result.caption,
      reported: result.reported,
    });
  });

  async function endLive(id: string, kind: LiveEndKind) {
    const stored = deps.store.findById(id);
    if (!stored) {
      return new Response(
        JSON.stringify({ error: "not_found", message: "That Light is not on Lights." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    const active = live.get(id);
    const result = await live.end(id, kind);
    if (!result.ok) {
      if (active?.kind === "preview") {
        record(stored, "preview", "unknown", `End Preview did not finish: ${result.message}`);
      }
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (active?.kind === "preview") {
      record(stored, "preview", "not-checked",
        kind === "cancel-without-restore" ? "Preview cancelled without restoration."
          : result.restored ? "Preview ended; restore write accepted. Pixel match was not checked."
            : "Preview ended; restoration was not confirmed.");
    }
    const { light, live: snap } = await refreshOne(stored);
    const detail = await decorateDetail(light, snap);
    return Response.json({ ...detail, restored: result.restored ?? false });
  }

  function notWired(action: string, message: string) {
    return {
      error: "not_implemented",
      action,
      slice: CURRENT_SLICE,
      message,
    };
  }

  app.post("/api/preview", (c) =>
    c.json(
      notWired(
        "preview",
        "Preview lives on a Light (Test live). This root path is not Apply.",
      ),
      400,
    ),
  );
  app.post("/api/apply", (c) =>
    c.json(
      {
        error: "wrong_path",
        action: "apply",
        slice: CURRENT_SLICE,
        message: "Apply lives on a Light (Edit ranges): POST /api/lights/:id/apply.",
      },
      400,
    ),
  );
  app.post("/api/all-off", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rawIds =
      body && typeof body === "object" ? (body as { lightIds?: unknown }).lightIds : undefined;
    const lightIds = Array.isArray(rawIds)
      ? rawIds.filter((id): id is string => typeof id === "string")
      : undefined;
    return c.json(await runAllOff(lightIds));
  });

  app.get("/api/lights/:id/safe", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const safe = await readSafe(light, snap?.firmware ?? light.firmware);
    return c.json({
      ...(await decorateDetail(light, snap)),
      safe,
    });
  });

  app.post("/api/lights/:id/safe", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const safe = await readSafe(light, snap?.firmware ?? light.firmware);
    const draft = await readSafeBody(c);
    if (!draft) {
      return c.json({ error: "invalid", message: "Send { settings } with Safe settings fields." }, 400);
    }
    const reason = safeRefuseReason({
      reachable: light.reachability === "online" && snap !== null,
      read: safe,
      busyKind: live.get(light.id)?.kind ?? null,
      draft,
    });
    if (reason) {
      return c.json(refusedSafeBody(safe, draft, reason), 422);
    }
    const built = buildSafeWrite(draft, safe.fingerprint);
    if (!built.ok) {
      return c.json(refusedSafeBody(safe, draft, built.message), 422);
    }
    try { await captureDevice("pre-safe", light, snap!, { safe: { ...safe.settings } }); }
    catch (error) { return c.json(backupFailure(error), 503); }
    const written = await deps.writeCfg(dest, built.body);
    if (!written) {
      return c.json(
        {
          error: "write-failed",
          message: "The controller did not take Safe settings. Nothing else changed.",
          safe,
          safeWrite: {
            status: "failed" as const,
            matched: false,
            sent: built.sent,
            read: safe.settings,
            fingerprint: safe.fingerprint,
            message: "The controller did not take Safe settings. Nothing else changed.",
            caption: safe.caption,
          },
        },
        422,
      );
    }
    const reread = await readSafe(light, snap?.firmware ?? light.firmware);
    const matched = safeFieldsMatch(built.sent, reread.settings);
    const { light: refreshed, live: nextSnap } = await refreshOne(stored);
    let next = refreshed;
    if (matched && typeof built.sent.displayName === "string") {
      const resolved = resolveLightName({
        infoName: nextSnap?.name ?? refreshed.name,
        cfgName: reread.settings.displayName,
        existing: refreshed,
      });
      next = applyResolvedName(refreshed, resolved);
      deps.store.replace(next);
    }
    const detail = await decorateDetail(next, nextSnap);
    const lagNote =
      matched && built.sent.displayName
        ? safeInfoNameLagNote(reread.settings.displayName, nextSnap?.name)
        : null;
    const result = {
      status: matched ? ("matched" as const) : ("mismatch" as const),
      matched,
      sent: built.sent,
      read: reread.settings,
      fingerprint: reread.fingerprint,
      message: matched
        ? ["Controller reports the Safe settings we sent.", lagNote].filter(Boolean).join(" ")
        : "Wrote, but /json/cfg did not match. Not treating as success.",
      caption: reread.caption,
    };
    if (!matched) {
      return c.json({ ...detail, safe: reread, safeWrite: result }, 409);
    }
    return c.json({ ...detail, safe: reread, safeWrite: result });
  });

  app.patch("/api/lights/:id/led-product", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = parseLedProductAttach(body);
    if (!parsed.ok) {
      return c.json({ error: parsed.error, message: parsed.message }, 400);
    }
    const resolved = resolveLedProductAttach(parsed.ledProductId, (id) =>
      products.findById(id),
    );
    if (!resolved.ok) {
      const status = resolved.error === "not_found" ? 404 : 422;
      return c.json({ error: resolved.error, message: resolved.message }, status);
    }
    const { light, live: snap } = await refreshOne(stored);
    const next = { ...light, ledProductId: resolved.ledProductId };
    deps.store.replace(next);
    return c.json({
      ...(await decorateDetail(next, snap)),
      ledProducts: products.list(),
    });
  });

  app.get("/api/lights/:id/provision", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const raw = await deps.readCfg(dest);
    const provision = await readProvision(light, snap?.firmware ?? light.firmware, raw);
    const next = persistOutputs(light, provision);
    return c.json({
      ...(await decorateDetail(next, snap)),
      provision,
      ledProducts: products.list(),
      nightplotSuggestions: { ...settings.read().stripSuggestions,
        defaultLedProductId: settings.read().defaultLedProductId },
    });
  });

  app.post("/api/lights/:id/provision", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live: snap } = await refreshOne(stored);
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const raw = await deps.readCfg(dest);
    const provision = await readProvision(light, snap?.firmware ?? light.firmware, raw);
    const parsed = await readProvisionBody(c);
    if (!parsed) {
      return c.json(
        {
          error: "invalid",
          message: "Send { provision: { ledType, length, gpio } } or { provision: { outputs } }.",
        },
        400,
      );
    }
    const firstWritable = provision.outputs.find((output) => output.writable);
    const drafts: WledStripProvisionOutputDraft[] =
      parsed.kind === "outputs"
        ? parsed.drafts
        : [{ ...parsed.draft, index: firstWritable?.index ?? 0 }];
    const primary: WledStripProvisionDraft = {
      ledType: drafts[0]!.ledType,
      length: drafts[0]!.length,
      gpio: drafts[0]!.gpio,
    };
    const reason = provisionRefuseReason({
      reachable: light.reachability === "online" && snap !== null,
      read: provision,
      busyKind: live.get(light.id)?.kind ?? null,
      draft: primary,
    });
    if (reason) {
      return c.json(
        {
          error: "refused",
          message: reason,
          provision,
          provisionWrite: {
            status: "refused" as const,
            matched: false,
            sent: primary,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: reason,
            caption: provision.caption,
            outputs: provisionOutputWriteRows(drafts, provision),
          },
        },
        422,
      );
    }
    const built = buildProvisionOutputsWrite(drafts, raw, provision.fingerprint);
    if (!built.ok) {
      return c.json(
        {
          error: "refused",
          message: built.message,
          provision,
          provisionWrite: {
            status: "refused" as const,
            matched: false,
            sent: primary,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: built.message,
            caption: provision.caption,
            outputs: provisionOutputWriteRows(drafts, provision),
          },
        },
        422,
      );
    }
    try { await captureDevice("pre-provision", light, snap!, { strip: { ...provision.settings } }); }
    catch (error) { return c.json(backupFailure(error), 503); }
    const written = await deps.writeCfg(dest, built.body);
    if (!written) {
      return c.json(
        {
          error: "write-failed",
          message: "The controller did not take strip provision. Nothing else changed.",
          provision,
          provisionWrite: {
            status: "failed" as const,
            matched: false,
            sent: primary,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: "The controller did not take strip provision. Nothing else changed.",
            caption: provision.caption,
            outputs: provisionOutputWriteRows(built.sent, provision),
          },
        },
        422,
      );
    }
    const previousLedCount = snap?.ledCount ?? light.ledCount;
    const rereadRaw = await deps.readCfg(dest);
    const reread = await readProvision(light, snap?.firmware ?? light.firmware, rereadRaw);
    const { light: refreshed, live: nextSnap } = await refreshOne(stored);
    const writtenIns = (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins;
    const expectedTotal = provisionWriteExpectedLedCount(writtenIns);
    const nextLedCount = expectedTotal ?? drafts.reduce((sum, draft) => sum + draft.length, 0);
    const outputRows = provisionOutputWriteRows(built.sent, reread);
    const cfgMatched = provisionOutputsMatch(built.sent, reread);
    const snapMatched = provisionSnapshotMatch(
      primary,
      nextSnap?.ledCount ?? null,
      nextLedCount,
    );
    const matched = cfgMatched && snapMatched;
    let next = persistOutputs(refreshed, reread);
    if (matched && nextSnap) {
      next.lastSnapshot = nextSnap;
      next.lastSnapshotAt = next.lastSeenAt;
      next.lastApply = null; // Strip Apply intentionally changes the controller baseline.
      deps.store.replace(next);
    } else if (nextSnap) {
      deps.store.replace(next);
    }
    let ranges: ReturnType<typeof rangeLengthStory> | null = null;
    if (matched && previousLedCount !== nextLedCount) {
      const reconcile = reconcileDeclaredRangesForLedCount(
        deps.store.elementsFor(light.id),
        previousLedCount,
        nextLedCount,
      );
      if (reconcile.rewritten) {
        deps.store.replaceElements(light.id, reconcile.elements);
      }
      ranges = rangeLengthStory(reconcile);
    }
    const detail = await decorateDetail(next, nextSnap);
    const primaryRead =
      reread.outputs.find((output) => output.index === drafts[0]!.index)?.settings ?? reread.settings;
    const result = {
      status: matched ? ("matched" as const) : ("mismatch" as const),
      matched,
      sent: primary,
      read: primaryRead,
      snapshotLedCount: nextSnap?.ledCount ?? null,
      fingerprint: reread.fingerprint,
      message: provisionMismatchNote(
        primary,
        primaryRead,
        nextSnap?.ledCount ?? null,
        nextLedCount,
      ),
      caption: reread.caption,
      orderPreserved: built.orderPreserved,
      outputs: outputRows,
      ...(ranges ? { ranges } : {}),
    };
    if (!matched) {
      return c.json({ ...detail, provision: reread, provisionWrite: result }, 409);
    }
    return c.json({ ...detail, provision: reread, provisionWrite: result });
  });

  app.get("/api/lights/:id/delete-checks", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    return c.json(await deleteImpact(stored));
  });

  app.delete("/api/lights/:id", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const impact = await deleteImpact(stored);
    if (!canDelete(impact.checks)) {
      return c.json(
        {
          error: "checks_incomplete",
          message: deleteRefuseReason(impact.checks),
          ...impact,
        },
        422,
      );
    }
    try { capture("pre-delete", stored); }
    catch (error) { return c.json(backupFailure(error), 503); }
    deps.store.remove(stored.id);
    return c.json({
      deleted: true,
      lightId: stored.id,
      message: `${stored.name} is no longer on Lights. The controller was not changed.`,
      caption: impact.caption,
    });
  });

  function allOffUnknownRow(
    light: Pick<Light, "id" | "name" | "hostname" | "port">,
    elapsedMs = 0,
  ): AllOffRow {
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    return {
      lightId: light.id,
      name: light.name,
      status: "unknown",
      detail: allOffNoAnswerReason(displayHost(dest), elapsedMs),
    };
  }

  async function allOffOneLight(
    stored: Light,
    noteFixture: (source?: LiveSource | null) => void,
  ): Promise<AllOffRow> {
    const dest: HostPort = { hostname: stored.hostname, port: stored.port };
    const { light, live: snap, elapsedMs } = await refreshOne(stored);
    const liveRead = snap ? await live.read(light) : null;
    noteFixture(liveRead?.source);
    if (light.reachability !== "online" || !snap) {
      return allOffUnknownRow(light, elapsedMs);
    }
    if (snap.on === false) {
      return {
        lightId: light.id,
        name: light.name,
        status: "already-off",
        detail: "was already off",
      };
    }
    const written = await deps.write(dest, { on: false });
    const reread = await deps.probe(dest);
    if (!written || reread.kind !== "found") {
      return {
        lightId: light.id,
        name: light.name,
        status: "failed",
        detail: "The controller did not take off.",
      };
    }
    const next = lightFromSnapshot(dest, reread.snapshot, nowIso(), light);
    deps.store.replace(next);
    if (reread.snapshot.on === false) {
      return {
        lightId: next.id,
        name: next.name,
        status: "off",
        detail: "reports on: false",
      };
    }
    return {
      lightId: next.id,
      name: next.name,
      status: "failed",
      detail: "still reports on",
    };
  }

  async function runAllOff(lightIds?: string[]): Promise<AllOffResult> {
    const enrolled = deps.store.load();
    const targets = lightIds?.length
      ? enrolled.filter((light) => lightIds.includes(light.id))
      : enrolled;
    const release = targets.map((light) => live.block(light.id));
    try {
      await Promise.all(targets.map((light) => live.settle(light.id)));
      const cancelled: AllOffCancelled[] = [];
      for (const session of live.list()) {
        if (lightIds?.length && !lightIds.includes(session.lightId)) continue;
        const owner = enrolled.find((light) => light.id === session.lightId);
        const ended = await live.end(session.lightId, "cancel-without-restore");
        if (ended.ok && session.kind === "preview" && owner) {
          record(owner, "preview", "not-checked", "Preview cancelled by All Off without restoration.");
        }
        cancelled.push({
          lightId: session.lightId,
          kind: session.kind,
          label: session.target.label,
          name: owner?.name ?? session.target.label,
        });
      }
      let honesty: LiveSource = "controller";
      // FileLightsStore.replace is a sync read-modify-write, so overlapping Light
      // jobs do not drop a sibling update. Do not invent success across Lights.
      const settled = await mapLimitSettled(targets, ALL_OFF_PROBE_CONCURRENCY, (stored) =>
        allOffOneLight(stored, (source) => {
          honesty = foldHonestySource(honesty, source);
        }),
      );
      const rows: AllOffRow[] = settled.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        const stored = targets[index]!;
        const current = deps.store.findById(stored.id) ?? stored;
        const next = markUnreachable(current);
        deps.store.replace(next);
        // Throw / unmeasured wait — generic refuse, not a claimed 3 s.
        return allOffUnknownRow(next);
      });
      for (const row of rows) {
        const owner = targets.find((light) => light.id === row.lightId);
        if (!owner) continue;
        const readback: ActivityEntry["readback"] = row.status === "off" || row.status === "already-off"
          ? "match" : row.status === "unknown" ? "unknown" :
            row.detail === "still reports on" ? "mismatch" : "unknown";
        record(owner, "all-off", readback,
          `${row.status === "already-off" ? "Already off" : "All Off"}: ${row.detail}.`);
      }
      const failedIds = rows
        .filter((row) => row.status === "failed" || row.status === "unknown")
        .map((row) => row.lightId);
      return {
        cancelled,
        restored: false,
        rows,
        failedIds,
        message: allOffSummary(rows, cancelled),
        caption: manageCaption(honesty),
      };
    } finally {
      release.forEach((unblock) => unblock());
    }
  }

  async function readProvision(
    light: Light,
    firmware: string | null,
    raw: unknown,
  ): Promise<ProvisionRead> {
    const liveRead = await live.read(light);
    const source = honestySource(liveRead?.source);
    if (raw === null) {
      return parseWledProvision(null, firmware, source);
    }
    return parseWledProvision(raw, firmware, source);
  }

  async function readProvisionBody(
    c: { req: { json: () => Promise<unknown> } },
  ): Promise<ParsedProvisionBody | null> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    return parseProvisionBody((body as { provision?: unknown }).provision);
  }

  async function readSafe(light: Light, firmware: string | null): Promise<SafeRead> {
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const raw = await deps.readCfg(dest);
    const liveRead = await live.read(light);
    const source = honestySource(liveRead?.source);
    if (raw === null) {
      return parseWledCfg(null, firmware, source);
    }
    return parseWledCfg(raw, firmware, source);
  }

  async function readSafeBody(
    c: { req: { json: () => Promise<unknown> } },
  ): Promise<Partial<WledSafeSettings> | null> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    const raw = (body as { settings?: unknown }).settings;
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const draft: Partial<WledSafeSettings> = {};
    if (typeof row.displayName === "string") draft.displayName = row.displayName;
    if (typeof row.turnOnAtBoot === "boolean") draft.turnOnAtBoot = row.turnOnAtBoot;
    if (typeof row.bootBrightness === "number") draft.bootBrightness = row.bootBrightness;
    if (typeof row.bootPreset === "number") draft.bootPreset = row.bootPreset;
    if (typeof row.defaultTransition === "number") draft.defaultTransition = row.defaultTransition;
    if (typeof row.currentLimitMa === "number") draft.currentLimitMa = row.currentLimitMa;
    return draft;
  }

  async function deleteImpact(stored: Light) {
    const { light, live: snap, elapsedMs } = await refreshOne(stored);
    const elements = deps.store.elementsFor(light.id);
    const session = live.get(light.id);
    const checks = buildDeleteChecks({
      elementLabels: elements.map((element) => element.label),
      sessionLabel: session?.target.label ?? null,
      reachable: light.reachability === "online" && snap !== null,
      reportedOn: snap?.on ?? null,
      controllerWaitMs: elapsedMs,
    });
    const liveRead = snap ? await live.read(light) : null;
    return {
      checks,
      caption: manageCaption(honestySource(liveRead?.source)),
      light: (await decorateDetail(light, snap, elements, elapsedMs)).light,
    };
  }

  function attachedProduct(light: Light): LedProduct | null {
    if (!light.ledProductId) return null;
    return products.findById(light.ledProductId) ?? null;
  }

  async function replacementCandidate(stored: Light, host: string): Promise<
    | { ok: true; target: HostPort; snapshot: WledSnapshot }
    | { ok: false; status: 403 | 409 | 422; error: string; message: string }
  > {
    const decision = decideProbeAddress(host);
    if (!decision.ok) return { ok: false, status: 403, error: decision.reasonCode, message: decision.reason };
    if (live.get(stored.id)) return { ok: false, status: 409, error: "busy",
      message: "End Preview or Blink before replacing this controller. Nothing was saved or sent." };
    const nextKey = normalizeHostKey(decision.target);
    const occupant = deps.store.findByHostKey(nextKey);
    if (occupant && occupant.id !== stored.id) return { ok: false, status: 409, error: "already-added",
      message: "That address already belongs to another Light. Nothing was saved or sent." };
    const outcome = await deps.probe(decision.target);
    if (outcome.kind !== "found") return { ok: false, status: 422, error: outcome.kind,
      message: `${outcome.reason} Kept the current controller. Nothing was saved or sent.` };
    if (live.get(stored.id)) return { ok: false, status: 409, error: "busy",
      message: "Preview or Blink started during the check. Nothing was saved or sent." };
    if (!normalizeMac(outcome.snapshot.mac)) return { ok: false, status: 422, error: "mac-unknown",
      message: "The replacement did not report a usable MAC. Nothing was saved or sent." };
    if (macsMatch(stored.mac, outcome.snapshot.mac)) return { ok: false, status: 409, error: "same-controller",
      message: "That is the same controller. Use Change address instead. Nothing was saved or sent." };
    if (deps.store.load().some((light) => light.id !== stored.id && macsMatch(light.mac, outcome.snapshot.mac))) {
      return { ok: false, status: 409, error: "already-added",
        message: "That controller MAC already belongs to another Light. Nothing was saved or sent." };
    }
    if (outcome.snapshot.ledCount !== stored.ledCount ||
      validateDeclaredRanges(deps.store.elementsFor(stored.id), outcome.snapshot.ledCount).length) {
      return { ok: false, status: 422, error: "length-mismatch",
        message: `The replacement reports ${outcome.snapshot.ledCount} LEDs; this Light has ${stored.ledCount}. Match the strip length before moving Segments. Nothing was saved or sent.` };
    }
    return { ok: true, target: decision.target, snapshot: outcome.snapshot };
  }

  function rememberStripKind(light: Light, ledType: string | null | undefined): Light {
    if (!isProvisionLedType(ledType) || light.stripKind === ledType) return light;
    const next = { ...light, stripKind: ledType };
    deps.store.replace(next);
    return next;
  }

  function persistOutputs(light: Light, provision: ProvisionRead): Light {
    const withKind = rememberStripKind(light, provision.settings.ledType);
    const next = withMigratedOutputs({
      ...withKind,
      outputs: outputsFromProvision(withKind, provision),
    });
    deps.store.upsert(next);
    return next;
  }

  type EnrollOutcome =
    | { status: "added"; host: string; light: LightView; lightId: string; name: string }
    | { status: "already-enrolled"; host: string; reason: string; lightId: string; name: string }
    | {
        status: "failed";
        host: string;
        reason: string;
        error?: string;
        candidate?: DiscoverRow;
      };

  async function enrollHost(host: string): Promise<EnrollOutcome> {
    const decision = decideProbeAddress(host);
    if (!decision.ok) {
      const row = refusedRow(host, "address-probe", nowIso(), decision.reason);
      mergeSession(row);
      return {
        status: "failed",
        host,
        reason: decision.reason,
        error: decision.reasonCode,
        candidate: row,
      };
    }

    const existing = deps.store.findByHostKey(normalizeHostKey(decision.target));
    if (existing) {
      return {
        status: "already-enrolled",
        host,
        reason: `${existing.name} is already on Lights.`,
        lightId: existing.id,
        name: existing.name,
      };
    }

    const outcome = await deps.probe(decision.target);
    if (outcome.kind !== "found") {
      const row = rowFromProbe(decision.target, "address-probe", outcome, nowIso(), false);
      mergeSession(row);
      return {
        status: "failed",
        host,
        reason: outcome.reason,
        error: outcome.kind,
        candidate: row,
      };
    }

    const light = withMigratedOutputs(lightFromSnapshot(decision.target, outcome.snapshot, nowIso()));
    deps.store.upsert(light);
    session.rows = session.rows.filter((row) => row.key !== light.hostKey);
    const view = lightDetail(light, outcome.snapshot, [], attachedProduct(light)).light;
    return { status: "added", host, light: view, lightId: light.id, name: light.name };
  }

  function readSetupProfileDraft(body: unknown): SetupProfileDraft | null {
    if (!body || typeof body !== "object") return null;
    const raw = (body as { profile?: unknown }).profile ?? body;
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name : "Setup profile";
    const draft: SetupProfileDraft = { name };
    if (isProvisionLedType(row.ledType)) draft.ledType = row.ledType;
    if (typeof row.colorOrder === "string") draft.colorOrder = row.colorOrder;
    if (typeof row.gpio === "number") draft.gpio = row.gpio;
    if (typeof row.length === "number") draft.length = row.length;
    if (typeof row.bootBrightness === "number") draft.bootBrightness = row.bootBrightness;
    if (typeof row.currentLimitMa === "number") draft.currentLimitMa = row.currentLimitMa;
    if (typeof row.namePattern === "string") draft.namePattern = row.namePattern;
    if (typeof row.outputIndex === "number") draft.outputIndex = row.outputIndex;
    if (row.outputIndex === null) draft.outputIndex = null;
    return draft;
  }

  async function applySetupProfileToLight(
    lightId: string,
    profile: SetupProfile,
    index: number,
  ): Promise<SetupApplyRow> {
    const stored = deps.store.findById(lightId);
    if (!stored) {
      return { lightId, name: lightId, status: "failed", reason: "That Light is not on Lights." };
    }
    try {
      const { light, live: snap } = await refreshOne(stored);
      if (light.reachability !== "online" || !snap) {
        return {
          lightId,
          name: light.name,
          status: "failed",
          reason: "This Light hasn’t answered. Refresh or re-address it first.",
        };
      }
      const busyKind = live.get(light.id)?.kind ?? null;
      if (busyKind === "preview") {
        return { lightId, name: light.name, status: "failed", reason: "End the Preview first. Preview is not Apply." };
      }
      if (busyKind === "blink") {
        return { lightId, name: light.name, status: "failed", reason: "Wait for Blink to finish." };
      }
      let backupId: string | undefined;
      try {
        const backup = await captureDevice("pre-setup-profile", light, snap);
        backupId = backup.id;
      } catch (error) {
        return {
          lightId,
          name: light.name,
          status: "failed",
          reason: error instanceof Error
            ? `Safety backup failed: ${error.message} Nothing was sent to WLED.`
            : "Safety backup failed. Nothing was sent to WLED.",
        };
      }

      const dest: HostPort = { hostname: light.hostname, port: light.port };
      let next = light;
      if (setupProfileWritesStrip(profile)) {
        const raw = await deps.readCfg(dest);
        const provision = await readProvision(next, snap.firmware ?? next.firmware, raw);
        const refuse = provisionRefuseReason({
          reachable: true,
          read: provision,
          busyKind: null,
        });
        if (refuse) return { lightId, name: next.name, status: "failed", reason: refuse, backupId };
        const writable = provision.outputs.filter((bus) => bus.writable);
        const targeted = setupProfileTargetIndexes(
          profile,
          writable.map((bus) => bus.index),
        );
        if (!targeted.ok) {
          return { lightId, name: next.name, status: "failed", reason: targeted.reason, backupId };
        }
        const drafts: WledStripProvisionOutputDraft[] = [];
        for (const bus of writable) {
          if (!targeted.indexes.includes(bus.index)) continue;
          const ledType = profile.ledType ?? (isProvisionLedType(bus.settings.ledType) ? bus.settings.ledType : null);
          const length = profile.length ?? bus.settings.length;
          const gpio = profile.gpio ?? bus.settings.gpio;
          if (!ledType || length == null || gpio == null) {
            return {
              lightId,
              name: next.name,
              status: "failed",
              reason: "This output is missing type, length, or GPIO, and the profile did not supply them.",
              backupId,
            };
          }
          drafts.push({
            index: bus.index,
            ledType,
            length,
            gpio,
            ...(profile.colorOrder ? { colorOrder: profile.colorOrder } : {}),
          });
        }
        if (drafts.length === 0) {
          return {
            lightId,
            name: next.name,
            status: "failed",
            reason: "None of this controller’s buses are a strip we provision.",
            backupId,
          };
        }
        const built = buildProvisionOutputsWrite(drafts, raw, provision.fingerprint);
        if (!built.ok) {
          return { lightId, name: next.name, status: "failed", reason: built.message, backupId };
        }
        const written = await deps.writeCfg(dest, built.body);
        if (!written) {
          return {
            lightId,
            name: next.name,
            status: "failed",
            reason: "The controller did not take strip provision. Nothing else changed.",
            backupId,
          };
        }
        const rereadRaw = await deps.readCfg(dest);
        const reread = await readProvision(next, snap.firmware ?? next.firmware, rereadRaw);
        const { light: refreshed, live: nextSnap } = await refreshOne(stored);
        const expected = provisionWriteExpectedLedCount(
          (built.body as { hw: { led: { ins: Record<string, unknown>[] } } }).hw.led.ins,
        );
        const matched =
          provisionOutputsMatch(built.sent, reread) &&
          expected !== null &&
          nextSnap?.ledCount === expected;
        next = persistOutputs(refreshed, reread);
        if (!matched) {
          return {
            lightId,
            name: next.name,
            status: "failed",
            reason: "Wrote, but /json/cfg did not match. Not treating as success.",
            backupId,
          };
        }
        if (nextSnap) {
          next = { ...next, lastSnapshot: nextSnap, lastSnapshotAt: next.lastSeenAt, lastApply: null };
          deps.store.replace(next);
        }
      }

      if (setupProfileWritesSafe(profile)) {
        const displayName = profile.namePattern
          ? applyNamePattern(profile.namePattern, {
              index,
              currentName: next.name,
              host: displayHost({ hostname: next.hostname, port: next.port }),
            })
          : undefined;
        const draft = {
          ...(profile.bootBrightness != null ? { bootBrightness: profile.bootBrightness } : {}),
          ...(profile.currentLimitMa != null ? { currentLimitMa: profile.currentLimitMa } : {}),
          ...(displayName ? { displayName } : {}),
        };
        const safe = await readSafe(next, snap.firmware ?? next.firmware);
        const refuse = safeRefuseReason({
          reachable: true,
          read: safe,
          busyKind: null,
          draft,
        });
        if (refuse) return { lightId, name: next.name, status: "failed", reason: refuse, backupId };
        const built = buildSafeWrite(draft, safe.fingerprint);
        if (!built.ok) return { lightId, name: next.name, status: "failed", reason: built.message, backupId };
        const written = await deps.writeCfg(dest, built.body);
        if (!written) {
          return {
            lightId,
            name: next.name,
            status: "failed",
            reason: "The controller did not take Safe settings. Nothing else changed.",
            backupId,
          };
        }
        const reread = await readSafe(next, snap.firmware ?? next.firmware);
        if (!safeFieldsMatch(built.sent, reread.settings)) {
          return {
            lightId,
            name: next.name,
            status: "failed",
            reason: "Wrote, but /json/cfg did not match. Not treating as success.",
            backupId,
          };
        }
        if (typeof built.sent.displayName === "string") {
          const { light: refreshed, live: nextSnap } = await refreshOne(stored);
          const resolved = resolveLightName({
            infoName: nextSnap?.name ?? refreshed.name,
            cfgName: reread.settings.displayName,
            existing: refreshed,
          });
          next = applyResolvedName(refreshed, resolved);
          deps.store.replace(next);
        }
      }

      return { lightId, name: next.name, status: "applied", backupId };
    } catch (error) {
      return {
        lightId,
        name: stored.name,
        status: "failed",
        reason: error instanceof Error ? error.message : "Setup profile apply failed.",
      };
    }
  }

  async function seedStripKindFromInspect(
    light: Light,
    snap: WledSnapshot | null,
  ): Promise<Light> {
    if (
      !snap ||
      !needsInspectStripKindSeed({
        stripKind: light.stripKind,
        ledProductId: light.ledProductId,
        reachable: light.reachability === "online",
      })
    ) {
      return light;
    }
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const raw = await deps.readCfg(dest);
    if (raw == null) return light;
    const provision = parseWledProvision(raw, snap.firmware ?? light.firmware);
    return persistOutputs(light, provision);
  }

  async function refreshOne(
    stored: Light,
  ): Promise<{ light: Light; live: WledSnapshot | null; elapsedMs: number }> {
    const started = Date.now();
    const target: HostPort = { hostname: stored.hostname, port: stored.port };
    const outcome = await deps.probe(target);
    const elapsedMs = Date.now() - started;
    if (outcome.kind === "found") {
      const next = lightFromSnapshot(target, outcome.snapshot, nowIso(), stored);
      deps.store.replace(next);
      return { light: next, live: outcome.snapshot, elapsedMs };
    }
    const next = markUnreachable(stored);
    deps.store.replace(next);
    return { light: next, live: null, elapsedMs };
  }

  async function listLights(): Promise<LightsPayload> {
    const stored = deps.store.load();
    const views: LightView[] = [];
    const allElements = deps.store.loadElements();
    const allProps = deps.store.loadProps();
    for (const light of stored) {
      const elements = allElements.filter((element) => element.lightId === light.id);
      const props = allProps.filter((prop) => prop.lightId === light.id);
      views.push(lightDetail(light, null, elements, attachedProduct(light), props).light);
    }
    const enrolled = new Set(views.map((light) => light.hostKey));
    return {
      lights: views,
      elements: allElements,
      props: allProps,
      unenrolled: session.rows.filter(
        (row) => row.status === "found" && !enrolled.has(row.key),
      ),
      sessions: live.list().map((item) => ({
        lightId: item.lightId,
        kind: item.kind,
        label: item.target.label,
      })),
      note:
        views.length === 0
          ? "No Lights are enrolled."
          : undefined,
    };
  }

  async function decorateDetail(
    light: Light,
    snap: WledSnapshot | null,
    elements?: Element[],
    controllerWaitMs?: number,
  ): Promise<LightDetail> {
    const elems = elements ?? deps.store.elementsFor(light.id);
    const detail = lightDetail(
      light,
      snap,
      elems,
      attachedProduct(light),
      deps.store.propsFor(light.id),
    );
    const liveRead = snap ? await live.read(light) : null;
    const current = live.get(light.id);
    return {
      ...detail,
      session: current ?? null,
      applyConflict: current ? null : compareLastApply(light.lastApply, snap),
      frozenPreview: !current && snap?.nativeRestoreUnavailable === "frozen",
      deleteChecks: buildDeleteChecks({
        elementLabels: elems.map((element) => element.label),
        sessionLabel: current?.target.label ?? null,
        reachable: light.reachability === "online" && snap !== null,
        reportedOn: snap?.on ?? null,
        controllerWaitMs,
      }),
      liveLeds: liveRead?.leds ?? null,
      liveCaption: decorateLiveCaption({ live: liveRead, session: current }),
    };
  }

  async function probeAddress(host: string, via: "address-probe"): Promise<DiscoverRow> {
    const now = nowIso();
    const decision = decideProbeAddress(host);
    if (!decision.ok) return refusedRow(host, via, now, decision.reason);
    const enrolled = Boolean(deps.store.findByHostKey(normalizeHostKey(decision.target)));
    const outcome = enrolled
      ? { kind: "found" as const, snapshot: emptySnap() }
      : await deps.probe(decision.target);
    return rowFromProbe(decision.target, via, outcome, now, enrolled);
  }

  function mergeSession(row: DiscoverRow) {
    session.rows = [row, ...session.rows.filter((item) => item.key !== row.key)];
  }

  async function readHostBody(c: { req: { json: () => Promise<unknown> } }) {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    const host = (body as { host?: unknown }).host;
    if (typeof host !== "string" || !host.trim()) return null;
    return { host: host.trim() };
  }

  async function readElementsBody(
    c: { req: { json: () => Promise<unknown> } },
  ): Promise<DraftRange[] | null> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    const raw = (body as { elements?: unknown }).elements;
    if (!Array.isArray(raw)) return null;
    const drafts: DraftRange[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") return null;
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown; color?: unknown; outputId?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      if (!validSegmentColor(row.color)) return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
        color: row.color as DraftRange["color"],
        ...(typeof row.outputId === "string" && row.outputId ? { outputId: row.outputId } : {}),
      });
    }
    return drafts;
  }

  async function readApplyDrafts(
    c: { req: { json: () => Promise<unknown> } },
    lightId: string,
  ): Promise<DraftRange[] | null> {
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") return null;
    if (!("elements" in body)) {
      return deps.store.elementsFor(lightId);
    }
    const raw = (body as { elements?: unknown }).elements;
    if (!Array.isArray(raw)) return null;
    const drafts: DraftRange[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") return null;
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown; color?: unknown; outputId?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      if (!validSegmentColor(row.color)) return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
        color: row.color as DraftRange["color"],
        ...(typeof row.outputId === "string" && row.outputId ? { outputId: row.outputId } : {}),
      });
    }
    return drafts;
  }

  function persistDrafts(lightId: string, drafts: DraftRange[]): Element[] {
    const existingIds = new Set(deps.store.elementsFor(lightId).map((element) => element.id));
    const elements: Element[] = drafts.map((draft, index) => ({
      id:
        draft.id && existingIds.has(draft.id)
          ? draft.id
          : draft.id && looksLikeId(draft.id)
            ? draft.id
            : randomUUID(),
      lightId,
      label: draft.label.trim() || `Segment ${index + 1}`,
      start: draft.start,
      stop: draft.stop,
      ...(draft.color ? { color: draft.color } :
        deps.store.elementsFor(lightId).find((item) => item.id === draft.id)?.color ?
          { color: deps.store.elementsFor(lightId).find((item) => item.id === draft.id)!.color } : {}),
      ...(draft.outputId ? { outputId: draft.outputId } :
        deps.store.elementsFor(lightId).find((item) => item.id === draft.id)?.outputId
          ? { outputId: deps.store.elementsFor(lightId).find((item) => item.id === draft.id)!.outputId }
          : {}),
    }));
    deps.store.replaceElements(lightId, elements);
    return elements;
  }

  async function readPreviewBody(c: { req: { json: () => Promise<unknown> } }) {
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      return {
        elementId: null as string | null,
        range: null,
        spans: null,
        color: undefined,
        white: undefined,
        brightness: undefined,
        reread: undefined as boolean | undefined,
        pixels: undefined as boolean | undefined,
        invalidPixels: false,
        invalidWhite: false,
      };
    }
    const row = body as {
      elementId?: unknown;
      start?: unknown;
      stop?: unknown;
      spans?: unknown;
      color?: unknown;
      white?: unknown;
      brightness?: unknown;
      reread?: unknown;
      pixels?: unknown;
    };
    const spans = Array.isArray(row.spans)
      ? row.spans.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const span = item as { start?: unknown; stop?: unknown; color?: unknown; white?: unknown };
          if (
            typeof span.start !== "number" ||
            typeof span.stop !== "number" ||
            !Number.isInteger(span.start) ||
            !Number.isInteger(span.stop) ||
            span.start < 0 ||
            span.stop <= span.start ||
            typeof span.color !== "string" ||
            (span.white !== undefined && (!Number.isInteger(span.white) || (span.white as number) < 0 || (span.white as number) > 255))
          ) {
            return [];
          }
          const color = parseHexColor(span.color);
          return color ? [{ start: span.start, stop: span.stop, color,
            ...(span.white !== undefined ? { white: span.white as number } : {}) }] : [];
        })
      : null;
    const range =
      typeof row.start === "number" &&
      typeof row.stop === "number" &&
      Number.isInteger(row.start) &&
      Number.isInteger(row.stop) &&
      row.start >= 0 &&
      row.stop > row.start
        ? { start: row.start, stop: row.stop }
        : null;
    return {
      elementId: typeof row.elementId === "string" ? row.elementId : null,
      range,
      spans: spans && spans.length > 0 ? (row.pixels === true ? spans : spans.slice(0, 64)) : null,
      color: typeof row.color === "string" ? parseHexColor(row.color) ?? undefined : undefined,
      white: Number.isInteger(row.white) && (row.white as number) >= 0 && (row.white as number) <= 255 ? row.white as number : undefined,
      brightness: typeof row.brightness === "number" ? row.brightness : undefined,
      reread: typeof row.reread === "boolean" ? row.reread : undefined,
      pixels: row.pixels === true,
      invalidPixels: row.pixels === true && (!Array.isArray(row.spans) || row.spans.length === 0
        || row.spans.length > 512 || spans?.length !== row.spans.length),
      invalidWhite: row.white !== undefined && (!Number.isInteger(row.white) || (row.white as number) < 0 || (row.white as number) > 255)
        || Array.isArray(row.spans) && spans?.length !== row.spans.length && row.spans.some((span: unknown) =>
          span && typeof span === "object" && "white" in span),
    };
  }

  return app;
}

function looksLikeId(id: string): boolean {
  return id.length > 0 && !id.startsWith("draft-");
}

function validSegmentColor(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const color = value as { hex?: unknown; white?: unknown };
  return typeof color.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(color.hex) &&
    Number.isInteger(color.white) && (color.white as number) >= 0 && (color.white as number) <= 255;
}

function refusedSafeBody(
  safe: SafeRead,
  sent: Partial<WledSafeSettings>,
  message: string,
): {
  error: "refused";
  message: string;
  safe: SafeRead;
  safeWrite: SafeWriteResult;
} {
  return {
    error: "refused",
    message,
    safe,
    safeWrite: {
      status: "refused",
      matched: false,
      sent,
      read: safe.settings,
      fingerprint: safe.fingerprint,
      message,
      caption: safe.caption,
    },
  };
}

function emptySnap(): WledSnapshot {
  return {
    name: "",
    firmware: "",
    mac: null,
    ledCount: 0,
    rgbw: false,
    on: null,
    brightness: null,
    segmentColor: null,
    segments: null,
  };
}

function wireframeCompileView(compiled: {
  staleLocks: { role: string; physicalIndex: number }[];
  staleHidden: { afterRole: string; count: number; reason: string }[];
  ledmapDigest: string;
  pathEdgeIds: string[];
  faces: { id: string; index: number; virtualStart: number; virtualStop: number }[];
}) {
  return {
    staleLocks: compiled.staleLocks,
    staleHidden: compiled.staleHidden,
    ledmapDigest: compiled.ledmapDigest,
    pathEdgeIds: compiled.pathEdgeIds,
    faces: compiled.faces.map((face) => ({
      id: face.id,
      index: face.index,
      start: face.virtualStart,
      stop: face.virtualStop,
    })),
  };
}
