"use client";

import {
  addStringAt,
  continueToCorner,
  continueToPoint,
  countLayout,
  edgeLengthM,
  gapLabel,
  gridSizeM,
  idleGesture,
  isClosed,
  ensureStrings,
  layoutStrings,
  lengthLabel,
  moveCorner,
  reduceGesture,
  setEdgeLength,
  snapPoint,
  type GestureHit,
  type GestureMode,
  type GestureState,
  type PropLayout,
} from "@nightplot/shared";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type View = { ppm: number; ox: number; oy: number };
const FT = 0.3048;

export function PropLayoutEditor({
  name,
  initial,
  mode: initialMode,
  doneLabel = "Done",
  onDone,
  onBack,
}: {
  name: string;
  initial: PropLayout;
  mode: GestureMode;
  doneLabel?: string;
  onDone: (layout: PropLayout) => void;
  onBack: () => void;
}) {
  const [layout, setLayout] = useState(initial);
  const [mode, setMode] = useState<GestureMode>(initialMode);
  const [past, setPast] = useState<PropLayout[]>([]);
  const [future, setFuture] = useState<PropLayout[]>([]);
  const [view, setView] = useState<View>({ ppm: 60, ox: 40, oy: 320 });
  const [snap, setSnap] = useState(true);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [guide, setGuide] = useState<{ x: number; y: number; kind: string } | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [asked, setAsked] = useState(false);
  const [activeString, setActiveString] = useState(layoutStrings(initial)[0]?.id ?? "s1");
  const [dark, setDark] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [gap, setGap] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [magnifier, setMagnifier] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const gesture = useRef<GestureState>(idleGesture(initialMode));
  const layoutRef = useRef(layout);
  const viewRef = useRef(view);
  const snapRef = useRef(snap);
  const askedRef = useRef(asked);
  const activeRef = useRef(activeString);
  const darkRef = useRef(dark);
  const placingRef = useRef(placing);
  const nudgeRef = useRef<(key: string) => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  layoutRef.current = layout;
  viewRef.current = view;
  snapRef.current = snap;
  askedRef.current = asked;
  activeRef.current = activeString;
  darkRef.current = dark;
  placingRef.current = placing;

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setSize({ w: node.clientWidth || 390, h: node.clientHeight || 520 });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || size.w < 40) return;
    opened.current = true;
    setView(fitView(initial, size.w, size.h));
  }, [initial, size.h, size.w]);

  useEffect(() => {
    try {
      localStorage.setItem("nightplot-prop-layout-draft", JSON.stringify(layout));
    } catch {
      /* a private browser may refuse the draft */
    }
  }, [layout]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        fitRef.current();
      } else if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        onDone(layoutRef.current);
      } else if (event.key.startsWith("Arrow")) {
        nudgeRef.current(event.key);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  function commit(next: PropLayout, notice?: string) {
    setPast((rows) => [...rows.slice(-49), layoutRef.current]);
    setFuture([]);
    setLayout(next);
    setToast(notice ?? null);
    const closing = next.run[next.run.length - 1];
    if (closing?.lockedLengthM && isClosed(next)) {
      const miss = Math.abs(edgeLengthM(next, closing) - closing.lockedLengthM);
      setGap(miss > 0.005 ? gapLabel(miss, next.units) : null);
    } else setGap(null);
  }

  function undo() {
    setPast((rows) => {
      const previous = rows[rows.length - 1];
      if (!previous) return rows;
      setFuture((ahead) => [layoutRef.current, ...ahead]);
      setLayout(previous);
      return rows.slice(0, -1);
    });
    setToast(null);
  }

  function redo() {
    setFuture((rows) => {
      const next = rows[0];
      if (!next) return rows;
      setPast((behind) => [...behind, layoutRef.current]);
      setLayout(next);
      return rows.slice(1);
    });
  }

  function fit() {
    setView(fitView(layoutRef.current, size.w, size.h));
    gesture.current = reduceGesture(gesture.current, { type: "fit", t: now() }).state;
    setPreview(null);
    setMagnifier(null);
  }

  function nudge(key: string) {
    if (!selected) return;
    const step = gridSizeM(layoutRef.current.units);
    const delta = key === "ArrowLeft" ? [-step, 0] : key === "ArrowRight" ? [step, 0] : key === "ArrowUp" ? [0, step] : [0, -step];
    const corner = layoutRef.current.corners.find((row) => row.id === selected);
    if (!corner) return;
    commit(moveCorner(layoutRef.current, selected, corner.x + delta[0]!, corner.y + delta[1]!));
  }

  function applyLength(edgeId: string, lengthM: number) {
    const edited = setEdgeLength(layoutRef.current, edgeId, lengthM);
    commit(edited.layout, edited.scaledAll ? "Scaled the drawing about the controller end." : undefined);
    if (edited.gapM) setGap(gapLabel(edited.gapM, layoutRef.current.units));
    setSheet(null);
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const local = localPoint(event);
    const world = toWorld(local.x, local.y, viewRef.current);
    const hit = hitOf(local, layoutRef.current, viewRef.current);
    const result = reduceGesture(gesture.current, { type: "down", pointerId: event.pointerId, x: world.x, y: world.y, t: now(), hit });
    gesture.current = result.state;
    for (const effect of result.effects) {
      if (effect.type === "preview") showPreview(effect.x, effect.y, local, event.altKey, event.shiftKey);
      if (effect.type === "cancel") clearPointer();
      if (effect.type === "edge") setSheet(effect.id);
    }
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const local = localPoint(event);
    const world = toWorld(local.x, local.y, viewRef.current);
    const result = reduceGesture(gesture.current, { type: "move", pointerId: event.pointerId, x: world.x, y: world.y, t: now() });
    gesture.current = result.state;
    for (const effect of result.effects) {
      if (effect.type === "preview") showPreview(effect.x, effect.y, local, event.altKey, event.shiftKey);
      if (effect.type === "drag") showDrag(effect.cornerId, effect.x, effect.y, local, event.altKey, event.shiftKey);
      if (effect.type === "pan") setView((current) => ({ ...current, ox: current.ox + effect.dx, oy: current.oy + effect.dy }));
      if (effect.type === "pinch") pinch(effect.ratio, effect.cx, effect.cy);
      if (effect.type === "cancel") clearPointer();
    }
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const local = localPoint(event);
    const world = toWorld(local.x, local.y, viewRef.current);
    const result = reduceGesture(gesture.current, { type: "up", pointerId: event.pointerId, x: world.x, y: world.y, t: now() });
    gesture.current = result.state;
    for (const effect of result.effects) {
      if (effect.type === "commit") dropCorner(effect.x, effect.y, event.altKey, event.shiftKey);
      if (effect.type === "commit-drag") {
        setSelected(effect.cornerId);
        if (effect.tap && gesture.current.mode === "trace") {
          if (placingRef.current) {
            const next = addStringAt(layoutRef.current, 0, 0, effect.cornerId);
            setActiveString(layoutStrings(next).at(-1)?.id ?? activeRef.current);
            setPlacing(false);
            commit(next);
          } else {
            commit(continueToCorner(layoutRef.current, activeRef.current, effect.cornerId, darkRef.current ? "wire" : "lit"));
          }
        } else if (!effect.tap) {
          const snapped = snappedPoint(effect.x, effect.y, effect.cornerId, event.altKey, event.shiftKey);
          commit(moveCorner(layoutRef.current, effect.cornerId, snapped.x, snapped.y));
        }
      }
    }
    clearPointer();
  }

  function showPreview(x: number, y: number, local: { x: number; y: number }, alt: boolean, shift: boolean) {
    const snapped = snappedPoint(x, y, undefined, alt, shift);
    setPreview(snapped);
    setGuide(snapped.guide ? { x: snapped.x, y: snapped.y, kind: snapped.guide } : null);
    setMagnifier({ x: local.x, y: local.y, wx: snapped.x, wy: snapped.y });
  }

  function showDrag(id: string, x: number, y: number, local: { x: number; y: number }, alt: boolean, shift: boolean) {
    const snapped = snappedPoint(x, y, id, alt, shift);
    setDrag({ id, x: snapped.x, y: snapped.y });
    setGuide(snapped.guide ? { x: snapped.x, y: snapped.y, kind: snapped.guide } : null);
    setMagnifier({ x: local.x, y: local.y, wx: snapped.x, wy: snapped.y });
  }

  function dropCorner(x: number, y: number, alt: boolean, shift: boolean) {
    const snapped = snappedPoint(x, y, undefined, alt, shift);
    if (placingRef.current) {
      const next = addStringAt(layoutRef.current, snapped.x, snapped.y);
      setActiveString(layoutStrings(next).at(-1)?.id ?? activeRef.current);
      setPlacing(false);
      commit(next);
      return;
    }
    const next = continueToPoint(layoutRef.current, activeRef.current, snapped.x, snapped.y, darkRef.current ? "wire" : "lit");
    const edge = layoutStrings(next).flatMap((string) => string.run).at(-1);
    if (edge && edge.kind === "lit" && edgeLengthM(next, edge) < next.pitchM && !askedRef.current) {
      setAsk(true);
      setAsked(true);
    }
    commit(next);
  }

  function snappedPoint(x: number, y: number, exclude: string | undefined, alt: boolean, shift: boolean) {
    const current = layoutRef.current;
    const anchorId = exclude
      ? current.run.find((edge) => edge.to === exclude)?.from
      : current.run.length > 0 ? current.run[current.run.length - 1]!.to : current.corners[0]?.id;
    const anchor = current.corners.find((corner) => corner.id === anchorId) ?? null;
    const previous = current.run.length > 0 ? current.run[current.run.length - 1] : undefined;
    const from = previous ? current.corners.find((corner) => corner.id === previous.from) : undefined;
    const to = previous ? current.corners.find((corner) => corner.id === previous.to) : undefined;
    const previousAngle = from && to ? Math.atan2(to.y - from.y, to.x - from.x) : null;
    return snapPoint({
      point: { x, y },
      anchor: anchor ? { x: anchor.x, y: anchor.y } : null,
      previousAngle,
      corners: current.corners,
      excludeIds: exclude ? [exclude, anchorId ?? ""] : [anchorId ?? ""],
      pitchM: current.pitchM,
      gridM: gridSizeM(current.units),
      snapOff: alt || !snapRef.current,
      force45: shift,
    });
  }

  function pinch(ratio: number, cx: number, cy: number) {
    setView((current) => {
      const world = toWorld(cx, cy, current);
      const ppm = clampPpm(current.ppm * ratio, layoutRef.current, size.w, size.h);
      return { ppm, ox: cx - world.x * ppm, oy: cy + world.y * ppm };
    });
  }

  function clearPointer() {
    setPreview(null);
    setDrag(null);
    setGuide(null);
    setMagnifier(null);
  }

  nudgeRef.current = nudge;
  fitRef.current = fit;

  const counted = countLayout(layout);
  const corners = layout.corners.map((corner) => drag?.id === corner.id ? { ...corner, x: drag.x, y: drag.y } : corner);
  const drawing = { ...layout, corners };
  const zoomed = view.ppm * layout.pitchM >= 12;
  const stringLights = layout.stringLights;
  const spare = stringLights == null ? null : stringLights - counted.total;
  const short = spare != null && spare < 0;

  const totalText = stringLights == null
    ? `${counted.total} lights`
    : `${counted.total} lights · string has ${stringLights} · ${short ? `${Math.abs(spare ?? 0)} short` : `${spare} spare`}`;

  return (
    <div className="flex h-dvh max-h-dvh w-full max-w-full flex-col overflow-hidden bg-background landscape:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-1 bg-background px-1">
        <button type="button" className="min-h-11 shrink-0 px-3 text-[16px]" onClick={onBack}>Back</button>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-medium">{name}</h1>
      </header>
      <p className={`shrink-0 bg-background px-4 text-[15px] ${short ? "text-amber-200" : "text-foreground"}`}>{totalText}</p>
      <p className="shrink-0 bg-background px-4 pb-2 text-[14px] leading-5 text-muted-foreground">{editorHint(mode, dark, placing)}</p>
      {gap ? <p className="bg-background px-4 text-[14px] text-red-400">{gap}</p> : null}
      <div ref={frame} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background" style={{ touchAction: "none" }}>
        <svg
          data-testid="layout-canvas"
          className="block h-full w-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="img"
          aria-label="Prop drawing"
        >
          <Grid layout={drawing} view={view} width={size.w} height={size.h} />
          {guide ? <Guide view={view} guide={guide} anchor={anchorOf(drawing, drag?.id)} /> : null}
          {layoutStrings(drawing).flatMap((string) => string.run.map((edge, index) => ({ edge, order: index + 1 }))).map(({ edge, order }) => {
            const from = corners.find((corner) => corner.id === edge.from);
            const to = corners.find((corner) => corner.id === edge.to);
            if (!from || !to) return null;
            const a = toScreen(from.x, from.y, view);
            const b = toScreen(to.x, to.y, view);
            const row = counted.edges.find((item) => item.id === edge.id);
            const label = lengthLabel(edgeLengthM(drawing, edge), layout.units);
            const mid = edgeLabelPoint(a, b);
            const pixelLen = Math.hypot(b.x - a.x, b.y - a.y);
            const caption = pixelLen < 80
              ? String(order)
              : `${order} · ${label.whole}${zoomed && label.extra ? ` ${label.extra}` : ""} · ${row?.lights ?? 0}`;
            return (
              <g key={edge.id}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edge.kind === "wire" ? "#8a8478" : "#d4a574"} strokeWidth={edge.kind === "wire" ? 2 : 3} strokeDasharray={edge.kind === "wire" ? "6 4" : undefined} />
                <Chevron a={a} b={b} />
                <g
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSheet(edge.id);
                  }}
                >
                  <rect x={mid.x - 48} y={mid.y - 22} width={96} height={44} fill="transparent" />
                  <text
                    x={mid.x}
                    y={mid.y}
                    textAnchor="middle"
                    fill={row?.lights === 0 ? "#f5c16c" : "#e8e2d6"}
                    fontSize={14}
                  >
                    {caption}
                  </text>
                  {edge.lockedLengthM ? <LockIcon x={mid.x + caption.length * 3.4} y={mid.y - 12} /> : null}
                </g>
              </g>
            );
          })}
          {preview ? <CornerDot view={view} x={preview.x} y={preview.y} index={corners.length + 1} ghost /> : null}
          {corners.map((corner, index) => (
            <CornerDot key={corner.id} view={view} x={corner.x} y={corner.y} index={index + 1} start={layoutStrings(layout).some((string) => string.startId === corner.id)} />
          ))}
        </svg>
        {magnifier ? <Magnifier magnifier={magnifier} layout={drawing} /> : null}
        <div className="absolute left-2 top-2 flex gap-2">
          <ModeButton active={mode === "trace"} onClick={() => switchMode("trace")}>Trace</ModeButton>
          <ModeButton active={mode === "edit"} onClick={() => switchMode("edit")}>Edit</ModeButton>
        </div>
      </div>
      </div>
      <div className="flex gap-2 border-t border-border bg-background p-2">
        <DockButton onClick={undo} disabled={past.length === 0}>Undo</DockButton>
        <DockButton onClick={redo} disabled={future.length === 0}>Redo</DockButton>
        <DockButton onClick={() => setSnap((value) => !value)} pressed={snap}>Snap</DockButton>
        <DockButton onClick={fit}>Fit</DockButton>
      </div>
      <div className="flex gap-2 bg-background px-2 pb-2">
        <DockButton onClick={() => { setDark((value) => !value); setPlacing(false); }} pressed={dark}>Mark dark</DockButton>
        <DockButton onClick={() => { setPlacing((value) => !value); setMode("trace"); }} pressed={placing}>Add another string</DockButton>
      </div>
      <div className="flex gap-2 border-t border-border bg-background px-3 py-3">
        <Button type="button" variant="outline" className="min-h-12 flex-1 text-base" onClick={onBack}>Back</Button>
        <Button type="button" className="min-h-12 flex-1 text-base" onClick={() => onDone(ensureStrings(layout))}>{doneLabel}</Button>
      </div>
      {toast ? (
        <div className="absolute bottom-20 left-3 right-3 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[14px] landscape:bottom-3 landscape:right-20">
          <span className="flex-1">{toast}</span>
          <button type="button" className="min-h-11 px-3 text-primary" onClick={undo}>Undo</button>
        </div>
      ) : null}
      {sheet ? (
        <LengthSheet
          layout={layout}
          edgeId={sheet}
          onClose={() => setSheet(null)}
          onApply={(lengthM) => applyLength(sheet, lengthM)}
        />
      ) : null}
      {ask ? (
        <div className="absolute inset-x-4 top-24 rounded-xl border border-amber-500/60 bg-card p-4 text-[15px]" role="dialog" aria-label="Short edge">
          <p>This edge is shorter than one light, so it has 0 lights.</p>
          <Button type="button" className="mt-3 min-h-11" onClick={() => setAsk(false)}>OK</Button>
        </div>
      ) : null}
    </div>
  );

  function switchMode(next: GestureMode) {
    setMode(next);
    gesture.current = { ...gesture.current, mode: next, pendingId: null, drag: null };
  }
}

function editorHint(mode: GestureMode, dark: boolean, placing: boolean): string {
  if (placing) return "Tap where the new string's wire comes in.";
  if (dark) return "The next run is dark: the wire jumps and no lights are on it.";
  if (mode === "edit") return "Drag a corner to move it. Snap keeps it on the grid. Fit shows the whole drawing.";
  return "Continue from where the wire comes in. Tap a corner to run there, or empty space for a new point.";
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-lg border px-3 text-[15px] ${active ? "border-primary bg-card" : "border-border"}`} aria-pressed={active}>
      {children}
    </button>
  );
}

function DockButton({ onClick, disabled, pressed, children }: { onClick: () => void; disabled?: boolean; pressed?: boolean; children: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} className={`min-h-11 min-w-11 flex-1 rounded-lg border text-[14px] landscape:flex-none ${pressed ? "border-primary" : "border-border"} disabled:opacity-40`}>
      {children}
    </button>
  );
}

function CornerDot({ view, x, y, index, start, ghost }: { view: View; x: number; y: number; index: number; start?: boolean; ghost?: boolean }) {
  const screen = toScreen(x, y, view);
  return (
    <g>
      <circle cx={screen.x} cy={screen.y} r={22} fill="transparent" />
      <circle cx={screen.x} cy={screen.y} r={6} fill={ghost ? "none" : start ? "#7ee0d0" : "#d4a574"} stroke="#d4a574" />
      <text x={screen.x + 12} y={start ? screen.y + 4 : screen.y - 10} textAnchor="start" fontSize={12} className="fill-foreground">{start ? "Wire in" : index}</text>
    </g>
  );
}

function edgeLabelPoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return { x: mx + nx * 16, y: my + ny * 16 };
}

function Chevron({ a, b }: { a: { x: number; y: number }; b: { x: number; y: number } }) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const x = a.x + (b.x - a.x) * 0.72;
  const y = a.y + (b.y - a.y) * 0.72;
  const size = 8;
  const tip = [x + Math.cos(angle) * size, y + Math.sin(angle) * size];
  const left = [x + Math.cos(angle + 2.6) * size, y + Math.sin(angle + 2.6) * size];
  const right = [x + Math.cos(angle - 2.6) * size, y + Math.sin(angle - 2.6) * size];
  return <polygon points={`${tip[0]},${tip[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`} fill="#d4a574" />;
}

function LockIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke="#e8e2d6" strokeWidth={1.4}>
      <rect x={0} y={5} width={9} height={7} rx={1} />
      <path d="M2 5 V3.2 a2.5 2.5 0 0 1 5 0 V5" />
    </g>
  );
}

function Guide({ view, guide, anchor }: { view: View; guide: { x: number; y: number }; anchor: { x: number; y: number } | null }) {
  if (!anchor) return null;
  const a = toScreen(anchor.x, anchor.y, view);
  const b = toScreen(guide.x, guide.y, view);
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#7ee0d0" strokeDasharray="4 3" />;
}

function Grid({ layout, view, width, height }: { layout: PropLayout; view: View; width: number; height: number }) {
  const grid = gridSizeM(layout.units);
  const lines = [];
  const left = toWorld(0, 0, view).x;
  const right = toWorld(width, 0, view).x;
  const top = toWorld(0, 0, view).y;
  const bottom = toWorld(0, height, view).y;
  const x0 = Math.floor(Math.min(left, right) / grid) * grid;
  const x1 = Math.ceil(Math.max(left, right) / grid) * grid;
  for (let x = x0; x <= x1 && lines.length < 80; x += grid) {
    const screen = toScreen(x, 0, view);
    lines.push(<line key={`x${x}`} x1={screen.x} y1={0} x2={screen.x} y2={height} stroke="#2a2e36" />);
  }
  const y0 = Math.floor(Math.min(top, bottom) / grid) * grid;
  const y1 = Math.ceil(Math.max(top, bottom) / grid) * grid;
  for (let y = y0; y <= y1 && lines.length < 160; y += grid) {
    const screen = toScreen(0, y, view);
    lines.push(<line key={`y${y}`} x1={0} y1={screen.y} x2={width} y2={screen.y} stroke="#2a2e36" />);
  }
  return <g>{lines}</g>;
}

function Magnifier({ magnifier, layout }: { magnifier: { x: number; y: number; wx: number; wy: number }; layout: PropLayout }) {
  const scale = 2.4;
  return (
    <div className="pointer-events-none absolute h-24 w-24 overflow-hidden rounded-full border border-primary bg-background" style={{ left: magnifier.x - 48, top: Math.max(8, magnifier.y - 140) }}>
      <svg viewBox={`${magnifier.wx - 0.35} ${-magnifier.wy - 0.35} ${0.7} ${0.7}`} className="h-full w-full" style={{ transform: `scale(${scale})` }}>
        {layout.run.map((edge) => {
          const from = layout.corners.find((corner) => corner.id === edge.from);
          const to = layout.corners.find((corner) => corner.id === edge.to);
          if (!from || !to) return null;
          return <line key={edge.id} x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} stroke="#d4a574" strokeWidth={0.02} />;
        })}
        <circle cx={magnifier.wx} cy={-magnifier.wy} r={0.03} fill="#7ee0d0" />
      </svg>
    </div>
  );
}

function LengthSheet({
  layout,
  edgeId,
  onClose,
  onApply,
}: {
  layout: PropLayout;
  edgeId: string;
  onClose: () => void;
  onApply: (lengthM: number) => void;
}) {
  const edge = layout.run.find((row) => row.id === edgeId);
  const lengthM = edge ? edgeLengthM(layout, edge) : 0;
  const per = layout.units === "ft" ? FT : 1;
  const [length, setLength] = useState(String(Math.round((lengthM / per) * 100) / 100));
  const [count, setCount] = useState(String(Math.max(1, Math.round(lengthM / layout.pitchM))));
  if (!edge) return null;
  return (
    <form
      className="absolute inset-x-0 bottom-0 z-30 border-t border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = Number(length);
        if (typed > 0) onApply(typed * per);
      }}
    >
      <p className="text-[15px] font-medium">This edge</p>
      <label className="mt-3 flex flex-col gap-1 text-[15px]">
        Length ({layout.units === "ft" ? "ft" : "m"})
        <input value={length} onChange={(event) => setLength(event.target.value)} inputMode="decimal" className="min-h-11 rounded-md border border-input bg-background px-3 text-base" />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-[15px]">
        Light count
        <input
          value={count}
          onChange={(event) => {
            setCount(event.target.value);
            const lights = Number(event.target.value);
            if (lights > 0) setLength(String(Math.round(((lights * layout.pitchM) / per) * 100) / 100));
          }}
          inputMode="numeric"
          className="min-h-11 rounded-md border border-input bg-background px-3 text-base"
        />
      </label>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" className="min-h-11 flex-1 text-base" onClick={onClose}>Back</Button>
        <Button type="submit" className="min-h-11 flex-1 text-base">Apply</Button>
      </div>
    </form>
  );
}

function hitOf(local: { x: number; y: number }, layout: PropLayout, view: View): GestureHit {
  for (const corner of layout.corners) {
    const screen = toScreen(corner.x, corner.y, view);
    if (Math.hypot(screen.x - local.x, screen.y - local.y) <= 22) return { kind: "corner", id: corner.id };
  }
  return { kind: "empty" };
}

function anchorOf(layout: PropLayout, cornerId: string | undefined): { x: number; y: number } | null {
  if (!cornerId) {
    const end = layout.run[layout.run.length - 1];
    const corner = layout.corners.find((row) => row.id === (end?.to ?? layout.corners[0]?.id));
    return corner ? { x: corner.x, y: corner.y } : null;
  }
  const edge = layout.run.find((row) => row.to === cornerId);
  const corner = layout.corners.find((row) => row.id === edge?.from);
  return corner ? { x: corner.x, y: corner.y } : null;
}

function toScreen(x: number, y: number, view: View): { x: number; y: number } {
  return { x: view.ox + x * view.ppm, y: view.oy - y * view.ppm };
}

function toWorld(x: number, y: number, view: View): { x: number; y: number } {
  return { x: (x - view.ox) / view.ppm, y: (view.oy - y) / view.ppm };
}

function localPoint(event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }): { x: number; y: number } {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function fitView(layout: PropLayout, width: number, height: number): View {
  const span = bounds(layout).span;
  const framed = span < 0.15 ? 12 * FT : span * 1.25;
  return center(layout, width, height, framed);
}

function center(layout: PropLayout, width: number, height: number, span: number): View {
  const box = bounds(layout);
  const ppm = clampPpm(Math.min(width, height) / span, layout, width, height);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return { ppm, ox: width / 2 - cx * ppm, oy: height / 2 + cy * ppm };
}

function clampPpm(ppm: number, layout: PropLayout, width: number, height: number): number {
  const maxIn = 48 / layout.pitchM;
  const span = Math.max(bounds(layout).span * 1.25, 12 * FT);
  const minOut = Math.min(width, height) / Math.max(span, 40 * FT);
  return Math.min(maxIn, Math.max(minOut, ppm));
}

function bounds(layout: PropLayout): { minX: number; maxX: number; minY: number; maxY: number; span: number } {
  const xs = layout.corners.map((corner) => corner.x);
  const ys = layout.corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, span: Math.max(maxX - minX, maxY - minY, 0.01) };
}
