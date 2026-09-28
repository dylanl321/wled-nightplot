"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gaps } from "./ops";
import type { EditorAction, EditorState } from "./use-editor-state";

export function CursorControls({
  state, dispatch, live, blocked, onPreview, onScanning,
}: {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  live: boolean;
  blocked: boolean;
  onPreview: () => void;
  onScanning?: (direction: 1 | -1 | null) => void;
}) {
  const [running, setRunning] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [speed, setSpeed] = useState(3);
  const [positionText, setPositionText] = useState<string | null>(null);
  const cursor = state.cursor ?? 0;
  const hasStrip = state.ledCount > 0;
  const atEnd = direction === 1 ? cursor >= state.ledCount - 1 : cursor <= 0;
  const scanning = running && live && !blocked && !atEnd && state.focus.kind === "cursor";
  if (running && (!live || blocked || atEnd || state.focus.kind !== "cursor")) setRunning(false);
  const free = gaps(state.els, state.ledCount);
  const previousGap = [...free].reverse().find((range) => range.start < cursor);
  const nextGap = free.find((range) => range.start > cursor);
  const boundaries = [...new Set(state.els.flatMap((segment) => [segment.start, segment.stop]))]
    .filter((index) => index >= 0 && index < state.ledCount).sort((a, b) => a - b);
  const previousEdge = [...boundaries].reverse().find((index) => index < cursor);
  const nextEdge = boundaries.find((index) => index > cursor);
  useEffect(() => { onScanning?.(scanning ? direction : null); }, [scanning, direction, onScanning]);

  useEffect(() => {
    if (!scanning) return;
    // One timeout per position: slow requests/background throttling never catch up in a burst.
    const timer = setTimeout(() => dispatch({ type: "cursor-step", delta: direction }), 1000 / speed);
    return () => clearTimeout(timer);
  }, [scanning, cursor, direction, speed, dispatch]);

  useEffect(() => {
    function stopWhenHidden() {
      if (document.visibilityState === "hidden") setRunning(false);
    }
    function stop(event: Event) {
      const ids = (event as CustomEvent<{ lightIds?: string[] }>).detail?.lightIds;
      if (!ids?.length || ids.includes(state.lightId)) setRunning(false);
    }
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("nightplot:all-off", stop);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("nightplot:all-off", stop);
    };
  }, [state.lightId]);

  function go(index: number) {
    setRunning(false);
    setPositionText(null);
    dispatch({ type: "cursor-set", index });
  }

  function toggleScan() {
    if (scanning) { setRunning(false); return; }
    if (blocked || !hasStrip || atEnd) return;
    dispatch({ type: "cursor-set", index: cursor });
    if (!live) onPreview();
    setRunning(true);
  }

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || target?.closest("input, select, textarea, button, [contenteditable=true]")) return;
      if (event.key === " ") { event.preventDefault(); toggleScan(); }
      else if (event.key === "[" || event.key === "]") setRunning(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const button = "h-[30px] rounded-md border border-input px-2 text-[12px] text-[#c9c3b8] disabled:opacity-40";
  return (
    <section aria-label="Locate and create Segments" className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-2.5 text-[12px]">
      <span className="text-muted-foreground">Cursor</span>
      <div className="flex h-[30px] overflow-hidden rounded-md border border-input">
        <button type="button" onClick={() => go(cursor - 1)} disabled={!hasStrip || cursor === 0} aria-label="Previous LED" className="w-7 border-r border-border disabled:opacity-40">−</button>
        <Input aria-label="Cursor LED" inputMode="numeric" className="h-full w-14 rounded-none border-0 p-0 text-center font-mono text-[12px]"
          value={positionText ?? cursor} onChange={(event) => setPositionText(event.target.value)}
          onBlur={() => { if (positionText !== null && /^\d+$/.test(positionText)) go(Number(positionText)); else setPositionText(null); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <button type="button" onClick={() => go(cursor + 1)} disabled={!hasStrip || cursor >= state.ledCount - 1} aria-label="Next LED" className="w-7 border-l border-border disabled:opacity-40">+</button>
      </div>
      <span className="mr-1 font-mono text-muted-foreground">of {Math.max(0, state.ledCount - 1)}</span>
      <div className="flex" role="group" aria-label="Edge navigation">
        <button type="button" className={`${button} rounded-r-none`} aria-label="Previous edge" disabled={previousEdge === undefined} onClick={() => go(previousEdge!)}>‹ Edge</button>
        <button type="button" className={`${button} rounded-l-none border-l-0`} aria-label="Next edge" disabled={nextEdge === undefined} onClick={() => go(nextEdge!)}>Edge ›</button>
      </div>
      <div className="flex" role="group" aria-label="Free LED navigation">
        <button type="button" className={`${button} rounded-r-none`} aria-label="Previous free range" disabled={!previousGap} onClick={() => go(previousGap!.start)}>‹ Free</button>
        <button type="button" className={`${button} rounded-l-none border-l-0`} aria-label="Next free range" disabled={!nextGap} onClick={() => go(nextGap!.start)}>Free ›</button>
      </div>
      <button type="button" className={button} style={state.markedStart !== null ? { color: "#d4a574", borderColor: "#d4a574" } : undefined} disabled={!hasStrip} onClick={() => { go(cursor); dispatch({ type: "mark-start" }); }}>
        {state.markedStart !== null ? `Start at ${state.markedStart}` : "[ Mark start"}
      </button>
      <button type="button" className={button} disabled={state.markedStart === null} onClick={() => { setRunning(false); dispatch({ type: "mark-end" }); }}>Mark end ]</button>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={`${button} w-[30px] px-0`} aria-label={`Scan direction: ${direction === 1 ? "forward" : "backward"}`} onClick={() => { setRunning(false); setDirection(direction === 1 ? -1 : 1); }}>{direction === 1 ? "→" : "←"}</button>
        <div className="flex rounded-md border border-input p-0.5" role="group" aria-label="Scan speed">
          {[1, 3, 5, 10].map((value) => <button type="button" key={value} aria-label={`${value} LEDs/s`} aria-pressed={value === speed} onClick={() => setSpeed(value)} className={`h-6 min-w-6 rounded px-1.5 font-mono text-[11px] ${speed === value ? "bg-[#2f3542] text-foreground" : "text-muted-foreground"}`}>{value}</button>)}
        </div>
        <span className="text-muted-foreground">LEDs/s</span>
        <Button onClick={toggleScan} disabled={blocked || !hasStrip || (!scanning && atEnd)} aria-label={scanning ? "Pause scan" : "Scan"}
          className={`h-[30px] gap-2 border border-[#1f4a45] px-3 text-[12px] ${scanning ? "bg-online text-[#0c0d10]" : "bg-transparent text-online hover:bg-online/10"}`}>
          {scanning ? "Pause" : "Scan"}<span className="font-mono text-[10px] font-normal">Space</span>
        </Button>
      </div>
    </section>
  );
}
