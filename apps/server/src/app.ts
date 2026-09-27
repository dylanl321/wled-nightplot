import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CURRENT_SLICE,
  allOffNoAnswerReason,
  allOffSummary,
  APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE,
  applyCaption,
  applyOutcome,
  APPLY_UNKNOWN_COLOUR_REASON,
  applyRefuseReason,
  applyUnknownSegments,
  knownApplyColor,
  snapshotSegmentCount,
  buildDeleteChecks,
  canDelete,
  catalogSnapshot,
  parseLedProductAttach,
  parseLedProductInput,
  resolveLedProductAttach,
  deleteRefuseReason,
  decideProbeAddress,
  displayHost,
  fixtureCaption,
  manageCaption,
  normalizeHostKey,
  parseHexColor,
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
  type DiscoverRow,
  type DraftRange,
  type Element,
  type HostPort,
  type LedProduct,
  type Light,
  type LightDetail,
  type LightView,
  type LightsPayload,
  type LiveEndKind,
  type ReaddressStep,
  type ProvisionRead,
  type SafeRead,
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
import { createLiveEngine } from "./live/engine.ts";
import { FileLedProductsStore } from "./store/led-products-store.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { ProbeFn } from "./wled/client.ts";
import type { ReadCfgFn, WriteCfgFn } from "./wled/cfg.ts";
import { applyRangesWrite, type ReadLiveFn, type WriteStateFn } from "./wled/live.ts";

export type AppDeps = {
  store: FileLightsStore;
  products?: FileLedProductsStore;
  probe: ProbeFn;
  collect: CollectFn;
  write: WriteStateFn;
  readLive: ReadLiveFn;
  readCfg: ReadCfgFn;
  writeCfg: WriteCfgFn;
  now?: () => Date;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const products =
    deps.products ??
    new FileLedProductsStore(join(tmpdir(), `nightplot-led-products-${randomUUID()}.json`));
  const session: { rows: DiscoverRow[] } = { rows: [] };
  const nowIso = () => (deps.now ?? (() => new Date()))().toISOString();
  const live = createLiveEngine({
    write: deps.write,
    readLive: deps.readLive,
    findLight: (id) => deps.store.findById(id),
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

  app.get("/api/led-products", (c) => c.json({ products: products.list() }));

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
    products.create(product);
    return c.json({ product }, 201);
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
    const elements: Element[] = drafts.map((draft, index) => ({
      id:
        draft.id && existingIds.has(draft.id)
          ? draft.id
          : draft.id && looksLikeId(draft.id)
            ? draft.id
            : randomUUID(),
      lightId: light.id,
      label: draft.label.trim() || `Element ${index + 1}`,
      start: draft.start,
      stop: draft.stop,
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
    const color = knownApplyColor(snap?.segmentColor);
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
    const sent = drafts.map((row) => ({
      label: row.label.trim() || "Untitled",
      start: row.start,
      stop: row.stop,
    }));
    const dest: HostPort = { hostname: light.hostname, port: light.port };
    const planned = applyRangesWrite(sent, previousSegmentCount, color);
    if (!planned.ok) {
      return c.json({ error: "refused", message: APPLY_UNKNOWN_PREVIOUS_SEGMENTS_MESSAGE }, 422);
    }
    const written = await deps.write(dest, planned.body);
    if (!written) {
      return c.json(
        {
          error: "write-failed",
          message: "The controller did not take the ranges. Nothing else changed.",
          apply: {
            status: "failed" as const,
            matched: false,
            rows: [],
            sent,
            read: [],
            message: "The controller did not take the ranges. Nothing else changed.",
            caption: applyCaption("controller"),
          },
        },
        422,
      );
    }
    const reread = await deps.probe(dest);
    if (reread.kind !== "found") {
      return c.json(
        {
          error: "reread-failed",
          message: "Wrote, but could not re-read. Not treating as success.",
          apply: {
            status: "failed" as const,
            matched: false,
            rows: [],
            sent,
            read: [],
            message: "Wrote, but could not re-read. Not treating as success.",
            caption: applyCaption("controller"),
          },
        },
        409,
      );
    }
    const liveRead = await live.read({ ...light, reachability: "online" });
    const source = liveRead?.source === "fixture" ? "fixture" : "controller";
    const read = reread.snapshot.segments;
    const next = lightFromSnapshot(dest, reread.snapshot, nowIso(), light);
    if (read === null) {
      const outcome = applyUnknownSegments(sent, source);
      deps.store.replace(next);
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
    if (outcome.matched) {
      next.lastSnapshot = reread.snapshot;
      next.lastSnapshotAt = next.lastSeenAt;
      deps.store.replace(next);
      const elements = persistDrafts(light.id, drafts);
      return c.json({
        ...(await decorateDetail(next, reread.snapshot, elements)),
        apply: outcome,
      });
    }
    deps.store.replace(next);
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
    const { light, live: snap } = await refreshOne(stored);
    const body = await readPreviewBody(c);
    const result = await live.startPreview({
      light,
      live: snap,
      elements: deps.store.elementsFor(light.id),
      elementId: body.elementId,
      color: body.color,
      brightness: body.brightness,
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

  app.post("/api/lights/:id/preview/end", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const restore = (body as { restore?: unknown }).restore;
    const kind: LiveEndKind = restore === false ? "cancel-without-restore" : "complete";
    return endLive(c.req.param("id"), kind);
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
    const { light, live: snap } = await refreshOne(stored);
    const body = await readPreviewBody(c);
    const result = await live.startBlink({
      light,
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
    const result = await live.end(id, kind);
    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
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
      return c.json(
        {
          error: "refused",
          message: reason,
          safe,
          safeWrite: {
            status: "refused" as const,
            matched: false,
            sent: draft,
            read: safe.settings,
            fingerprint: safe.fingerprint,
            message: reason,
            caption: safe.caption,
          },
        },
        422,
      );
    }
    const built = buildSafeWrite(draft, safe.fingerprint);
    if (!built.ok) {
      return c.json({ error: "refused", message: built.message, safe }, 422);
    }
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
      return c.json({ error: "refused", message: built.message, provision }, 422);
    }
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
    noteFixture: () => void,
  ): Promise<AllOffRow> {
    const dest: HostPort = { hostname: stored.hostname, port: stored.port };
    const { light, live: snap, elapsedMs } = await refreshOne(stored);
    const liveRead = snap ? await live.read(light) : null;
    if (liveRead?.source === "fixture") noteFixture();
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
    const cancelled: AllOffCancelled[] = [];
    for (const session of live.list()) {
      if (lightIds?.length && !lightIds.includes(session.lightId)) continue;
      const owner = enrolled.find((light) => light.id === session.lightId);
      await live.end(session.lightId, "cancel-without-restore");
      cancelled.push({
        lightId: session.lightId,
        kind: session.kind,
        label: session.target.label,
        name: owner?.name ?? session.target.label,
      });
    }
    let sawFixture = false;
    // FileLightsStore.replace is a sync read-modify-write, so overlapping Light
    // jobs do not drop a sibling update. Do not invent success across Lights.
    const settled = await mapLimitSettled(targets, ALL_OFF_PROBE_CONCURRENCY, (stored) =>
      allOffOneLight(stored, () => {
        sawFixture = true;
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
    const failedIds = rows
      .filter((row) => row.status === "failed" || row.status === "unknown")
      .map((row) => row.lightId);
    return {
      cancelled,
      restored: false,
      rows,
      failedIds,
      message: allOffSummary(rows, cancelled),
      caption: manageCaption(sawFixture ? "fixture" : "controller"),
    };
  }

  async function readProvision(
    light: Light,
    firmware: string | null,
    raw: unknown,
  ): Promise<ProvisionRead> {
    const liveRead = await live.read(light);
    const source = liveRead?.source === "fixture" ? "fixture" : "controller";
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
    const source = liveRead?.source === "fixture" ? "fixture" : "controller";
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
      caption: manageCaption(liveRead?.source === "fixture" ? "fixture" : "controller"),
      light: (await decorateDetail(light, snap, elements, elapsedMs)).light,
    };
  }

  function attachedProduct(light: Light): LedProduct | null {
    if (!light.ledProductId) return null;
    return products.findById(light.ledProductId) ?? null;
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
      const { light: next, live } = await refreshOne(light);
      const elements = allElements.filter((element) => element.lightId === next.id);
      views.push(lightDetail(next, live, elements, attachedProduct(next)).light);
    }
    const enrolled = new Set(views.map((light) => light.hostKey));
    return {
      lights: views,
      elements: deps.store.loadElements(),
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
      deleteChecks: buildDeleteChecks({
        elementLabels: elems.map((element) => element.label),
        sessionLabel: current?.target.label ?? null,
        reachable: light.reachability === "online" && snap !== null,
        reportedOn: snap?.on ?? null,
        controllerWaitMs,
      }),
      liveLeds: liveRead?.leds ?? null,
      liveCaption: liveRead
        ? fixtureCaption(liveRead.source)
        : current
          ? fixtureCaption(current.source)
          : null,
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
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
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
      const row = item as { id?: unknown; label?: unknown; start?: unknown; stop?: unknown };
      if (typeof row.start !== "number" || typeof row.stop !== "number") return null;
      drafts.push({
        id: typeof row.id === "string" ? row.id : undefined,
        label: typeof row.label === "string" ? row.label : "",
        start: row.start,
        stop: row.stop,
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
      label: draft.label.trim() || `Element ${index + 1}`,
      start: draft.start,
      stop: draft.stop,
    }));
    deps.store.replaceElements(lightId, elements);
    return elements;
  }

  async function readPreviewBody(c: { req: { json: () => Promise<unknown> } }) {
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== "object") {
      return { elementId: null as string | null, color: undefined, brightness: undefined };
    }
    const row = body as { elementId?: unknown; color?: unknown; brightness?: unknown };
    return {
      elementId: typeof row.elementId === "string" ? row.elementId : null,
      color: typeof row.color === "string" ? parseHexColor(row.color) ?? undefined : undefined,
      brightness: typeof row.brightness === "number" ? row.brightness : undefined,
    };
  }

  return app;
}

function looksLikeId(id: string): boolean {
  return id.length > 0 && !id.startsWith("draft-");
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
