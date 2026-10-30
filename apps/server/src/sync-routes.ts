import {
  SYNC_CAPTION,
  buildSyncLookWrite,
  isPresetId,
  parseWledPresets,
  presetsMatch,
  syncLookMatches,
  syncSummary,
  syncWarnings,
  type ActivityEntry,
  type BackupDocument,
  type HostPort,
  type Light,
  type SyncKind,
  type SyncResult,
  type SyncRow,
  type SyncWarning,
  type WledSnapshot,
} from "@nightplot/shared";
import type { Hono } from "hono";
import type { createLiveEngine } from "./live/engine.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { WriteStateFn } from "./wled/live.ts";
import type { ReadWledPresets, WriteWledPresets } from "./wled/native-backup.ts";

export type SyncRouteDeps = {
  store: FileLightsStore;
  live: ReturnType<typeof createLiveEngine>;
  write: WriteStateFn;
  readPresets: ReadWledPresets;
  writePresets: WriteWledPresets;
  refreshOne: (stored: Light) => Promise<{ light: Light; live: WledSnapshot | null }>;
  captureDevice: (reason: "pre-sync", light: Light, snap: WledSnapshot) => Promise<BackupDocument>;
  record: (light: Pick<Light, "id" | "name">, action: ActivityEntry["action"],
    readback: ActivityEntry["readback"], detail: string) => void;
  /** Wait between preset rereads; WLED applies `ps` on its next loop. */
  presetSettleMs?: number;
};

type Online = { light: Light; snap: WledSnapshot };
type Prepared = { online: Online[]; rows: SyncRow[] };

const BUSY = "End Preview or Blink on this Light first. Nothing was sent.";
const OFFLINE = "WLED did not answer. Nothing was sent.";

function target(light: Light): HostPort {
  return { hostname: light.hostname, port: light.port };
}

function row(light: Pick<Light, "id" | "name">, status: SyncRow["status"], detail: string,
  safetyBackupId?: string): SyncRow {
  return { lightId: light.id, lightName: light.name, status, detail, ...(safetyBackupId ? { safetyBackupId } : {}) };
}

function readback(status: SyncRow["status"]): ActivityEntry["readback"] {
  return status === "matched" ? "match" : status === "mismatch" ? "mismatch" : status === "unknown" ? "unknown" : "not-checked";
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((id): id is string => typeof id === "string" && id.length > 0);
  return out.length === value.length ? [...new Set(out)] : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/**
 * On-demand Sync: Copy presets, Copy colours and effects, Turn on preset.
 * Every target is refreshed first; offline or busy Lights are listed, never
 * skipped silently. Only Copy presets is a lasting WLED file write, so only it
 * takes a native safety backup first.
 */
export function registerSyncRoutes(app: Hono, deps: SyncRouteDeps) {
  async function prepare(targetIds: string[]): Promise<Prepared> {
    const online: Online[] = [];
    const rows: SyncRow[] = [];
    for (const id of targetIds) {
      const stored = deps.store.findById(id);
      if (!stored) { rows.push({ lightId: id, lightName: id, status: "refused", detail: "That Light is not on Lights. Nothing was sent." }); continue; }
      if (deps.live.get(stored.id)) { rows.push(row(stored, "refused", BUSY)); continue; }
      const { light, live: snap } = await deps.refreshOne(stored);
      if (!snap || light.reachability !== "online") { rows.push(row(light, "failed", OFFLINE)); continue; }
      online.push({ light, snap });
    }
    return { online, rows };
  }

  async function withLight<T>(light: Light, work: () => Promise<T>): Promise<T | "busy"> {
    const release = deps.live.block(light.id);
    try {
      await deps.live.settle(light.id);
      if (deps.live.get(light.id)) return "busy";
      return await work();
    } finally { release(); }
  }

  function finish(kind: SyncKind, sourceLightId: string | null, rows: SyncRow[]): SyncResult {
    return { kind, sourceLightId, rows, message: syncSummary(kind, rows), caption: SYNC_CAPTION };
  }

  async function source(id: unknown) {
    if (typeof id !== "string") return { error: { error: "source-required", message: "Choose the Light to copy from. Nothing was sent." }, status: 400 as const };
    const stored = deps.store.findById(id);
    if (!stored) return { error: { error: "not_found", message: "The source Light is not on Lights." }, status: 404 as const };
    const { light, live: snap } = await deps.refreshOne(stored);
    if (!snap || light.reachability !== "online")
      return { error: { error: "unreachable", message: `${light.name} did not answer. Nothing was sent.` }, status: 503 as const };
    return { light, snap };
  }

  function needsConfirm(warnings: SyncWarning[], confirmed: unknown) {
    return warnings.length > 0 && confirmed !== true;
  }

  app.get("/api/sync/presets/:id", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    try {
      const parsed = parseWledPresets(await deps.readPresets(target(stored)));
      if (!parsed.ok) return c.json({ error: "presets-unreadable", message: parsed.message }, 502);
      return c.json({ lightId: stored.id, presets: parsed.presets });
    } catch (error) {
      return c.json({ error: "unreachable", message: `WLED presets did not load. ${message(error)}`.trim() }, 503);
    }
  });

  app.post("/api/sync/presets", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      { sourceLightId?: unknown; targetLightIds?: unknown; confirmWarnings?: unknown } | null;
    const targetIds = ids(body?.targetLightIds)?.filter((id) => id !== body?.sourceLightId);
    if (!targetIds?.length) return c.json({ error: "targets-required", message: "Choose at least one other Light. Nothing was sent." }, 400);
    const from = await source(body?.sourceLightId);
    if ("error" in from) return c.json(from.error, from.status);
    let raw: string;
    try { raw = await deps.readPresets(target(from.light)); }
    catch (error) { return c.json({ error: "presets-unreadable", message: `${from.light.name} presets did not load. ${message(error)} Nothing was sent.` }, 502); }
    const parsed = parseWledPresets(raw);
    if (!parsed.ok) return c.json({ error: "presets-unreadable", message: `${parsed.message} Nothing was sent.` }, 502);

    const { online, rows } = await prepare(targetIds);
    const warnings = online.flatMap(({ light, snap }) => syncWarnings({ kind: "presets",
      source: { ledCount: from.snap.ledCount, firmware: from.snap.firmware, segmentCount: null },
      target: { lightId: light.id, lightName: light.name, ledCount: snap.ledCount, firmware: snap.firmware, segmentCount: null } }));
    if (needsConfirm(warnings, body?.confirmWarnings))
      return c.json({ error: "confirm-warnings", warnings, rows, presetCount: parsed.presets.length,
        message: "Review these differences, then confirm. Nothing was sent." }, 409);

    for (const { light, snap } of online) {
      const result = await withLight(light, async (): Promise<SyncRow> => {
        let safety: BackupDocument;
        try { safety = await deps.captureDevice("pre-sync", light, snap); }
        catch (error) { return row(light, "failed", `Safety backup failed: ${message(error)} Nothing was sent.`); }
        try { await deps.writePresets(target(light), raw); }
        catch (error) { return row(light, "failed", `WLED did not take presets.json. ${message(error)}`.trim(), safety.id); }
        let after: string;
        try { after = await deps.readPresets(target(light)); }
        catch { return row(light, "unknown", "Uploaded, but presets.json did not reread. Not treating as a match.", safety.id); }
        return presetsMatch(raw, after)
          ? row(light, "matched", `Reports the same ${parsed.presets.length} presets as ${from.light.name}.`, safety.id)
          : row(light, "mismatch", "Uploaded, but presets.json reads back different. Not treating as a match.", safety.id);
      });
      const done = result === "busy" ? row(light, "refused", BUSY) : result;
      rows.push(done);
      deps.record(light, "sync", readback(done.status), `Copy presets from ${from.light.name}: ${done.detail}`);
    }
    return c.json(finish("presets", from.light.id, rows));
  });

  app.post("/api/sync/look", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      { sourceLightId?: unknown; targetLightIds?: unknown; confirmWarnings?: unknown } | null;
    const targetIds = ids(body?.targetLightIds)?.filter((id) => id !== body?.sourceLightId);
    if (!targetIds?.length) return c.json({ error: "targets-required", message: "Choose at least one other Light. Nothing was sent." }, 400);
    const from = await source(body?.sourceLightId);
    if ("error" in from) return c.json(from.error, from.status);
    const look = from.snap.nativeRestore;
    if (!look) {
      const why = from.snap.nativeRestoreUnavailable === "playlist" ? "is running a playlist"
        : from.snap.nativeRestoreUnavailable === "frozen" ? "has frozen segments" : "did not report its full segment state";
      return c.json({ error: "source-look-unknown", message: `${from.light.name} ${why}, so its look cannot be copied. Nothing was sent.` }, 422);
    }

    const { online, rows } = await prepare(targetIds);
    const warnings = online.flatMap(({ light, snap }) => syncWarnings({ kind: "look",
      source: { ledCount: from.snap.ledCount, firmware: from.snap.firmware, segmentCount: look.seg.length },
      target: { lightId: light.id, lightName: light.name, ledCount: snap.ledCount, firmware: snap.firmware,
        segmentCount: snap.nativeRestore?.seg.length ?? null } }));
    if (needsConfirm(warnings, body?.confirmWarnings))
      return c.json({ error: "confirm-warnings", warnings, rows, message: "Review these differences, then confirm. Nothing was sent." }, 409);

    for (const { light, snap } of online) {
      const result = await withLight(light, async (): Promise<SyncRow> => {
        const own = snap.nativeRestore;
        const sent = own ? buildSyncLookWrite(look, own, snap.rgbw) : null;
        if (!own || !sent) return row(light, "refused", "This Light’s WLED segments could not be read. Nothing was sent.");
        const geometry = new Map(own.seg.map((segment) => [segment.id, segment]));
        const ok = await deps.write(target(light), { on: sent.on, bri: sent.bri,
          seg: sent.seg.map((segment) => ({ ...segment, start: geometry.get(segment.id)!.start, stop: geometry.get(segment.id)!.stop })) });
        if (!ok) return row(light, "failed", "WLED did not accept the state write.");
        const { live: after } = await deps.refreshOne(deps.store.findById(light.id) ?? light);
        const matched = syncLookMatches(sent, after?.nativeRestore);
        return matched === true ? row(light, "matched", `Reports ${from.light.name}’s colours and effects.`)
          : matched === false ? row(light, "mismatch", "Wrote, but the reread look differs. Not treating as a match.")
            : row(light, "unknown", "Wrote, but the reread did not report full segment state. Not treating as a match.");
      });
      const done = result === "busy" ? row(light, "refused", BUSY) : result;
      rows.push(done);
      deps.record(light, "sync", readback(done.status), `Copy colours and effects from ${from.light.name}: ${done.detail}`);
    }
    return c.json(finish("look", from.light.id, rows));
  });

  app.post("/api/sync/preset", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lightIds?: unknown; presetId?: unknown } | null;
    const lightIds = ids(body?.lightIds);
    if (!lightIds?.length) return c.json({ error: "targets-required", message: "Choose at least one Light. Nothing was sent." }, 400);
    const presetId = body?.presetId;
    if (!isPresetId(presetId)) return c.json({ error: "preset-required", message: "Choose a WLED preset 1–250. Nothing was sent." }, 400);

    const { online, rows } = await prepare(lightIds);
    for (const { light } of online) {
      const result = await withLight(light, async (): Promise<SyncRow> => {
        let presets;
        try { presets = parseWledPresets(await deps.readPresets(target(light))); }
        catch (error) { return row(light, "failed", `WLED presets did not load. ${message(error)} Nothing was sent.`); }
        if (!presets.ok) return row(light, "failed", `${presets.message} Nothing was sent.`);
        const preset = presets.presets.find((entry) => entry.id === presetId);
        if (!preset) return row(light, "refused", `This Light has no preset ${presetId}. Copy presets first. Nothing was sent.`);
        if (!(await deps.write(target(light), { ps: presetId }))) return row(light, "failed", "WLED did not accept the preset select.");
        let reported: number | undefined;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, deps.presetSettleMs ?? 250));
          const { live: after } = await deps.refreshOne(deps.store.findById(light.id) ?? light);
          if (!after) return row(light, "unknown", "Sent, but WLED did not answer the reread.");
          reported = after.preset;
          if (reported === presetId) return row(light, "matched", `Reports preset ${presetId} “${preset.name}”.`);
        }
        return reported === undefined
          ? row(light, "unknown", `Sent preset ${presetId}, but WLED reports no active preset. Not treating as a match.`)
          : row(light, "mismatch", `Sent preset ${presetId}, but WLED reports preset ${reported}.`);
      });
      const done = result === "busy" ? row(light, "refused", BUSY) : result;
      rows.push(done);
      deps.record(light, "sync", readback(done.status), `Turn on preset ${presetId}: ${done.detail}`);
    }
    return c.json(finish("preset", null, rows));
  });
}
