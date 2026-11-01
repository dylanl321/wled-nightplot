"use client";

/**
 * The one-page yard editor. The yard is home and shows every prop. Building
 * or editing a prop opens its own clean canvas (Save / Cancel) and returns
 * to the yard; a new prop comes back as an outline to place. Looks open on
 * the Looks page (`/looks/<id>`), which draws the same yard in their colours.
 *
 * Ported from docs/prototypes/yard-page.html (v4). Editor state lives in one
 * ref, as in the prototype, so a drag or pinch redraws the canvas without a
 * React render; `render()` re-renders the panels.
 */
import {
  applyCommand,
  countLayout,
  drawnYard,
  ensureStrings,
  formatLength,
  lookIncludesProp,
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
import { YardCanvas } from "@/components/looks/yard-canvas";
import { deleteJson, patchJson, postJson, putJson } from "@/lib/api";
import { ColourInput, CommitField } from "./fields";
import {
  addPoint,
  addSection,
  countRunFromLength,
  deleteSection,
  dragCorner,
  drawRows,
  draftFromProp,
  isAutoName,
  kindOfShape,
  lightTotal,
  measurementsOf,
  newDraft,
  nextName,
  placeWireIn,
  removeRun,
  renameForShape,
  resetToTemplate,
  runRows,
  sectionOfEdge,
  sectionRangeText,
  setCount,
  setZigzagDirection,
  guideFor,
  isSpiral,
  setRunLength,
  setRunLights,
  setSize,
  setSpacing,
  setUnits,
  SHAPE_TITLES,
  SHAPES,
  SIZE_FIELDS,
  sizeForRun,
  startFrom,
  toggleRunInSection,
  totalLengthM,
  updateSection,
  addRunLight,
  alongRunAt,
  lightMarks,
  moveRunLight,
  pointAlongRun,
  removeRunLight,
  spaceRunEvenly,
  type Draft,
  type LightPick,
  type SizeKey,
} from "./model";
import { mergeToast, previewRun, previewTotals } from "@/components/props/trace-preview";
import { initialTool, LONG_PRESS_MS, reduceTool, type ToolEffect, type ToolHit, type ToolState } from "@/components/props/tool-machine";
import {
  drawRubber,
  drawScene,
  fitBox,
  hitCorner,
  hitDot,
  hitProp,
  hitRun,
  pointHitSlop,
  readColours,
  showLightDots,
  View,
  visibleRect,
  zoomAt,
  type Camera,
  type DrawEdge,
  type DrawGuide,
  type DrawProp,
  type LightDot,
  type RubberBand,
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
  /** From the address bar: `view=new`, `prop=<id>`, `view=edit`, `fold=controller` (`look=<id>` redirects to the Looks page). */
  query: { view?: string; prop?: string; look?: string; fold?: string };
};

type ViewName = "yard" | "prop";
type Tool = "move" | "trace" | "split";
type Snapshot = { props: Prop[]; looks: Look[] | null };

const UNIT_KEY = "nightplot.propUnit";
const PITCH_KEY = "nightplot.propPitchM";
const NEXT_RUN_KEY = "nightplot.propNextRun";
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
    street: false,
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
    nextRun: "lit" as "lit" | "dark",
    toast: null as string | null,
    band: null as RubberBand | null,
    selRun: null as string | null,
    /** A corner picked with a finger. Delete point and a long-press both remove it. */
    selPoint: null as string | null,
    /** A single light picked on the prop canvas, and where it is while it is dragged. */
    selLight: null as LightPick | null,
    slide: null as (LightPick & { alongM: number }) | null,
    dotsOn: false,
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
  const traceRef = useRef<ToolState>(initialTool("edit"));

  const inProp = () => s.view === "prop";
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
        const letter = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
        string.run.forEach((edge, runIndex) => {
          const a = layout.corners.find((c) => c.id === edge.from);
          const b = layout.corners.find((c) => c.id === edge.to);
          if (!a || !b) return;
          used.add(a.id);
          used.add(b.id);
          const n = counted.get(edge.id)?.lights ?? 0;
          lights += n;
          edges.push({
            id: edge.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, lights: n,
            color: edge.kind === "wire" ? null : colour(edge.id), wire: edge.kind !== "lit", typed: typed && edge.lockedLights != null,
            badge: `${letter}${runIndex + 1}`,
            ...(edge.wrapLengthM != null ? { lengthM: counted.get(edge.id)?.lengthM ?? edge.wrapLengthM } : {}),
          });
        });
      });
      for (const corner of layout.corners) if (used.has(corner.id)) corners.push(corner);
    }
    return { id, name, x: at.x, y: at.y, edges, corners, start, lights, box: layoutBox(layout ?? undefined) };
  }

  function yardDrawables(): DrawProp[] {
    const at = placements();
    return s.props
      .filter((p) => p.id !== s.placing?.id)
      .map((p) => {
        const place = at.get(p.id)?.at ?? { x: 0, y: 0 };
        const colour = (edgeId: string) => sectionOfEdge(p.sections ?? [], edgeId)?.color ?? lit();
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
      mode: inProp() ? "prop" : "yard",
      units: s.units,
      phone: s.phone,
      props,
      selectedId: s.sel,
      ghost,
      selectedRun: s.selRun,
      sectionRuns: section,
      fmtLen,
      guide: inProp() ? drawGuideFor(s.draft) : null,
      dots: inProp() ? lightDots() : null,
      badges: inProp() && s.draft?.shape === "draw",
      selectedPoint: inProp() ? s.selPoint : null,
    }, coloursRef.current, size.current.dpr);
    if (s.band && coloursRef.current) drawRubber(ctx, view(), s.band, coloursRef.current);
    placePointBar();
    // The run panel says whether the dots are showing; zooming changes that without a React render.
    const dotsNow = inProp() && dotsShown();
    if (dotsNow !== s.dotsOn) {
      s.dotsOn = dotsNow;
      if (s.selRun) render();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Delete point sits off the runs, the captions, and the other points. */
  function placePointBar() {
    const el = document.getElementById("ye-pointbar");
    if (!el) return;
    const shape = draftDrawable();
    const corner = shape?.corners.find((c) => c.id === s.selPoint);
    if (!s.selPoint || !s.phone || !shape || !corner) {
      el.hidden = true;
      return;
    }
    const vw = view();
    const x = vw.sx(corner.x + shape.x);
    const y = vw.sy(corner.y + shape.y);
    const w = 148;
    const h = 44;
    const frac = s.sheet === "full" ? 0.88 : s.sheet === "half" ? 0.58 : 0.34;
    const sheetTop = size.current.H * (1 - frac);
    let bx = 0;
    let by = 0;
    for (const edge of shape.edges) {
      const ax = vw.sx(edge.ax + shape.x);
      const ay = vw.sy(edge.ay + shape.y);
      const ex = vw.sx(edge.bx + shape.x);
      const ey = vw.sy(edge.by + shape.y);
      const fromHere = Math.hypot(ax - x, ay - y) < 8;
      const toHere = Math.hypot(ex - x, ey - y) < 8;
      if (!fromHere && !toHere) continue;
      const dx = fromHere ? ex - ax : ax - ex;
      const dy = fromHere ? ey - ay : ay - ey;
      const len = Math.hypot(dx, dy) || 1;
      bx += dx / len;
      by += dy / len;
    }
    const len = Math.hypot(bx, by) || 1;
    const ux = -bx / len;
    const uy = -by / len;
    // The button hangs off one edge of the point, so it does not straddle the runs.
    const spots = [
      { x: ux, y: uy },
      { x: -uy, y: ux },
      { x: uy, y: -ux },
      { x: -ux, y: -uy },
    ];
    const blocks: { x: number; y: number; hw: number; hh: number }[] = [];
    for (const edge of shape.edges) {
      const ax = vw.sx(edge.ax + shape.x);
      const ay = vw.sy(edge.ay + shape.y);
      const ex = vw.sx(edge.bx + shape.x);
      const ey = vw.sy(edge.by + shape.y);
      const seg = Math.hypot(ex - ax, ey - ay) || 1;
      const nx = -(ey - ay) / seg;
      const ny = (ex - ax) / seg;
      const mx = (ax + ex) / 2;
      const my = (ay + ey) / 2;
      blocks.push({ x: mx + nx * 46, y: my + ny * 46, hw: 56, hh: 14 });
      blocks.push({ x: mx - nx * 36, y: my - ny * 36, hw: 16, hh: 16 });
    }
    let best: { left: number; top: number; score: number } | null = null;
    for (const spot of spots) {
      const nearX = x + spot.x * 32;
      const nearY = y + spot.y * 32;
      let left = spot.x >= 0 ? nearX : nearX - w;
      let top = spot.y >= 0 ? nearY : nearY - h;
      left = Math.max(8, Math.min(size.current.W - w - 8, left));
      top = Math.max(52, Math.min(sheetTop - h - 8, top));
      const mx = left + w / 2;
      const my = top + h / 2;
      let score = 80;
      if (left < x && left + w > x && top < y && top + h > y) score -= 500;
      for (const other of shape.corners) {
        if (other.id === corner.id) continue;
        const ox = vw.sx(other.x + shape.x);
        const oy = vw.sy(other.y + shape.y);
        if (ox > left - 12 && ox < left + w + 12 && oy > top - 12 && oy < top + h + 12) score -= 300;
      }
      for (const block of blocks) {
        const overlaps = Math.abs(mx - block.x) < w / 2 + block.hw && Math.abs(my - block.y) < h / 2 + block.hh;
        if (overlaps) score -= 220;
      }
      if (!best || score > best.score) best = { left, top, score };
    }
    el.hidden = false;
    el.style.left = `${best?.left ?? 8}px`;
    el.style.top = `${best?.top ?? 56}px`;
  }

  /** Whole prop on screen: dots wait for a bigger zoom so a fitted drawing stays readable. */
  function draftFits(d: Draft): boolean {
    if (!d.layout) return true;
    const b = layoutBox(d.layout);
    const vw = view();
    const { W, H } = size.current;
    return vw.sx(b.minX) >= 0 && vw.sx(b.maxX) <= W && vw.sy(b.maxY) >= 0 && vw.sy(b.minY) <= H;
  }

  function dotsShown(): boolean {
    const d = s.draft;
    return Boolean(d?.layout && !s.activeSection && showLightDots(d.layout.pitchM, s.cam.ppm, draftFits(d)));
  }

  /** Every light as a numbered dot, from 0 at the wire-in, once zoomed in. */
  function lightDots(): LightDot[] | null {
    const d = s.draft;
    if (!d || !dotsShown()) return null;
    const byEdge = new Map<string, ReturnType<typeof lightMarks>>();
    for (const mark of lightMarks(d)) byEdge.set(mark.edgeId, [...(byEdge.get(mark.edgeId) ?? []), mark]);
    const dots: LightDot[] = [];
    const same = (a: LightPick | null, edgeId: string, id: string | null, station: number) =>
      Boolean(a && a.edgeId === edgeId && (a.id != null ? a.id === id : a.station === station));
    for (const [edgeId, row] of byEdge) {
      const shown = row.map((mark, station) => {
        if (!s.slide || !same(s.slide, edgeId, mark.id, station)) return { mark, station };
        const at = pointAlongRun(d, edgeId, s.slide.alongM);
        return { mark: at ? { ...mark, alongM: s.slide.alongM, x: at.x, y: at.y } : mark, station };
      });
      const order = [...shown].sort((a, b) => a.mark.alongM - b.mark.alongM || a.station - b.station);
      const first = Math.min(...row.map((mark) => mark.index));
      for (const item of shown) {
        dots.push({
          edgeId,
          id: item.mark.id,
          station: item.station,
          x: item.mark.x,
          y: item.mark.y,
          // Counted from 1 at the wire-in, like the section ranges and the install guide on this page.
          label: String(first + order.indexOf(item) + 1),
          selected: same(s.selLight, edgeId, item.mark.id, item.station),
        });
      }
    }
    return dots;
  }

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

  // ---------- Looks: put back after an undo ----------
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
      s.toast = null;
      if (s.selPoint && !s.draft.layout?.corners.some((c) => c.id === s.selPoint)) s.selPoint = null;
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
    s.selPoint = null;
    s.toast = null;
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
    s.selPoint = null;
    s.toast = null;
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
    | { kind: "pan"; cam: Camera; px: number; py: number; moved: boolean; onTap?: () => void; deselect?: boolean; button?: number; noPan?: boolean }
    | { kind: "prop"; id: string; ox: number; oy: number; wx: number; wy: number; px: number; py: number; moved: boolean; pushed: boolean }
    | { kind: "corner"; id: string; px: number; py: number; moved: boolean }
    | { kind: "point"; id: string; hit: ToolHit; px: number; py: number; moved: boolean }
    | { kind: "light"; pick: LightPick; px: number; py: number; moved: boolean }
    | { kind: "ghost"; gx: number; gy: number; wx: number; wy: number; px: number; py: number; moved: boolean };
  const dragRef = useRef<Drag | null>(null);
  const holdRef = useRef<{ timer: number; fired: boolean } | null>(null);
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
      // A second finger means pinch: whatever the first finger was dragging goes back.
      if (drag?.kind === "corner") {
        const before = s.dpast.pop();
        if (drag.moved && before) s.draft = JSON.parse(before) as Draft;
      }
      clearHold();
      if (drag?.kind === "light") s.slide = null;
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
      propPointer(px, py, e.button, e.pointerType);
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
      if (s.sel !== hit.id) {
        s.sel = hit.id;
        s.confirmDelete = false;
        s.lensSection = null;
        s.ctrl = { ...s.ctrl, notice: null, applied: false };
        if (!s.sheet) s.sheet = "half";
        setQuery({ prop: hit.id });
        render();
      }
      dragRef.current = { kind: "prop", id: hit.id, ox: hit.x, oy: hit.y, wx: vw.wx(px), wy: vw.wy(py), pushed: false, ...start };
      return;
    }
    dragRef.current = { kind: "pan", cam: { ...s.cam }, deselect: true, ...start };
  }

  /** Phone taps add a point only after Draw it is picked. A template stays put. */
  function tracingAllowed(): boolean {
    const d = s.draft;
    if (!d || s.tool !== "trace" || s.activeSection) return false;
    if (s.phone && d.shape !== "draw") return false;
    return true;
  }

  function showTrace(text: string | null) {
    const el = document.getElementById("ye-trace");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text ?? "";
  }

  function tailOf(layout: NonNullable<Draft["layout"]>) {
    const string = layoutStrings(ensureStrings(layout))[0];
    if (!string) return null;
    const id = string.run.length > 0 ? string.run[string.run.length - 1]!.to : string.startId;
    const corner = layout.corners.find((row) => row.id === id);
    return corner ? { string, id, corner } : null;
  }

  function runKind(button: 0 | 2): "lit" | "wire" {
    const left = s.nextRun === "dark" ? "wire" : "lit";
    return button === 2 ? (left === "lit" ? "wire" : "lit") : left;
  }

  function commitLayout(layout: NonNullable<Draft["layout"]>, notice?: string) {
    edit((d) => ({ ...d, drawn: true, layout }));
    s.toast = notice ?? null;
    s.band = null;
    showTrace(null);
    if (notice) render();
  }

  function traceHit(px: number, py: number): ToolHit {
    const d = s.draft;
    const shape = draftDrawable();
    if (!d?.layout || !shape) return { kind: "empty" };
    const tail = tailOf(d.layout);
    const cornerId = hitCorner(view(), shape, px, py);
    const onlyPoint = d.layout.corners.length === 1 && (tail?.string.run.length ?? 0) === 0;
    if (!cornerId || !tail) return { kind: "empty" };
    const role = cornerId === tail.string.startId ? "wire-in" : cornerId === tail.id ? "tail" : "corner";
    return { kind: "point", id: cornerId, role, onlyPoint };
  }

  function finishChain() {
    traceRef.current = { ...traceRef.current, gesture: "idle", lengthDraft: "", press: null, dragId: null };
    s.band = null;
    showTrace(null);
    draw();
  }

  function updateBand(px: number, py: number, button: 0 | 2) {
    const d = s.draft;
    if (!d?.layout || !tracingAllowed() || traceRef.current.gesture === "idle") {
      s.band = null;
      showTrace(null);
      draw();
      return;
    }
    const tail = tailOf(d.layout);
    if (!tail) return;
    const vw = view();
    const point = { x: snapV(vw.wx(px)), y: snapV(vw.wy(py)) };
    const kind = runKind(button);
    const preview = previewRun({ from: tail.corner, to: point, pitchM: d.layout.pitchM, kind, units: d.layout.units });
    if (!preview.valid) {
      s.band = null;
      showTrace(null);
      draw();
      return;
    }
    const order = tail.string.run.length + 1;
    const name = `A${order}`;
    s.band = {
      ax: tail.corner.x, ay: tail.corner.y, bx: point.x, by: point.y,
      wire: kind === "wire",
      lengthText: preview.lengthText,
      countText: preview.countText,
      dots: preview.dots,
      wireIn: shapeStart(d.layout),
    };
    showTrace(`${name} · ${preview.lengthText} · ${preview.countText}\nAfter: ${previewTotals(d.layout, preview, kind)}`);
    draw();
  }

  function shapeStart(layout: NonNullable<Draft["layout"]>): { x: number; y: number } | null {
    const id = layoutStrings(ensureStrings(layout))[0]?.startId;
    const corner = id ? layout.corners.find((row) => row.id === id) : undefined;
    return corner ? { x: corner.x, y: corner.y } : null;
  }

  function pointWord(id: string): string {
    const layout = s.draft?.layout;
    const tail = layout ? tailOf(layout) : null;
    if (tail?.string.startId === id) return "Wire in";
    if (tail?.id === id) return "Last point";
    return "Point";
  }

  function buzz() {
    const vibrate = navigator.vibrate?.bind(navigator);
    if (!vibrate) return;
    try {
      vibrate(20);
    } catch {
      // A phone can refuse vibration. The point still goes.
    }
  }

  function clearHold() {
    if (holdRef.current) window.clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }

  /** Select, or remove with the merge rule. The toast always offers Undo. */
  function applyPointEffect(effect: ToolEffect): boolean {
    const d = s.draft;
    if (!d?.layout) return false;
    const tail = tailOf(d.layout);
    const stringId = tail?.string.id ?? "s1";
    if (effect.type === "selectPoint") {
      s.selPoint = effect.pointId;
      s.selRun = null;
      s.selLight = null;
      render();
      return true;
    }
    if (effect.type === "removePoint" || effect.type === "popTail") {
      const cornerId = effect.type === "popTail" ? tail?.id : effect.pointId;
      if (!cornerId) return true;
      const applied = applyCommand(d.layout, { type: "removePoint", cornerId, stringId });
      const wireIn = tail?.string.startId === cornerId;
      if (!applied.inverse) {
        s.toast = wireIn || applied.refused === "wire-in"
          ? "The wire-in stays unless it is the only point."
          : "That point stays.";
        render();
        return true;
      }
      if (s.selPoint === cornerId) s.selPoint = null;
      commitLayout(applied.layout, applied.merge ? mergeToast(applied.merge) : "Point removed.");
      return true;
    }
    if (effect.type === "refuseWireIn" || effect.type === "removeWireIn") {
      s.toast = "The wire-in stays unless it is the only point.";
      render();
      return true;
    }
    return false;
  }

  function touchStep(hit: ToolHit, held: boolean) {
    const step = reduceTool(traceRef.current, {
      type: "pointer",
      phase: "up",
      button: 0,
      pointerType: "touch",
      hit,
      moved: false,
      held,
      detail: 0,
      shift: false,
      modifierPan: false,
    });
    traceRef.current = step.state;
    applyPointEffect(step.effect);
  }

  function armHold(hit: ToolHit) {
    clearHold();
    const timer = window.setTimeout(() => {
      const hold = holdRef.current;
      if (!hold || hold.fired) return;
      hold.fired = true;
      buzz();
      touchStep(hit, true);
    }, LONG_PRESS_MS);
    holdRef.current = { timer, fired: false };
  }

  function traceClick(button: 0 | 2, px: number, py: number) {
    const d = s.draft;
    if (!d?.layout || !tracingAllowed()) return;
    const step = reduceTool(traceRef.current, {
      type: "pointer",
      phase: "up",
      button,
      pointerType: "mouse",
      hit: traceHit(px, py),
      moved: false,
      detail: 0,
      shift: false,
      modifierPan: false,
    });
    traceRef.current = step.state;
    if (applyPointEffect(step.effect)) return;
    const vw = view();
    const point = { x: snapV(vw.wx(px)), y: snapV(vw.wy(py)) };
    const tail = tailOf(d.layout);
    const stringId = tail?.string.id ?? "s1";
    if (step.effect.type === "place") {
      s.selPoint = null;
      const applied = applyCommand(d.layout, { type: "addPoint", stringId, x: point.x, y: point.y, kind: step.effect.kind });
      if (applied.inverse) commitLayout(applied.layout);
      return;
    }
    if (step.effect.type === "join") {
      s.selPoint = null;
      const applied = applyCommand(d.layout, { type: "joinPoint", stringId, cornerId: step.effect.pointId, kind: step.effect.kind });
      if (applied.inverse) commitLayout(applied.layout);
      return;
    }
    if (step.effect.type === "finishChain") finishChain();
  }

  function propPointer(px: number, py: number, button: number, pointerType: string) {
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
          traceRef.current = { ...traceRef.current, mode: "trace", gesture: "tracing", nextRun: s.nextRun };
          edit((x) => placeWireIn({ ...x, label: renameForShape(x.label, "draw", s.props.map((p) => p.label)) }, snapV(vw.wx(px)), snapV(vw.wy(py)), s.units, s.pitchDefault));
          if (s.phone) s.sheet = "";
          render();
        },
      };
      return;
    }
    const finger = pointerType !== "mouse";
    const ci = hitCorner(vw, shape, px, py, pointHitSlop(finger));
    const hr = hitRun(vw, shape, px, py, finger ? 22 : 10);
    const layout = d.layout;
    if (ci && finger && !s.activeSection && layout) {
      const tail = tailOf(layout);
      const onlyPoint = layout.corners.length === 1 && (tail?.string.run.length ?? 0) === 0;
      const role = !tail ? "corner" : ci === tail.string.startId ? "wire-in" : ci === tail.id ? "tail" : "corner";
      const hit: ToolHit = { kind: "point", id: ci, role, onlyPoint };
      dragRef.current = { kind: "point", id: ci, hit, ...start };
      armHold(hit);
      return;
    }
    if (ci && s.tool === "move" && !s.activeSection) {
      s.dpast.push(JSON.stringify(d));
      s.dfuture.length = 0;
      dragRef.current = { kind: "corner", id: ci, ...start };
      return;
    }
    const dots = s.tool === "move" ? lightDots() : null;
    const dot = dots ? hitDot(vw, dots, px, py) : null;
    if (dot) {
      const pick = { edgeId: dot.edgeId, id: dot.id, station: dot.station };
      s.selLight = pick;
      s.selRun = dot.edgeId;
      dragRef.current = { kind: "light", pick, ...start };
      render();
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
    } else if (ci && tracingAllowed()) {
      onTap = () => traceClick(button === 2 ? 2 : 0, px, py);
    } else if (hr && dots && s.selRun === hr.id) {
      // Zoomed in on the selected run: a tap puts a light there.
      onTap = () => {
        if (!s.draft) return;
        const along = alongRunAt(s.draft, hr.id, vw.wx(px), vw.wy(py));
        if (along == null) return;
        const made = addRunLight(s.draft, hr.id, along);
        if (!made.id) return;
        edit(() => made.draft);
        s.selLight = { edgeId: hr.id, id: made.id, station: 0 };
        render();
      };
    } else if (hr) {
      onTap = () => {
        if (s.selLight?.edgeId !== hr.id) s.selLight = null;
        s.selRun = hr.id;
        s.activeSection = null;
        if (s.phone) s.sheet = "";
        render();
        if (insp.current) insp.current.scrollTop = 0;
      };
    } else if (tracingAllowed()) {
      onTap = () => traceClick(button === 2 ? 2 : 0, px, py);
    } else {
      onTap = () => {
        if (s.selRun || s.selLight || s.selPoint) {
          s.selRun = null;
          s.selLight = null;
          s.selPoint = null;
          render();
        }
      };
    }
    dragRef.current = { kind: "pan", cam: { ...s.cam }, ...start, onTap, button, noPan: button === 2 };
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
      if (tracingAllowed() && e.pointerType !== "touch") updateBand(px, py, e.button === 2 ? 2 : 0);
      if (cv.current) cv.current.style.cursor = cursorAt(px, py);
      return;
    }
    if (Math.hypot(px - drag.px, py - drag.py) > (e.pointerType === "touch" ? TAP_SLOP : 3)) drag.moved = true;
    if (!drag.moved && drag.kind === "pan" && tracingAllowed()) updateBand(px, py, drag.button === 2 ? 2 : 0);
    if (!drag.moved) return;
    if (drag.kind === "point") {
      clearHold();
      if (s.tool === "move" && !s.activeSection && s.draft) {
        s.dpast.push(JSON.stringify(s.draft));
        s.dfuture.length = 0;
        dragRef.current = { kind: "corner", id: drag.id, px: drag.px, py: drag.py, moved: true };
        const x = snapV(vw.wx(px));
        const y = snapV(vw.wy(py));
        s.draft = dragCorner(s.draft, drag.id, x, y);
        s.draftDirty = true;
        showCoords(px, py, `${fmt(x)}, ${fmt(y)} from the wire-in`);
        draw();
        return;
      }
      dragRef.current = { kind: "pan", cam: { ...s.cam }, px: drag.px, py: drag.py, moved: true };
      s.band = null;
      showTrace(null);
      s.cam = { ...s.cam, x: s.cam.x - (px - drag.px) / s.cam.ppm, y: s.cam.y + (py - drag.py) / s.cam.ppm };
      draw();
      return;
    }
    if (drag.kind === "pan" && drag.noPan) return;
    if (drag.kind === "pan") {
      s.band = null;
      showTrace(null);
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
    if (drag.kind === "light" && s.draft) {
      const along = alongRunAt(s.draft, drag.pick.edgeId, vw.wx(px), vw.wy(py));
      if (along == null) return;
      s.slide = { ...drag.pick, alongM: along };
      showCoords(px, py, `${fmtLen(along)} along the run`);
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
    if (drag?.kind === "point") {
      const fired = holdRef.current?.fired === true;
      clearHold();
      if (e.type === "pointercancel" || fired || drag.moved) return;
      touchStep(drag.hit, false);
      return;
    }
    if (!drag) return;
    if (drag.kind === "light") {
      const slide = s.slide;
      s.slide = null;
      if (e.type !== "pointercancel" && drag.moved && slide && s.draft) {
        const made = moveRunLight(s.draft, drag.pick, slide.alongM);
        if (made.id) {
          edit(() => made.draft);
          s.selLight = { ...drag.pick, id: made.id };
        }
      }
      render();
      requestAnimationFrame(draw);
      return;
    }
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
    if (drag.kind === "pan" && !drag.moved && e.detail >= 2 && tracingAllowed()) finishChain();
    else if (drag.kind === "pan" && !drag.moved && drag.onTap) drag.onTap();
    else if (drag.kind === "pan" && !drag.moved && drag.deselect) {
      s.sel = null;
      s.confirmDelete = false;
      setQuery({});
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
    return h ? "move" : "grab";
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
    s.nextRun = readStored(NEXT_RUN_KEY, (raw) => (raw === "dark" || raw === "lit" ? raw : null), "lit");
    traceRef.current = { ...traceRef.current, nextRun: s.nextRun };
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
      }
    };
    window.addEventListener("popstate", onPop);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("popstate", onPop);
      media.removeEventListener("change", draw);
      clearHold();
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
  const panelKey = `${s.view}|${s.sel}|${Boolean(s.placing)}|${s.selRun}|${s.selPoint}|${s.activeSection}`;
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
          else if (s.selPoint) s.selPoint = null;
          else if (s.selLight) s.selLight = null;
          else if (s.selRun) s.selRun = null;
          else if (s.tool === "trace" && traceRef.current.gesture !== "idle") finishChain();
          else return cancelProp();
          render();
        } else if (e.key === "Enter" && s.tool === "trace") {
          e.preventDefault();
          finishChain();
        } else if ((e.key === "d" || e.key === "D") && !mod) {
          e.preventDefault();
          s.nextRun = s.nextRun === "dark" ? "lit" : "dark";
          writeStored(NEXT_RUN_KEY, s.nextRun);
          traceRef.current = { ...traceRef.current, nextRun: s.nextRun };
          render();
        } else if ((e.key === "Delete" || e.key === "Backspace") && s.selPoint) {
          e.preventDefault();
          applyPointEffect({ type: "removePoint", pointId: s.selPoint });
        } else if (e.key === "Backspace" && tracingAllowed() && !s.selLight && !s.selRun && s.draft?.layout) {
          e.preventDefault();
          const tail = tailOf(s.draft.layout);
          if (!tail || tail.string.run.length === 0) {
            s.toast = "The wire-in stays unless it is the only point.";
            render();
          } else {
            const applied = applyCommand(s.draft.layout, { type: "removePoint", cornerId: tail.id, stringId: tail.string.id });
            if (!applied.inverse || applied.refused) {
              s.toast = "The wire-in stays unless it is the only point.";
              render();
            } else commitLayout(applied.layout, applied.merge ? mergeToast(applied.merge) : undefined);
          }
        } else if ((e.key === "Delete" || e.key === "Backspace") && s.selLight) {
          e.preventDefault();
          removeLight();
        } else if ((e.key === "Delete" || e.key === "Backspace") && s.selRun) {
          e.preventDefault();
          const id = s.selRun;
          s.selRun = null;
          if (id) edit((d) => removeRun(d, id));
        } else if (e.key === "t") {
          s.tool = "trace";
          traceRef.current = { ...traceRef.current, mode: "trace", gesture: "tracing", nextRun: s.nextRun };
          render();
        } else if (e.key === "v") { s.tool = "move"; s.band = null; showTrace(null); render(); }
        else if (e.key === "a") { s.tool = "split"; render(); }
        else if (e.key === "f") fitDraft();
        return;
      }
      const p = yardSel();
      if (e.key === "Escape") {
        if (s.placing) placeDefault();
        else {
          s.sel = null;
          render();
        }
      } else if ((e.key === "Delete" || e.key === "Backspace") && p) {
        e.preventDefault();
        s.confirmDelete = true;
        s.sheet = "half";
        render();
      } else if (mod && e.key.toLowerCase() === "d" && p) {
        e.preventDefault();
        void duplicateProp(p);
      } else if (e.key === "Enter" && p) openProp(p, false);
      else if (e.key === "n") openProp(null, true);
      else if (e.key === "f") fitYard();
      else if (e.key.startsWith("Arrow") && p) {
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
        {(() => {
          const looks = s.looksDoc?.looks ?? [];
          const lonely = looks.length > 0 ? s.props.filter((p) => !looks.some((k) => lookIncludesProp(k, p.id))) : [];
          return lonely.length > 0 ? (
            <div>
              <h2>In no Look</h2>
              <ul className="lonely">
                {lonely.map((p) => (
                  <li key={p.id}><span>{p.label}</span> <span className="note">In no Look · <Link href={`/looks?add=${encodeURIComponent(p.id)}`}>Add to Looks…</Link></span></li>
                ))}
              </ul>
            </div>
          ) : null;
        })()}
        <div className="keys"><h2>Keys</h2><p className="note">N new prop · Enter edit the selected prop · Delete · Esc · ⌘/Ctrl+Z undo · ⌘/Ctrl+D duplicate · arrows nudge (Shift ×10) · F fit</p></div>
      </>
    );
  }

  /** How many Looks light this prop, and a way in when none does. */
  function lookLine(p: Prop) {
    const looks = s.looksDoc?.looks ?? [];
    if (looks.length === 0) return null;
    const n = looks.filter((k) => lookIncludesProp(k, p.id)).length;
    return n === 0 ? (
      <p className="note">In no Look · <Link href={`/looks?add=${encodeURIComponent(p.id)}`}>Add to Looks…</Link></p>
    ) : (
      <p className="note">In {n} of {looks.length} Looks · <Link href="/looks">Looks page</Link></p>
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
        {lookLine(p)}
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
    const rows = d.shape === "draw" ? drawRows(d) : runRows(d).map((row) => ({ ...row, wire: false }));
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
      if (shape === "draw") {
        s.tool = "trace";
        traceRef.current = { ...traceRef.current, mode: "trace", gesture: "tracing", nextRun: s.nextRun };
      } else {
        s.tool = "move";
        s.band = null;
        traceRef.current = { ...traceRef.current, mode: "edit", gesture: "idle" };
      }
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
        {s.selPoint ? (
          <div className="runbox pointsheet">
            <h2>{pointWord(s.selPoint)}</h2>
            <p className="note">A point between two runs merges them. Undo puts it back.</p>
            <div className="btnrow">
              <button type="button" className="btn danger" onClick={() => s.selPoint && applyPointEffect({ type: "removePoint", pointId: s.selPoint })}>Delete point</button>
            </div>
          </div>
        ) : null}
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
                ) : s.phone
                  ? "Drawn by hand. Trace adds runs. Tap a point, then Delete point, or hold the point to remove it. Tap a run to type its length."
                  : "Drawn by hand. Use Trace to add runs and drag corners to reshape. Tap a run to type its length."}
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

  function removeLight() {
    const pick = s.selLight;
    if (!pick) return;
    s.selLight = null;
    edit((x) => removeRunLight(x, pick));
    requestAnimationFrame(draw);
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
        <div className="lightsbox">
          <h2>Single lights</h2>
          {dotsShown() ? (
            <p className="note">{tapWord()} the run to add a light. Drag a numbered light along the run. Light 1 is next to the wire-in.</p>
          ) : (
            <p className="note">Zoom in on the run to see each light as a numbered dot, then drag one or {tapWord().toLowerCase()} the run to add one.</p>
          )}
          {r.placed ? <p className="note">These lights stay where you put them. Space evenly again keeps all {r.lights} and spreads them along the run.</p> : null}
          <div className="btnrow">
            <button type="button" className="btn" disabled={s.selLight?.edgeId !== r.edge.id} onClick={removeLight}>Remove light</button>
            <button type="button" className="btn" disabled={!r.placed} onClick={() => { s.selLight = null; edit((x) => spaceRunEvenly(x, r.edge.id)); requestAnimationFrame(draw); }}>Space evenly again</button>
          </div>
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

  // ---------- render ----------
  const editing = s.view !== "yard";
  const d = s.draft;
  const p = yardSel();
  let chip: React.ReactNode = null;
  let hint = "";
  if (inProp() && d) {
    chip = <><b>{s.draftIsNew ? "New prop" : "Editing"}</b> {d.label}</>;
    const shaped = Boolean(d.layout && d.layout.corners.length > 0);
    hint = !shaped ? "" : s.activeSection ? "Click runs to put them in the highlighted section. Esc stops." : s.tool === "trace" ? `${tapWord()} empty space for the next run. Right-click places the opposite. ${tapWord()} the last point to remove it.` : s.tool === "split" ? "Click a run to add a point on it." : "Drag a corner to reshape. Click a run to set its length or lights. Drag empty space to pan.";
  } else if (s.placing) {
    chip = s.phone ? <><b>Place</b> drag the outline, then Place here</> : <><b>Place</b> {s.placing.label}</>;
    hint = "Click where it goes in the yard. Esc puts it next to the others.";
  } else if (s.street) {
    hint = "Street is the yard from eye height. Drag to look a little left or right. Pick 2D to move or edit props.";
  } else {
    hint = "Click a prop to select it. Drag to move it. Double-click to edit it on its own canvas. Scroll pans; Ctrl/⌘ + scroll zooms.";
  }
  const shaped = Boolean(d?.layout && d.layout.corners.length > 0 && (d.shape === "draw" ? drawRows(d).length : runRows(d).length + 1) > 0);
  const toolBtn = (k: Tool, label: string, key: string) => (
    <button key={k} type="button" aria-pressed={s.tool === k} title={key} onClick={() => {
      s.tool = k;
      if (k === "trace") traceRef.current = { ...traceRef.current, mode: "trace", gesture: "tracing", nextRun: s.nextRun };
      else { s.band = null; showTrace(null); traceRef.current = { ...traceRef.current, mode: "edit", gesture: "idle" }; }
      render();
    }}>{label}</button>
  );
  const sortedProps = [...s.props].filter((q) => q.id !== s.placing?.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const canUndo = inProp() ? s.dpast.length > 0 : s.past.length > 0;
  const canRedo = inProp() ? s.dfuture.length > 0 : s.future.length > 0;

  let panel: React.ReactNode;
  if (inProp() && d) panel = propPanel(d);
  else if (s.placing) panel = placingPanel(s.placing);
  else panel = p ? yardPropPanel(p) : yardSummary();

  return (
    <div className={`ye app ${editing ? "editing" : ""}`} data-testid="yard-editor" data-sheet={s.sheet}>
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
            <a href="#" onClick={(e) => { e.preventDefault(); cancelProp(); }}>Yard</a>
            <span aria-hidden="true">›</span>
            <b>{d?.label || "New prop"}</b>
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
            <button type="button" className="btn primary" disabled={!d || (d.shape === "draw" ? drawRows(d).length : runRows(d).length) === 0} onClick={() => void saveProp()}>{s.draftIsNew && !s.phone ? "Save and place" : "Save"}</button>
          </>
        ) : null}
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
                return (
                  <li key={q.id}>
                    <button type="button" className={q.id === s.sel ? "on" : ""} onClick={() => { s.sel = q.id; s.confirmDelete = false; s.railOpen = false; s.lensSection = null; s.sheet = s.sheet || "half"; setQuery({ prop: q.id }); render(); requestAnimationFrame(() => fitIfOff(q.id)); }}>
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
                    const n = s.props.filter((q) => lookIncludesProp(k, q.id)).length;
                    return (
                      <li key={k.id}>
                        <Link href={`/looks/${encodeURIComponent(k.id)}`} className="lookrow">
                          <span className="dot" style={{ background: "var(--y-pick)" }} />{k.name}<span className="n">{n}/{s.props.length}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Link href="/looks" className="btn" style={{ marginTop: 6, width: "100%" }}>New Look or playlist…</Link>
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
            onContextMenu={(e) => { if (inProp()) e.preventDefault(); }}
            onDoubleClick={(e) => {
              if (inProp() && tracingAllowed()) {
                finishChain();
                return;
              }
              if (inProp() || s.placing) return;
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
          {!inProp() && !s.placing ? (
            <div className="viewseg" role="group" aria-label="Yard view">
              <button type="button" aria-pressed={!s.street} onClick={() => { s.street = false; render(); requestAnimationFrame(draw); }}>2D</button>
              <button type="button" aria-pressed={s.street} onClick={() => { s.street = true; render(); }}>Street</button>
            </div>
          ) : null}
          {s.street && !inProp() && !s.placing ? (
            <YardCanvas
              drawn={drawnYard(s.props)}
              props={s.props}
              look={s.looksDoc?.looks[0] ?? null}
              neutral={!s.looksDoc?.looks[0]}
              depth
              className="street"
              ariaLabel="Yard from the street"
              onPick={(hit) => { s.sel = hit?.propId ?? null; if (s.sel && !s.sheet) s.sheet = "half"; setQuery(s.sel ? { prop: s.sel } : {}); render(); }}
            />
          ) : null}
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
              {s.tool === "trace" ? (
                <button
                  type="button"
                  aria-pressed={s.nextRun === "dark"}
                  title="Next run. D switches it. Saved on this device."
                  onClick={() => {
                    s.nextRun = s.nextRun === "dark" ? "lit" : "dark";
                    writeStored(NEXT_RUN_KEY, s.nextRun);
                    traceRef.current = { ...traceRef.current, nextRun: s.nextRun };
                    render();
                  }}
                >{s.nextRun === "dark" ? "Next: Dark" : "Next: Lit"}</button>
              ) : null}
              <span className="sep" />
              <button type="button" onClick={fitDraft}>Fit</button>
            </div>
          ) : null}
          <div className="coords" id="ye-coords" hidden />
          <div className="tracehud" id="ye-trace" hidden />
          <div className="pointbar" id="ye-pointbar" hidden>
            <button type="button" className="btn danger" onClick={() => s.selPoint && applyPointEffect({ type: "removePoint", pointId: s.selPoint })}>Delete point</button>
          </div>
          {s.phone && inProp() ? (
            <button type="button" className="drawundo" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={() => void undo()}>Undo</button>
          ) : null}
          {s.toast ? (
            <div className="tracetip" role="status">
              <span>{s.toast}</span>
              <button type="button" onClick={() => { s.toast = null; void undo(); }}>Undo</button>
            </div>
          ) : null}
          <p className="hint" style={s.error ? { color: "var(--y-danger)" } : undefined}>{s.error ?? hint}</p>
          <div className="zoom" hidden={s.street && !inProp() && !s.placing}>
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

