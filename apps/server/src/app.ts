import { randomUUID } from "node:crypto";
import {
  CURRENT_SLICE,
  catalogSnapshot,
  decideProbeAddress,
  normalizeHostKey,
  validateDeclaredRanges,
  type DiscoverRow,
  type DraftRange,
  type Element,
  type HostPort,
  type Light,
  type LightView,
  type LightsPayload,
  type WledSnapshot,
} from "@nightplot/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CollectFn } from "./discovery/collect.ts";
import {
  lightDetail,
  lightFromSnapshot,
  markUnreachable,
  refusedRow,
  rowFromProbe,
} from "./domain.ts";
import type { FileLightsStore } from "./store/lights-store.ts";
import type { ProbeFn } from "./wled/client.ts";

export type AppDeps = {
  store: FileLightsStore;
  probe: ProbeFn;
  collect: CollectFn;
  now?: () => Date;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const session: { rows: DiscoverRow[] } = { rows: [] };
  const nowIso = () => (deps.now ?? (() => new Date()))().toISOString();

  app.use(
    "*",
    cors({
      origin: ["http://127.0.0.1:43180", "http://localhost:43180"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "nightplot-configure",
      slice: CURRENT_SLICE,
    }),
  );

  app.get("/api/catalogs", (c) => c.json(catalogSnapshot()));

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
    const rows: DiscoverRow[] = [];

    for (const item of collected) {
      const decision = decideProbeAddress(
        item.port === 80 ? item.hostname : `${item.hostname}:${item.port}`,
      );
      if (!decision.ok) {
        rows.push(refusedRow(item.hostname, item.via, now, decision.reason));
        continue;
      }
      const key = normalizeHostKey(decision.target);
      if (enrolled.has(key)) {
        const light = deps.store.findByHostKey(key);
        rows.push({
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
        });
        continue;
      }
      const outcome = await deps.probe(decision.target);
      rows.push(rowFromProbe(decision.target, item.via, outcome, now, false));
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
    return c.json({ light: lightDetail(light, outcome.snapshot, []).light }, 201);
  });

  app.get("/api/lights/:id", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live } = await refreshOne(stored);
    return c.json(lightDetail(light, live, deps.store.elementsFor(light.id)));
  });

  app.patch("/api/lights/:id/elements", async (c) => {
    const stored = deps.store.findById(c.req.param("id"));
    if (!stored) {
      return c.json({ error: "not_found", message: "That Light is not on Lights." }, 404);
    }
    const { light, live } = await refreshOne(stored);
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
    return c.json(lightDetail(light, live, elements));
  });

  function notWired(action: string) {
    return {
      error: "not_implemented",
      action,
      slice: CURRENT_SLICE,
      message: `${action} is a placeholder. Nothing was sent to hardware.`,
    };
  }

  app.post("/api/preview", (c) => c.json(notWired("preview"), 501));
  app.post("/api/apply", (c) => c.json(notWired("apply"), 501));
  app.post("/api/all-off", (c) => c.json(notWired("all-off"), 501));

  async function refreshOne(
    stored: Light,
  ): Promise<{ light: Light; live: WledSnapshot | null }> {
    const target: HostPort = { hostname: stored.hostname, port: stored.port };
    const outcome = await deps.probe(target);
    if (outcome.kind === "found") {
      const next = lightFromSnapshot(target, outcome.snapshot, nowIso(), stored);
      deps.store.replace(next);
      return { light: next, live: outcome.snapshot };
    }
    const next = markUnreachable(stored);
    deps.store.replace(next);
    return { light: next, live: null };
  }

  async function listLights(): Promise<LightsPayload> {
    const stored = deps.store.load();
    const views: LightView[] = [];
    const allElements = deps.store.loadElements();
    for (const light of stored) {
      const { light: next, live } = await refreshOne(light);
      const elements = allElements.filter((element) => element.lightId === next.id);
      views.push(lightDetail(next, live, elements).light);
    }
    const enrolled = new Set(views.map((light) => light.hostKey));
    return {
      lights: views,
      elements: deps.store.loadElements(),
      unenrolled: session.rows.filter(
        (row) => row.status === "found" && !enrolled.has(row.key),
      ),
      note:
        views.length === 0
          ? "No Lights are enrolled."
          : undefined,
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
    segments: [],
  };
}
