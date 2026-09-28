"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { gaps, selectionFacts } from "./ops";
import type { EditorAction, EditorState } from "./use-editor-state";

export function CursorControls({
  state, dispatch, live, blocked, onPreview,
}: {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  live: boolean;
  blocked: boolean;
  onPreview: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [speed, setSpeed] = useState(3);
  const [positionText, setPositionText] = useState<string | null>(null);
  const cursor = state.cursor ?? 0;
  const hasStrip = state.ledCount > 0;
  const atEnd = direction === 1 ? cursor >= state.ledCount - 1 : cursor <= 0;
  const scanning = running && live && !blocked && !atEnd;
  if (running && (!live || blocked || atEnd)) setRunning(false);
  const free = gaps(state.els, state.ledCount);
  const previousGap = [...free].reverse().find((range) => range.start < cursor);
  const nextGap = free.find((range) => range.start > cursor);
  const boundaries = [...new Set(state.els.flatMap((segment) => [segment.start, segment.stop]))]
    .filter((index) => index >= 0 && index < state.ledCount).sort((a, b) => a - b);
  const previousEdge = [...boundaries].reverse().find((index) => index < cursor);
  const nextEdge = boundaries.find((index) => index > cursor);
  const selected = state.ledSel ? selectionFacts(state.els, state.ledSel) : null;

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

  function onKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
    const key = event.key;
    if (["ArrowLeft", "ArrowRight", "Home", "End", " ", "[", "]"].includes(key)) {
      event.preventDefault();
      if (key === " ") toggleScan();
      else if (key === "[" || key === "]") {
        setRunning(false);
        dispatch({ type: key === "[" ? "mark-start" : "mark-end" });
      } else go(key === "Home" ? 0 : key === "End" ? state.ledCount - 1
        : cursor + (key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1));
    }
  }

  return (
    <section aria-label="Locate and create Segments" tabIndex={0} onKeyDown={onKey}
      className="flex flex-col gap-3 rounded-xl border border-input bg-card p-4 outline-offset-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15px] font-medium">Locate</h2>
        <Button variant="outline" onClick={() => go(cursor - 1)} disabled={!hasStrip || cursor === 0} aria-label="Previous LED">−1</Button>
        <label className="flex items-center gap-2 text-[13px]">
          LED
          <Input aria-label="Cursor LED" inputMode="numeric" className="w-24"
            value={positionText ?? cursor}
            onChange={(event) => setPositionText(event.target.value)}
            onBlur={() => {
              if (positionText !== null && /^\d+$/.test(positionText)) go(Number(positionText));
              else setPositionText(null);
            }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
        </label>
        <Button variant="outline" onClick={() => go(cursor + 1)} disabled={!hasStrip || cursor >= state.ledCount - 1} aria-label="Next LED">+1</Button>
        <span className="text-[12px] text-muted-foreground">of {Math.max(0, state.ledCount - 1)}</span>
        <label className="ml-auto text-[13px]">
          Direction{" "}
          <select aria-label="Scan direction" value={direction}
            onChange={(event) => { setRunning(false); setDirection(Number(event.target.value) as 1 | -1); }}
            className="rounded border border-input bg-card p-2">
            <option value={1}>Forward</option><option value={-1}>Backward</option>
          </select>
        </label>
        <label className="text-[13px]">
          Speed{" "}
          <select aria-label="Scan speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}
            className="rounded border border-input bg-card p-2">
            {[1, 3, 5, 10].map((value) => <option key={value} value={value}>{value} LEDs/s</option>)}
          </select>
        </label>
        <Button onClick={toggleScan} disabled={blocked || !hasStrip || (!scanning && atEnd)}>
          {scanning ? "Pause scan" : "Auto-scan"}
        </Button>
      </div>
      <input type="range" min={0} max={Math.max(0, state.ledCount - 1)} value={cursor}
        aria-label="Strip cursor" disabled={!hasStrip} onChange={(event) => go(Number(event.target.value))}
        className="w-full accent-[#d4a574]" />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={previousEdge === undefined} onClick={() => go(previousEdge!)}>Previous edge</Button>
        <Button variant="outline" disabled={nextEdge === undefined} onClick={() => go(nextEdge!)}>Next edge</Button>
        <Button variant="outline" disabled={!previousGap} onClick={() => go(previousGap!.start)}>Previous unused range</Button>
        <Button variant="outline" disabled={!nextGap} onClick={() => go(nextGap!.start)}>Next unused range</Button>
        <Button variant="outline" disabled={!hasStrip} onClick={() => {
          go(cursor); dispatch({ type: "mark-start" });
        }}>Mark start</Button>
        <Button variant="outline" disabled={state.markedStart === null} onClick={() => {
          setRunning(false); dispatch({ type: "mark-end" });
        }}>Mark end</Button>
        <Button disabled={!state.ledSel} onClick={() => {
          setRunning(false); dispatch({ type: "new-from-sel" });
        }}>{selected?.hit.length ? "Create Segment from selection" : "Create Segment"}</Button>
      </div>
      {state.markedStart !== null ? <p className="text-[13px] text-primary">Start marked at LED {state.markedStart}. Mark the last LED to include.</p> : null}
      {state.ledSel ? <p className="text-[13px] text-primary">
        Selected LEDs {state.ledSel.start}–{state.ledSel.stop - 1} · {state.ledSel.stop - state.ledSel.start} LEDs.
        {selected?.hit.length ? ` Creating a Segment takes these LEDs from ${selected.hit.map((segment) => segment.label).join(", ")}. Undo reverses it.` : " This range is unused."}
      </p> : null}
      <p className="text-[12px] text-muted-foreground">
        The cursor stays when the mouse leaves. Press L to locate, then ← / → to step (Shift: 10), [ / ] to mark.
        Focus this panel and press Space to scan or pause. Scanning stops at the strip end and pauses when the tab is hidden.
      </p>
    </section>
  );
}
