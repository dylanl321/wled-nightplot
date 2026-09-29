import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  buildProvisionWrite,
  buildSafeWrite,
  isProvisionLedType,
  needsInspectStripKindSeed,
  parseWledProvision,
  provisionFieldsMatch,
  provisionMismatchNote,
  provisionRefuseReason,
  provisionSnapshotMatch,
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
  type ProvisionRead,
  type SafeRead,
  type SafeWriteResult,
  type SegmentBackup,
  type WledSafeSettings,
  type WledSnapshot,
  type WledStripProvisionDraft,
} from "@nightplot/shared";
import { Hono } from "hono";
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
import { FileLedProductsStore } from "./store/led-products-store.ts";
import { FileSettingsStore } from "./store/settings-store.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { ProbeFn } from "./wled/client.ts";
import type { ReadCfgFn, WriteCfgFn } from "./wled/cfg.ts";
import { createWledConfigExportReader, createWledNativeFilesReader, type ReadWledConfigExport, type ReadWledNativeFiles } from "./wled/native-backup.ts";
import { applyRangesWrite, type ReadLiveFn, type WriteStateFn } from "./wled/live.ts";

export type AppDeps = {
  store: FileLightsStore;
  activity?: FileActivityStore;
  backups?: FileBackupStore;
  settings?: FileSettingsStore;
  products?: FileLedProductsStore;
  probe: ProbeFn;
  collect: CollectFn;
  write: WriteStateFn;
  readLive: ReadLiveFn;
  readCfg: ReadCfgFn;
  readNativeFiles?: ReadWledNativeFiles;
  readConfigExport?: ReadWledConfigExport;
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
  const backups = deps.backups ?? new FileBackupStore(join(tmpdir(), `nightplot-backups-${randomUUID()}`), () => settings.read().backupRetention);
  const readNativeFiles = deps.readNativeFiles ?? createWledNativeFilesReader();
  const readConfigExport = deps.readConfigExport ?? createWledConfigExportReader();
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
    const deviceFiles = await readNativeFiles({ hostname: light.hostname, port: light.port });
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

  function backupFailure(error: unknown) {
    return { error: "backup-failed", message: error instanceof Error ?
      `Safety backup failed: ${error.message} The requested change was not made; nothing was sent to WLED.` :
      "Safety backup failed. The requested change was not made; nothing was sent to WLED." };
  }
  const live = createLiveEngine({
    write: deps.write,
    readLive: deps.readLive,
    findLight: (id) => deps.store.findById(id),
  });

  function catalogDeleteFromStore(productId: string) {
    const raw = deps.store.tryLoadRaw();
    if (!raw.ok) return unknownLedProductDeleteImpact();
    return ledProductDeleteImpact(raw.lights, productId);
  }

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

  app.get("/api/backups", (c) => c.json({ backups: backups.list() }));
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
  app.patch("/api/backups/:id/pin", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.pinned !== "boolean") return c.json({ error: "invalid", message: "Choose pinned or unpinned." }, 422);
    const backup = backups.setPinned(c.req.param("id"), body.pinned);
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
      products: reviewed.data.products.length, activity: reviewed.data.activity.length },
      current: { lights: current.lights.length, segments: current.elements.length,
        products: current.products.length, activity: current.activity.length },
      expectedDigest: backupDigest(reviewed.data), expectedCurrentDigest: backupDigest(current),
      message: "Review these counts. Restore replaces Nightplot data only; it does not write any controller. A safety backup is created first." });
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
        deps.store.restoreBackup(reviewed.data);
        products.restoreBackup(reviewed.data.products);
        activity.restoreBackup(reviewed.data.activity);
        if (reviewed.data.settings) settings.restore(reviewed.data.settings);
      } catch (error) {
        try {
          deps.store.restoreBackup(current);
          products.restoreBackup(current.products);
          activity.restoreBackup(current.activity);
          if (current.settings) settings.restore(current.settings);
        } catch { return c.json({ error: "restore-partial",
          message: `Restore and rollback failed. Safety backup ${safety.id} is kept; inspect Nightplot data before further changes.` }, 500); }
        return c.json({ error: "restore-failed",
          message: `Restore failed and was rolled back. Safety backup ${safety.id} is kept. ${error instanceof Error ? error.message : ""}` }, 500);
      }
      return c.json({ restored: true, safetyBackupId: safety.id,
        message: "Nightplot data restored. No WLED controller was changed; inspect Lights and use Apply separately." });
    } finally { releases.forEach((release) => release()); }
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
    const decision = decideProbeAddress(body.host);
    if (!decision.ok) {
      const row = refusedRow(body.host, "address-probe", nowIso(), decision.reason);
      mergeSession(row);
      return c.json(
        { error: decision.reasonCode, message: decision.reason, candidate: row },
        403,
      );
    }

    const existing = deps.store.findByHostKey(normalizeHostKey(decision.target));
    if (existing) {
      return c.json(
        {
          error: "already-added",
          message: `${existing.name} is already on Lights.`,
        },
        409,
      );
    }

    const outcome = await deps.probe(decision.target);
    if (outcome.kind !== "found") {
      const row = rowFromProbe(
        decision.target,
        "address-probe",
        outcome,
        nowIso(),
        false,
      );
      mergeSession(row);
      return c.json(
        { error: outcome.kind, message: outcome.reason, candidate: row },
        422,
      );
    }

    const light = lightFromSnapshot(decision.target, outcome.snapshot, nowIso());
    deps.store.upsert(light);
    session.rows = session.rows.filter((row) => row.key !== light.hostKey);
    return c.json({ light: lightDetail(light, outcome.snapshot, [], attachedProduct(light)).light }, 201);
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
      ...lightDetail(light, null, elements, attachedProduct(light)),
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
    const issues = validateDeclaredRanges(drafts, light.ledCount);
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
    const issues = validateDeclaredRanges(drafts, light.ledCount);
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
    });
    if (reason || !color) {
      return c.json(
        { error: "refused", message: reason ?? APPLY_UNKNOWN_COLOUR_REASON },
        422,
      );
    }
    if (!colors) return c.json({ error: "colour-unknown",
      message: "An unset Segment has no unique fresh WLED colour at its exact range. Choose a colour, then Save before Apply. Nothing was sent." }, 422);
    const rgbw = getStrip(light.stripKind)?.bead === "rgbw";
    if (colors.some((entry) => entry.white && !rgbw)) return c.json({ error: "unsupported-white",
      message: "This Light is not configured as RGBW. White-channel Apply was not sent." }, 422);
    const sent = drafts.map((row) => ({
      label: row.label.trim() || "Untitled",
      start: row.start,
      stop: row.stop,
    }));
    const sentDescription = sent.map((row) => `${row.label} (${row.start}–${row.stop})`).join(", ");
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const planned = applyRangesWrite(sent, previousSegmentCount, color, colors, rgbw);
    if (!planned.ok) {
      return c.json({ error: "refused", message: APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE }, 422);
    }
    try { await captureDevice("pre-apply", light, snap!); }
    catch (error) { return c.json(backupFailure(error), 503); }
    const written = await deps.write(dest, planned.body);
    if (!written) {
      record(light, "apply", "unknown", `Apply write was not confirmed for ${sentDescription}; ranges were not read back.`);
      const outcome = applyUnreadFailed(
        sent,
        "The controller did not take the ranges. Nothing else changed.",
        "controller",
      );
      return c.json(
        {
          error: "write-failed",
          message: outcome.message,
          apply: outcome,
        },
        422,
      );
    }
    const reread = await deps.probe(dest);
    if (reread.kind !== "found") {
      record(light, "apply", "unknown", `Apply sent ${sentDescription}, but the controller did not answer the readback.`);
      const outcome = applyUnreadFailed(
        sent,
        "Wrote, but could not re-read. Not treating as success.",
        "controller",
      );
      return c.json(
        {
          error: "reread-failed",
          message: outcome.message,
          apply: outcome,
        },
        409,
      );
    }
    if (light.mac && (!reread.snapshot.mac || !macsMatch(light.mac, reread.snapshot.mac))) {
      const outcome = applyUnreadFailed(sent, "Apply was sent, but the readback controller identity is missing or changed. Not treating this as success.", "controller");
      record(light, "apply", "unknown", outcome.message);
      return c.json({ error: "controller-changed", message: outcome.message, apply: outcome }, 409);
    }
    const liveRead = await live.read({ ...light, reachability: "online" });
    const source = honestySource(liveRead?.source);
    const read = reread.snapshot.segments;
    const next = lightFromSnapshot(dest, reread.snapshot, nowIso(), light);
    if (read === null) {
      const outcome = applyUnknownSegments(sent, source);
      deps.store.replace(next);
      record(next, "apply", "unknown", `Apply sent ${sentDescription}; controller Segments were not reported. ${outcome.caption}`);
      return c.json(
        {
          error: "reread-unknown-segments",
          message: outcome.message,
          ...(await decorateDetail(next, reread.snapshot)),
          apply: outcome,
        },
        409,
      );
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
      return c.json({ ...(await decorateDetail(next, reread.snapshot)), apply: uncertain, message: uncertain.message }, 409);
    }
    if (outcome.matched) {
      next.lastSnapshot = reread.snapshot;
      next.lastSnapshotAt = next.lastSeenAt;
      next.lastApply = next.mac ? { at: next.lastSeenAt ?? nowIso(), mac: next.mac,
        ledCount: next.ledCount, ranges: sent.map(({ start, stop }) => ({ start, stop })), color,
        ...(reread.snapshot.segmentColors ? { colors } : {}) } : null;
      deps.store.replace(next);
      const elements = persistDrafts(light.id, drafts);
      record(next, "apply", "match", `Applied ${sentDescription}; reported ranges match. ${outcome.caption}`);
      return c.json({
        ...(await decorateDetail(next, reread.snapshot, elements)),
        apply: outcome,
      });
    }
    deps.store.replace(next);
    record(next, "apply", "mismatch", `Applied ${sentDescription}; reported ranges differ. ${outcome.caption}`);
    return c.json(
      {
        ...(await decorateDetail(next, reread.snapshot)),
        apply: outcome,
      },
      409,
    );
  });

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
      try { capture("pre-replacement", stored); }
      catch (error) { return c.json(backupFailure(error), 503); }
      deps.store.replace(next);
      record(next, "replacement", "not-checked",
        `Controller changed from ${stored.hostKey} (${shortMac(stored.mac)}) to ${targetKey} (${shortMac(next.mac)}). Saved Segments stayed on this Light; nothing was Applied.`);
      return c.json({
        ...lightDetail(next, checked.snapshot, deps.store.elementsFor(next.id), attachedProduct(next)),
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
    const next = rememberStripKind(light, provision.settings.ledType);
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
    const draft = await readProvisionBody(c);
    if (!draft) {
      return c.json(
        { error: "invalid", message: "Send { provision: { ledType, length, gpio } }." },
        400,
      );
    }
    const reason = provisionRefuseReason({
      reachable: light.reachability === "online" && snap !== null,
      read: provision,
      busyKind: live.get(light.id)?.kind ?? null,
      draft,
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
            sent: draft,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: reason,
            caption: provision.caption,
          },
        },
        422,
      );
    }
    const built = buildProvisionWrite(draft, raw, provision.fingerprint);
    if (!built.ok) {
      return c.json(
        {
          error: "refused",
          message: built.message,
          provision,
          provisionWrite: {
            status: "refused" as const,
            matched: false,
            sent: draft,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: built.message,
            caption: provision.caption,
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
            sent: built.sent,
            read: provision.settings,
            snapshotLedCount: snap?.ledCount ?? light.ledCount,
            fingerprint: provision.fingerprint,
            message: "The controller did not take strip provision. Nothing else changed.",
            caption: provision.caption,
          },
        },
        422,
      );
    }
    const previousLedCount = snap?.ledCount ?? light.ledCount;
    const rereadRaw = await deps.readCfg(dest);
    const reread = await readProvision(light, snap?.firmware ?? light.firmware, rereadRaw);
    const { light: refreshed, live: nextSnap } = await refreshOne(stored);
    const cfgMatched = provisionFieldsMatch(built.sent, reread.settings);
    const snapMatched = provisionSnapshotMatch(built.sent, nextSnap?.ledCount ?? null);
    const matched = cfgMatched && snapMatched;
    let next = rememberStripKind(refreshed, reread.settings.ledType);
    if (matched && nextSnap) {
      next.lastSnapshot = nextSnap;
      next.lastSnapshotAt = next.lastSeenAt;
      next.lastApply = null; // Strip Apply intentionally changes the controller baseline.
      deps.store.replace(next);
    } else if (nextSnap) {
      deps.store.replace(next);
    }
    let ranges: ReturnType<typeof rangeLengthStory> | null = null;
    if (matched && previousLedCount !== built.sent.length) {
      const reconcile = reconcileDeclaredRangesForLedCount(
        deps.store.elementsFor(light.id),
        previousLedCount,
        built.sent.length,
      );
      if (reconcile.rewritten) {
        deps.store.replaceElements(light.id, reconcile.elements);
      }
      ranges = rangeLengthStory(reconcile);
    }
    const detail = await decorateDetail(next, nextSnap);
    const result = {
      status: matched ? ("matched" as const) : ("mismatch" as const),
      matched,
      sent: built.sent,
      read: reread.settings,
      snapshotLedCount: nextSnap?.ledCount ?? null,
      fingerprint: reread.fingerprint,
      message: provisionMismatchNote(built.sent, reread.settings, nextSnap?.ledCount ?? null),
      caption: reread.caption,
      orderPreserved: built.orderPreserved,
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
  ): Promise<WledStripProvisionDraft | null> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    const raw = (body as { provision?: unknown }).provision;
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (!isProvisionLedType(row.ledType)) return null;
    if (typeof row.length !== "number" || typeof row.gpio !== "number") return null;
    return {
      ledType: row.ledType,
      length: row.length,
      gpio: row.gpio,
    };
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
    return rememberStripKind(light, provision.settings.ledType);
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
    for (const light of stored) {
      const elements = allElements.filter((element) => element.lightId === light.id);
      views.push(lightDetail(light, null, elements, attachedProduct(light)).light);
    }
    const enrolled = new Set(views.map((light) => light.hostKey));
    return {
      lights: views,
      elements: allElements,
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
    const detail = lightDetail(
      light,
      snap,
      elements ?? deps.store.elementsFor(light.id),
      attachedProduct(light),
    );
    const liveRead = snap ? await live.read(light) : null;
    const current = live.get(light.id);
    const elems = elements ?? deps.store.elementsFor(light.id);
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
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown; color?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      if (!validSegmentColor(row.color)) return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
        color: row.color as DraftRange["color"],
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
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown; color?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      if (!validSegmentColor(row.color)) return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
        color: row.color as DraftRange["color"],
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
