"use client";

import {
  addStringAt,
  continueToCorner,
  clearEdgeLights,
  continueToPoint,
  countLayout,
  deletePoint,
  deleteRun,
  edgeLengthM,
  ensureStrings,
  formatLength,
  formatPitchCm,
  gapLabel,
  gridScaleLabel,
  gridSizeM,
  isClosed,
  layoutReview,
  layoutStrings,
  mergeShortRuns,
  moveCorner,
  parsePitchCm,
  runsOnSameSpan,
  setEdgeLength,
  setEdgeLights,
  setEdgeName,
  setLayoutUnits,
  setPitchM,
  shortRuns,
  snapPoint,
  splitRun,
  snapStepM,
  stringById,
  stringEndId,
  weldCorners,
  type PropLayout,
} from "@nightplot/shared";
import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Circle, Group, Line, Text } from "react-konva";
import { EditorStage, boundsOf, toScreen, toWorld, type Camera, type EditorStageHandle, type Point } from "@/components/canvas";
import { Button } from "@/components/ui/button";
import { RunList } from "./run-list";
import { placeRunLabels, runBadge, stringColour } from "./run-labels";

/** Trace adds runs from the wire-in. Edit moves corners. Both pan, zoom, and select. */
export type EditorMode = "trace" | "edit";

const LIT = "#d4a574";
const WIRE = "#8a8478";
const START = "#7ee0d0";
const INK = "#e8e2d6";
const WARN = "#f5c16c";
/** Join treats corners closer than this on screen as one corner. */
const WELD_PX = 12;
const OVERLAP_PX = 10;

type Drag = { id: string; x: number; y: number; screen: Point; guide: string | null };
type Ghost = { x: number; y: number; guide: string | null };

export function PropLayoutEditor({
  name,
  initial,
  mode: initialMode,
  doneLabel = "Done",
  backLabel = "Back",
  onDone,
  onBack,
  onAutosave,
}: {
  name: string;
  initial: PropLayout;
  mode: EditorMode;
  doneLabel?: string;
  backLabel?: string;
  onDone: (layout: PropLayout) => void;
  onBack: (layout: PropLayout) => void | Promise<void>;
  /** Write the drawing. Absent on a new prop, which is kept on this device until it is created. */
  onAutosave?: (layout: PropLayout) => Promise<boolean>;
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
  const [splitting, setSplitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [review, setReview] = useState<string[] | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [activeString, setActiveString] = useState(layoutStrings(initial)[0]?.id ?? "s1");
  const [dark, setDark] = useState(false);
  const [placing, setPlacing] = useState(false);
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const splittingRef = useRef(splitting);
  splittingRef.current = splitting;
  const [gap, setGap] = useState<string | null>(null);
  const stage = useRef<EditorStageHandle>(null);
  const layoutRef = useRef(layout);
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const onAutosaveRef = useRef(onAutosave);
  onAutosaveRef.current = onAutosave;
  const saveGen = useRef(0);
  const openedJson = useRef(JSON.stringify(ensureStrings(initial)));
  const saveNoteRef = useRef(saveNote);
  saveNoteRef.current = saveNote;
  const runPress = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = name;
    return () => { document.title = previous; };
  }, [name]);

  useEffect(() => {
    layoutRef.current = layout;
    try {
      localStorage.setItem("nightplot-prop-layout-draft", JSON.stringify(layout));
    } catch {
      /* a private browser may refuse the draft */
    }
  }, [layout]);

  async function persistNow(): Promise<boolean> {
    const next = ensureStrings(layoutRef.current);
    const json = JSON.stringify(next);
    const save = onAutosaveRef.current;
    if (!save) {
      let stored = true;
      try {
        localStorage.setItem("nightplot-prop-layout-draft", json);
      } catch {
        stored = false;
      }
      if (json === openedJson.current) {
        setSaveNote(null);
        return true;
      }
      setSaveNote(stored ? "Saved on this device" : "Not saved");
      if (stored) openedJson.current = json;
      return stored;
    }
    const mine = saveGen.current + 1;
    saveGen.current = mine;
    setSaveNote("Saving…");
    let ok = false;
    try {
      ok = await save(next);
    } catch {
      ok = false;
    }
    if (mine !== saveGen.current) return ok;
    if (ok) openedJson.current = json;
    setSaveNote(ok ? "Saved" : "Not saved");
    return ok;
  }

  useEffect(() => {
    if (JSON.stringify(ensureStrings(layout)) === openedJson.current) return;
    const timer = window.setTimeout(() => { void persistNow(); }, 400);
    return () => window.clearTimeout(timer);
  }, [layout]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      const pending = JSON.stringify(ensureStrings(layoutRef.current)) !== openedJson.current;
      const note = saveNoteRef.current;
      if (pending || note === "Saving…" || note === "Not saved") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onHide = () => { void persistNow(); };
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

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
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (review) {
        setReview(null);
        return;
      }
      if (splitting || placing || dark) {
        setSplitting(false);
        setPlacing(false);
        setDark(false);
        setGhost(null);
        return;
      }
      if (picked || selected) {
        setPicked(null);
        setSelected(null);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      void askDone();
    } else if ((event.key === "Delete" || event.key === "Backspace") && !picked && selected && deletePoint(layoutRef.current, selected) !== layoutRef.current) {
      event.preventDefault();
      removePoint(selected);
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
    setNote(null);
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
    const step = snapStepM(layoutRef.current.units);
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

  function applyUnits(units: PropLayout["units"]) {
    const next = setLayoutUnits(layoutRef.current, units);
    if (next !== layoutRef.current) commit(next);
  }

  function applyPitch(pitchM: number) {
    const next = setPitchM(layoutRef.current, pitchM);
    if (next !== layoutRef.current) commit(next);
  }

  function applyName(edgeId: string, edgeName: string) {
    const next = setEdgeName(layoutRef.current, edgeId, edgeName);
    if (next !== layoutRef.current) commit(next);
  }

  async function leave() {
    setLeaving(true);
    try {
      const ok = await persistNow();
      if (!ok) return;
      await onBack(ensureStrings(layoutRef.current));
    } finally {
      setLeaving(false);
    }
  }

  function finishDone() {
    const next = ensureStrings(layoutRef.current);
    const notes = layoutReview(next);
    if (notes.length === 0) onDone(next);
    else setReview(notes);
  }

  function askDone() {
    if (!onAutosaveRef.current) {
      void persistNow();
      finishDone();
      return;
    }
    void (async () => {
      const ok = await persistNow();
      if (ok) finishDone();
    })();
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

  function removePoint(cornerId: string) {
    const next = deletePoint(layoutRef.current, cornerId);
    if (next === layoutRef.current) {
      setNote("That corner is a wire-in, or other runs use it, so it stays.");
      return;
    }
    setSelected(null);
    commit(next, "The two runs are now one.");
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
      stepM: snapStepM(current.units),
      snapOff: alt || !snap,
      force45: shift,
    });
  }

  function addPoint(world: Point, alt: boolean, shift: boolean) {
    const point = snapped(world.x, world.y, undefined, alt, shift);
    setGhost(null);
    if (!placing) {
      const endId = stringEndId(stringById(layoutRef.current, activeString));
      const end = layoutRef.current.corners.find((corner) => corner.id === endId);
      if (end && Math.hypot(point.x - end.x, point.y - end.y) < 1e-4) return;
    }
    if (placing) {
      const next = addStringAt(layoutRef.current, point.x, point.y);
      setActiveString(layoutStrings(next).at(-1)?.id ?? activeString);
      setPlacing(false);
      commit(next);
      return;
    }
    finishTrace(continueToPoint(layoutRef.current, activeString, point.x, point.y, dark ? "wire" : "lit"));
  }

  function splitPickedOrArm() {
    setPlacing(false);
    setMode("edit");
    const edgeId = pickedRef.current;
    if (edgeId) {
      const edge = layoutStrings(layoutRef.current).flatMap((string) => string.run).find((row) => row.id === edgeId);
      const from = edge ? layoutRef.current.corners.find((corner) => corner.id === edge.from) : undefined;
      const to = edge ? layoutRef.current.corners.find((corner) => corner.id === edge.to) : undefined;
      if (from && to) {
        const split = splitRun(layoutRef.current, edgeId, (from.x + to.x) / 2, (from.y + to.y) / 2);
        if (split.cornerId) {
          setSplitting(false);
          setSelected(split.cornerId);
          commit(split.layout, "Added a point on the run.");
          return;
        }
      }
    }
    setSplitting((value) => !value);
  }

  function joinNearby() {
    const ppm = stage.current?.camera().ppm ?? 1;
    const next = weldCorners(layoutRef.current, WELD_PX / Math.max(ppm, 1));
    if (next === layoutRef.current) {
      setNote("No corners are close enough to join.");
      return;
    }
    commit(next, "Joined corners that sat on each other.");
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
    finishTrace(continueToCorner(layoutRef.current, activeString, cornerId, dark ? "wire" : "lit"));
  }

  /** Mark dark arms one run. Tracing that run turns the toggle off. */
  function finishTrace(next: PropLayout) {
    const added = runCount(next) > runCount(layoutRef.current);
    commit(next);
    if (added && darkRef.current) setDark(false);
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
    if (next === "trace") setSplitting(false);
    if (next === "edit") setPlacing(false);
  }

  const counted = countLayout(layout);
  const corners = layout.corners.map((corner) => (drag?.id === corner.id ? { ...corner, x: drag.x, y: drag.y } : corner));
  const drawing = { ...layout, corners };
  const strings = layoutStrings(drawing);
  const runs = strings.flatMap((string, stringIndex) => string.run.map((edge, index) => ({ edge, order: index + 1, stringIndex, stringId: string.id })));
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
    <div className="flex h-dvh max-h-dvh w-full max-w-full flex-col bg-background max-lg:portrait:overflow-y-auto lg:flex-row lg:overflow-hidden max-lg:landscape:flex-row max-lg:landscape:overflow-hidden">
      <div className="flex w-full min-w-0 flex-col bg-background max-lg:portrait:shrink-0 lg:min-h-0 lg:flex-1 lg:overflow-hidden max-lg:landscape:min-h-0 max-lg:landscape:flex-1 max-lg:landscape:overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-1 bg-background px-1">
          <button type="button" className="min-h-11 shrink-0 px-3 text-[16px]" onClick={() => void leave()}>{leaving ? "Saving…" : backLabel}</button>
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-medium">{name}</h1>
          {saveNote ? <p role="status" className="shrink-0 px-2 text-[13px] text-muted-foreground">{saveNote}</p> : null}
        </header>
        <p className={`shrink-0 bg-background px-4 text-[15px] ${short ? "text-amber-200" : "text-foreground"}`}>{totalText}</p>
        <p className="shrink-0 bg-background px-4 pb-2 text-[14px] leading-5 text-muted-foreground">{editorHint(mode, dark, placing, splitting)}</p>
        {note ? <p className="shrink-0 bg-background px-4 pb-2 text-[14px] text-amber-200">{note}</p> : null}
        {gap ? <p className="bg-background px-4 text-[14px] text-red-400">{gap}</p> : null}
        <div className="relative h-[45dvh] min-h-[45dvh] w-full min-w-0 overflow-hidden bg-background lg:h-auto lg:min-h-0 lg:flex-1 max-lg:landscape:h-auto max-lg:landscape:min-h-0 max-lg:landscape:flex-1">
          <EditorStage
            ref={stage}
            bounds={bounds}
            limits={{ minPpm: 2, maxPpm: 48 / Math.max(layout.pitchM, 0.005) }}
            fitMinSpanM={layout.corners.length < 2 ? 2 : layout.pitchM * 2}
            fitPad={{ top: 52, left: 40, bottom: 36, right: 12 }}
            gridM={gridSizeM(layout.units)}
            label="Prop drawing"
            testId="layout-canvas"
            onBackgroundTap={(tap) => {
              // A click on empty canvas clears the selection. A pan never
              // reaches here, so dragging keeps whatever is selected.
              setPicked(null);
              setSelected(null);
              if (splittingRef.current) {
                setNote("Tap a run to add a point on it.");
                return;
              }
              if (mode === "trace") addPoint(tap.world, tap.altKey, tap.shiftKey);
            }}
            onHover={(hover) => {
              if (!hover || mode !== "trace") return setGhost(null);
              const point = snapped(hover.world.x, hover.world.y, undefined, hover.altKey, hover.shiftKey);
              setGhost({ x: point.x, y: point.y, guide: point.guide });
            }}
            overlay={(camera, size) => {
              const spans = runsOnSameSpan(drawing);
              const drawn = runs.flatMap(({ edge, order, stringIndex }) => {
                const from = corners.find((corner) => corner.id === edge.from);
                const to = corners.find((corner) => corner.id === edge.to);
                if (!from || !to) return [];
                const rawA = toScreen(from, camera);
                const rawB = toScreen(to, camera);
                const shifted = shiftEnds(rawA, rawB, overlapShift(spans.get(edge.id), edge.id));
                return [{ edge, order, stringIndex, a: shifted.a, b: shifted.b }];
              });
              const wireIns = [...starts].flatMap((id) => {
                const corner = corners.find((row) => row.id === id);
                return corner ? [toScreen(corner, camera)] : [];
              });
              const spots = placeRunLabels(
                drawn.map((run) => ({ ax: run.a.x, ay: run.a.y, bx: run.b.x, by: run.b.y })),
                [...wireIns, { x: size.w - 28, y: 22 }, { x: size.w - 28, y: 72 }],
                28,
                { w: size.w, h: size.h },
              );
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
                {drawn.map(({ edge, order, stringIndex, a, b }, index) => {
                  const spot = spots[index]!;
                  const colour = stringColour(stringIndex);
                  const row = counted.edges.find((item) => item.id === edge.id);
                  const zero = row?.lights === 0 && edge.kind === "lit";
                  const selectedRun = picked === edge.id;
                  const pick = (event: Konva.KonvaEventObject<Event>) => {
                    event.cancelBubble = true;
                    if (splittingRef.current) {
                      const pointer = event.target.getStage()?.getPointerPosition();
                      if (!pointer) return;
                      const world = toWorld(pointer, camera);
                      const split = splitRun(layoutRef.current, edge.id, world.x, world.y);
                      if (!split.cornerId) {
                        setNote("Tap the middle of a run to add a point.");
                        return;
                      }
                      setSplitting(false);
                      setSelected(split.cornerId);
                      setPicked(edge.id);
                      commit(split.layout, "Added a point on the run.");
                      return;
                    }
                    const group = spans.get(edge.id) ?? [edge.id];
                    if (pickedRef.current === edge.id && group.length > 1) {
                      const at = group.indexOf(edge.id);
                      setPicked(group[(at + 1) % group.length]!);
                      return;
                    }
                    setPicked(edge.id);
                  };
                  const pressRun = (event: Konva.KonvaEventObject<PointerEvent>) => {
                    runPress.current = { x: event.evt.clientX, y: event.evt.clientY };
                  };
                  const clickRun = (event: Konva.KonvaEventObject<MouseEvent>) => {
                    const start = runPress.current;
                    if (start && Math.hypot(event.evt.clientX - start.x, event.evt.clientY - start.y) > 6) return;
                    pick(event);
                  };
                  return (
                    <Group key={edge.id}>
                      {selectedRun ? (
                        <Line points={[a.x, a.y, b.x, b.y]} stroke="#f4efe6" strokeWidth={12} listening={false} />
                      ) : null}
                      <Line
                        points={[a.x, a.y, b.x, b.y]}
                        stroke={edge.kind === "wire" ? WIRE : colour}
                        strokeWidth={edge.kind === "wire" ? 2 : selectedRun ? 6 : 3}
                        dash={edge.kind === "wire" ? [6, 4] : undefined}
                        hitStrokeWidth={28}
                        onPointerDown={pressRun}
                        onClick={clickRun}
                        onTap={pick}
                      />
                      <Chevron a={a} b={b} colour={edge.kind === "wire" ? WIRE : colour} />
                      <Group x={spot.badge.x} y={spot.badge.y} onPointerDown={pressRun} onClick={clickRun} onTap={pick}>
                        <Circle radius={14} fill={selectedRun ? colour : "#12141a"} stroke={selectedRun ? "#f4efe6" : zero ? WARN : colour} strokeWidth={selectedRun ? 3 : 1.5} />
                        <Text text={runBadge(stringIndex, order)} fontSize={11} fill={selectedRun ? "#0c0d10" : zero ? WARN : INK} width={28} offsetX={14} offsetY={5} align="center" listening={false} />
                        {edge.lockedLengthM ? <LockMark /> : null}
                      </Group>
                      {row ? (
                        <Text
                          x={spot.caption.x}
                          y={spot.caption.y}
                          text={lengthCaption(row.lengthM, layout.units, row.lights)}
                          fontSize={11}
                          fill={selectedRun ? "#f4efe6" : edge.lockedLights != null ? colour : "#a8a296"}
                          width={104}
                          offsetX={52}
                          offsetY={6}
                          align="center"
                          listening={false}
                        />
                      ) : null}
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
                      {start ? <Text text="Wire in" x={14} y={at.y < 70 ? 10 : -18} fontSize={12} fill={INK} listening={false} /> : null}
                    </Group>
                  );
                })}
              </>
              );
            }}
          />
          {drag ? <Magnifier at={drag.screen} world={{ x: drag.x, y: drag.y }} layout={drawing} /> : null}
          <p data-testid="grid-scale" className="pointer-events-none absolute left-2 top-14 rounded-md bg-background/90 px-2 py-1 text-[12px] text-muted-foreground">
            {gridScaleLabel(layout.units)}
          </p>
          <div className="absolute left-2 top-2 flex gap-2">
            <ModeButton active={mode === "trace"} onClick={() => switchMode("trace")}>Trace</ModeButton>
            <ModeButton active={mode === "edit"} onClick={() => switchMode("edit")}>Edit</ModeButton>
          </div>
          {toast ? (
            <div className="absolute bottom-3 left-3 right-16 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[14px]">
              <span className="flex-1">{toast}</span>
              <button type="button" className="min-h-11 px-3 text-primary" onClick={undo}>Undo</button>
            </div>
          ) : null}
        </div>
      </div>
      {/* Phone portrait: under the drawing. Wide window or short landscape phone: a fixed-width column beside it. */}
      <aside
        aria-label="Path tools"
        className="flex w-full min-w-0 flex-col bg-background lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:border-l lg:border-border max-lg:landscape:w-[300px] max-lg:landscape:shrink-0 max-lg:landscape:border-l max-lg:landscape:border-border"
      >
      {shortRuns(layout).length > 0 ? (
        <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-2">
          <p className="min-w-0 flex-1 text-[13px] leading-4 text-amber-200">
            {shortRuns(layout).length === 1
              ? "1 run is shorter than the light spacing."
              : `${shortRuns(layout).length} runs are shorter than the light spacing.`}
          </p>
          <button type="button" className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-[14px]" onClick={() => commit(mergeShortRuns(layoutRef.current), "Merged the short runs.")}>
            Merge short runs
          </button>
        </div>
      ) : null}
      <RunList
        className="min-h-0 border-t border-border bg-background max-lg:portrait:overflow-visible lg:flex-1 lg:overflow-y-auto lg:border-t-0 max-lg:landscape:flex-1 max-lg:landscape:overflow-y-auto max-lg:landscape:border-t-0"
        layout={layout}
        picked={picked}
        onPick={setPicked}
        onLength={applyLength}
        onLights={applyLights}
        onName={applyName}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-2 py-2">
        <div role="group" aria-label="Length unit" className="flex gap-1">
          <ChoiceButton active={layout.units === "ft"} onClick={() => applyUnits("ft")}>Feet</ChoiceButton>
          <ChoiceButton active={layout.units === "m"} onClick={() => applyUnits("m")}>Metres</ChoiceButton>
        </div>
        <SpacingField pitchM={layout.pitchM} onPitch={applyPitch} />
      </div>
      <div className="flex gap-2 bg-background px-2 pb-2">
        <DockButton onClick={undo} disabled={past.length === 0}>Undo</DockButton>
        <DockButton onClick={redo} disabled={future.length === 0}>Redo</DockButton>
        <DockButton onClick={() => setSnap((value) => !value)} pressed={snap}>Snap</DockButton>
        <DockButton onClick={() => picked && removeRun(picked)} disabled={!picked}>{pickedLabel(layout, picked) ? `Delete ${pickedLabel(layout, picked)}` : "Delete"}</DockButton>
      </div>
      <div className="flex gap-2 bg-background px-2 pb-2">
        <DockButton onClick={() => splitPickedOrArm()} pressed={splitting}>Add point</DockButton>
        <DockButton onClick={() => selected && removePoint(selected)} disabled={!selected || deletePoint(layout, selected) === layout}>Delete point</DockButton>
        <DockButton onClick={joinNearby}>Join</DockButton>
      </div>
      <div className="flex gap-2 bg-background px-2 pb-2">
        <DockButton onClick={() => { setDark((value) => !value); setPlacing(false); }} pressed={dark}>Mark dark</DockButton>
        <DockButton onClick={() => { setPlacing((value) => !value); setMode("trace"); setSplitting(false); }} pressed={placing}>Add another string</DockButton>
      </div>
      <p className="px-3 pb-1 text-[12px] leading-4 text-muted-foreground">
        Arrow keys nudge the selected corner. Delete removes the selected run. Ctrl+Z or Cmd+Z undoes.
      </p>
      <div className="flex gap-2 border-t border-border bg-background px-3 py-3">
        <Button type="button" className="min-h-12 flex-1 text-base" onClick={askDone}>{doneLabel}</Button>
      </div>
      {review ? (
        <div className="border-t border-amber-500/60 bg-card px-3 py-3" role="dialog" aria-label="Check the drawing">
          <p className="text-[14px]">Before naming sections:</p>
          <ul className="mt-1 list-disc pl-5 text-[14px] text-amber-200">
            {review.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setReview(null)}>Stay</Button>
            <Button type="button" className="min-h-11 flex-1" onClick={() => {
              if (!onAutosaveRef.current) {
                void persistNow();
                setReview(null);
                onDone(ensureStrings(layoutRef.current));
                return;
              }
              void (async () => {
                const ok = await persistNow();
                if (!ok) return;
                setReview(null);
                onDone(ensureStrings(layoutRef.current));
              })();
            }}>Continue</Button>
          </div>
        </div>
      ) : null}
      </aside>
    </div>
  );
}

function runCount(layout: PropLayout): number {
  return layoutStrings(layout).reduce((sum, string) => sum + string.run.length, 0);
}

function editorHint(mode: EditorMode, dark: boolean, placing: boolean, splitting: boolean): string {
  if (placing) return "Tap where the new string's wire comes in.";
  if (dark) return "The next run is dark: the wire jumps and no lights are on it.";
  if (splitting) return "Add point is on. Tap a run to split it there.";
  if (mode === "edit") return "Edit moves corners. Drag a corner. Add point splits a run. Join welds corners that sit on each other.";
  return "Trace adds runs from the wire-in. Tap empty space for a new point, or a corner to run there. Edit moves, splits, and joins.";
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 rounded-lg border px-3 text-[15px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/90"}`} aria-pressed={active}>
      {children}
    </button>
  );
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-lg border px-3 text-[14px] ${active ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
      {children}
    </button>
  );
}

function SpacingField({ pitchM, onPitch }: { pitchM: number; onPitch: (pitchM: number) => void }) {
  const shown = formatPitchCm(pitchM);
  const [value, setValue] = useState(shown);
  const [last, setLast] = useState(shown);
  if (last !== shown) {
    setLast(shown);
    setValue(shown);
  }
  function apply() {
    const pitch = parsePitchCm(value);
    if (pitch == null) return setValue(shown);
    if (Math.abs(pitch - pitchM) > 1e-6) onPitch(pitch);
  }
  return (
    <form className="flex min-w-0 items-center gap-1" onSubmit={(event) => { event.preventDefault(); apply(); }}>
      <label htmlFor="light-spacing" className="text-[13px] text-muted-foreground">Spacing</label>
      <input
        id="light-spacing"
        aria-label="Light spacing (cm)"
        value={value}
        inputMode="decimal"
        onChange={(event) => setValue(event.target.value)}
        onBlur={apply}
        className="min-h-11 w-16 rounded-md border border-input bg-background px-2 text-base"
      />
      <span className="text-[13px] text-muted-foreground">cm</span>
    </form>
  );
}

function DockButton({ onClick, disabled, pressed, children }: { onClick: () => void; disabled?: boolean; pressed?: boolean; children: string }) {
  const filled = Boolean(pressed);
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} className={`min-h-11 min-w-11 flex-1 whitespace-nowrap rounded-lg border px-1 text-[13px] ${filled ? "border-primary bg-primary text-primary-foreground" : pressed ? "border-primary" : "border-border"} disabled:opacity-40`}>
      {children}
    </button>
  );
}

function overlapShift(ids: readonly string[] | undefined, edgeId: string): number {
  if (!ids || ids.length < 2) return 0;
  const index = Math.max(0, ids.indexOf(edgeId));
  return (index - (ids.length - 1) / 2) * OVERLAP_PX;
}

function shiftEnds(a: Point, b: Point, shift: number): { a: Point; b: Point; nx: number; ny: number; shift: number } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return {
    a: { x: a.x + nx * shift, y: a.y + ny * shift },
    b: { x: b.x + nx * shift, y: b.y + ny * shift },
    nx,
    ny,
    shift,
  };
}

function pickedLabel(layout: PropLayout, edgeId: string | null): string | null {
  if (!edgeId) return null;
  const strings = layoutStrings(layout);
  for (let index = 0; index < strings.length; index += 1) {
    const at = strings[index]!.run.findIndex((edge) => edge.id === edgeId);
    if (at >= 0) return runBadge(index, at + 1);
  }
  return null;
}

function lengthCaption(lengthM: number, units: PropLayout["units"], lights: number): string {
  const length = formatLength(lengthM, units);
  return `${units === "m" ? `${length} m` : length} · ${lights}`;
}

function Chevron({ a, b, colour }: { a: Point; b: Point; colour: string }) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const x = a.x + (b.x - a.x) * 0.72;
  const y = a.y + (b.y - a.y) * 0.72;
  const size = 8;
  const points = [
    x + Math.cos(angle) * size, y + Math.sin(angle) * size,
    x + Math.cos(angle + 2.6) * size, y + Math.sin(angle + 2.6) * size,
    x + Math.cos(angle - 2.6) * size, y + Math.sin(angle - 2.6) * size,
  ];
  return <Line points={points} closed fill={colour} listening={false} />;
}

function LockMark() {
  return (
    <Group x={10} y={-14} listening={false}>
      <Line points={[0, 5, 9, 5, 9, 12, 0, 12]} closed stroke={INK} strokeWidth={1.4} />
      <Line points={[2, 5, 2, 3, 4.5, 0.8, 7, 3, 7, 5]} stroke={INK} strokeWidth={1.4} tension={0.4} />
    </Group>
  );
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
