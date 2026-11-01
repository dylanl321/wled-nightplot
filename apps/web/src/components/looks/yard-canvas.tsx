"use client";

import { drawnLightColour, sampleLookStyle, streetProject, type DrawnProp, type FlatView, type Look, type LookStyle, type Prop } from "@nightplot/shared";
import { useEffect, useRef } from "react";

/** One clock for every canvas on the page, so thumbnails and strips move together. */
const listeners = new Set<(t: number) => void>();
let raf = 0;
const started = typeof performance !== "undefined" ? performance.now() : 0;
function tick() {
  const t = (performance.now() - started) / 1000;
  for (const listener of listeners) listener(t);
  raf = listeners.size ? requestAnimationFrame(tick) : 0;
}
function subscribe(listener: (t: number) => void) {
  listeners.add(listener);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => { listeners.delete(listener); };
}

function reducedMotion() {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type YardView = { s: number; ox: number; oy: number };

function bounds(drawn: readonly DrawnProp[]) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const prop of drawn) for (const light of prop.lights) {
    x0 = Math.min(x0, light.x); x1 = Math.max(x1, light.x); y0 = Math.min(y0, light.y); y1 = Math.max(y1, light.y);
  }
  if (!Number.isFinite(x0)) return { x0: -1, x1: 1, y0: 0, y1: 2 };
  const pad = Math.max(0.4, (x1 - x0) * 0.04);
  return { x0: x0 - pad, x1: x1 + pad, y0: Math.min(0, y0) - 0.3, y1: y1 + pad + 0.3 };
}

function fit(w: number, h: number, world: ReturnType<typeof bounds>, pad: number): YardView {
  const s = Math.min((w - pad * 2) / (world.x1 - world.x0), (h - pad * 2) / (world.y1 - world.y0));
  const ox = (w - s * (world.x1 - world.x0)) / 2 - world.x0 * s;
  const oy = h - pad - Math.max(0, (h - pad * 2 - s * (world.y1 - world.y0)) * 0.25) + world.y0 * s;
  return { s, ox, oy };
}

const toScreen = (view: YardView, x: number, y: number): [number, number] => [view.ox + x * view.s, view.oy - y * view.s];

type Props = {
  drawn: readonly DrawnProp[];
  props: readonly Pick<Prop, "id" | "kind">[];
  look: Look | null;
  className?: string;
  small?: boolean;
  labels?: boolean;
  selected?: readonly string[];
  section?: string | null;
  dim?: boolean;
  /** The yard with no Look: every light in the warm "lit" colour. */
  neutral?: boolean;
  /** Street: the same dots, with depth. Further back is smaller and higher. */
  depth?: boolean;
  onPick?: (hit: { propId: string; index: number } | null, event: PointerEvent) => void;
  ariaLabel: string;
};

/** The yard front-on, each light the colour this Look gives it. A drawing, not the lights. */
export function YardCanvas({ drawn, props, look, className, small, labels, selected, section, dim, neutral, depth, onPick, ariaLabel }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<YardView | null>(null);
  const eye = useRef({ yaw: 0, zoom: 1 });
  const state = useRef({ drawn, props, look, small, labels, selected, section, dim, neutral, depth });
  useEffect(() => { state.current = { drawn, props, look, small, labels, selected, section, dim, neutral, depth }; });

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const still = reducedMotion();
    const draw = (t: number) => {
      const { drawn, props, look, small, labels, selected, section, dim, neutral, depth } = state.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#07080b"; g.fillRect(0, 0, w, h);
      let view = fit(w, h, bounds(drawn), small ? 6 : depth ? 36 : 26);
      if (depth) {
        const nearest = drawn.reduce((min, prop) => prop.lights.reduce((m, light) => Math.min(m, light.z), min), 0);
        const persp = 8 / (8 + Math.max(-7.5, nearest));
        view = { ...view, s: view.s / Math.max(1, persp) * 0.86 };
      }
      viewRef.current = view;
      const { yaw, zoom } = eye.current;
      const place = (x: number, y: number, z = 0) => depth ? streetProject({ x, y, z }, view, yaw, zoom) : { ...flatPoint(view, x, y), scale: 1, fade: 1 };
      if (depth) drawGround(g, w, h, view, yaw, zoom);
      else {
        const gy = toScreen(view, 0, 0)[1];
        g.fillStyle = "#0e1117"; g.fillRect(0, gy, w, h - gy);
        g.strokeStyle = "#1e232c"; g.beginPath(); g.moveTo(0, gy); g.lineTo(w, gy); g.stroke();
      }
      const r = Math.max(1.1, Math.min(4, view.s * 0.045 * (depth ? zoom : 1)));
      const time = still ? 0.7 : t;
      const order = depth ? [...drawn].sort((a, b) => meanZ(b) - meanZ(a)) : drawn;
      if (depth) drawPosts(g, order, place);
      for (const drawnProp of order) {
        const prop = props.find((row) => row.id === drawnProp.id);
        if (!prop) continue;
        const isSel = selected?.includes(prop.id) ?? false;
        const k = selected?.length && !isSel && dim ? 0.35 : 1;
        g.globalCompositeOperation = "lighter";
        drawnProp.lights.forEach((light, index) => {
          const at = place(light.x, light.y, light.z);
          const x = at.x, y = at.y;
          const dot = r * at.scale;
          const c = neutral ? [212, 165, 116] : look ? drawnLightColour(look, prop, drawnProp, index, time) : null;
          if (!c || c[0] + c[1] + c[2] < 6) {
            g.globalCompositeOperation = "source-over";
            g.fillStyle = "#262a33"; g.beginPath(); g.arc(x, y, Math.max(1, dot * 0.7), 0, 7); g.fill();
            g.globalCompositeOperation = "lighter";
            return;
          }
          const [cr, cg, cb] = [c[0]! | 0, c[1]! | 0, c[2]! | 0];
          const dimmer = at.fade;
          if (!small) { g.fillStyle = `rgba(${cr},${cg},${cb},${0.16 * k * dimmer})`; g.beginPath(); g.arc(x, y, dot * 3.2, 0, 7); g.fill(); }
          g.fillStyle = `rgba(${cr},${cg},${cb},${k * dimmer})`; g.beginPath(); g.arc(x, y, Math.max(1.1, dot), 0, 7); g.fill();
        });
        g.globalCompositeOperation = "source-over";
        if (!drawnProp.lights.length || small) continue;
        const pts = drawnProp.lights.map((light) => { const at = place(light.x, light.y, light.z); return [at.x, at.y] as [number, number]; });
        const bx0 = Math.min(...pts.map((p) => p[0])) - 9, bx1 = Math.max(...pts.map((p) => p[0])) + 9;
        const by0 = Math.min(...pts.map((p) => p[1])) - 9, by1 = Math.max(...pts.map((p) => p[1])) + 9;
        if (isSel) {
          g.strokeStyle = "#7ee0d0"; g.lineWidth = 1.5; g.setLineDash([5, 4]);
          g.strokeRect(bx0, by0, bx1 - bx0, by1 - by0); g.setLineDash([]);
          const sec = section ? drawnProp.sections.find((row) => row.id === section) : null;
          if (sec) {
            g.strokeStyle = "#7ee0d0"; g.lineWidth = 3; g.beginPath();
            for (let i = sec.first; i <= sec.last; i += 1) { const [x, y] = pts[i]!; if (i === sec.first) g.moveTo(x, y + 7); else g.lineTo(x, y + 7); }
            g.stroke();
          }
          g.fillStyle = "#7ee0d0"; g.font = "600 12px IBM Plex Sans, sans-serif"; g.fillText(drawnProp.label, bx0, by0 - 5);
        } else if (labels && w >= 640) {
          const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
          g.fillStyle = look && !neutral && !(look.propIds ?? null)?.includes(prop.id) && look.propIds ? "#5a5f69" : "#a39d91";
          g.font = "11px IBM Plex Sans, sans-serif"; g.textAlign = "center"; g.fillText(drawnProp.label, cx, by0 - 1); g.textAlign = "start";
        }
      }
    };
    if (still) { draw(0.7); const again = () => draw(0.7); window.addEventListener("resize", again); return () => window.removeEventListener("resize", again); }
    return subscribe(draw);
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !onPick) return;
    const down = (event: PointerEvent) => {
      if (state.current.depth) return;
      onPick(hitAt(cv, event.clientX, event.clientY, viewRef.current, eye.current, false, state.current.drawn), event);
    };
    cv.addEventListener("pointerdown", down);
    return () => cv.removeEventListener("pointerdown", down);
  }, [onPick]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; yaw: number; moved: boolean } | null = null;
    let pinch: { distance: number; zoom: number } | null = null;
    const down = (event: PointerEvent) => {
      if (!state.current.depth) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      cv.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, zoom: eye.current.zoom };
        drag = null;
        return;
      }
      drag = { x: event.clientX, yaw: eye.current.yaw, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        eye.current.zoom = clamp(pinch.zoom * distance / pinch.distance, 0.55, 2.4);
        return;
      }
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 5) drag.moved = true;
      eye.current.yaw = clamp(drag.yaw - dx * 0.004, -0.45, 0.45);
    };
    const up = (event: PointerEvent) => {
      const was = drag;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) drag = null;
      if (was && !was.moved && onPick) onPick(hitAt(cv, event.clientX, event.clientY, viewRef.current, eye.current, true, state.current.drawn), event);
    };
    const wheel = (event: WheelEvent) => {
      if (!state.current.depth) return;
      event.preventDefault();
      eye.current.zoom = clamp(eye.current.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.4);
    };
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("wheel", wheel);
    };
  }, [onPick]);

  return <canvas ref={ref} className={className} role="img" aria-label={ariaLabel} data-yard={depth ? "street" : "flat"} />;
}

function flatPoint(view: YardView, x: number, y: number): { x: number; y: number } {
  const [sx, sy] = toScreen(view, x, y);
  return { x: sx, y: sy };
}

function meanZ(prop: DrawnProp): number {
  if (!prop.lights.length) return 0;
  return prop.lights.reduce((sum, light) => sum + light.z, 0) / prop.lights.length;
}

function drawGround(g: CanvasRenderingContext2D, w: number, h: number, view: FlatView, yaw: number, zoom: number) {
  const horizon = streetProject({ x: 0, y: STREET_EYE, z: 40 }, view, yaw, zoom).y;
  g.fillStyle = "#0e1117";
  g.fillRect(0, horizon, w, h - horizon);
  g.strokeStyle = "#2a3140";
  g.lineWidth = 1;
  for (const z of [0, 2, 4, 6, 8]) {
    const a = streetProject({ x: -8, y: 0, z }, view, yaw, zoom);
    const b = streetProject({ x: 8, y: 0, z }, view, yaw, zoom);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  for (const x of [-6, -3, 0, 3, 6]) {
    const a = streetProject({ x, y: 0, z: -2 }, view, yaw, zoom);
    const b = streetProject({ x, y: 0, z: 10 }, view, yaw, zoom);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
}

const STREET_EYE = 1.6;

function drawPosts(
  g: CanvasRenderingContext2D,
  props: readonly DrawnProp[],
  place: (x: number, y: number, z?: number) => { x: number; y: number },
) {
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.lineWidth = 1;
  for (const prop of props) {
    if (!prop.lights.length) continue;
    const x = prop.lights.reduce((sum, light) => sum + light.x, 0) / prop.lights.length;
    const y = prop.lights.reduce((sum, light) => sum + light.y, 0) / prop.lights.length;
    const z = meanZ(prop);
    if (y < 0.4) continue;
    const foot = place(x, 0, z);
    const head = place(x, y, z);
    g.beginPath(); g.moveTo(foot.x, foot.y); g.lineTo(head.x, head.y); g.stroke();
  }
}

function hitAt(cv: HTMLCanvasElement, clientX: number, clientY: number, view: YardView | null, eye: { yaw: number; zoom: number }, depth: boolean, drawn: readonly DrawnProp[]): { propId: string; index: number } | null {
  if (!view) return null;
  const box = cv.getBoundingClientRect();
  const px = clientX - box.left, py = clientY - box.top;
  let best: { propId: string; index: number } | null = null;
  let bd = 22;
  for (const prop of drawn) {
    prop.lights.forEach((light, index) => {
      const at = depth ? streetProject({ x: light.x, y: light.y, z: light.z }, view, eye.yaw, eye.zoom) : flatPoint(view, light.x, light.y);
      const d = Math.hypot(at.x - px, at.y - py);
      if (d < bd) { bd = d; best = { propId: prop.id, index }; }
    });
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A short row of lights showing one style. */
export function StyleStrip({ style, count = 40, className }: { style: LookStyle | null; count?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const current = useRef(style);
  useEffect(() => { current.current = style; });
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const still = reducedMotion();
    const draw = (t: number) => {
      const st = current.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < count; i += 1) {
        const c = st ? sampleLookStyle(st, i, count, still ? 0.7 : t) : [40, 44, 52];
        g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        g.beginPath(); g.arc(((i + 0.5) * w) / count, h / 2, st ? Math.min(h / 2 - 1, w / count / 2.2) : 1, 0, 7); g.fill();
      }
    };
    if (still) { draw(0.7); return; }
    return subscribe(draw);
  }, [count]);
  return <canvas ref={ref} className={className ?? "strip"} aria-hidden="true" />;
}
