/**
 * The yard editor's drawing: one 2D canvas for the yard, a Look, and a
 * single prop's own canvas. Ported from docs/prototypes/yard-page.html so
 * the build behaves the way the walkthrough checked. World units are metres
 * with y up; the camera maps them to CSS pixels.
 */
import { METRES_PER_FOOT, type LayoutUnits } from "@nightplot/shared";

export type Camera = { x: number; y: number; ppm: number };

export type DrawEdge = {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lights: number;
  /** Null draws the run dark (not in the Look, or a wire). */
  color: string | null;
  wire?: boolean;
  typed?: boolean;
  /** Real length when it is not the drawn line (half a turn of a spiral). */
  lengthM?: number;
};

/** Install marks on a prop's own canvas, in the prop's frame. */
export type DrawGuide = {
  /** A numbered light: every 20th, say. */
  lights: { x: number; y: number; label: string }[];
  /** A height line with the light that should sit on it. */
  heights: { y: number; x: number; label: string }[];
};

export type DrawProp = {
  id: string;
  name: string;
  /** Where the drawing's origin sits on the yard. 0,0 on a prop's own canvas. */
  x: number;
  y: number;
  edges: DrawEdge[];
  corners: { id: string; x: number; y: number }[];
  /** Wire-in corner, in the prop's own frame. */
  start: { x: number; y: number } | null;
  lights: number;
  box: { minX: number; minY: number; maxX: number; maxY: number };
};

export type Scene = {
  mode: "yard" | "prop" | "look";
  units: LayoutUnits;
  phone: boolean;
  props: DrawProp[];
  selectedId: string | null;
  /** A new prop being placed: drawn as an outline at `ghost`. */
  ghost: { prop: DrawProp; x: number; y: number } | null;
  /** Prop canvas only. */
  selectedRun: string | null;
  sectionRuns: string[] | null;
  fmtLen: (m: number) => string;
  /** Prop canvas only: where lights go when putting the string up. */
  guide?: DrawGuide | null;
};

export type Colours = Record<"canvas" | "grid" | "gridStrong" | "pick" | "quiet" | "fg" | "card" | "input" | "lit" | "primary", string>;

export function readColours(el: Element): Colours {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    canvas: v("--y-canvas"),
    grid: v("--y-grid"),
    gridStrong: v("--y-grid-strong"),
    pick: v("--y-pick"),
    quiet: v("--y-quiet"),
    fg: v("--y-fg"),
    card: v("--y-card"),
    input: v("--y-input"),
    lit: v("--y-lit"),
    primary: v("--y-primary"),
  };
}

export class View {
  constructor(public cam: Camera, public W: number, public H: number) {}
  sx = (x: number) => (x - this.cam.x) * this.cam.ppm + this.W / 2;
  sy = (y: number) => this.H / 2 - (y - this.cam.y) * this.cam.ppm;
  wx = (px: number) => (px - this.W / 2) / this.cam.ppm + this.cam.x;
  wy = (py: number) => this.cam.y - (py - this.H / 2) / this.cam.ppm;
}

function gridStep(scene: Scene, ppm: number): number {
  const base = scene.mode === "prop" ? (scene.units === "ft" ? METRES_PER_FOOT / 2 : 0.25) : scene.units === "ft" ? METRES_PER_FOOT : 1;
  let s = base;
  while (s * ppm < 18) s *= 2;
  return s;
}

const toU = (m: number, units: LayoutUnits) => (units === "ft" ? m / METRES_PER_FOOT : m);
const uLabel = (units: LayoutUnits) => (units === "ft" ? "ft" : "m");

type LabelBox = { x: number; y: number; w: number };

export function drawScene(ctx: CanvasRenderingContext2D, view: View, scene: Scene, c: Colours, dpr: number) {
  const { W, H, sx, sy, wx, wy } = view;
  const ppm = view.cam.ppm;
  const inProp = scene.mode === "prop";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = c.canvas;
  ctx.fillRect(0, 0, W, H);
  const step = gridStep(scene, ppm);
  const major = step * 4;
  const x0 = wx(0), x1 = wx(W), y0 = wy(H), y1 = wy(0);
  ctx.lineWidth = 1;
  for (const [st, col] of [[step, c.grid], [major, c.gridStrong]] as const) {
    ctx.strokeStyle = col;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) { const p = Math.round(sx(x)) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, H); }
    for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) { const p = Math.round(sy(y)) + 0.5; ctx.moveTo(0, p); ctx.lineTo(W, p); }
    ctx.stroke();
  }
  ctx.font = "11px var(--font-plex-mono), 'IBM Plex Mono', monospace";
  if (!inProp) {
    // Below ground is shaded and unlabelled: the yard sits on it.
    ctx.fillStyle = c.canvas;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(0, sy(0), W, H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.gridStrong;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(0, sy(0) + 0.5); ctx.lineTo(W, sy(0) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    const ox = sx(0), oy = sy(0);
    ctx.strokeStyle = c.pick; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ox, oy, 7, 0, Math.PI * 2); ctx.moveTo(ox - 11, oy); ctx.lineTo(ox + 11, oy); ctx.moveTo(ox, oy - 11); ctx.lineTo(ox, oy + 11); ctx.stroke();
    ctx.fillStyle = c.pick; ctx.fillText("0, 0", ox + 10, oy + 16);
  }
  ctx.fillStyle = c.quiet;
  const u = uLabel(scene.units);
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
    if (Math.abs(x) < 1e-6 && !inProp) continue;
    ctx.fillText(`${+toU(x, scene.units).toFixed(1)} ${u}`, sx(x) + 3, Math.min(H - 60, Math.max(scene.phone ? 90 : 14, sy(0) + (inProp ? 16 : 34))));
  }
  for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
    if (Math.abs(y) < 1e-6 || (y < 0 && !inProp)) continue;
    ctx.fillText(`${+toU(y, scene.units).toFixed(1)} ${u}`, 4, sy(y) - 3);
  }

  const labels: LabelBox[] = [];
  if (inProp) {
    for (const p of scene.props) drawProp(ctx, view, scene, c, p, 1, true, false, labels);
    if (scene.guide) for (const p of scene.props) drawGuide(ctx, view, c, p, scene.guide);
  } else {
    const ordered = [...scene.props].sort((a, b) => Number(a.id === scene.selectedId) - Number(b.id === scene.selectedId));
    for (const p of ordered) drawProp(ctx, view, scene, c, p, 1, false, false, labels);
    if (scene.ghost) drawProp(ctx, view, scene, c, { ...scene.ghost.prop, x: scene.ghost.x, y: scene.ghost.y }, 0.6, false, true, labels);
  }

  // Scale bar: what one bar and one square are, in the unit in use.
  const metric = scene.units !== "ft";
  const sb = metric ? (ppm < 25 ? 5 : ppm > 160 ? 0.5 : 1) : METRES_PER_FOOT * (ppm * METRES_PER_FOOT < 12 ? 10 : ppm * METRES_PER_FOOT < 30 ? 5 : 1);
  const bx = 14, by = scene.phone ? 66 : H - 52, len = sb * ppm;
  ctx.strokeStyle = c.fg; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + len, by); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.moveTo(bx + len, by - 4); ctx.lineTo(bx + len, by + 4); ctx.stroke();
  ctx.fillStyle = c.fg;
  ctx.fillText(`${+toU(sb, scene.units).toFixed(2)} ${u} · one square = ${+toU(step, scene.units).toFixed(2)} ${u}`, bx + len + 8, by + 4);
}

function drawProp(ctx: CanvasRenderingContext2D, view: View, scene: Scene, c: Colours, p: DrawProp, alpha: number, scoped: boolean, ghost: boolean, labels: LabelBox[]) {
  const { sx, sy, W, H } = view;
  const ppm = view.cam.ppm;
  ctx.save();
  ctx.globalAlpha = alpha;
  const selected = scoped || p.id === scene.selectedId;
  // A spiral has dozens of half-turn runs: label only the picked one, and draw corners as dots.
  const crowded = p.edges.length > 16;
  for (const e of p.edges) {
    const ax = sx(e.ax + p.x), ay = sy(e.ay + p.y), bx = sx(e.bx + p.x), by = sy(e.by + p.y);
    const col = ghost ? c.pick : e.color;
    const isSel = scoped && scene.selectedRun === e.id;
    const inSection = scoped && scene.sectionRuns?.includes(e.id);
    ctx.strokeStyle = col || c.input;
    ctx.globalAlpha = alpha * (col ? 0.35 : 0.5);
    ctx.lineWidth = isSel ? 6 : scoped ? 4 : 3;
    if (e.wire) { ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5; }
    if (isSel) { ctx.strokeStyle = c.pick; ctx.globalAlpha = alpha; }
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    if (inSection) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = c.pick; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
    }
    const n = e.lights;
    ctx.globalAlpha = alpha;
    const segLen = Math.max(1, Math.hypot(bx - ax, by - ay));
    if (n > 0) {
      const rpx = Math.max(1.2, Math.min(scoped ? 4 : 3, ppm * 0.025));
      const stride = n * rpx * 3 > segLen ? Math.ceil((n * rpx * 3) / segLen) : 1;
      ctx.fillStyle = col || c.input;
      if (col && !ghost) { ctx.shadowColor = col; ctx.shadowBlur = 6; }
      for (let k = 0; k < n; k += stride) {
        const t = (k + 0.5) / n;
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * t, ay + (by - ay) * t, rpx, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    if (scoped && !e.wire && (!crowded || isSel)) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const t = `${scene.fmtLen(e.lengthM ?? Math.hypot(e.bx - e.ax, e.by - e.ay))} · ${n}${e.typed ? "*" : ""}`;
      const w = ctx.measureText(t).width + 8;
      // Off the outside of the run, then away from labels already placed.
      const nx = -(by - ay) / segLen, ny = (bx - ax) / segLen;
      let lx = mx - w / 2 + nx * 14, ly = my - 8 + ny * 14;
      const hit = (q: LabelBox) => lx < q.x + q.w && lx + w > q.x && ly < q.y + 16 && ly + 16 > q.y;
      for (let g = 0; g < 8 && labels.some(hit); g++) { lx += nx * 12; ly += ny * 12 + (g % 2 ? 10 : -10); }
      lx = Math.max(4, Math.min(W - w - 4, lx));
      ly = Math.max(scene.phone ? 84 : 16, Math.min(H - 8, ly));
      labels.push({ x: lx, y: ly, w });
      ctx.fillStyle = c.card; ctx.globalAlpha = 0.92; ctx.fillRect(lx, ly - 11, w, 16); ctx.globalAlpha = 1;
      ctx.fillStyle = isSel ? c.pick : c.fg; ctx.fillText(t, lx + 4, ly + 1);
    }
  }
  if (scoped) {
    for (const corner of p.corners) {
      const x = sx(corner.x + p.x), y = sy(corner.y + p.y);
      const isStart = p.start && Math.abs(p.start.x - corner.x) < 1e-9 && Math.abs(p.start.y - corner.y) < 1e-9;
      ctx.fillStyle = c.card; ctx.strokeStyle = isStart ? c.primary : c.pick; ctx.lineWidth = 2;
      const r = crowded && !isStart ? 2.5 : 5;
      ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    }
    if (p.start) {
      ctx.fillStyle = c.primary;
      ctx.font = "11px var(--font-plex-sans), 'IBM Plex Sans', sans-serif";
      const t = "Wire in · light 1", tw = ctx.measureText(t).width, x = sx(p.start.x + p.x), y = sy(p.start.y + p.y);
      const left = x - tw - 10 > 4;
      ctx.fillText(t, left ? x - tw - 10 : x + 10, y + (left ? 4 : 30));
      ctx.font = "11px var(--font-plex-mono), 'IBM Plex Mono', monospace";
    }
    ctx.restore();
    return;
  }
  const bb = { minX: p.box.minX + p.x, minY: p.box.minY + p.y, maxX: p.box.maxX + p.x, maxY: p.box.maxY + p.y };
  if (selected && !ghost) {
    ctx.strokeStyle = c.pick; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.strokeRect(sx(bb.minX) - 8, sy(bb.maxY) - 8, sx(bb.maxX) - sx(bb.minX) + 16, sy(bb.minY) - sy(bb.maxY) + 16);
    ctx.setLineDash([]);
  }
  ctx.font = "12px var(--font-plex-sans), 'IBM Plex Sans', sans-serif";
  ctx.fillStyle = selected || ghost ? c.pick : c.fg;
  const label = `${p.name} · ${p.lights}`;
  const lw = ctx.measureText(label).width;
  const lx = Math.max(4, Math.min(W - lw - 4, (sx(bb.minX) + sx(bb.maxX)) / 2 - lw / 2));
  // Above, else below, else one step up, else hidden until selected.
  const clash = (y: number) => labels.some((q) => lx < q.x + q.w + 6 && lx + lw + 6 > q.x && Math.abs(y - q.y) < 14);
  const tries = [sy(bb.maxY) - 14, sy(bb.minY) + 18, sy(bb.maxY) - 29];
  let ly = tries.find((y) => !clash(y));
  if (ly == null && (selected || ghost)) ly = tries[0];
  if (ly != null) { labels.push({ x: lx, y: ly, w: lw }); ctx.fillText(label, lx, ly); }
  ctx.font = "11px var(--font-plex-mono), 'IBM Plex Mono', monospace";
  ctx.restore();
}

/**
 * Install marks over a prop. Height lines run across the prop with the light
 * that belongs on them; numbered lights get a ring and their number.
 */
function drawGuide(ctx: CanvasRenderingContext2D, view: View, c: Colours, p: DrawProp, guide: DrawGuide) {
  const { sx, sy, W } = view;
  ctx.save();
  ctx.font = "11px var(--font-plex-mono), 'IBM Plex Mono', monospace";
  const left = sx(p.box.minX + p.x) - 14;
  const right = sx(p.box.maxX + p.x) + 14;
  let lastY = Infinity;
  for (const h of guide.heights) {
    const y = sy(h.y + p.y);
    ctx.strokeStyle = c.primary; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(left, y + 0.5); ctx.lineTo(right, y + 0.5); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.primary; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx(h.x + p.x), sy(h.y + p.y), 6, 0, Math.PI * 2); ctx.stroke();
    // Skip a label that would sit on the one below it; the line still shows.
    if (Math.abs(lastY - y) < 14) continue;
    lastY = y;
    const w = ctx.measureText(h.label).width + 8;
    const lx = Math.min(W - w - 4, right + 4);
    ctx.fillStyle = c.card; ctx.globalAlpha = 0.92; ctx.fillRect(lx, y - 8, w, 16); ctx.globalAlpha = 1;
    ctx.fillStyle = c.primary; ctx.fillText(h.label, lx + 4, y + 4);
  }
  for (const m of guide.lights) {
    const x = sx(m.x + p.x), y = sy(m.y + p.y);
    ctx.strokeStyle = c.pick; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    const w = ctx.measureText(m.label).width + 6;
    ctx.fillStyle = c.card; ctx.globalAlpha = 0.92; ctx.fillRect(x + 9, y - 19, w, 14); ctx.globalAlpha = 1;
    ctx.fillStyle = c.pick; ctx.fillText(m.label, x + 12, y - 8);
  }
  ctx.restore();
}

// ---------- hit tests ----------

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return [Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t];
}

export function hitRun(view: View, p: DrawProp, px: number, py: number, slop = 10): { id: string; d: number; t: number } | null {
  let best: { id: string; d: number; t: number } | null = null;
  for (const e of p.edges) {
    if (e.wire) continue;
    const [d, t] = distSeg(px, py, view.sx(e.ax + p.x), view.sy(e.ay + p.y), view.sx(e.bx + p.x), view.sy(e.by + p.y));
    if (d < slop && (!best || d < best.d)) best = { id: e.id, d, t };
  }
  return best;
}

export function hitCorner(view: View, p: DrawProp, px: number, py: number, slop = 9): string | null {
  for (let i = p.corners.length - 1; i >= 0; i--) {
    const c = p.corners[i]!;
    if (Math.abs(view.sx(c.x + p.x) - px) < slop && Math.abs(view.sy(c.y + p.y) - py) < slop) return c.id;
  }
  return null;
}

export function hitProp(view: View, props: DrawProp[], px: number, py: number): DrawProp | null {
  let best: { p: DrawProp; score: number } | null = null;
  for (const p of props) {
    const pad = 10;
    const minX = p.box.minX + p.x, maxX = p.box.maxX + p.x, minY = p.box.minY + p.y, maxY = p.box.maxY + p.y;
    if (px >= view.sx(minX) - pad && px <= view.sx(maxX) + pad && py >= view.sy(maxY) - pad - 18 && py <= view.sy(minY) + pad) {
      const area = (maxX - minX + 0.1) * (maxY - minY + 0.1);
      const run = hitRun(view, p, px, py);
      const score = run ? -1 / (1 + run.d) : area;
      if (!best || score < best.score) best = { p, score };
    }
  }
  return best ? best.p : null;
}

// ---------- fitting ----------

export type Rect = { top: number; bottom: number; left: number; right: number };

/** The part of the canvas a phone's bottom sheet and toolbar leave visible. */
export function visibleRect(W: number, H: number, phone: boolean, sheetFrac: number): Rect {
  if (!phone) return { top: 70, bottom: H - 70, left: 80, right: W - 80 };
  return { top: 96, bottom: H * (1 - sheetFrac) - 34, left: 40, right: W - 40 };
}

export function fitBox(W: number, H: number, v: Rect, b: { minX: number; minY: number; maxX: number; maxY: number }, maxPpm: number, groundDown: boolean): Camera {
  const pw = v.right - v.left, ph = Math.max(80, v.bottom - v.top);
  const ppm = Math.max(6, Math.min(maxPpm, Math.min(pw / Math.max(0.5, b.maxX - b.minX), ph / Math.max(0.5, b.maxY - b.minY))));
  const cxs = (v.left + v.right) / 2, cys = (v.top + v.bottom) / 2;
  const x = (b.minX + b.maxX) / 2 - (cxs - W / 2) / ppm;
  // The yard sits on the ground: spare height goes above it, not into empty earth.
  const y = groundDown ? b.minY + (v.bottom - H / 2) / ppm : (b.minY + b.maxY) / 2 + (cys - H / 2) / ppm;
  return { x, y, ppm };
}

export function zoomAt(cam: Camera, W: number, H: number, px: number, py: number, f: number): Camera {
  const v = new View(cam, W, H);
  const bx = v.wx(px), by = v.wy(py);
  const ppm = Math.max(6, Math.min(600, cam.ppm * f));
  return { ppm, x: bx - (px - W / 2) / ppm, y: by + (py - H / 2) / ppm };
}
