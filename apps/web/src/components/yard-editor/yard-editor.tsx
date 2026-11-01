"use client";

/**
 * The one-page yard editor. The yard is home and shows every prop. Building
 * or editing a prop opens its own clean canvas (Save / Cancel) and returns
 * to the yard; a new prop comes back as an outline to place. A Look is the
 * yard in that Look's colours (changes save as you go, Done returns).
 *
 * Ported from docs/prototypes/yard-page.html (v4). Editor state lives in one
 * ref, as in the prototype, so a drag or pinch redraws the canvas without a
 * React render; `render()` re-renders the panels.
 */
import {
  countLayout,
  formatLength,
  LOOK_EFFECTS,
  layoutBox,
  layoutStrings,
  METRES_PER_FOOT,
  planPropPlacement,
  propAttachmentLabel,
  snapStepM,
  yardPlacements,
  yardSetupSteps,
  type Light,
  type LayoutUnits,
  type LightView,
  type Look,
  type LooksDocument,
  type Prop,
  type PropAttachment,
  type PropLayout,
  type PropSection,
} from "@nightplot/shared";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { AllOffControl, type LiveHint } from "@/components/all-off-control";
import { deleteJson, patchJson, postJson, putJson } from "@/lib/api";
import { ColourInput, CommitField } from "./fields";
import {
  addPoint,
  addSection,
  countRunFromLength,
  deleteSection,
  dragCorner,
  draftFromProp,
  freeSlot,
  isAutoName,
  kindOfShape,
  lightTotal,
  measurementsOf,
  newDraft,
  nextName,
  placeWireIn,
  propOn,
  removeRun,
  renameForShape,
  resetToTemplate,
  runRows,
  sectionLit,
  sectionOfEdge,
  sectionRangeText,
  setAllOn,
  setCount,
  setZigzagDirection,
  guideFor,
  isSpiral,
  setLookStyle,
  setPropOn,
  setRunLength,
  setRunLights,
  setSectionLit,
  setSize,
  setSpacing,
  setUnits,
  SHAPE_TITLES,
  SHAPES,
  SIZE_FIELDS,
  sizeForRun,
  startFrom,
  styleFor,
  toggleRunInSection,
  totalLengthM,
  traceTo,
  updateSection,
  type Draft,
  type SizeKey,
} from "./model";
import {
  drawScene,
  fitBox,
  hitCorner,
  hitProp,
  hitRun,
  readColours,
  View,
  visibleRect,
  zoomAt,
  type Camera,
  type DrawEdge,
  type DrawGuide,
  type DrawProp,
} from "./stage";
import "./yard-editor.css";

export type YardLight = Pick<Light, "id" | "name" | "outputs" | "ledCount" | "lastSnapshot"> & { elementCount?: number };

export type YardEditorProps = {
  props: Prop[];
  attachments: PropAttachment[];
  lights: YardLight[];
  lightViews: LightView[];
  sessions: LiveHint[];
  looks: LooksDocument | null;
  looksReady: boolean;
  yardClear: boolean;
  /** From the address bar: `view=new`, `prop=<id>`, `view=edit`, `look=<id>`, `fold=controller`. */
  query: { view?: string; prop?: string; look?: string; fold?: string };
};

type ViewName = "yard" | "prop" | "look";
type Tool = "move" | "trace" | "split";
type Snapshot = { props: Prop[]; looks: Look[] | null };

const UNIT_KEY = "nightplot.propUnit";
const PITCH_KEY = "nightplot.propPitchM";
const TAP_SLOP = 8;

function readStored<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw == null ? null : parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* A private window may refuse storage. The choice still applies here. */
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function YardEditor(init: YardEditorProps) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const render = useCallback(() => bump(), []);

  // ---------- state (one ref, like the prototype) ----------
  const st = useRef({
    props: init.props,
    attachments: init.attachments,
    looksDoc: init.looks,
    view: "yard" as ViewName,
    lookId: null as string | null,
    sel: null as string | null,
    placing: null as Prop | null,
    ghost: null as { x: number; y: number } | null,
    draft: null as Draft | null,
    draftPos: null as { x: number; y: number } | null,
    draftIsNew: false,
    draftDirty: false,
    askDiscard: false,
    showTiles: false,
    /** Install marks on the prop canvas. Null: on for a spiral or zigzag, off otherwise. */
    guideOn: null as boolean | null,
    guideEvery: 20,
    allRuns: false,
    tool: "move" as Tool,
    selRun: null as string | null,
    activeSection: null as string | null,
    lensSection: null as string | null,
    confirmDelete: false,
    folds: { controller: init.query.fold === "controller" },
    cam: { x: 7, y: 2.2, ppm: 60 } as Camera,
    yardCam: null as Camera | null,
    sheet: "" as "" | "half" | "full",
    railOpen: false,
    units: "m" as LayoutUnits,
    pitchDefault: 0.1,
    saving: "Saved" as string,
    savingBusy: false,
    error: null as string | null,
    past: [] as Snapshot[],
    future: [] as Snapshot[],
    dpast: [] as string[],
    dfuture: [] as string[],
    ctrl: { lightId: "", outputId: "", afterPropId: null as string | null, busy: false, notice: null as string | null, applied: false, blinking: false },
    coords: null as { x: number; y: number; text: string } | null,
    focusName: false,
    phone: false,
    started: false,
  }).current;
  const s = st;

  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const insp = useRef<HTMLElement>(null);
  const size = useRef({ W: 0, H: 0, dpr: 1 });

  const inProp = () => s.view === "prop";
  const look = (): Look | null => (s.view === "look" ? s.looksDoc?.looks.find((k) => k.id === s.lookId) ?? null : null);
  const yardSel = () => s.props.find((p) => p.id === s.sel) ?? null;
  const fmt = (m: number) => `${+(s.units === "ft" ? m / METRES_PER_FOOT : m).toFixed(2)} ${s.units === "ft" ? "ft" : "m"}`;
  const fmtLen = (m: number) => (s.units === "m" ? `${m.toFixed(2)} m` : formatLength(m, "ft"));
  const toU = (m: number) => (s.units === "ft" ? m / METRES_PER_FOOT : m);
  const fromU = (v: number) => (s.units === "ft" ? v * METRES_PER_FOOT : v);
  const uLabel = () => (s.units === "ft" ? "ft" : "m");
  const tapWord = () => (s.phone ? "Tap" : "Click");
  const parse = (v: string) => {
    const n = Number.parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  // ---------- drawable props ----------
  const placements = () => new Map(yardPlacements(s.props.filter((p) => p.id !== s.placing?.id)).map((row) => [row.propId, row]));

  function drawable(id: string, name: string, layout: PropLayout | undefined | null, sections: readonly PropSection[], at: { x: number; y: number }, colour: (edgeId: string) => string | null, typed = false): DrawProp {
    const edges: DrawEdge[] = [];
    let start: { x: number; y: number } | null = null;
    const corners: { id: string; x: number; y: number }[] = [];
    let lights = 0;
    if (layout) {
      const counted = new Map(countLayout(layout).edges.map((row) => [row.id, row]));
      const used = new Set<string>();
      layoutStrings(layout).forEach((string, index) => {
        const c0 = layout.corners.find((c) => c.id === string.startId);
        if (index === 0 && c0) start = { x: c0.x, y: c0.y };
        used.add(string.startId);
        for (const edge of string.run) {
          const a = layout.corners.find((c) => c.id === edge.from);
          const b = layout.corners.find((c) => c.id === edge.to);
          if (!a || !b) continue;
          used.add(a.id);
          used.add(b.id);
          const n = counted.get(edge.id)?.lights ?? 0;
          lights += n;
          edges.push({
            id: edge.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, lights: n,
            color: edge.kind === "wire" ? null : colour(edge.id), wire: edge.kind !== "lit", typed: typed && edge.lockedLights != null,
            ...(edge.wrapLengthM != null ? { lengthM: counted.get(edge.id)?.lengthM ?? edge.wrapLengthM } : {}),
          });
        }
      });
      for (const corner of layout.corners) if (used.has(corner.id)) corners.push(corner);
    }
    return { id, name, x: at.x, y: at.y, edges, corners, start, lights, box: layoutBox(layout ?? undefined) };
  }

  function lookColour(L: Look, p: Prop) {
    return (edgeId: string) => {
      if (!propOn(L, p.id)) return null;
      const section = sectionOfEdge(p.sections ?? [], edgeId);
      if (section && !sectionLit(L, p.id, section.id)) return null;
      return styleFor(L, p, section?.id).color;
    };
  }

  function yardDrawables(): DrawProp[] {
    const at = placements();
    const L = look();
    return s.props
      .filter((p) => p.id !== s.placing?.id)
      .map((p) => {
        const place = at.get(p.id)?.at ?? { x: 0, y: 0 };
        const colour = L ? lookColour(L, p) : (edgeId: string) => sectionOfEdge(p.sections ?? [], edgeId)?.color ?? lit();
        return drawable(p.id, p.label, p.layout, p.sections ?? [], place, colour);
      });
  }

  function draftDrawable(): DrawProp | null {
    const d = s.draft;
    if (!d) return null;
    return drawable("draft", d.label, d.layout, d.sections, { x: 0, y: 0 }, (edgeId) => sectionOfEdge(d.sections, edgeId)?.color ?? lit(), d.count == null);
  }

  // ---------- canvas ----------
  const view = () => new View(s.cam, size.current.W, size.current.H);
  const coloursRef = useRef<ReturnType<typeof readColours> | null>(null);
  const lit = () => coloursRef.current?.lit || "#d4a574";

  const draw = useCallback(() => {
    const canvas = cv.current;
    const host = wrap.current;
    if (!canvas || !host || !size.current.W) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    coloursRef.current = readColours(host);
    const props = inProp() ? [draftDrawable()].filter((p): p is DrawProp => Boolean(p)) : yardDrawables();
    const ghost = s.placing && s.ghost ? { prop: drawable(s.placing.id, s.placing.label, s.placing.layout, s.placing.sections ?? [], { x: 0, y: 0 }, () => lit()), x: s.ghost.x, y: s.ghost.y } : null;
    const section = inProp() && s.activeSection ? s.draft?.sections.find((x) => x.id === s.activeSection)?.edgeIds ?? [] : null;
    drawScene(ctx, view(), {
      mode: inProp() ? "prop" : look() ? "look" : "yard",
      units: s.units,
      phone: s.phone,
      props,
      selectedId: s.sel,
      ghost,
      selectedRun: s.selRun,
      sectionRuns: section,
      fmtLen,
      guide: inProp() ? drawGuideFor(s.draft) : null,
    }, coloursRef.current, size.current.dpr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function guideShown(d: Draft | null): boolean {
    if (!d) return false;
    return s.guideOn ?? (isSpiral(d.shape) || d.shape === "zigzag");
  }

  function heightLabel(m: number): string {
    return s.units === "ft" ? `${Math.round(m / METRES_PER_FOOT)} ft` : `${+m.toFixed(2)} m`;
  }

  function drawGuideFor(d: Draft | null): DrawGuide | null {
    if (!d || !guideShown(d)) return null;
    const g = guideFor(d, s.guideEvery);
    if (!g) return null;
    return {
      lights: g.counts.map((m) => ({ x: m.x, y: m.y, label: String(m.number) })),
      heights: g.heights.map((h) => ({ x: h.x, y: h.y, label: `${heightLabel(h.heightM)} · light ${h.number}` })),
    };
  }

  function sheetFrac(): number {
    if (s.sheet === "full") return 0.88;
    if (s.sheet === "half") return 0.58;
    const h = insp.current?.scrollHeight ?? 0;
    return Math.min(0.34, (h + 4) / Math.max(1, size.current.H));
  }
  const vis = () => visibleRect(size.current.W, size.current.H, s.phone, sheetFrac());

  function fitYard() {
    const at = placements();
    let b: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const row of at.values()) {
      const q = row.box;
      b = b ? { minX: Math.min(b.minX, q.minX), minY: Math.min(b.minY, q.minY, 0), maxX: Math.max(b.maxX, q.maxX), maxY: Math.max(b.maxY, q.maxY) } : { ...q, minY: Math.min(q.minY, 0) };
    }
    if (!b) b = { minX: -1, minY: 0, maxX: 10, maxY: 5 };
    s.cam = fitBox(size.current.W, size.current.H, vis(), b, 220, true);
    draw();
  }
  function fitDraft() {
    const d = s.draft;
    if (!d?.layout || d.layout.corners.length < 2) {
      s.cam = { x: 1.5, y: 1, ppm: s.phone ? 70 : 110 };
      draw();
      return;
    }
    s.cam = fitBox(size.current.W, size.current.H, vis(), layoutBox(d.layout), 400, false);
    draw();
  }
  /** Keep a prop in the part of the canvas the panel leaves visible. */
  function fitIfOff(id: string) {
    const row = placements().get(id);
    if (!row) return;
    const bb = row.box;
    const v = vis();
    const vw = view();
    if (vw.sx(bb.maxX) < v.left - 30 || vw.sx(bb.minX) > v.right + 30 || vw.sy(bb.minY) < v.top || vw.sy(bb.maxY) > v.bottom + 20) {
      const { W, H } = size.current;
      s.cam = { ...s.cam, x: (bb.minX + bb.maxX) / 2 - ((v.left + v.right) / 2 - W / 2) / s.cam.ppm, y: (bb.minY + bb.maxY) / 2 + ((v.top + v.bottom) / 2 - H / 2) / s.cam.ppm };
      draw();
    }
  }

  // ---------- saving ----------
  let saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null).current;
  async function saving<T>(work: () => Promise<{ ok: true; data: unknown } | { ok: false; data: { message?: string } }>): Promise<(T & { message?: string }) | null> {
    s.saving = "Saving…";
    s.savingBusy = true;
    s.error = null;
    renderChromeSoon();
    const res = await work();
    s.savingBusy = false;
    if (!res.ok) {
      s.saving = "Not saved";
      s.error = res.data.message ?? "Nightplot did not save that.";
      render();
      return null;
    }
    s.saving = "Saved";
    render();
    return res.data as T & { message?: string };
  }
  function renderChromeSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(render, 0);
  }

  const snapshot = (): Snapshot => ({ props: clone(s.props), looks: s.looksDoc ? clone(s.looksDoc.looks) : null });
  function pushHistory() {
    s.past.push(snapshot());
    if (s.past.length > 100) s.past.shift();
    s.future.length = 0;
  }
  function replaceProp(prop: Prop) {
    const i = s.props.findIndex((p) => p.id === prop.id);
    if (i >= 0) s.props[i] = prop;
    else s.props.push(prop);
  }

  async function moveProp(id: string, x: number, y: number, record = true) {
    const p = s.props.find((q) => q.id === id);
    if (!p) return;
    if (record) pushHistory();
    p.yard = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
    render();
    const data = await saving<{ prop: Prop }>(() => patchJson(`/api/props/${id}/yard`, { yard: p.yard }));
    if (data?.prop) replaceProp(data.prop);
    render();
  }
  async function renameProp(id: string, label: string) {
    const p = s.props.find((q) => q.id === id);
    if (!p || !label.trim() || label.trim() === p.label) return;
    pushHistory();
    p.label = label.trim();
    render();
    const data = await saving<{ prop: Prop }>(() => patchJson(`/api/props/${id}`, { label: p.label }));
    if (data?.prop) replaceProp(data.prop);
    render();
  }
  async function deleteProp(id: string) {
    pushHistory();
    const data = await saving<{ deleted: string }>(() => deleteJson(`/api/props/${id}`));
    if (!data) {
      s.past.pop();
      return;
    }
    s.props = s.props.filter((p) => p.id !== id);
    s.attachments = s.attachments.filter((a) => a.propId !== id);
    if (s.looksDoc) {
      s.looksDoc = {
        ...s.looksDoc,
        looks: s.looksDoc.looks.map((k) => ({ ...k, propIds: k.propIds?.filter((x) => x !== id), overrides: k.overrides.filter((o) => o.propId !== id) })),
      };
    }
    s.sel = null;
    s.confirmDelete = false;
    render();
  }
  async function duplicateProp(p: Prop) {
    pushHistory();
    const label = `${p.label} copy`.slice(0, 64);
    const data = await saving<{ prop: Prop }>(() => postJson("/api/props", {
      label,
      kind: p.kind,
      unit: p.layout?.units ?? p.design?.unit ?? "m",
      pitchMm: Math.round((p.layout?.pitchM ?? 0.1) * 1000 * 1000) / 1000,
      measurements: p.design?.measurements,
      layout: p.layout,
      sections: p.sections ?? [],
    }));
    if (!data?.prop) {
      s.past.pop();
      return;
    }
    const at = placements().get(p.id)?.at ?? { x: 0, y: 0 };
    s.props.push(data.prop);
    s.sel = data.prop.id;
    await moveProp(data.prop.id, at.x + 0.5, at.y, false);
  }

  // ---------- Looks: autosave ----------
  const lookTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function commitLook(fn: (L: Look) => Look) {
    const L = look();
    if (!L || !s.looksDoc) return;
    pushHistory();
    s.looksDoc = { ...s.looksDoc, looks: s.looksDoc.looks.map((k) => (k.id === L.id ? fn(k) : k)) };
    render();
    queueLooksSave();
  }
  function queueLooksSave() {
    if (lookTimer.current) clearTimeout(lookTimer.current);
    s.saving = "Saving…";
    renderChromeSoon();
    lookTimer.current = setTimeout(() => void saveLooks(), 400);
  }
  async function saveLooks() {
    const doc = s.looksDoc;
    if (!doc) return;
    const data = await saving<LooksDocument>(() => putJson("/api/looks", { looks: doc.looks, playlists: doc.playlists, schedule: doc.schedule }));
    if (data?.looks) s.looksDoc = { version: 1, looks: data.looks, playlists: data.playlists, schedule: data.schedule };
    render();
  }

  // ---------- undo / redo ----------
  async function syncTo(target: Snapshot) {
    const cur = s.props;
    const want = new Map(target.props.map((p) => [p.id, p]));
    const have = new Map(cur.map((p) => [p.id, p]));
    const next: Prop[] = [];
    s.saving = "Saving…";
    render();
    let failed: string | null = null;
    for (const p of target.props) {
      const now = have.get(p.id);
      if (!now) {
        const res = await postJson<{ prop: Prop; message?: string }>(`/api/props/${p.id}/restore`, { prop: p });
        if (res.ok) next.push(res.data.prop);
        else failed = res.data.message ?? "Could not bring it back.";
        continue;
      }
      let merged = now;
      if (JSON.stringify(now.layout) !== JSON.stringify(p.layout) || JSON.stringify(now.sections ?? []) !== JSON.stringify(p.sections ?? []) || now.kind !== p.kind) {
        const res = await patchJson<{ prop: Prop; message?: string }>(`/api/props/${p.id}`, { label: p.label, kind: p.kind, layout: p.layout, measurements: p.design?.measurements, sections: p.sections ?? [] });
        if (res.ok) merged = res.data.prop;
        else failed = res.data.message ?? "Undo did not save.";
      } else if (now.label !== p.label) {
        const res = await patchJson<{ prop: Prop; message?: string }>(`/api/props/${p.id}`, { label: p.label });
        if (res.ok) merged = res.data.prop;
        else failed = res.data.message ?? "Undo did not save.";
      }
      if (JSON.stringify(now.yard ?? null) !== JSON.stringify(p.yard ?? null) && p.yard) {
        const res = await patchJson<{ prop: Prop; message?: string }>(`/api/props/${p.id}/yard`, { yard: p.yard });
        if (res.ok) merged = res.data.prop;
        else failed = res.data.message ?? "Undo did not save.";
      }
      next.push(merged);
    }
    for (const p of cur) {
      if (want.has(p.id)) continue;
      const res = await deleteJson(`/api/props/${p.id}`);
      if (!res.ok) {
        failed = (res.data as { message?: string }).message ?? "Undo did not save.";
        next.push(p);
      }
    }
    s.props = next;
    if (s.sel && !next.some((p) => p.id === s.sel)) s.sel = null;
    if (target.looks && s.looksDoc && JSON.stringify(target.looks) !== JSON.stringify(s.looksDoc.looks)) {
      s.looksDoc = { ...s.looksDoc, looks: target.looks };
      await saveLooks();
    }
    s.saving = failed ? "Not saved" : "Saved";
    s.error = failed;
    render();
  }
  async function undo() {
    if (inProp()) {
      const prev = s.dpast.pop();
      if (!prev || !s.draft) return;
      s.dfuture.push(JSON.stringify(s.draft));
      s.draft = JSON.parse(prev) as Draft;
      s.draftDirty = true;
      render();
      return;
    }
    const prev = s.past.pop();
    if (!prev) return;
    s.future.push(snapshot());
    await syncTo(prev);
  }
  async function redo() {
    if (inProp()) {
      const nextDraft = s.dfuture.pop();
      if (!nextDraft || !s.draft) return;
      s.dpast.push(JSON.stringify(s.draft));
      s.draft = JSON.parse(nextDraft) as Draft;
      render();
      return;
    }
    const nextSnap = s.future.pop();
    if (!nextSnap) return;
    s.past.push(snapshot());
    await syncTo(nextSnap);
  }

  /** Change the draft on the prop canvas, with its own Undo. */
  function edit(fn: (d: Draft) => Draft) {
    if (!s.draft) return;
    s.dpast.push(JSON.stringify(s.draft));
    s.dfuture.length = 0;
    s.draft = fn(s.draft);
    s.draftDirty = true;
    render();
  }

  // ---------- open / save / cancel the prop canvas ----------
  function setQuery(q: Record<string, string | null>, push = false) {
    const url = new URL(window.location.href);
    for (const key of ["view", "prop", "look", "fold"]) url.searchParams.delete(key);
    for (const [k, v] of Object.entries(q)) if (v) url.searchParams.set(k, v);
    const href = `${url.pathname}${url.search}`;
    if (push) window.history.pushState({ yard: true }, "", href);
    else window.history.replaceState(window.history.state, "", href);
  }

  function openProp(p: Prop | null, isNew: boolean) {
    s.yardCam = s.started ? { ...s.cam } : null;
    s.coords = null;
    const taken = s.props.map((q) => q.label);
    s.draft = p ? draftFromProp(p, s.units, s.pitchDefault) : newDraft(nextName(null, taken));
    if (p && s.draft.layout && s.draft.layout.units !== s.units) s.units = s.draft.layout.units;
    s.draftPos = p ? placements().get(p.id)?.at ?? null : null;
    s.draftIsNew = isNew;
    s.draftDirty = isNew;
    s.askDiscard = false;
    s.showTiles = false;
    s.dpast = [];
    s.dfuture = [];
    s.view = "prop";
    s.tool = "move";
    s.selRun = null;
    s.activeSection = null;
    s.railOpen = false;
    s.sheet = isNew ? "half" : "";
    s.focusName = false;
    setQuery(isNew ? { view: "new" } : { prop: p!.id, view: "edit" }, true);
    render();
    requestAnimationFrame(() => fitDraft());
  }

  async function saveProp() {
    const d = s.draft;
    if (!d) return;
    if (!d.layout || countLayout(d.layout).edges.length === 0) {
      s.error = "Give the prop a shape before saving.";
      render();
      return;
    }
    const label = d.label.trim() || nextName(d.shape, s.props.map((p) => p.label));
    const wasNew = s.draftIsNew;
    const body = {
      label,
      kind: d.keepKind ?? kindOfShape(d.shape ?? "draw"),
      unit: d.layout.units,
      pitchMm: Math.round(d.layout.pitchM * 1000 * 1000) / 1000,
      ...(d.keepKind ? {} : { measurements: measurementsOf(d) }),
      layout: d.layout,
      sections: d.sections,
    };
    if (wasNew) {
      const data = await saving<{ prop: Prop }>(() => postJson("/api/props", body));
      if (!data?.prop) return;
      s.props.push(data.prop);
      leaveProp();
      s.placing = data.prop;
      s.sel = null;
      s.sheet = "";
      render();
      const bb = layoutBox(data.prop.layout);
      const v = vis();
      const vw = view();
      s.ghost = { x: snap(vw.wx((v.left + v.right) / 2) - (bb.minX + bb.maxX) / 2), y: snap(-bb.minY) };
      draw();
      return;
    }
    pushHistory();
    const data = await saving<{ prop: Prop }>(() => patchJson(`/api/props/${d.id}`, body));
    if (!data?.prop) {
      s.past.pop();
      return;
    }
    replaceProp(data.prop);
    s.sel = data.prop.id;
    leaveProp();
    render();
  }
  function leaveProp() {
    s.view = "yard";
    if (s.yardCam) s.cam = s.yardCam;
    else requestAnimationFrame(fitYard);
    if (s.draft && !s.draftIsNew && s.props.some((p) => p.id === s.draft?.id)) s.sel = s.draft.id;
    s.draft = null;
    s.askDiscard = false;
    s.selRun = null;
    s.activeSection = null;
    setQuery(s.sel ? { prop: s.sel } : {});
  }
  function cancelProp(force = false) {
    if (s.draftDirty && !force) {
      s.askDiscard = true;
      s.sheet = s.sheet || "half";
      render();
      return;
    }
    leaveProp();
    render();
    requestAnimationFrame(draw);
  }
  async function placeAt(x: number, y: number) {
    const p = s.placing;
    if (!p) return;
    pushHistory();
    // The prop was saved before placing; Undo of the placing removes it.
    s.past[s.past.length - 1] = { ...s.past[s.past.length - 1]!, props: s.past[s.past.length - 1]!.props.filter((q) => q.id !== p.id) };
    s.placing = null;
    s.ghost = null;
    hideCoords();
    s.sel = p.id;
    s.sheet = "half";
    setQuery({ prop: p.id });
    await moveProp(p.id, x, y, false);
    fitIfOff(p.id);
  }
  function placeDefault() {
    if (!s.placing) return;
    let right = 0;
    for (const row of placements().values()) right = Math.max(right, row.box.maxX);
    const bb = layoutBox(s.placing.layout);
    void placeAt(+(right + 1 - bb.minX).toFixed(2), -bb.minY);
  }

  function openLook(id: string) {
    s.sel = null;
    s.view = "look";
    s.lookId = id;
    s.lensSection = null;
    s.confirmDelete = false;
    s.railOpen = false;
    s.sheet = "half";
    setQuery({ look: id }, true);
    render();
  }
  function closeLook() {
    s.view = "yard";
    s.lookId = null;
    s.lensSection = null;
    setQuery(s.sel ? { prop: s.sel } : {});
    render();
  }
  function newLook() {
    if (!s.looksDoc) return;
    const slot = freeSlot(s.looksDoc.looks, s.looksDoc.playlists);
    if (slot == null) {
      s.error = "Every preset slot is taken. Delete a Look on the Looks page first.";
      render();
      return;
    }
    pushHistory();
    const names = new Set(s.looksDoc.looks.map((k) => k.name));
    let n = s.looksDoc.looks.length + 1;
    while (names.has(`Look ${n}`)) n += 1;
    const k: Look = { id: `look-${Date.now().toString(36)}`, name: `Look ${n}`, slot, style: { fx: 0, pal: 0, sx: 128, ix: 128, bri: 180, color: "#ffa000" }, overrides: [], propIds: [] };
    s.looksDoc = { ...s.looksDoc, looks: [...s.looksDoc.looks, k] };
    queueLooksSave();
    openLook(k.id);
  }
  function deleteLook() {
    const L = look();
    if (!L || !s.looksDoc) return;
    if (s.looksDoc.looks.length <= 1) {
      s.error = "Keep at least one Look.";
      render();
      return;
    }
    pushHistory();
    s.looksDoc = {
      ...s.looksDoc,
      looks: s.looksDoc.looks.filter((k) => k.id !== L.id),
      playlists: s.looksDoc.playlists.map((pl) => ({ ...pl, lookIds: pl.lookIds.filter((x) => x !== L.id) })).filter((pl) => pl.lookIds.length > 0),
    };
    queueLooksSave();
    closeLook();
  }

  const snap = (v: number) => {
    const step = s.units === "ft" ? METRES_PER_FOOT / 4 : 0.1;
    return Math.round(v / step) * step;
  };
  const snapV = (v: number) => {
    const step = snapStepM(s.units);
    return Math.round(v / step) * step;
  };

  // ---------- pointer ----------
  type Drag =
    | { kind: "pan"; cam: Camera; px: number; py: number; moved: boolean; onTap?: () => void; deselect?: boolean }
    | { kind: "prop"; id: string; ox: number; oy: number; wx: number; wy: number; px: number; py: number; moved: boolean; pushed: boolean }
    | { kind: "corner"; id: string; px: number; py: number; moved: boolean }
    | { kind: "ghost"; gx: number; gy: number; wx: number; wy: number; px: number; py: number; moved: boolean };
  const dragRef = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { px: number; py: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number; cam: Camera } | null>(null);

  function localPoint(e: { clientX: number; clientY: number }) {
    const r = cv.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  function showCoords(px: number, py: number, text: string) {
    s.coords = { x: px + 14, y: py + 14, text };
    const el = document.getElementById("ye-coords");
    if (el) {
      el.hidden = false;
      el.textContent = text;
      el.style.left = `${px + 14}px`;
      el.style.top = `${py + 14}px`;
    }
  }
  function hideCoords() {
    s.coords = null;
    const el = document.getElementById("ye-coords");
    if (el) el.hidden = true;
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = cv.current!;
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    const { px, py } = localPoint(e);
    pointers.current.set(e.pointerId, { px, py });
    if (pointers.current.size === 2) {
      const drag = dragRef.current;
      if (drag?.kind === "corner" && !drag.moved) s.dpast.pop();
      if (drag?.kind === "prop" && drag.pushed) {
        const q = s.props.find((x) => x.id === drag.id);
        if (q) q.yard = { x: drag.ox, y: drag.oy };
        s.past.pop();
      }
      dragRef.current = null;
      const [a, b] = [...pointers.current.values()] as [{ px: number; py: number }, { px: number; py: number }];
      pinch.current = { d: Math.hypot(a.px - b.px, a.py - b.py), mx: (a.px + b.px) / 2, my: (a.py + b.py) / 2, cam: { ...s.cam } };
      hideCoords();
      return;
    }
    if (pointers.current.size > 2) return;
    const vw = view();
    const start = { px, py, moved: false };
    if (inProp()) {
      propPointer(px, py);
      return;
    }
    if (s.placing && s.ghost && e.pointerType === "touch") {
      dragRef.current = { kind: "ghost", gx: s.ghost.x, gy: s.ghost.y, wx: vw.wx(px), wy: vw.wy(py), ...start };
      return;
    }
    if (s.placing) {
      dragRef.current = {
        kind: "pan",
        cam: { ...s.cam },
        ...start,
        onTap: () => {
          const bb = layoutBox(s.placing?.layout);
          void placeAt(snap(vw.wx(px)), snap(Math.max(-bb.minY, vw.wy(py))));
        },
      };
      return;
    }
    const props = yardDrawables();
    const hit = hitProp(vw, props, px, py);
    if (hit) {
      if (look() && hit.id === s.sel) {
        const run = hitRun(vw, hit, px, py);
        const p = s.props.find((q) => q.id === hit.id);
        const section = run && p ? sectionOfEdge(p.sections ?? [], run.id) : undefined;
        s.lensSection = section ? section.id : null;
        render();
        return;
      }
      if (s.sel !== hit.id) {
        s.sel = hit.id;
        s.confirmDelete = false;
        s.lensSection = null;
        s.ctrl = { ...s.ctrl, notice: null, applied: false };
        if (!s.sheet) s.sheet = "half";
        setQuery(look() ? { look: s.lookId } : { prop: hit.id });
        render();
      }
      if (look()) return;
      dragRef.current = { kind: "prop", id: hit.id, ox: hit.x, oy: hit.y, wx: vw.wx(px), wy: vw.wy(py), pushed: false, ...start };
      return;
    }
    dragRef.current = { kind: "pan", cam: { ...s.cam }, deselect: true, ...start };
  }

  function propPointer(px: number, py: number) {
    const d = s.draft;
    if (!d) return;
    const vw = view();
    const start = { px, py, moved: false };
    const shape = draftDrawable();
    if (!d.layout || !shape || shape.corners.length === 0 || (d.shape === "draw" && d.layout.corners.length === 1 && countLayout(d.layout).edges.length === 0 && !d.layout.corners.length)) {
      dragRef.current = {
        kind: "pan",
        cam: { ...s.cam },
        ...start,
        onTap: () => {
          if (!s.draft) return;
          if (s.draft.shape !== "draw" && s.draft.layout) return;
          s.tool = "trace";
          edit((x) => placeWireIn({ ...x, label: renameForShape(x.label, "draw", s.props.map((p) => p.label)) }, snapV(vw.wx(px)), snapV(vw.wy(py)), s.units, s.pitchDefault));
          if (s.phone) s.sheet = "";
          render();
        },
      };
      return;
    }
    const ci = hitCorner(vw, shape, px, py);
    const hr = hitRun(vw, shape, px, py);
    if (ci && s.tool === "move" && !s.activeSection) {
      s.dpast.push(JSON.stringify(d));
      s.dfuture.length = 0;
      dragRef.current = { kind: "corner", id: ci, ...start };
      return;
    }
    let onTap: (() => void) | undefined;
    if (s.activeSection && hr) onTap = () => edit((x) => toggleRunInSection(x, s.activeSection!, hr.id));
    else if (hr && s.tool === "split") {
      onTap = () => {
        if (!s.draft) return;
        const made = addPoint(s.draft, hr.id, vw.wx(px), vw.wy(py));
        edit(() => made.draft);
        s.selRun = made.newEdgeId;
        render();
      };
    } else if (ci && s.tool === "trace") {
      onTap = () => {
        if (!s.draft) return;
        const made = traceTo(s.draft, { cornerId: ci });
        edit(() => made.draft);
        s.selRun = made.newEdgeId;
        render();
      };
    } else if (hr) {
      onTap = () => {
        s.selRun = hr.id;
        s.activeSection = null;
        if (s.phone) s.sheet = "";
        render();
        if (insp.current) insp.current.scrollTop = 0;
      };
    } else if (s.tool === "trace") {
      onTap = () => {
        if (!s.draft) return;
        const made = traceTo(s.draft, { x: snapV(vw.wx(px)), y: snapV(vw.wy(py)) });
        edit(() => made.draft);
        s.selRun = made.newEdgeId;
        render();
      };
    } else {
      onTap = () => {
        if (s.selRun) {
          s.selRun = null;
          render();
        }
      };
    }
    dragRef.current = { kind: "pan", cam: { ...s.cam }, ...start, onTap };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { px, py } = localPoint(e);
    const vw = view();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { px, py });
    const pin = pinch.current;
    if (pin && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ px: number; py: number }, { px: number; py: number }];
      const dist = Math.hypot(a.px - b.px, a.py - b.py), mx = (a.px + b.px) / 2, my = (a.py + b.py) / 2;
      const base = new View(pin.cam, size.current.W, size.current.H);
      const wx0 = base.wx(pin.mx), wy0 = base.wy(pin.my);
      const ppm = Math.max(6, Math.min(600, (pin.cam.ppm * dist) / Math.max(1, pin.d)));
      s.cam = { ppm, x: wx0 - (mx - size.current.W / 2) / ppm, y: wy0 + (my - size.current.H / 2) / ppm };
      draw();
      return;
    }
    const drag = dragRef.current;
    // A mouse moving over the yard while placing: the outline follows it.
    if (!inProp() && s.placing && e.pointerType !== "touch" && (!drag || !drag.moved)) {
      const bb = layoutBox(s.placing.layout);
      s.ghost = { x: snap(vw.wx(px)), y: snap(Math.max(-bb.minY, vw.wy(py))) };
      showCoords(px, py, `X ${fmt(s.ghost.x)}  Y ${fmt(s.ghost.y)}`);
      draw();
      if (!drag) return;
    }
    if (!drag) {
      if (cv.current) cv.current.style.cursor = cursorAt(px, py);
      return;
    }
    if (Math.hypot(px - drag.px, py - drag.py) > (e.pointerType === "touch" ? TAP_SLOP : 3)) drag.moved = true;
    if (!drag.moved) return;
    if (drag.kind === "pan") {
      s.cam = { ...s.cam, x: drag.cam.x - (px - drag.px) / s.cam.ppm, y: drag.cam.y + (py - drag.py) / s.cam.ppm };
      draw();
      return;
    }
    if (drag.kind === "ghost" && s.placing) {
      const bb = layoutBox(s.placing.layout);
      s.ghost = { x: snap(drag.gx + vw.wx(px) - drag.wx), y: snap(Math.max(-bb.minY, drag.gy + vw.wy(py) - drag.wy)) };
      showCoords(px, py - 70, `X ${fmt(s.ghost.x)}  Y ${fmt(s.ghost.y)}`);
      draw();
      return;
    }
    if (drag.kind === "prop") {
      const p = s.props.find((q) => q.id === drag.id);
      if (!p) return;
      if (!drag.pushed) {
        pushHistory();
        drag.pushed = true;
      }
      p.yard = { x: snap(drag.ox + vw.wx(px) - drag.wx), y: snap(drag.oy + vw.wy(py) - drag.wy) };
      showCoords(px, py, `X ${fmt(p.yard.x)}  Y ${fmt(p.yard.y)}`);
      draw();
      return;
    }
    if (drag.kind === "corner" && s.draft) {
      const x = snapV(vw.wx(px)), y = snapV(vw.wy(py));
      s.draft = dragCorner(s.draft, drag.id, x, y);
      s.draftDirty = true;
      showCoords(px, py, `${fmt(x)}, ${fmt(y)} from the wire-in`);
      draw();
    }
  }

  function endPointer(e: React.PointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      dragRef.current = null;
      return;
    }
    if (!s.placing) hideCoords();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (e.type === "pointercancel") return;
    if (drag.kind === "ghost") {
      if (!drag.moved && s.placing) {
        const bb = layoutBox(s.placing.layout);
        const { px, py } = localPoint(e);
        const vw = view();
        s.ghost = { x: snap(vw.wx(px) - (bb.minX + bb.maxX) / 2), y: snap(Math.max(-bb.minY, vw.wy(py) - (bb.minY + bb.maxY) / 2)) };
        draw();
      }
      setTimeout(hideCoords, 900);
      return;
    }
    if (drag.kind === "pan" && !drag.moved && drag.onTap) drag.onTap();
    else if (drag.kind === "pan" && !drag.moved && drag.deselect) {
      s.sel = null;
      s.confirmDelete = false;
      setQuery(look() ? { look: s.lookId } : {});
      render();
    } else if (drag.kind === "prop" && drag.pushed) {
      const p = s.props.find((q) => q.id === drag.id);
      if (p?.yard) void moveProp(p.id, p.yard.x, p.yard.y, false);
    } else if (drag.kind === "corner") {
      if (drag.moved) render();
      else s.dpast.pop();
    }
  }

  function cursorAt(px: number, py: number): string {
    const vw = view();
    if (inProp()) {
      const p = draftDrawable();
      if (!p || p.corners.length === 0) return "crosshair";
      if (s.tool === "move" && hitCorner(vw, p, px, py)) return "move";
      if (hitRun(vw, p, px, py)) return "pointer";
      return s.tool === "trace" ? "crosshair" : "grab";
    }
    const h = hitProp(vw, yardDrawables(), px, py);
    return h ? (look() ? "pointer" : "move") : "grab";
  }

  // ---------- lifecycle ----------
  useLayoutEffect(() => {
    s.phone = window.innerWidth <= 860;
    // Walk scripts read the editor state in development.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __yard?: unknown }).__yard = s;
    s.units = readStored(UNIT_KEY, (raw) => (raw === "m" || raw === "ft" ? raw : null), "m");
    s.pitchDefault = readStored(PITCH_KEY, (raw) => {
      const n = Number(raw);
      return n > 0 && n < 2 ? n : null;
    }, 0.1);
    const host = wrap.current;
    if (!host) return;
    const resize = () => {
      const r = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { W: r.width, H: r.height, dpr };
      if (cv.current) {
        cv.current.width = Math.round(r.width * dpr);
        cv.current.height = Math.round(r.height * dpr);
      }
      const phone = window.innerWidth <= 860;
      if (phone !== s.phone) {
        s.phone = phone;
        render();
      }
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    // Open what the address asked for.
    const q = init.query;
    const target = q.prop ? s.props.find((p) => p.id === q.prop) ?? null : null;
    if (q.view === "new") openProp(null, true);
    else if (target && q.view === "edit") openProp(target, false);
    else if (q.look && s.looksDoc?.looks.some((k) => k.id === q.look)) openLook(q.look);
    else if (target) {
      s.sel = target.id;
      s.sheet = "half";
    }
    s.started = true;
    render();
    requestAnimationFrame(() => {
      if (!inProp()) {
        fitYard();
        if (s.sel) fitIfOff(s.sel);
      }
    });
    const onPop = () => {
      if (inProp()) {
        if (s.draftDirty) {
          // Stay on the prop's canvas and ask; Discard leaves.
          setQuery(s.draftIsNew || !s.draft ? { view: "new" } : { prop: s.draft.id, view: "edit" }, true);
          s.askDiscard = true;
          render();
        } else cancelProp(true);
      } else if (s.view === "look") closeLook();
    };
    window.addEventListener("popstate", onPop);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("popstate", onPop);
      media.removeEventListener("change", draw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw after every render; the panel may have changed what is drawn.
  useEffect(() => {
    draw();
    if (s.focusName) {
      s.focusName = false;
      const n = document.getElementById("ye-name") as HTMLInputElement | null;
      n?.focus();
    }
  });

  // A panel opens at the top when what it shows changes.
  const panelKey = `${s.view}|${s.sel}|${Boolean(s.placing)}|${s.lookId}|${s.selRun}|${s.activeSection}`;
  const lastKey = useRef(panelKey);
  useEffect(() => {
    if (lastKey.current !== panelKey && insp.current) insp.current.scrollTop = 0;
    lastKey.current = panelKey;
  }, [panelKey]);

  // Keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing = /INPUT|SELECT|TEXTAREA/.test(el?.tagName ?? "");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (mod && e.key.toLowerCase() === "s" && inProp()) {
        e.preventDefault();
        void saveProp();
        return;
      }
      if (typing) return;
      if (inProp()) {
        if (e.key === "Escape") {
          if (s.activeSection) s.activeSection = null;
          else if (s.selRun) s.selRun = null;
          else return cancelProp();
          render();
        } else if ((e.key === "Delete" || e.key === "Backspace") && s.selRun) {
          e.preventDefault();
          const id = s.selRun;
          s.selRun = null;
          edit((d) => removeRun(d, id));
        } else if (e.key === "t") { s.tool = "trace"; render(); }
        else if (e.key === "v") { s.tool = "move"; render(); }
        else if (e.key === "a") { s.tool = "split"; render(); }
        else if (e.key === "f") fitDraft();
        return;
      }
      const p = yardSel();
      if (e.key === "Escape") {
        if (s.placing) placeDefault();
        else if (s.view === "look" && !s.sel) closeLook();
        else {
          s.sel = null;
          render();
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && p && !look()) {
        e.preventDefault();
        s.confirmDelete = true;
        s.sheet = "half";
        render();
      } else if (mod && e.key.toLowerCase() === "d" && p && !look()) {
        e.preventDefault();
        void duplicateProp(p);
      } else if (e.key === "Enter" && p && !look()) openProp(p, false);
      else if (e.key === "n" && !look()) openProp(null, true);
      else if (e.key === "f") fitYard();
      else if (e.key.startsWith("Arrow") && p && !look()) {
        e.preventDefault();
        const step = (s.units === "ft" ? METRES_PER_FOOT / 4 : 0.1) * (e.shiftKey ? 10 : 1);
        const at = placements().get(p.id)?.at ?? { x: 0, y: 0 };
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        void moveProp(p.id, at.x + dx, at.y + dy);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ---------- panels ----------
  const sheetHandle = (
    <button
      type="button"
      className="sheethandle"
      aria-label="Resize panel"
      onClick={() => {
        s.sheet = s.sheet === "" ? "half" : s.sheet === "half" ? "full" : "";
        render();
        if (inProp() && s.sheet !== "full") requestAnimationFrame(fitDraft);
      }}
    />
  );

  function NumRow({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: number) => void }) {
    return (
      <label className="f">
        {label}
        <CommitField id={id} inputMode="decimal" value={value} onCommit={(text) => { const v = parse(text); if (v != null) onCommit(v); }} />
      </label>
    );
  }

  function yardSummary() {
    const total = s.props.reduce((sum, p) => sum + (p.layout ? countLayout(p.layout).total : p.design?.ledCount ?? 0), 0);
    const attached = s.props.filter((p) => s.attachments.some((a) => a.propId === p.id)).length;
    const steps = yardSetupSteps({ propCount: s.props.length, unattachedCount: s.props.length - attached, lightCount: init.lights.length, looksReady: init.looksReady, yardClear: init.yardClear });
    const href: Record<string, string> = { design: "#", connect: "/discover", attach: "#", looks: "/looks", check: "/yard" };
    return (
      <>
        <button type="button" className="newbtn big" onClick={() => openProp(null, true)}>+ New prop</button>
        <div>
          <div className="title"><h1>Your yard</h1></div>
          <p className="sub">{s.phone ? "Tap a prop to select it. Drag it to move it. Edit shape opens it on its own canvas." : "Click a prop to select it and drag to move it. Double-click it, or Edit shape, to open it on its own canvas."}</p>
        </div>
        <div>
          <div className="stat"><span>Props</span><b>{s.props.length}</b></div>
          <div className="stat"><span>Lights</span><b>{total}</b></div>
          <div className="stat"><span>Attached to a controller</span><b>{attached} of {s.props.length}</b></div>
        </div>
        <div>
          <h2>Setup</h2>
          <ol className="steps">
            {steps.map((step) => (
              <li key={step.id}>
                <span className={`m ${step.mark === "done" ? "done" : step.mark === "next" ? "next" : ""}`}>{step.mark === "done" ? "Done" : step.mark === "next" ? "Next" : "Not yet"}</span>
                {href[step.id] !== "#" ? <Link href={href[step.id]!}>{step.title}</Link> : step.title}
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2>Yard units</h2>
          <div className="grid2">
            <label className="f">Lengths
              <span className="seg" role="group">
                {(["ft", "m"] as const).map((u) => (
                  <button key={u} type="button" aria-pressed={s.units === u} onClick={() => { s.units = u; writeStored(UNIT_KEY, u); render(); }}>{u === "ft" ? "Feet" : "Metres"}</button>
                ))}
              </span>
            </label>
            <NumRow
              id="ye-ypitch"
              label={`New-prop spacing (${s.units === "ft" ? "in" : "cm"})`}
              value={s.units === "ft" ? (s.pitchDefault / 0.0254).toFixed(2) : (s.pitchDefault * 100).toFixed(1)}
              onCommit={(v) => {
                if (!(v > 0)) return;
                s.pitchDefault = s.units === "ft" ? v * 0.0254 : v / 100;
                writeStored(PITCH_KEY, String(s.pitchDefault));
                render();
              }}
            />
          </div>
          <p className="note" style={{ marginTop: 6 }}>Switching converts every number. Nothing moves.</p>
        </div>
        <div className="keys"><h2>Keys</h2><p className="note">N new prop · Enter edit the selected prop · Delete · Esc · ⌘/Ctrl+Z undo · ⌘/Ctrl+D duplicate · arrows nudge (Shift ×10) · F fit</p></div>
      </>
    );
  }

  function yardPropPanel(p: Prop) {
    const at = placements().get(p.id)?.at ?? { x: 0, y: 0 };
    const lights = p.layout ? countLayout(p.layout).total : p.design?.ledCount ?? 0;
    const draftLike = draftFromProp(p, s.units, s.pitchDefault);
    return (
      <>
        <div>
          <div className="title"><h1>{p.label}</h1></div>
          <p className="sub">{draftLike.drawn && draftLike.shape !== "draw" ? `Drawn · started as ${SHAPE_TITLES[draftLike.shape ?? "draw"]}` : SHAPE_TITLES[draftLike.shape ?? "draw"]} · {lights} lights · {fmtLen(totalLengthM(p.layout ?? null))}</p>
        </div>
        <label className="f">Name
          <CommitField id="ye-name" className="" selectOnFocus={false} value={p.label} maxLength={64} onCommit={(text) => void renameProp(p.id, text)} />
        </label>
        <div className="grid2">
          <NumRow id="ye-x" label={`X from origin (${uLabel()})`} value={String(+toU(at.x).toFixed(2))} onCommit={(v) => void moveProp(p.id, fromU(v), at.y).then(() => fitIfOff(p.id))} />
          <NumRow id="ye-y" label={`Y above ground (${uLabel()})`} value={String(+toU(at.y).toFixed(2))} onCommit={(v) => void moveProp(p.id, at.x, fromU(v)).then(() => fitIfOff(p.id))} />
        </div>
        {(p.sections ?? []).length > 0 ? (
          <div>
            <h2>Sections</h2>
            <div className="sectionrows">
              {(p.sections ?? []).map((sec) => (
                <div className="secrow" key={sec.id}>
                  <span className="sw" style={{ background: sec.color ?? "var(--y-lit)" }} />
                  <span className="nm">{sec.name}</span>
                  <span className="rng">{sectionRangeText(p.layout ?? null, p.sections ?? [], sec.id).human}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="btnrow">
          <button type="button" className="btn primary" onClick={() => openProp(p, false)}>Edit shape</button>
          <button type="button" className="btn" onClick={() => void duplicateProp(p)}>Duplicate</button>
          <button type="button" className="btn danger" onClick={() => { s.confirmDelete = true; render(); }}>Delete</button>
        </div>
        {s.confirmDelete ? (
          <div className="confirm" role="alertdialog">
            <strong>Delete {p.label}?</strong>
            <span className="note">It leaves the yard and every Look. Nothing is sent to a controller. Undo brings it back{s.attachments.some((a) => a.propId === p.id) ? ", but not attached" : ""}.</span>
            <div className="btnrow">
              <button type="button" className="btn danger" onClick={() => void deleteProp(p.id)}>Delete</button>
              <button type="button" className="btn" onClick={() => { s.confirmDelete = false; render(); }}>Keep it</button>
            </div>
          </div>
        ) : null}
        {controllerFold(p)}
      </>
    );
  }

  function controllerFold(p: Prop) {
    const attachment = s.attachments.find((a) => a.propId === p.id) ?? null;
    const attachedLight = attachment ? init.lights.find((l) => l.id === attachment.lightId) : undefined;
    const attachedOutput = attachedLight?.outputs?.find((o) => o.id === attachment?.outputId);
    const meta = !attachment ? "Not attached" : !attachedLight ? "Controller missing" : propAttachmentLabel(attachment, attachedLight.name, attachedOutput?.index ?? null);
    const c = s.ctrl;
    const lightId = c.lightId || attachment?.lightId || "";
    const light = init.lights.find((l) => l.id === lightId) ?? null;
    const outputs = light?.outputs ?? [];
    const output = outputs.find((o) => o.id === (c.outputId || attachment?.outputId)) ?? outputs[0] ?? null;
    const followers = s.props.filter((q) => q.id !== p.id && s.attachments.some((a) => a.propId === q.id && a.lightId === lightId && a.outputId === output?.id));
    const after = c.afterPropId ?? (attachment && attachment.lightId === lightId ? attachment.afterPropId : null);
    const plan = light && output
      ? planPropPlacement({
        prop: p,
        output,
        lightName: light.name,
        place: after ? { startIndex: null, afterPropId: after } : { startIndex: 0, afterPropId: null },
        props: s.props,
        attachments: s.attachments,
        maxSegments: light.lastSnapshot?.maxSegments ?? null,
        otherRangeCount: Math.max(0, (light.elementCount ?? 0) - p.elementIds.length),
      })
      : null;
    const blinking = c.blinking || init.sessions.some((x) => x.lightId === lightId && x.kind === "blink");
    async function apply() {
      if (!light || !output || !plan?.ok) return;
      s.ctrl = { ...s.ctrl, busy: true, notice: null };
      render();
      if (blinking) await postJson(`/api/lights/${light.id}/blink/end`, {});
      const res = await postJson<{ prop?: Prop; message?: string; summary?: string; apply?: { matched?: boolean; message?: string } }>(`/api/props/${p.id}/attach`, {
        lightId: light.id,
        outputId: output.id,
        startIndex: after ? null : 0,
        afterPropId: after,
        apply: true,
      });
      if (!res.ok) {
        s.ctrl = { ...s.ctrl, busy: false, blinking: false, applied: false, notice: res.data.message ?? "Nothing was sent." };
        render();
        return;
      }
      if (res.data.prop) replaceProp(res.data.prop);
      s.attachments = [...s.attachments.filter((a) => a.propId !== p.id), { propId: p.id, lightId: light.id, outputId: output.id, startIndex: after ? null : 0, afterPropId: after }];
      const readback = res.data.apply?.message ?? res.data.message;
      s.ctrl = { ...s.ctrl, busy: false, blinking: false, applied: res.data.apply?.matched === true, notice: readback ?? "The controller did not report a readback. Not treating this as done." };
      render();
    }
    async function blink() {
      if (!light) return;
      if (blinking) {
        await postJson(`/api/lights/${light.id}/blink/end`, {});
        s.ctrl = { ...s.ctrl, blinking: false };
      } else {
        const res = await postJson<{ message?: string }>(`/api/lights/${light.id}/blink`, p.elementIds[0] ? { elementId: p.elementIds[0] } : {});
        s.ctrl = { ...s.ctrl, blinking: res.ok, notice: res.ok ? null : res.data.message ?? "Blink did not start." };
      }
      render();
    }
    return (
      <details className="fold" open={s.folds.controller} onToggle={(e) => { s.folds.controller = (e.currentTarget as HTMLDetailsElement).open; }}>
        <summary>Controller<span className="meta">{meta}</span></summary>
        <div className="foldbody">
          {init.lights.length === 0 ? (
            <p className="note">No controllers are connected. The prop works without one. <Link href="/discover">Connect controllers</Link> when the box is up.</p>
          ) : (
            <>
              <div className="grid2">
                <label className="f">Controller
                  <select value={lightId} onChange={(e) => { const l = init.lights.find((x) => x.id === e.target.value); s.ctrl = { ...s.ctrl, lightId: e.target.value, outputId: l?.outputs?.[0]?.id ?? "", afterPropId: null, applied: false, notice: null }; render(); }}>
                    <option value="">Not attached</option>
                    {init.lights.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="f">Output
                  <select value={output?.id ?? ""} disabled={!light} onChange={(e) => { s.ctrl = { ...s.ctrl, lightId, outputId: e.target.value, afterPropId: null, applied: false }; render(); }}>
                    {light ? outputs.map((o) => <option key={o.id} value={o.id}>{o.index + 1}</option>) : <option>—</option>}
                  </select>
                </label>
              </div>
              {light ? (
                <>
                  <label className="f">Where on this output
                    <select value={after ?? ""} onChange={(e) => { s.ctrl = { ...s.ctrl, lightId, outputId: output?.id ?? "", afterPropId: e.target.value || null, applied: false }; render(); }}>
                      <option value="">From the first light</option>
                      {followers.map((q) => <option key={q.id} value={q.id}>After {q.label}</option>)}
                    </select>
                  </label>
                  <div className="readback"><strong>What gets written</strong><br />{plan ? (plan.ok ? plan.summary : plan.message) : "Pick an output."}
                    {plan?.ok ? plan.segments.map((seg) => <span key={`${seg.label}-${seg.start}`}><br />{seg.label}</span>) : null}
                  </div>
                  <div className="btnrow">
                    <button type="button" className="btn" onClick={() => void blink()}>{blinking ? "End blink" : "Blink"}</button>
                    <button type="button" className="btn primary" disabled={!plan?.ok || c.busy} onClick={() => void apply()}>{c.busy ? "Applying…" : "Apply"}</button>
                  </div>
                  <p className="note">Apply writes the controller and reads it back. A mismatch is not called done.</p>
                  {c.notice ? <div className="readback">{c.notice}</div> : null}
                </>
              ) : <p className="note">The prop works without a controller. Attach it when the box is up.</p>}
            </>
          )}
        </div>
      </details>
    );
  }

  function placingPanel(p: Prop) {
    const lights = p.layout ? countLayout(p.layout).total : 0;
    const d = draftFromProp(p, s.units, s.pitchDefault);
    return (
      <>
        <div>
          <div className="title"><h1>Place {p.label}</h1></div>
          <p className="sub">{SHAPE_TITLES[d.shape ?? "draw"]} · {lights} lights · saved</p>
        </div>
        <p className="note">{s.phone ? "Drag the outline to where it hangs, or tap a spot. Pinch to zoom." : "Click the yard where it hangs. The outline follows the pointer."} You can move it or type X and Y any time later.</p>
        <div className="placebar">
          <button type="button" className="btn primary" onClick={() => s.ghost && void placeAt(s.ghost.x, s.ghost.y)}>Place here</button>
          <button type="button" className="btn" onClick={placeDefault}>Next to the others</button>
        </div>
      </>
    );
  }

  function propPanel(d: Draft) {
    const rows = runRows(d);
    const r = rows.find((x) => x.edge.id === s.selRun) ?? null;
    const sec = d.sections.find((x) => x.id === s.activeSection) ?? null;
    const hasShape = Boolean(d.layout && d.layout.corners.length > 0 && (rows.length > 0 || d.shape !== "draw"));
    const unsectioned = rows.filter((x) => !sectionOfEdge(d.sections, x.edge.id));
    const pitch = d.layout?.pitchM ?? s.pitchDefault;
    const taken = s.props.filter((p) => p.id !== d.id).map((p) => p.label);
    const pick = (shape: (typeof SHAPES)[number]["id"]) => {
      s.showTiles = false;
      if (s.phone) s.sheet = "";
      edit((x) => ({ ...startFrom(x, shape, s.units, s.pitchDefault), label: renameForShape(x.label, shape, taken) }));
      if (shape === "draw") s.tool = "trace";
      else s.tool = "move";
      render();
      requestAnimationFrame(fitDraft);
    };
    const nameField = (
      <label className="f">Name
        <CommitField
          id="ye-name"
          className=""
          selectOnFocus={isAutoName(d.label)}
          value={d.label}
          maxLength={64}
          onLive={(text) => { if (s.draft && text.trim()) { s.draft.label = text.trim(); s.draftDirty = true; draw(); } }}
          onCommit={(text) => { if (s.draft && text.trim()) { s.draft.label = text.trim(); render(); } }}
        />
      </label>
    );
    return (
      <>
        {s.askDiscard ? (
          <div className="discard">
            <span>Leave without saving? Your changes to this prop are lost.</span>
            <button type="button" className="btn danger" onClick={() => cancelProp(true)}>Discard</button>
            <button type="button" className="btn" onClick={() => { s.askDiscard = false; render(); }}>Keep editing</button>
          </div>
        ) : null}
        {r ? runEditor(d, r) : null}
        {sec ? sectionEditor(d, sec) : null}
        {!hasShape || s.showTiles ? (
          <div>
            <h2>{hasShape ? "Change shape" : "Start from"}</h2>
            <div className="tiles">
              {SHAPES.map((shape) => (
                <button key={shape.id} type="button" className={`shape ${hasShape && d.shape === shape.id && (!d.drawn || shape.id === "draw") ? "on" : ""}`} data-start={shape.id} onClick={() => pick(shape.id)}>
                  <svg viewBox="0 0 34 24" aria-hidden><path d={shape.svg} /></svg>
                  {shape.title}
                </button>
              ))}
            </div>
            {hasShape ? <p className="note" style={{ marginTop: 6 }}>Picking another shape replaces this one and clears its sections. <button type="button" className="btn link" onClick={() => { s.showTiles = false; render(); }}>Keep {SHAPE_TITLES[d.shape ?? "draw"]}</button></p> : null}
            {d.shape === "draw" && !hasShape ? <p className="note" style={{ marginTop: 6 }}>{tapWord()} the canvas where the wire comes in.</p> : null}
          </div>
        ) : (
          <div>
            <h2>Shape</h2>
            <div className="secrow">
              <span className="nm">{d.keepKind ? "Drawn" : d.drawn && d.shape !== "draw" ? `Drawn · from ${SHAPE_TITLES[d.shape ?? "draw"]}` : SHAPE_TITLES[d.shape ?? "draw"]} · {fmtLen(totalLengthM(d.layout))}</span>
              <button type="button" className="btn link" onClick={() => { s.showTiles = true; render(); }}>Change shape</button>
            </div>
          </div>
        )}
        {hasShape ? (
          <div>
            <div className="hrow">
              <h2>Size</h2>
              <span className="seg" role="group" aria-label="Unit">
                {(["ft", "m"] as const).map((u) => (
                  <button key={u} type="button" aria-pressed={s.units === u} onClick={() => { s.units = u; writeStored(UNIT_KEY, u); edit((x) => setUnits(x, u)); }}>{u === "ft" ? "Feet" : "Metres"}</button>
                ))}
              </span>
            </div>
            {d.drawn || !d.shape || d.shape === "draw" ? (
              <p className="note">
                {d.shape && d.shape !== "draw" && !d.keepKind ? (
                  <>Edited by hand, so the {SHAPE_TITLES[d.shape]} sizes no longer apply. <button type="button" className="btn link" onClick={() => { edit(resetToTemplate); requestAnimationFrame(fitDraft); }}>Reset to {SHAPE_TITLES[d.shape]}</button></>
                ) : "Drawn by hand. Use Trace to add runs and drag corners to reshape. Tap a run to type its length."}
              </p>
            ) : (
              <div className="grid2">
                {SIZE_FIELDS[d.shape].map((field) => {
                  // Small sizes read the way a tape does: inches, or centimetres.
                  const k = field.small ? (s.units === "ft" ? 12 : 100) : 1;
                  const unit = field.plain ? "" : ` (${field.small ? (s.units === "ft" ? "in" : "cm") : uLabel()})`;
                  const fallback = field.key === "aroundTop" ? d.sizes.around ?? 0 : 0;
                  return (
                    <NumRow
                      key={field.key}
                      id={`ye-size-${field.key}`}
                      label={`${field.label}${unit}`}
                      value={String(+((d.sizes[field.key] ?? fallback) * k).toFixed(field.plain ? 0 : field.small ? 1 : 2))}
                      onCommit={(v) => {
                        // Only a spiral's top may be 0: a tree's tip.
                        if (!(v > 0) && !(field.key === "aroundTop" && v === 0)) return;
                        edit((x) => setSize(x, field.key as SizeKey, field.plain ? Math.round(v) : v / k));
                        requestAnimationFrame(fitDraft);
                      }}
                    />
                  );
                })}
              </div>
            )}
            {d.shape === "zigzag" && !d.drawn ? (
              <span className="seg" role="group" aria-label="Zigzag direction" style={{ marginTop: 8 }}>
                {([[0, "Up and down"], [1, "Side to side"]] as const).map(([v, text]) => (
                  <button key={v} type="button" aria-pressed={(d.sizes.horizontal ?? 0) === v} onClick={() => { edit((x) => setZigzagDirection(x, v === 1)); requestAnimationFrame(fitDraft); }}>{text}</button>
                ))}
              </span>
            ) : null}
            {isSpiral(d.shape) && !d.drawn && d.sizes.height && d.sizes.gap ? (
              <p className="note">{+(d.sizes.height / d.sizes.gap).toFixed(1)} turns. {d.shape === "spiral"
                ? "Measure “around” with a tape: a 4×4 post is 14 in. Set the top to 0 for a tree that comes to a point."
                : "Measure “around” with a tape at the bottom of the tree. The top is 0 for a point; type more for a flat top."}</p>
            ) : null}
          </div>
        ) : null}
        {rows.length > 0 ? (
          <>
            <div>
              <h2>Lights</h2>
              <div className="grid2">
                <NumRow id="ye-count" label="How many lights" value={String(lightTotal(d.layout))} onCommit={(v) => { if (v >= 1) edit((x) => setCount(x, Math.round(v))); }} />
                <NumRow
                  id="ye-pitch"
                  label={`Spacing (${s.units === "ft" ? "in" : "cm"})`}
                  value={s.units === "ft" ? (pitch / 0.0254).toFixed(2) : (pitch * 100).toFixed(1)}
                  onCommit={(v) => { if (v > 0) edit((x) => setSpacing(x, s.units === "ft" ? v * 0.0254 : v / 100)); }}
                />
              </div>
              <p className="note">{isSpiral(d.shape) && !d.drawn
                ? "Type the count on your string and the wraps are spaced to use all of it."
                : d.count != null ? `Fixed at ${d.count}, spread over the runs by length.` : "Counted from length and spacing."} Light 1 is at the wire-in.</p>
            </div>
            {installPanel(d)}
            {nameField}
            <div>
              <h2>Sections</h2>
              <div className="sectionrows">
                {d.sections.map((x) => (
                  <div key={x.id} className={`secrow ${x.id === s.activeSection ? "on" : ""}`}>
                    <span className="sw" style={{ background: x.color ?? "var(--y-lit)" }} />
                    <button type="button" className="nm" onClick={() => { s.activeSection = s.activeSection === x.id ? null : x.id; s.tool = "move"; s.selRun = null; render(); }}>{x.name}</button>
                    <span className="rng">{sectionRangeText(d.layout, d.sections, x.id).human}</span>
                  </div>
                ))}
              </div>
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => {
                  if (!s.draft) return;
                  const made = addSection(s.draft);
                  edit(() => made.draft);
                  s.activeSection = made.id;
                  s.selRun = null;
                  s.tool = "move";
                  render();
                  setTimeout(() => { const n = document.getElementById("ye-secname") as HTMLInputElement | null; n?.focus(); n?.select(); });
                }}>New section</button>
              </div>
              {unsectioned.length && d.sections.length ? <p className="note" style={{ marginTop: 6 }}>Not in any section: {unsectioned.map((x) => x.name).join(", ")}.</p> : null}
            </div>
            <div>
              <h2>Runs, from the wire-in · {s.phone ? "tap" : "click"} one {sec ? `to add it to ${sec.name} or take it out` : "to change it"}</h2>
              <div className="sectionrows">
                {(rows.length > 12 && !s.allRuns ? rows.slice(0, 6) : rows).map((x) => (
                  <div key={x.edge.id} className="secrow">
                    <span className="sw" style={{ background: sectionOfEdge(d.sections, x.edge.id)?.color ?? "var(--y-lit)" }} />
                    <button type="button" className="nm" data-run={x.edge.id} aria-pressed={sec ? sec.edgeIds.includes(x.edge.id) : undefined} onClick={() => {
                      if (sec) {
                        edit((y) => toggleRunInSection(y, sec.id, x.edge.id));
                        return;
                      }
                      s.selRun = x.edge.id;
                      s.activeSection = null;
                      if (s.phone) s.sheet = "";
                      render();
                      if (insp.current) insp.current.scrollTop = 0;
                    }}>{x.name}</button>
                    <span className="rng">{fmtLen(x.lengthM)} · {x.lights}{x.typed ? "*" : ""}</span>
                  </div>
                ))}
              </div>
              {rows.length > 12 ? (
                <button type="button" className="btn link" onClick={() => { s.allRuns = !s.allRuns; render(); }}>{s.allRuns ? "Show fewer runs" : `Show all ${rows.length} runs`}</button>
              ) : null}
            </div>
          </>
        ) : null}
        {rows.length === 0 ? nameField : null}
        <div className="btnrow">
          <button type="button" className="btn primary" disabled={rows.length === 0} onClick={() => void saveProp()}>{s.draftIsNew ? "Save and place" : "Save"}</button>
          <button type="button" className="btn" onClick={() => cancelProp()}>Cancel</button>
        </div>
        <p className="note keys">Keys: V select, T trace, A add point, Delete removes the selected run, ⌘/Ctrl+S saves, Esc leaves.</p>
      </>
    );
  }

  /** Where lights go when putting the string up, so the spacing matches the drawing. */
  function installPanel(d: Draft) {
    const shown = guideShown(d);
    const g = guideFor(d, s.guideEvery);
    if (!g) return null;
    const spiral = isSpiral(d.shape);
    return (
      <div>
        <div className="hrow">
          <h2>Install guide</h2>
          <button type="button" className="btn link" aria-pressed={shown} onClick={() => { s.guideOn = !shown; render(); draw(); }}>{shown ? "Hide on drawing" : "Show on drawing"}</button>
        </div>
        <div className="grid2">
          <NumRow id="ye-guide-every" label="Number every … lights" value={String(s.guideEvery)} onCommit={(v) => { if (v >= 1) { s.guideEvery = Math.round(v); render(); draw(); } }} />
        </div>
        {spiral && g.heights.length ? (
          <p className="note" id="ye-guide-heights">At each {s.units === "ft" ? "foot" : "25 cm"} up: {g.heights.map((h) => `${heightLabel(h.heightM)} light ${h.number}`).join(" · ")}.</p>
        ) : null}
        {d.shape === "zigzag" && g.turns.length ? (
          <p className="note" id="ye-guide-turns">Turn after light {g.turns.map((t) => t.number - 1).join(", ")}. {g.turns.map((t) => `${t.runName ?? "Next run"} starts at light ${t.number}`).slice(0, 3).join(" · ")}{g.turns.length > 3 ? "…" : ""}</p>
        ) : null}
        <p className="note">Count from light 1 at the wire-in. {g.counts.length ? `Lights ${g.counts.slice(0, 4).map((m) => m.number).join(", ")}${g.counts.length > 4 ? "…" : ""} are ringed on the drawing.` : `This prop has fewer than ${s.guideEvery} lights.`}{spiral ? " Height lines show which light sits at each mark going up." : ""}</p>
      </div>
    );
  }

  function runEditor(d: Draft, r: ReturnType<typeof runRows>[number]) {
    const step = s.units === "ft" ? 0.0254 : 0.05;
    const stepText = s.units === "ft" ? "1 in" : "5 cm";
    const key = sizeForRun(d, r.edge.id);
    const nudge = (sign: number) => edit((x) => setRunLength(x, r.edge.id, Math.max(step, r.lengthM + sign * step)));
    return (
      <div className="runbox">
        <h2>Selected run · {r.name}</h2>
        <label className="f">Length ({uLabel()})
          <span className="stepper">
            <button type="button" aria-label={`Shorter by ${stepText}`} onClick={() => nudge(-1)}>−</button>
            <CommitField id="ye-rlen" inputMode="decimal" value={String(+toU(r.lengthM).toFixed(2))} onCommit={(text) => { const v = parse(text); if (v != null && v > 0) edit((x) => setRunLength(x, r.edge.id, fromU(v))); }} />
            <button type="button" aria-label={`Longer by ${stepText}`} onClick={() => nudge(1)}>+</button>
          </span>
        </label>
        <div className="grid2" style={{ marginTop: 8 }}>
          <NumRow id="ye-rlights" label="Lights on this run" value={String(r.lights)} onCommit={(v) => { if (v >= 0) edit((x) => setRunLights(x, r.edge.id, Math.round(v))); }} />
          <label className="f">&nbsp;
            <button type="button" className="btn danger" onClick={() => { const id = r.edge.id; s.selRun = null; edit((x) => removeRun(x, id)); }}>Delete run</button>
          </label>
        </div>
        <p className="note">
          {r.typed ? <>Lights set by hand. <button type="button" className="btn link" onClick={() => edit((x) => countRunFromLength(x, r.edge.id))}>Count from length</button></> : "Lights follow the length."}{" "}
          {key ? `Changes the ${SHAPE_TITLES[d.shape ?? "draw"]}'s ${key === "base" ? "width" : key}, so the shape stays true.` : "The run's far end moves along the run."} ± steps {stepText}.
        </p>
        <div className="btnrow" style={{ marginTop: 6 }}>
          <button type="button" className="btn" onClick={() => { s.selRun = null; render(); }}>Done with this run</button>
        </div>
      </div>
    );
  }

  function sectionEditor(d: Draft, sec: PropSection) {
    const ranges = sectionRangeText(d.layout, d.sections, sec.id);
    return (
      <div className="runbox">
        <h2>Section · {tapWord().toLowerCase()} runs to add or remove</h2>
        <label className="f">Section name
          <CommitField
            id="ye-secname"
            className=""
            selectOnFocus={isAutoName(sec.name) || /^Section \d+$/.test(sec.name)}
            value={sec.name}
            maxLength={40}
            onLive={(text) => { if (s.draft && text.trim()) { s.draft = updateSection(s.draft, sec.id, { name: text.trim() }); s.draftDirty = true; } }}
            onCommit={(text) => { if (text.trim()) edit((x) => updateSection(x, sec.id, { name: text.trim() })); }}
          />
        </label>
        <div style={{ marginTop: 8 }}>
          <ColourInput label="Section colour" value={sec.color ?? "#d4a574"} onChange={(hex) => edit((x) => updateSection(x, sec.id, { color: hex }))} />
        </div>
        <p className="note">{ranges.empty ? `Empty. ${tapWord()} runs on the drawing to put them in this section.` : `Lights ${ranges.human} (WLED counts from 0: ${ranges.wled}).`}</p>
        <div className="btnrow" style={{ marginTop: 6 }}>
          <button type="button" className="btn" onClick={() => { s.activeSection = null; render(); }}>Done with {sec.name}</button>
          <button type="button" className="btn danger" onClick={() => { s.activeSection = null; edit((x) => deleteSection(x, sec.id)); }}>Delete section</button>
        </div>
      </div>
    );
  }

  function lookPropPanel(p: Prop, L: Look) {
    const on = propOn(L, p.id);
    const sections = p.sections ?? [];
    const sid = s.lensSection && sections.some((x) => x.id === s.lensSection) ? s.lensSection : null;
    const style = styleFor(L, p, sid ?? undefined);
    const allIds = s.props.map((q) => q.id);
    const chip = (id: string, label: string, dot: string, off: boolean) => (
      <button key={id || "whole"} type="button" className="btn" aria-pressed={(sid ?? "") === id} style={(sid ?? "") === id ? { borderColor: "var(--y-pick)", color: "var(--y-pick)" } : undefined} onClick={() => { s.lensSection = id || null; render(); }}>
        <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: dot, border: "1px solid var(--y-input)", marginRight: 6 }} />
        {label}{off ? " (off)" : ""}
      </button>
    );
    return (
      <>
        <div>
          <div className="title"><h1>{p.label}</h1></div>
          <p className="sub">In “{L.name}” · {on ? "on" : "off"}</p>
        </div>
        <button type="button" className={`btn ${on ? "" : "primary"}`} style={{ minHeight: 44 }} onClick={() => commitLook((k) => setPropOn(k, allIds, p.id, !on))}>{on ? "Switch off in this Look" : "Switch on in this Look"}</button>
        {on ? (
          <>
            {sections.length > 0 ? (
              <div>
                <h2>Colour for</h2>
                <div className="btnrow">
                  {chip("", "Whole prop", styleFor(L, p).color, false)}
                  {sections.map((x) => { const lit = sectionLit(L, p.id, x.id); return chip(x.id, x.name, lit ? styleFor(L, p, x.id).color : "transparent", !lit); })}
                </div>
              </div>
            ) : null}
            <div className="grid2">
              <label className="f">Colour
                <ColourInput label="Look colour" value={style.color} onChange={(hex) => commitLook((k) => setLookStyle(k, p, sid ?? undefined, { color: hex }))} />
              </label>
              <label className="f">Effect
                <select value={style.fx} onChange={(e) => commitLook((k) => setLookStyle(k, p, sid ?? undefined, { fx: Number(e.target.value) }))}>
                  {LOOK_EFFECTS.map((fx) => <option key={fx.fx} value={fx.fx}>{fx.label}</option>)}
                </select>
              </label>
            </div>
            {sid ? (
              <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 8, color: "var(--y-fg)", fontSize: 14 }}>
                <input type="checkbox" checked={sectionLit(L, p.id, sid)} onChange={(e) => commitLook((k) => setSectionLit(k, p, sid, e.target.checked))} /> {sections.find((x) => x.id === sid)?.name} lights up
              </label>
            ) : null}
            {sections.length > 0 && !sid ? <p className="note">Pick a section to give it its own colour or switch it off. You can also {tapWord().toLowerCase()} the section on the drawing.</p> : null}
          </>
        ) : null}
        <div className="btnrow"><button type="button" className="btn" onClick={() => { s.sel = null; render(); }}>Back to the whole Look</button></div>
      </>
    );
  }

  function lookSummary(L: Look) {
    const on = s.props.filter((p) => propOn(L, p.id));
    return (
      <>
        <div>
          <div className="title"><h1>{L.name}</h1></div>
          <p className="sub">Look · {on.length} of {s.props.length} props on</p>
        </div>
        <label className="f">Look name
          <CommitField
            id="ye-lookname"
            className=""
            selectOnFocus={/^Look \d+$/.test(L.name)}
            value={L.name}
            maxLength={32}
            onCommit={(text) => { if (text.trim()) commitLook((k) => ({ ...k, name: text.trim() })); }}
          />
        </label>
        <p className="note">{tapWord()} a prop to switch it on, pick its colour, or turn its sections off. Changes save as you go.</p>
        {on.length < s.props.length ? <div className="btnrow"><button type="button" className="btn" onClick={() => commitLook((k) => setAllOn(k, s.props.map((p) => p.id)))}>Switch every prop on</button></div> : null}
        <p className="proto">The playlist, the nightly schedule and Push to Lights stay on the <Link href="/looks">Looks page</Link>.</p>
        <div className="btnrow">
          <button type="button" className="btn primary" onClick={closeLook}>Done</button>
          <button type="button" className="btn danger" onClick={deleteLook}>Delete Look</button>
        </div>
      </>
    );
  }

  // ---------- render ----------
  const editing = s.view !== "yard";
  const d = s.draft;
  const L = look();
  const p = yardSel();
  let chip: React.ReactNode = null;
  let hint = "";
  if (inProp() && d) {
    chip = <><b>{s.draftIsNew ? "New prop" : "Editing"}</b> {d.label}</>;
    const shaped = Boolean(d.layout && d.layout.corners.length > 0);
    hint = !shaped ? "" : s.activeSection ? "Click runs to put them in the highlighted section. Esc stops." : s.tool === "trace" ? "Click empty space to add a run from the last corner. Click a corner to go back over it." : s.tool === "split" ? "Click a run to add a point on it." : "Drag a corner to reshape. Click a run to set its length or lights. Drag empty space to pan.";
  } else if (s.placing) {
    chip = s.phone ? <><b>Place</b> drag the outline, then Place here</> : <><b>Place</b> {s.placing.label}</>;
    hint = "Click where it goes in the yard. Esc puts it next to the others.";
  } else if (L) {
    chip = s.phone ? null : <><b>Look</b> {L.name}</>;
    hint = "Click a prop to set it in this Look. Click a section of the selected prop to colour it on its own.";
  } else {
    hint = "Click a prop to select it. Drag to move it. Double-click to edit it on its own canvas. Scroll pans; Ctrl/⌘ + scroll zooms.";
  }
  const shaped = Boolean(d?.layout && d.layout.corners.length > 0 && runRows(d).length + (d.shape === "draw" ? 0 : 1) > 0);
  const toolBtn = (k: Tool, label: string, key: string) => (
    <button key={k} type="button" aria-pressed={s.tool === k} title={key} onClick={() => { s.tool = k; render(); }}>{label}</button>
  );
  const sortedProps = [...s.props].filter((q) => q.id !== s.placing?.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const canUndo = inProp() ? s.dpast.length > 0 : s.past.length > 0;
  const canRedo = inProp() ? s.dfuture.length > 0 : s.future.length > 0;

  let panel: React.ReactNode;
  if (inProp() && d) panel = propPanel(d);
  else if (s.placing) panel = placingPanel(s.placing);
  else if (L) panel = p ? lookPropPanel(p, L) : lookSummary(L);
  else panel = p ? yardPropPanel(p) : yardSummary();

  return (
    <div className={`ye app ${editing ? "editing" : ""}`} data-testid="yard-editor">
      <header className="top">
        <Link href="/" className="brand" aria-label="Nightplot yard"><i aria-hidden="true" />Nightplot</Link>
        <nav className="nav" aria-label="Nightplot" hidden={editing}>
          <Link href="/" className="on" aria-current="page">Yard</Link>
          <Link href="/looks">Looks</Link>
          <Link href="/lights">Lights</Link>
          <Link href="/yard">Check</Link>
          <details className="more">
            <summary>More</summary>
            <div className="menu">
              <Link href="/discover">Find Lights</Link>
              <Link href="/led-products">LED products</Link>
              <Link href="/backups">Backups</Link>
              <Link href="/sync">Sync</Link>
              <Link href="/settings">Settings</Link>
            </div>
          </details>
        </nav>
        {editing ? (
          <div className="crumb">
            <a href="#" onClick={(e) => { e.preventDefault(); if (inProp()) cancelProp(); else closeLook(); }}>Yard</a>
            <span aria-hidden="true">›</span>
            <b>{inProp() ? d?.label || "New prop" : `Look: ${L?.name ?? ""}`}</b>
          </div>
        ) : null}
        <span className="spacer" />
        {inProp() && s.draftDirty ? <span className="dirty">Not saved yet</span> : null}
        <button type="button" className="iconbtn" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={() => void undo()}>↶</button>
        <button type="button" className="iconbtn" id="ye-redo" aria-label="Redo" title="Redo (Shift+Ctrl/⌘+Z)" disabled={!canRedo} onClick={() => void redo()}>↷</button>
        {!inProp() ? <span className={`saved ${s.savingBusy ? "busy" : ""}`} role="status">{s.saving}</span> : null}
        {inProp() ? (
          <>
            <button type="button" className="btn" onClick={() => cancelProp()}>Cancel</button>
            <button type="button" className="btn primary" disabled={!d || runRows(d).length === 0} onClick={() => void saveProp()}>{s.draftIsNew && !s.phone ? "Save and place" : "Save"}</button>
          </>
        ) : null}
        {L ? <button type="button" className="btn primary" onClick={closeLook}>Done</button> : null}
        {!editing ? <div className="alloff"><AllOffControl size="bar" lights={init.lightViews} sessions={init.sessions} /></div> : null}
      </header>
      <div className={`main ${inProp() ? "editor" : ""}`}>
        <aside className={`rail ${s.railOpen ? "open" : ""}`}>
          <button type="button" className="newbtn" onClick={() => openProp(null, true)}>+ New prop</button>
          <section>
            <h2>Props</h2>
            <ul className="plist">
              {sortedProps.length === 0 ? <li className="note">No props yet. A prop is a shape: a roofline, a window, an arch. It does not need a controller.</li> : null}
              {sortedProps.map((q) => {
                const off = L && !propOn(L, q.id);
                return (
                  <li key={q.id} className={off ? "off" : ""}>
                    <button type="button" className={q.id === s.sel ? "on" : ""} onClick={() => { s.sel = q.id; s.confirmDelete = false; s.railOpen = false; s.lensSection = null; s.sheet = s.sheet || "half"; setQuery(L ? { look: s.lookId } : { prop: q.id }); render(); requestAnimationFrame(() => fitIfOff(q.id)); }}>
                      <span className="dot" />{q.label}<span className="n">{q.layout ? countLayout(q.layout).total : q.design?.ledCount ?? "?"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h2>Looks</h2>
            {s.looksDoc ? (
              <>
                <ul className="plist">
                  {s.looksDoc.looks.map((k) => {
                    const n = s.props.filter((q) => propOn(k, q.id)).length;
                    return (
                      <li key={k.id}>
                        <button type="button" className={k.id === s.lookId ? "on" : ""} onClick={() => openLook(k.id)}>
                          <span className="dot" style={{ background: "var(--y-pick)" }} />{k.name}<span className="n">{n}/{s.props.length}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="btn" style={{ marginTop: 6, width: "100%" }} onClick={newLook}>+ New Look</button>
              </>
            ) : <p className="note">Could not read Looks.</p>}
          </section>
          <nav className="railnav" aria-label="Nightplot pages">
            <Link href="/looks">Looks page</Link>
            <Link href="/lights">Lights</Link>
            <Link href="/yard">Yard check</Link>
            <Link href="/sync">Sync</Link>
            <Link href="/discover">Find Lights</Link>
            <Link href="/led-products">LED products</Link>
            <Link href="/backups">Backups</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </aside>
        <div className="stagewrap" ref={wrap}>
          <canvas
            ref={cv}
            aria-label={inProp() ? `Drawing of ${d?.label ?? "the new prop"}` : "Yard drawing"}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onDoubleClick={(e) => {
              if (inProp() || look() || s.placing) return;
              const { px, py } = localPoint(e);
              const hit = hitProp(view(), yardDrawables(), px, py);
              const prop = hit ? s.props.find((q) => q.id === hit.id) : null;
              if (prop) openProp(prop, false);
            }}
            onWheel={(e) => {
              const { px, py } = localPoint(e);
              if (e.ctrlKey || e.metaKey) s.cam = zoomAt(s.cam, size.current.W, size.current.H, px, py, Math.exp(-e.deltaY * 0.01));
              else s.cam = { ...s.cam, x: s.cam.x + e.deltaX / s.cam.ppm, y: s.cam.y - e.deltaY / s.cam.ppm };
              draw();
            }}
          />
          {inProp() && d && !shaped ? (
            <div className="empty"><div><strong>A clean canvas</strong><span>{s.phone ? "Pick a shape below. Or pick Draw it, then tap where the wire comes in." : "Pick a starting shape in the panel, or choose Draw it and click where the wire comes in."}</span></div></div>
          ) : null}
          {!inProp() ? <div className="phonebar"><button type="button" aria-label="Props and Looks" onClick={() => { s.railOpen = !s.railOpen; render(); }}>☰ Props &amp; Looks</button></div> : null}
          {chip ? <div className={`modechip ${inProp() ? "path" : ""}`}>{chip}</div> : null}
          {inProp() && shaped ? (
            <div className="tools">
              {toolBtn("move", "Select / move", "V")}
              {toolBtn("trace", "Trace", "T")}
              {toolBtn("split", "Add point", "A")}
              <span className="sep" />
              <button type="button" onClick={fitDraft}>Fit</button>
            </div>
          ) : null}
          <div className="coords" id="ye-coords" hidden />
          <p className="hint" style={s.error ? { color: "var(--y-danger)" } : undefined}>{s.error ?? hint}</p>
          <div className="zoom">
            <button type="button" aria-label="Zoom out" onClick={() => { s.cam = zoomAt(s.cam, size.current.W, size.current.H, size.current.W / 2, size.current.H / 2, 0.8); draw(); }}>−</button>
            <button type="button" aria-label="Zoom in" onClick={() => { s.cam = zoomAt(s.cam, size.current.W, size.current.H, size.current.W / 2, size.current.H / 2, 1.25); draw(); }}>+</button>
            <button type="button" onClick={() => (inProp() ? fitDraft() : fitYard())}>Fit</button>
          </div>
        </div>
        <aside className={`insp ${s.sheet === "half" ? "half" : ""} ${s.sheet === "full" ? "full" : ""}`} ref={insp} aria-label="Details">
          {sheetHandle}
          {s.error && s.phone ? <p className="note" role="alert" style={{ color: "var(--y-danger)" }}>{s.error}</p> : null}
          {panel}
        </aside>
      </div>
    </div>
  );
}

