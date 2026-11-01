"use client";

import {
  addStringAt,
  continueToCorner,
  clearEdgeLights,
  continueToPoint,
  countLayout,
  deleteRun,
  edgeLengthM,
  ensureStrings,
  gapLabel,
  gridSizeM,
  isClosed,
  layoutStrings,
  moveCorner,
  setEdgeLength,
  setEdgeLights,
  snapPoint,
  stringById,
  stringEndId,
  type PropLayout,
} from "@nightplot/shared";
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import { EditorStage, boundsOf, toScreen, toWorld, type Camera, type EditorStageHandle, type Point } from "@/components/canvas";
import { Button } from "@/components/ui/button";
import { RunList, lengthInUnit } from "./run-list";

/** Trace adds runs from the wire-in. Edit moves corners. Both pan, zoom, and select. */
export type EditorMode = "trace" | "edit";

const LIT = "#d4a574";
const WIRE = "#8a8478";
const START = "#7ee0d0";
const INK = "#e8e2d6";
const WARN = "#f5c16c";

type Drag = { id: string; x: number; y: number; screen: Point; guide: string | null };
type Ghost = { x: number; y: number; guide: string | null };

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
  mode: EditorMode;
  doneLabel?: string;
  onDone: (layout: PropLayout) => void;
  onBack: () => void;
}) {
  const [layout, setLayout] = useState(initial);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [past, setPast] = useState<PropLayout[]>([]);
  const [future, setFuture] = useState<PropLayout[]>([]);
  const [snap, setSnap] = useState(true);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [asked, setAsked] = useState(false);
  const [activeString, setActiveString] = useState(layoutStrings(initial)[0]?.id ?? "s1");
  const [dark, setDark] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [gap, setGap] = useState<string | null>(null);
  const stage = useRef<EditorStageHandle>(null);
  const layoutRef = useRef(layout);
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    layoutRef.current = layout;
    try {
      localStorage.setItem("nightplot-prop-layout-draft", JSON.stringify(layout));
    } catch {
      /* a private browser may refuse the draft */
    }
  }, [layout]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    keyRef.current = onKey;
  });

  function onKey(event: KeyboardEvent) {
    if (typing(event.target)) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      stage.current?.fit();
    } else if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      onDone(layoutRef.current);
    } else if ((event.key === "Delete" || event.key === "Backspace") && picked) {
      event.preventDefault();
      removeRun(picked);
    } else if (event.key.startsWith("Arrow") && selected) {
      event.preventDefault();
      nudge(event.key);
    }
  }

  function commit(next: PropLayout, notice?: string) {
    const current = layoutRef.current;
    setPast((rows) => [...rows.slice(-49), current]);
    setFuture([]);
    layoutRef.current = next;
    setLayout(next);
    setToast(notice ?? null);
    const closing = next.run[next.run.length - 1];
    if (closing?.lockedLengthM && isClosed(next)) {
      const miss = Math.abs(edgeLengthM(next, closing) - closing.lockedLengthM);
      setGap(miss > 0.005 ? gapLabel(miss, next.units) : null);
    } else setGap(null);
  }

  function undo() {
    const previous = past[past.length - 1];
    if (!previous) return;
    const current = layoutRef.current;
    setFuture((ahead) => [current, ...ahead]);
    setPast((rows) => rows.slice(0, -1));
    layoutRef.current = previous;
    setLayout(previous);
    setToast(null);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    const current = layoutRef.current;
    setPast((behind) => [...behind, current]);
    setFuture((rows) => rows.slice(1));
    layoutRef.current = next;
    setLayout(next);
  }

  function nudge(key: string) {
    const step = gridSizeM(layoutRef.current.units);
    const delta = key === "ArrowLeft" ? [-step, 0] : key === "ArrowRight" ? [step, 0] : key === "ArrowUp" ? [0, step] : [0, -step];
    const corner = layoutRef.current.corners.find((row) => row.id === selected);
    if (!corner) return;
    commit(moveCorner(layoutRef.current, corner.id, corner.x + delta[0]!, corner.y + delta[1]!));
  }

  function applyLength(edgeId: string, lengthM: number) {
    const edited = setEdgeLength(layoutRef.current, edgeId, lengthM);
    commit(edited.layout, edited.scaledAll ? "Scaled the drawing about the controller end." : undefined);
    if (edited.gapM) setGap(gapLabel(edited.gapM, layoutRef.current.units));
  }

  function applyLights(edgeId: string, lights: number | null) {
    commit(lights == null ? clearEdgeLights(layoutRef.current, edgeId) : setEdgeLights(layoutRef.current, edgeId, lights));
  }

  function removeRun(edgeId: string) {
    const next = deleteRun(layoutRef.current, edgeId);
    if (next === layoutRef.current) return;
    setPicked(null);
    setSelected(null);
    commit(next, "Deleted the run.");
  }

  /** Where a new point or a dragged corner lands, after snap. */
  function snapped(x: number, y: number, exclude: string | undefined, alt: boolean, shift: boolean) {
    const current = layoutRef.current;
    const strings = layoutStrings(current);
    const allRuns = strings.flatMap((string) => string.run);
    let anchorId: string | undefined;
    let previous: (typeof allRuns)[number] | undefined;
    if (exclude) {
      previous = allRuns.find((edge) => edge.to === exclude);
      anchorId = previous?.from;
    } else {
      const active = stringById(current, activeString);
      anchorId = placing ? undefined : stringEndId(active);
      previous = placing ? undefined : active.run[active.run.length - 1];
    }
    const anchor = current.corners.find((corner) => corner.id === anchorId) ?? null;
    const from = previous ? current.corners.find((corner) => corner.id === previous.from) : undefined;
    const to = previous ? current.corners.find((corner) => corner.id === previous.to) : undefined;
    const previousAngle = !exclude && from && to ? Math.atan2(to.y - from.y, to.x - from.x) : null;
    return snapPoint({
      point: { x, y },
      anchor: anchor ? { x: anchor.x, y: anchor.y } : null,
      previousAngle,
      corners: current.corners,
      excludeIds: exclude ? [exclude, anchorId ?? ""] : [anchorId ?? ""],
      pitchM: current.pitchM,
      gridM: gridSizeM(current.units),
      snapOff: alt || !snap,
      force45: shift,
    });
  }

  function addPoint(world: Point, alt: boolean, shift: boolean) {
    const point = snapped(world.x, world.y, undefined, alt, shift);
    setGhost(null);
    if (placing) {
      const next = addStringAt(layoutRef.current, point.x, point.y);
      setActiveString(layoutStrings(next).at(-1)?.id ?? activeString);
      setPlacing(false);
      commit(next);
      return;
    }
    const next = continueToPoint(layoutRef.current, activeString, point.x, point.y, dark ? "wire" : "lit");
    const edge = stringById(next, activeString).run.at(-1);
    if (edge && edge.kind === "lit" && edgeLengthM(next, edge) < next.pitchM && !asked) {
      setAsk(true);
      setAsked(true);
    }
    commit(next);
  }

  function tapCorner(cornerId: string) {
    setSelected(cornerId);
    if (mode !== "trace") return;
    if (placing) {
      const next = addStringAt(layoutRef.current, 0, 0, cornerId);
      setActiveString(layoutStrings(next).at(-1)?.id ?? activeString);
      setPlacing(false);
      commit(next);
      return;
    }
    commit(continueToCorner(layoutRef.current, activeString, cornerId, dark ? "wire" : "lit"));
  }

  function onCornerDrag(cornerId: string, event: Konva.KonvaEventObject<DragEvent>, camera: Camera, end: boolean) {
    const node = event.target;
    const world = toWorld(node.position(), camera);
    const point = snapped(world.x, world.y, cornerId, event.evt.altKey, event.evt.shiftKey);
    const screen = toScreen(point, camera);
    node.position(screen);
    if (!end) {
      setDrag({ id: cornerId, x: point.x, y: point.y, screen, guide: point.guide });
      return;
    }
    setDrag(null);
    setSelected(cornerId);
    const corner = layoutRef.current.corners.find((row) => row.id === cornerId);
    if (corner && (Math.abs(corner.x - point.x) > 1e-9 || Math.abs(corner.y - point.y) > 1e-9)) {
      commit(moveCorner(layoutRef.current, cornerId, point.x, point.y));
    }
  }

  function switchMode(next: EditorMode) {
    setMode(next);
    setGhost(null);
    if (next === "edit") setPlacing(false);
  }

  const counted = countLayout(layout);
  const corners = layout.corners.map((corner) => (drag?.id === corner.id ? { ...corner, x: drag.x, y: drag.y } : corner));
  const drawing = { ...layout, corners };
  const strings = layoutStrings(drawing);
  const runs = strings.flatMap((string) => string.run.map((edge, index) => ({ edge, order: index + 1, stringId: string.id })));
  const starts = new Set(strings.map((string) => string.startId));
  const stringLights = layout.stringLights;
  const spare = stringLights == null ? null : stringLights - counted.total;
  const short = spare != null && spare < 0;
  const bounds = boundsOf(layout.corners) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const guideAnchor = guideAnchorOf(drawing, drag?.id, stringEndId(stringById(drawing, activeString)), placing);
  const guide = drag?.guide ? { x: drag.x, y: drag.y } : ghost?.guide ? { x: ghost.x, y: ghost.y } : null;

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
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          <EditorStage
            ref={stage}
            bounds={bounds}
            limits={{ minPpm: 2, maxPpm: 48 / Math.max(layout.pitchM, 0.005) }}
            fitMinSpanM={layout.corners.length < 2 ? 2 : layout.pitchM * 2}
            gridM={gridSizeM(layout.units)}
            label="Prop drawing"
            testId="layout-canvas"
            onBackgroundTap={(tap) => {
              setPicked(null);
              if (mode === "trace") addPoint(tap.world, tap.altKey, tap.shiftKey);
              else setSelected(null);
            }}
            onHover={(hover) => {
              if (!hover || mode !== "trace") return setGhost(null);
              const point = snapped(hover.world.x, hover.world.y, undefined, hover.altKey, hover.shiftKey);
              setGhost({ x: point.x, y: point.y, guide: point.guide });
            }}
            overlay={(camera) => {
              const labels = badgeSpots(runs, corners, camera);
              return (
              <>
                {guide && guideAnchor ? (
                  <Line points={flat([toScreen(guideAnchor, camera), toScreen(guide, camera)])} stroke={START} strokeWidth={1} dash={[4, 3]} listening={false} />
                ) : null}
                {ghost && mode === "trace" && !drag ? (
                  <>
                    {guideAnchor && !placing ? (
                      <Line points={flat([toScreen(guideAnchor, camera), toScreen(ghost, camera)])} stroke={dark ? WIRE : LIT} strokeWidth={2} opacity={0.5} dash={dark ? [6, 4] : undefined} listening={false} />
                    ) : null}
                    <Circle {...toScreen(ghost, camera)} radius={6} stroke={LIT} listening={false} />
                  </>
                ) : null}
                {runs.map(({ edge, order }, index) => {
                  const from = corners.find((corner) => corner.id === edge.from);
                  const to = corners.find((corner) => corner.id === edge.to);
                  if (!from || !to) return null;
                  const a = toScreen(from, camera);
                  const b = toScreen(to, camera);
                  const label = labels[index]!;
                  const row = counted.edges.find((item) => item.id === edge.id);
                  const zero = row?.lights === 0 && edge.kind === "lit";
                  const pick = () => setPicked(edge.id);
                  return (
                    <Group key={edge.id}>
                      <Line
                        points={[a.x, a.y, b.x, b.y]}
                        stroke={edge.kind === "wire" ? WIRE : LIT}
                        strokeWidth={edge.kind === "wire" ? 2 : picked === edge.id ? 5 : 3}
                        dash={edge.kind === "wire" ? [6, 4] : undefined}
                        hitStrokeWidth={28}
                        onClick={pick}
                        onTap={pick}
                      />
                      <Chevron a={a} b={b} />
                      <Group x={label.x} y={label.y} onClick={pick} onTap={pick}>
                        <Circle radius={12} fill={picked === edge.id ? "#1c2430" : "#12141a"} stroke={zero ? WARN : INK} />
                        <Text text={String(order)} fontSize={12} fill={zero ? WARN : INK} width={24} offsetX={12} offsetY={6} align="center" listening={false} />
                        {edge.lockedLengthM ? <LockMark /> : null}
                        {Math.hypot(b.x - a.x, b.y - a.y) > 72 && row ? (
                          <Text
                            text={`${lengthInUnit(row.lengthM, layout.units)} ${layout.units === "ft" ? "ft" : "m"} · ${row.lights}`}
                            fontSize={11}
                            fill={edge.lockedLights != null ? LIT : "#a8a296"}
                            y={15}
                            width={90}
                            offsetX={45}
                            align="center"
                            listening={false}
                          />
                        ) : null}
                      </Group>
                    </Group>
                  );
                })}
                {corners.map((corner) => {
                  const at = toScreen(corner, camera);
                  const start = starts.has(corner.id);
                  return (
                    <Group
                      key={corner.id}
                      x={at.x}
                      y={at.y}
                      draggable
                      onDragStart={() => setGhost(null)}
                      onDragMove={(event) => onCornerDrag(corner.id, event, camera, false)}
                      onDragEnd={(event) => onCornerDrag(corner.id, event, camera, true)}
                      onClick={() => tapCorner(corner.id)}
                      onTap={() => tapCorner(corner.id)}
                    >
                      <Circle radius={22} fill="transparent" />
                      <Circle radius={selected === corner.id ? 8 : 6} fill={start ? START : LIT} stroke={selected === corner.id ? INK : LIT} strokeWidth={selected === corner.id ? 2 : 1} />
                      {start ? <Text text="Wire in" x={12} y={-6} fontSize={12} fill={INK} listening={false} /> : null}
                    </Group>
                  );
                })}
              </>
              );
            }}
          />
          {drag ? <Magnifier at={drag.screen} world={{ x: drag.x, y: drag.y }} layout={drawing} /> : null}
          <div className="absolute left-2 top-2 flex gap-2">
            <ModeButton active={mode === "trace"} onClick={() => switchMode("trace")}>Trace</ModeButton>
            <ModeButton active={mode === "edit"} onClick={() => switchMode("edit")}>Edit</ModeButton>
          </div>
          <ul className="sr-only" aria-label="Strings">
            {strings.map((string, index) => (
              <li key={string.id}>
                String {index + 1}: Wire in, {string.run.length} {string.run.length === 1 ? "run" : "runs"}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <RunList
        className="max-h-[24dvh] shrink-0 border-t border-border bg-background"
        layout={layout}
        picked={picked}
        onPick={setPicked}
        onLength={applyLength}
        onLights={applyLights}
        onDelete={removeRun}
      />
      <div className="flex gap-2 border-t border-border bg-background p-2">
        <DockButton onClick={undo} disabled={past.length === 0}>Undo</DockButton>
        <DockButton onClick={redo} disabled={future.length === 0}>Redo</DockButton>
        <DockButton onClick={() => setSnap((value) => !value)} pressed={snap}>Snap</DockButton>
        <DockButton onClick={() => picked && removeRun(picked)} disabled={!picked}>Delete</DockButton>
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
      {ask ? (
        <div className="absolute inset-x-4 top-24 rounded-xl border border-amber-500/60 bg-card p-4 text-[15px]" role="dialog" aria-label="Short edge">
          <p>This edge is shorter than one light, so it has 0 lights.</p>
          <Button type="button" className="mt-3 min-h-11" onClick={() => setAsk(false)}>OK</Button>
        </div>
      ) : null}
    </div>
  );
}

function editorHint(mode: EditorMode, dark: boolean, placing: boolean): string {
  if (placing) return "Tap where the new string's wire comes in.";
  if (dark) return "The next run is dark: the wire jumps and no lights are on it.";
  if (mode === "edit") return "Drag a corner to move it. Snap keeps it on the grid. Drag empty space to pan. Fit shows the whole drawing.";
  return "Continue from where the wire comes in. Tap a corner to run there, or empty space for a new point. Drag to pan.";
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-lg border bg-background/90 px-3 text-[15px] ${active ? "border-primary bg-card" : "border-border"}`} aria-pressed={active}>
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

function Chevron({ a, b }: { a: Point; b: Point }) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const x = a.x + (b.x - a.x) * 0.72;
  const y = a.y + (b.y - a.y) * 0.72;
  const size = 8;
  const points = [
    x + Math.cos(angle) * size, y + Math.sin(angle) * size,
    x + Math.cos(angle + 2.6) * size, y + Math.sin(angle + 2.6) * size,
    x + Math.cos(angle - 2.6) * size, y + Math.sin(angle - 2.6) * size,
  ];
  return <Line points={points} closed fill={LIT} listening={false} />;
}

function LockMark() {
  return (
    <Group x={10} y={-14} listening={false}>
      <Line points={[0, 5, 9, 5, 9, 12, 0, 12]} closed stroke={INK} strokeWidth={1.4} />
      <Line points={[2, 5, 2, 3, 4.5, 0.8, 7, 3, 7, 5]} stroke={INK} strokeWidth={1.4} tension={0.4} />
    </Group>
  );
}

/** Keep run-number badges off the line and clear of each other. */
function badgeSpots(
  runs: { edge: { from: string; to: string } }[],
  corners: readonly { id: string; x: number; y: number }[],
  camera: Camera,
): Point[] {
  const placed: Point[] = [];
  const gap = 26;
  return runs.map(({ edge }) => {
    const from = corners.find((corner) => corner.id === edge.from);
    const to = corners.find((corner) => corner.id === edge.to);
    if (!from || !to) return finish({ x: -999, y: -999 });
    const a = toScreen(from, camera);
    const b = toScreen(to, camera);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let chosen = { x: mx + nx * 18, y: my + ny * 18 };
    let best = -1;
    for (const dist of [18, 30, 42, 54]) {
      for (const side of [1, -1]) {
        for (const along of [0, 12, -12, 22, -22]) {
          const next = { x: mx + nx * dist * side + ny * along, y: my + ny * dist * side - nx * along };
          const clearance = placed.reduce((min, point) => Math.min(min, Math.hypot(point.x - next.x, point.y - next.y)), 999);
          if (clearance > best) {
            best = clearance;
            chosen = next;
          }
          if (clearance >= gap) return finish(next);
        }
      }
    }
    return finish(chosen);
  });

  function finish(point: Point): Point {
    placed.push(point);
    return point;
  }
}

function Magnifier({ at, world, layout }: { at: Point; world: Point; layout: PropLayout }) {
  const scale = 2.4;
  return (
    <div className="pointer-events-none absolute h-24 w-24 overflow-hidden rounded-full border border-primary bg-background" style={{ left: at.x - 48, top: Math.max(8, at.y - 140) }}>
      <svg viewBox={`${world.x - 0.35} ${-world.y - 0.35} ${0.7} ${0.7}`} className="h-full w-full" style={{ transform: `scale(${scale})` }}>
        {layoutStrings(layout).flatMap((string) => string.run).map((edge) => {
          const from = layout.corners.find((corner) => corner.id === edge.from);
          const to = layout.corners.find((corner) => corner.id === edge.to);
          if (!from || !to) return null;
          return <line key={edge.id} x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} stroke={LIT} strokeWidth={0.02} />;
        })}
        <circle cx={world.x} cy={-world.y} r={0.03} fill={START} />
      </svg>
    </div>
  );
}

/** The corner a snap guide or ghost run starts from: the dragged corner's run start, or the active string's end. */
function guideAnchorOf(layout: PropLayout, dragId: string | undefined, endId: string, placing: boolean): Point | null {
  const id = dragId
    ? layoutStrings(layout).flatMap((string) => string.run).find((edge) => edge.to === dragId)?.from
    : placing ? undefined : endId;
  const corner = layout.corners.find((row) => row.id === id);
  return corner ? { x: corner.x, y: corner.y } : null;
}

function flat(points: Point[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}
