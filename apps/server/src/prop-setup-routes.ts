import { randomUUID } from "node:crypto";
import {
  compilePropDesign,
  defaultSections,
  designFromLayout,
  isPropDesign,
  isPropLayout,
  parsePropKind,
  parsePropSections,
  planPropPlacement,
  validateDeclaredRangesForLight,
  defaultWireframeSpec,
  type DraftRange,
  type Element,
  type Light,
  type Prop,
  type PropAttachment,
  type PropMeasurements,
  type WledSnapshot,
} from "@nightplot/shared";
import type { Hono } from "hono";
import type { FileLightsStore } from "./store/lights-store.ts";
import { persistWireframeOnLight } from "./wireframe-persist.ts";

export type PropSetupDeps = {
  store: FileLightsStore;
  palette: () => readonly { hex: string }[];
  refresh: (stored: Light) => Promise<{ light: Light; live: WledSnapshot | null }>;
  applyDrafts: (
    light: Light,
    snap: WledSnapshot | null,
    drafts: DraftRange[],
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Ends a Blink on this Light when one is open, so Apply is not stuck behind it. */
  endBlink?: (lightId: string) => Promise<void>;
};

export function registerPropSetupRoutes(app: Hono, deps: PropSetupDeps) {
  app.get("/api/props", (c) => {
    return c.json({ props: deps.store.loadProps(), attachments: deps.store.loadAttachments() });
  });

  app.post("/api/props", async (c) => {
    const row = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const label = typeof row?.label === "string" ? row.label.trim().slice(0, 64) : "";
    const kind = parsePropKind(row?.kind);
    const unit = row?.unit === "m" || row?.unit === "ft" ? row.unit : null;
    const pitchMm = typeof row?.pitchMm === "number" ? row.pitchMm : 100;
    const ledProductId = typeof row?.ledProductId === "string" && row.ledProductId.trim()
      ? row.ledProductId.trim()
      : null;
    if (!label || !kind || !unit) {
      return c.json({ error: "invalid", message: "Send a name and a shape. Nothing was saved." }, 400);
    }
    const measurements = isMeasurements(row?.measurements) ? row.measurements : null;
    const layout = isPropLayout(row?.layout) ? row.layout : null;
    if (!measurements && !layout) {
      return c.json({ error: "invalid", message: "Send the measurements or the drawing. Nothing was saved." }, 400);
    }
    if ((kind === "custom" || measurements?.shape === "custom") && !layout) {
      return c.json({ error: "custom-later", message: "Draw the prop, then save. Nothing was saved." }, 422);
    }
    const fromDrawing = layout
      ? designFromLayout(layout, ledProductId, measurements ?? { shape: "custom" })
      : null;
    if (fromDrawing && !isPropDesign(fromDrawing)) {
      return c.json({ error: "invalid-shape", message: "That drawing could not be saved." }, 422);
    }
    const built = fromDrawing || !measurements ? null : compilePropDesign({
      kind,
      unit,
      pitchMm,
      ledProductId,
      measurements,
    });
    if (!fromDrawing && (!built || !built.ok)) {
      return c.json({ error: "invalid-shape", message: built && !built.ok ? built.message : "Those measurements could not be saved." }, 422);
    }
    const storedLayout = layout ?? (built && built.ok ? built.layout : null);
    const sections = row?.sections === undefined
      ? (storedLayout ? defaultSections(storedLayout) : built && built.ok ? built.sections : [])
      : parsePropSections(row.sections);
    if (row?.sections !== undefined && !sections) {
      return c.json({ error: "invalid-sections", message: "Those sections could not be read. Nothing was saved." }, 400);
    }
    const prop: Prop = {
      id: randomUUID(),
      label,
      kind,
      elementIds: [],
      design: fromDrawing ?? (built && built.ok ? built.design : undefined),
      ...(storedLayout ? { layout: storedLayout } : {}),
      ...(sections ? { sections } : {}),
      ...(kind === "wireframe" && measurements?.shape === "wireframe"
        ? { wireframe: defaultWireframeSpec({ sides: measurements.sides, pitchMm }) }
        : built && built.ok && built.wireframe ? { wireframe: built.wireframe } : {}),
    };
    if (!prop.design) {
      return c.json({ error: "invalid-shape", message: "That drawing could not be saved." }, 422);
    }
    deps.store.saveDesignedProp(prop);
    return c.json({
      prop,
      message: "Prop saved in Nightplot. It is not attached to a controller, and nothing was sent.",
    });
  });

  app.patch("/api/props/:id", async (c) => {
    const existing = deps.store.loadProps().find((row) => row.id === c.req.param("id"));
    if (!existing) return c.json({ error: "not_found", message: "That prop is not in the yard." }, 404);
    const row = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!isPropLayout(row?.layout)) {
      return c.json({ error: "invalid", message: "Send the drawing. Nothing was saved." }, 400);
    }
    const measurements = isMeasurements(row?.measurements)
      ? row.measurements
      : existing.design?.measurements ?? { shape: "custom" as const };
    const design = designFromLayout(row.layout, existing.design?.ledProductId ?? null, measurements);
    if (!isPropDesign(design)) {
      return c.json({ error: "invalid-shape", message: "That drawing could not be saved." }, 422);
    }
    const sections = row?.sections === undefined ? existing.sections : parsePropSections(row.sections);
    if (row?.sections !== undefined && !sections) {
      return c.json({ error: "invalid-sections", message: "Those sections could not be read. Nothing was saved." }, 400);
    }
    const prop: Prop = {
      ...existing,
      design,
      layout: row.layout,
      ...(sections ? { sections } : {}),
    };
    deps.store.saveDesignedProp(prop);
    return c.json({ prop, message: "Prop saved in Nightplot. Nothing was sent to a controller." });
  });

  app.post("/api/props/:id/attach", async (c) => {
    const prop = deps.store.loadProps().find((row) => row.id === c.req.param("id"));
    if (!prop?.design) {
      return c.json({ error: "not_found", message: "That prop is not in the yard." }, 404);
    }
    const row = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const lightId = typeof row?.lightId === "string" ? row.lightId : "";
    const outputId = typeof row?.outputId === "string" ? row.outputId : "";
    const startIndex = typeof row?.startIndex === "number" ? row.startIndex : null;
    const afterPropId = typeof row?.afterPropId === "string" && row.afterPropId ? row.afterPropId : null;
    const apply = row?.apply === true;
    if ((startIndex === null) === (afterPropId === null)) {
      return c.json({ error: "invalid", message: "Choose the start of this output, or a prop to follow. Nothing was sent." }, 400);
    }
    const stored = deps.store.findById(lightId);
    if (!stored) return c.json({ error: "not_found", message: "That controller is not connected. Nothing was sent." }, 404);
    const { light, live } = await deps.refresh(stored);
    const output = (light.outputs ?? []).find((item) => item.id === outputId);
    if (!output) return c.json({ error: "invalid", message: "That output is not on this controller. Nothing was sent." }, 422);
    const props = deps.store.loadProps();
    const attachments = deps.store.loadAttachments();
    const plan = planPropPlacement({
      prop,
      output,
      lightName: light.name,
      place: { startIndex, afterPropId },
      props,
      attachments,
    });
    if (!plan.ok) return c.json({ error: "wont-fit", message: plan.message }, 422);

    if (prop.kind === "wireframe" && !(prop.sections && prop.sections.length > 0)) {
      const whole = !afterPropId && startIndex === 0 && output.start === 0 &&
        output.ledCount === light.ledCount && prop.design.ledCount === light.ledCount;
      if (!whole || !prop.wireframe) {
        const count = prop.design.ledCount ?? "an unknown number of";
        return c.json({
          error: "wont-fit",
          message: `A well house is mapped across the whole controller. This one needs ${count} lights and ${light.name} reports ${light.ledCount}. Nothing was sent.`,
        }, 422);
      }
      const saved = persistWireframeOnLight({
        store: deps.store,
        light,
        propId: prop.id,
        label: prop.label,
        spec: prop.wireframe,
        design: prop.design,
        palette: deps.palette(),
      });
      if (!saved.ok) return c.json({ error: "invalid-wireframe", message: saved.message }, 422);
      if (!apply) {
        return c.json({ prop: saved.prop, summary: plan.summary, message: "Prop saved in Nightplot. Apply was not sent." });
      }
      const drafts = saved.elements.map(toDraft);
      const result = await deps.applyDrafts(light, live, drafts);
      return c.json({ ...result.body, prop: saved.prop, summary: plan.summary }, statusOf(result.status));
    }

    const palette = deps.palette();
    const previousIds = new Set(prop.elementIds);
    const kept = deps.store.elementsFor(light.id).filter((element) => !previousIds.has(element.id));
    const created: Element[] = plan.segments.map((segment, index) => ({
      id: randomUUID(),
      lightId: light.id,
      label: segment.label,
      start: segment.start,
      stop: segment.stop,
      color: {
        hex: isHex(segment.color) ? segment.color : palette[index % palette.length]!.hex,
        white: 0,
      },
      ...(segment.outputId ? { outputId: segment.outputId } : {}),
    }));
    const merged = [...kept, ...created];
    const issues = validateDeclaredRangesForLight(merged, { ledCount: light.ledCount, outputs: light.outputs });
    if (issues.length > 0) {
      return c.json({ error: issues[0]!.code, message: issues[0]!.message, issues }, 422);
    }
    const attachment: PropAttachment = {
      propId: prop.id,
      lightId: light.id,
      outputId: output.id,
      startIndex,
      afterPropId,
    };
    const next: Prop = { ...prop, lightId: light.id, elementIds: created.map((element) => element.id) };
    if (!apply) {
      deps.store.attachProp(next, attachment, merged);
      return c.json({
        prop: next,
        summary: plan.summary,
        message: "Prop saved in Nightplot. Apply was not sent.",
      });
    }
    deps.store.attachProp(next, attachment, merged);
    if (deps.endBlink) await deps.endBlink(light.id);
    const fresh = await deps.refresh(light);
    const result = await deps.applyDrafts(fresh.light, fresh.live, merged.map(toDraft));
    return c.json({ ...result.body, prop: next, summary: plan.summary }, statusOf(result.status));
  });
}

function statusOf(status: number): 200 | 409 | 422 | 503 {
  if (status === 200 || status === 409 || status === 422 || status === 503) return status;
  return 422;
}

function isHex(value: string | undefined): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function toDraft(element: Element): DraftRange {
  return {
    id: element.id,
    label: element.label,
    start: element.start,
    stop: element.stop,
    ...(element.color ? { color: element.color } : {}),
    ...(element.outputId ? { outputId: element.outputId } : {}),
  };
}

function isMeasurements(value: unknown): value is PropMeasurements {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shape = (value as { shape?: unknown }).shape;
  return shape === "roofline" || shape === "window" || shape === "arch" || shape === "tree" ||
    shape === "stake-row" || shape === "wireframe" || shape === "custom" || shape === "legacy";
}
