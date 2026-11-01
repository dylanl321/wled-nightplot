/**
 * Looks on the real lights: the effects the Lights offer, Preview of a whole
 * Look (temporary, End puts back what was on), Turn on now (a saved preset,
 * read back), what is on now, and copying a Light's current look into a
 * Look. Nothing here writes presets; Send does that.
 */
import {
  FALLBACK_EFFECTS,
  FALLBACK_PALETTES,
  LOOK_OFF_SLOT,
  buildLookPreset,
  intersectEffects,
  isLook,
  lookChangesFor,
  lookTargetsForLook,
  mergeFollowingSections,
  parseWledEffects,
  parseWledPalettes,
  type Light,
  type Look,
  type LookEffectInfo,
  type LookPaletteInfo,
  type LookStyle,
  type WledNativeSegment,
  type WledSnapshot,
} from "@nightplot/shared";
import type { Hono } from "hono";
import { mapLimit } from "./discovery/map-limit.ts";
import type { LookRouteDeps } from "./look-routes.ts";
import { readLooks } from "./look-routes.ts";
import type { ReadWledJsonFn, WledSegWrite, WriteStateFn } from "./wled/live.ts";

export type LookLiveDeps = LookRouteDeps & {
  write: WriteStateFn;
  readJson: ReadWledJsonFn;
  /** Wait between Turn on rereads. Tests pass 0. */
  settleMs?: number;
};

type LiveRow = { lightId: string; lightName: string; status: "matched" | "showing" | "failed" | "refused" | "mismatch" | "unknown"; detail: string };

const CONCURRENCY = 4;

function target(light: Light) {
  return { hostname: light.hostname, port: light.port };
}

function idList(value: unknown): string[] | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function hexOf(rgb: unknown): string {
  if (!Array.isArray(rgb)) return "#000000";
  return `#${[0, 1, 2].map((index) => Math.max(0, Math.min(255, Number(rgb[index]) || 0)).toString(16).padStart(2, "0")).join("")}`;
}

/** A Light's segment as a Look style. */
export function styleFromSegment(segment: WledNativeSegment, bri: number): LookStyle {
  const col = Array.isArray(segment.col) ? segment.col : [];
  const num = (key: string, fallback: number) => (typeof segment[key] === "number" ? (segment[key] as number) : fallback);
  const style: LookStyle = {
    fx: num("fx", 0), pal: num("pal", 0), sx: num("sx", 128), ix: num("ix", 128), bri,
    color: hexOf(col[0]), color2: hexOf(col[1]), color3: hexOf(col[2]),
  };
  if (segment.rev === true) style.dir = "rev";
  if (segment.mi === true) style.dir = "mirror";
  const opacity = num("bri", 255);
  if (opacity !== 255) style.opacity = opacity;
  return style;
}

export function registerLookLiveRoutes(app: Hono, deps: LookLiveDeps) {
  const effectCache = new Map<string, { effects: LookEffectInfo[]; palettes: LookPaletteInfo[] }>();

  async function effectsOf(light: Light) {
    const key = `${light.id}:${light.firmware ?? ""}`;
    const cached = effectCache.get(key);
    if (cached) return cached;
    const [names, fxdata, pal] = await Promise.all([
      deps.readJson(target(light), "/json/eff"),
      deps.readJson(target(light), "/json/fxdata"),
      deps.readJson(target(light), "/json/pal"),
    ]);
    if (!Array.isArray(names) || names.length === 0) return null;
    const result = {
      effects: parseWledEffects(names, Array.isArray(fxdata) ? fxdata : null),
      palettes: Array.isArray(pal) ? parseWledPalettes(pal) : [...FALLBACK_PALETTES],
    };
    effectCache.set(key, result);
    return result;
  }

  app.get("/api/looks/effects", async (c) => {
    const lights = deps.store.load();
    const read = await mapLimit(lights, CONCURRENCY, async (light) => ({ light, list: await effectsOf(light) }));
    const answered = read.filter((row) => row.list);
    if (answered.length === 0) {
      return c.json({ source: "built-in", effects: FALLBACK_EFFECTS, palettes: FALLBACK_PALETTES, missing: [],
        lights: lights.map((light) => ({ lightId: light.id, lightName: light.name, read: false })),
        caption: "No Light answered, so this is WLED's usual list. It may differ from your firmware." });
    }
    const effects = intersectEffects(answered.map((row) => row.list!.effects));
    const missing = answered[0]!.list!.effects
      .filter((row) => !row.hidden && !effects.some((kept) => kept.fx === row.fx))
      .map((row) => ({ fx: row.fx, name: row.name, lights: answered.filter((other) => !other.list!.effects.some((e) => e.fx === row.fx && e.name === row.name)).map((other) => other.light.name) }));
    return c.json({
      source: "lights",
      effects,
      palettes: answered[0]!.list!.palettes,
      missing,
      lights: read.map((row) => ({ lightId: row.light.id, lightName: row.light.name, read: row.list !== null })),
      caption: "Read from the Lights' firmware.",
    });
  });

  function lightsForLook(lightIds: string[] | null): Light[] {
    const lights = deps.store.load();
    const withProps = lights.filter((light) => deps.store.propsFor(light.id).length > 0 || deps.store.elementsFor(light.id).length > 0);
    return lightIds ? withProps.filter((light) => lightIds.includes(light.id)) : withProps;
  }

  async function previewOne(light: Light, look: Look): Promise<LiveRow> {
    const busy = deps.live.get(light.id);
    const ours = busy && deps.live.isLookPreview(light.id);
    let snap: WledSnapshot | null = null;
    let current = light;
    if (!ours) {
      if (busy) return { lightId: light.id, lightName: light.name, status: "refused", detail: "Another Preview or Blink is on this Light. Nothing was sent." };
      const refreshed = await deps.refreshOne(light);
      current = refreshed.light;
      snap = refreshed.live;
      if (!snap || current.reachability !== "online") return { lightId: light.id, lightName: light.name, status: "failed", detail: "Didn't answer. Nothing was sent." };
    }
    const geometry = { ledCount: current.ledCount, elements: deps.store.elementsFor(current.id), props: deps.store.propsFor(current.id) };
    const preset = buildLookPreset(look, lookTargetsForLook(look, geometry), current.rgbw);
    const seg = preset.seg as WledSegWrite[];
    if (typeof snap?.maxSegments === "number" && seg.length > snap.maxSegments) {
      return { lightId: light.id, lightName: light.name, status: "refused",
        detail: `This Look needs ${seg.length} segments here and this Light holds ${snap.maxSegments}. Nothing was sent.` };
    }
    const result = await deps.live.startLook({
      light: current, live: snap, label: look.name, bri: look.style.bri, seg,
      ...(look.transitionTenths !== undefined ? { transition: look.transitionTenths } : {}),
    });
    if (!result.ok) return { lightId: light.id, lightName: light.name, status: result.error === "busy" ? "refused" : "failed", detail: result.message };
    if (!ours) deps.record(current, "preview", "not-checked", `Preview of the Look “${look.name}” started. Temporary, not saved.`);
    return { lightId: light.id, lightName: light.name, status: "showing", detail: result.caption };
  }

  app.post("/api/looks/:id/preview", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lightIds?: unknown; look?: unknown } | null;
    const document = readLooks(deps);
    const saved = document.looks.find((row) => row.id === c.req.param("id"));
    // The Look view sends the Look as it is being edited; edits save a moment later.
    const look = body?.look !== undefined ? (isLook(body.look) ? body.look : null) : saved ?? null;
    if (!look) return c.json({ error: "not_found", message: "That Look is not in the library. Nothing was sent." }, 404);
    const lights = lightsForLook(idList(body?.lightIds));
    if (lights.length === 0) return c.json({ error: "no-lights", message: "No Light has props yet. Nothing was sent." }, 422);
    const rows = await mapLimit(lights, CONCURRENCY, (light) => previewOne(light, look));
    const showing = rows.filter((row) => row.status === "showing").length;
    return c.json({ rows, showing, total: rows.length,
      message: showing === rows.length ? `Previewing on ${showing} Light${showing === 1 ? "" : "s"}.` : `Previewing on ${showing} of ${rows.length} Lights.` });
  });

  app.post("/api/looks/preview/end", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lightIds?: unknown } | null;
    const ids = idList(body?.lightIds);
    const lights = deps.store.load().filter((light) => deps.live.isLookPreview(light.id) && (!ids || ids.includes(light.id)));
    const rows = await mapLimit(lights, CONCURRENCY, async (light): Promise<LiveRow> => {
      const result = await deps.live.end(light.id, "complete");
      if (!result.ok) return { lightId: light.id, lightName: light.name, status: "failed", detail: result.message };
      deps.record(light, "preview", result.restored ? "match" : "not-checked", result.restored ? "Look Preview ended; the previous look was put back." : "Look Preview ended.");
      return { lightId: light.id, lightName: light.name, status: result.restored ? "matched" : "unknown",
        detail: result.restored ? "Put back what was on." : "Ended, but the Light did not confirm it put back what was on." };
    });
    const failed = rows.filter((row) => row.status !== "matched");
    return c.json({ rows, message: failed.length === 0 ? "Preview ended. The lights went back to what they were showing."
      : `Preview ended. ${failed.map((row) => row.lightName).join(", ")} did not confirm it went back.` });
  });

  app.post("/api/looks/turn-on", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { slot?: unknown; lightIds?: unknown } | null;
    const document = readLooks(deps);
    const slot = body?.slot;
    const look = document.looks.find((row) => row.slot === slot);
    const list = document.playlists.find((row) => row.slot === slot);
    if (!look && !list && slot !== LOOK_OFF_SLOT) {
      return c.json({ error: "slot-required", message: "Pick a Look or playlist. Nothing was sent." }, 400);
    }
    const name = look?.name ?? (list ? `${list.name} playlist` : "Off");
    const key = look ? `look:${look.id}` : list ? `playlist:${list.id}` : null;
    const ids = idList(body?.lightIds);
    const lights = deps.store.load().filter((light) => !ids || ids.includes(light.id));
    const rows = await mapLimit(lights, CONCURRENCY, async (stored): Promise<LiveRow> => {
      const base = { lightId: stored.id, lightName: stored.name };
      if (key && lookChangesFor(document, stored.lastLookPush).some((row) => row.key === key)) {
        return { ...base, status: "refused", detail: `${name} is not on this Light yet. Send first. Nothing was turned on.` };
      }
      const release = deps.live.block(stored.id);
      try {
        await deps.live.settle(stored.id);
        if (deps.live.get(stored.id)) return { ...base, status: "refused", detail: "End Preview or Blink on this Light first. Nothing was turned on." };
        if (!(await deps.write(target(stored), { ps: slot as number }))) return { ...base, status: "failed", detail: "Didn't answer. Nothing was turned on." };
        let after: WledSnapshot | null = null;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? 250));
          after = (await deps.refreshOne(deps.store.findById(stored.id) ?? stored)).live;
          if (!after) continue;
          if (slot === LOOK_OFF_SLOT ? after.on === false || after.preset === slot : after.preset === slot || after.playlist === slot) {
            return { ...base, status: "matched", detail: `Reports ${name}.` };
          }
        }
        return after
          ? { ...base, status: "mismatch", detail: `Sent ${name}, but it reports ${after.playlist ? `playlist ${after.playlist}` : after.preset ? `preset ${after.preset}` : "no preset"}.` }
          : { ...base, status: "unknown", detail: `Sent ${name}, but it did not answer the reread.` };
      } finally {
        release();
      }
    });
    for (const done of rows) {
      const light = deps.store.findById(done.lightId);
      if (light) deps.record(light, "sync", done.status === "matched" ? "match" : done.status === "mismatch" ? "mismatch" : done.status === "unknown" ? "unknown" : "not-checked", `Turn on ${name}: ${done.detail}`);
    }
    const ok = rows.filter((row) => row.status === "matched").length;
    return c.json({ rows, message: ok === rows.length ? `${name} is on now.` : `${name} is on ${ok} of ${rows.length} Lights.` });
  });

  /** Last `leds.maxseg` each Light reported, for rows read while it previews. */
  const maxSegmentsSeen = new Map<string, number>();

  app.get("/api/looks/now", async (c) => {
    const document = readLooks(deps);
    const lights = deps.store.load();
    const rows = await mapLimit(lights, CONCURRENCY, async (stored) => {
      const previewing = deps.live.isLookPreview(stored.id);
      const { light, live } = previewing ? { light: stored, live: null } : await deps.refreshOne(stored);
      const preset = live?.preset;
      const playlist = live?.playlist;
      if (typeof live?.maxSegments === "number") maxSegmentsSeen.set(light.id, live.maxSegments);
      // Segments each Look needs here, counted the way Send counts them.
      const geometry = { ledCount: light.ledCount, elements: deps.store.elementsFor(light.id), props: deps.store.propsFor(light.id) };
      const segments = Object.fromEntries(document.looks.map((look) => [look.id, mergeFollowingSections(look, lookTargetsForLook(look, geometry)).length]));
      return {
        lightId: light.id,
        lightName: light.name,
        online: previewing || (live !== null && light.reachability === "online"),
        previewing,
        on: live?.on ?? null,
        lookId: document.looks.find((row) => row.slot === preset)?.id ?? null,
        playlistId: document.playlists.find((row) => row.slot === playlist)?.id ?? null,
        preset: preset ?? null,
        playlist: playlist ?? null,
        changes: lookChangesFor(document, light.lastLookPush),
        lastSentAt: light.lastLookPush?.at ?? null,
        maxSegments: maxSegmentsSeen.get(light.id) ?? null,
        segments,
      };
    });
    return c.json({ rows, at: new Date().toISOString() });
  });

  /** What a Light shows now, as styles: one per prop that has lights on this Light. */
  app.post("/api/looks/capture", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { lightId?: unknown } | null;
    const stored = typeof body?.lightId === "string" ? deps.store.findById(body.lightId) : undefined;
    if (!stored) return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    if (deps.live.get(stored.id)) return c.json({ error: "busy", message: "End Preview on this Light first, so Nightplot reads what it really shows." }, 422);
    const { light, live } = await deps.refreshOne(stored);
    if (!live) return c.json({ error: "offline", message: `${light.name} didn't answer.` }, 503);
    const native = live.nativeRestore;
    if (!native) {
      return c.json({ error: "unreadable", message: live.nativeRestoreUnavailable === "playlist"
        ? `${light.name} is running a playlist. Stop it in WLED on the look you want, then try again.`
        : `${light.name} did not report its segments.` }, 422);
    }
    const lit = native.seg.filter((segment) => segment.stop > segment.start);
    const main = lit.find((segment) => segment.on !== false) ?? lit[0];
    if (!main) return c.json({ error: "unreadable", message: `${light.name} has no segments to copy.` }, 422);
    const geometry = { ledCount: light.ledCount, elements: deps.store.elementsFor(light.id), props: deps.store.propsFor(light.id) };
    const props = geometry.props.map((prop) => {
      const owned = geometry.elements.filter((element) => prop.elementIds.includes(element.id));
      const first = owned.sort((a, b) => a.start - b.start)[0];
      const segment = first ? lit.find((row) => first.start >= row.start && first.start < row.stop) : undefined;
      return { propId: prop.id, off: segment ? segment.on === false : true, style: segment ? styleFromSegment(segment, native.bri) : null };
    });
    return c.json({ lightId: light.id, lightName: light.name, on: native.on, style: styleFromSegment(main, native.bri), props,
      message: `Read ${lit.length} segment${lit.length === 1 ? "" : "s"} from ${light.name}.` });
  });
}

