"use client";

import { countLayout, formatLength, layoutStrings, parseLength, type PropLayout } from "@nightplot/shared";
import { useEffect, useRef, useState } from "react";

export type RunRow = {
  edgeId: string;
  stringIndex: number;
  order: number;
  kind: "lit" | "wire" | "hidden";
  lengthM: number;
  lights: number;
  typedCount: boolean;
};

export function runRows(layout: PropLayout): RunRow[] {
  const counted = new Map(countLayout(layout).edges.map((edge) => [edge.id, edge]));
  return layoutStrings(layout).flatMap((string, stringIndex) =>
    string.run.map((edge, index) => {
      const row = counted.get(edge.id);
      return {
        edgeId: edge.id,
        stringIndex,
        order: index + 1,
        kind: edge.kind,
        lengthM: row?.lengthM ?? 0,
        lights: row?.lights ?? 0,
        typedCount: edge.kind === "lit" && edge.lockedLights != null,
      };
    }),
  );
}

/**
 * Every run with its length and light count, editable in place. Typing a
 * length moves that run's end; typing a count stores it on the run and leaves
 * the drawing alone. A typed count overrides round(length ÷ spacing) until
 * that run's length changes.
 */
export function RunList({
  layout,
  picked,
  onPick,
  onLength,
  onLights,
  onDelete,
  className,
}: {
  layout: PropLayout;
  picked: string | null;
  onPick: (edgeId: string) => void;
  onLength: (edgeId: string, lengthM: number) => void;
  onLights: (edgeId: string, lights: number | null) => void;
  onDelete: (edgeId: string) => void;
  className?: string;
}) {
  const rows = runRows(layout);
  const named = layoutStrings(layout).length > 1;
  const unit = layout.units === "ft" ? "ft" : "m";
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!picked) return;
    const rows = list.current?.querySelectorAll<HTMLElement>("[data-edge]") ?? [];
    const row = [...rows].find((node) => node.dataset.edge === picked);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [picked]);

  if (rows.length === 0) {
    return <p className={`px-4 py-3 text-[14px] text-muted-foreground ${className ?? ""}`}>No runs yet.</p>;
  }

  return (
    <section aria-label="Runs" className={`overflow-y-auto ${className ?? ""}`}>
      <div className="sticky top-0 bg-background">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_2.75rem] items-center gap-2 px-3 py-1 text-[12px] text-muted-foreground">
          <span>Run</span>
          <span>Length ({unit})</span>
          <span>Lights</span>
          <span className="sr-only">Delete</span>
        </div>
        <p id="run-lights-note" className="px-3 pb-1 text-[12px] leading-4 text-muted-foreground">
          Lights follow round(length ÷ spacing). A number you type here overrides that until the length changes.
        </p>
      </div>
      <ol ref={list} className="flex flex-col">
        {rows.map((row) => (
          <RunRowItem
            key={row.edgeId}
            row={row}
            label={named ? `String ${row.stringIndex + 1} · run ${row.order}` : `Run ${row.order}`}
            units={layout.units}
            selected={picked === row.edgeId}
            onPick={() => onPick(row.edgeId)}
            onLength={(lengthM) => onLength(row.edgeId, lengthM)}
            onLights={(lights) => onLights(row.edgeId, lights)}
            onDelete={() => onDelete(row.edgeId)}
          />
        ))}
      </ol>
    </section>
  );
}

function RunRowItem({
  row,
  label,
  units,
  selected,
  onPick,
  onLength,
  onLights,
  onDelete,
}: {
  row: RunRow;
  label: string;
  units: PropLayout["units"];
  selected: boolean;
  onPick: () => void;
  onLength: (lengthM: number) => void;
  onLights: (lights: number | null) => void;
  onDelete: () => void;
}) {
  const shownLength = formatLength(row.lengthM, units);
  const shownLights = String(row.lights);
  const [length, setLength] = useState(shownLength);
  const [lights, setLights] = useState(shownLights);
  const [lastLength, setLastLength] = useState(shownLength);
  const [lastLights, setLastLights] = useState(shownLights);
  // Follow the drawing when it changes underneath the field.
  if (lastLength !== shownLength) {
    setLastLength(shownLength);
    setLength(shownLength);
  }
  if (lastLights !== shownLights) {
    setLastLights(shownLights);
    setLights(shownLights);
  }
  const lit = row.kind === "lit";

  function applyLength() {
    const metres = parseLength(length, units);
    if (metres == null) return setLength(shownLength);
    if (Math.abs(metres - row.lengthM) > 1e-4) onLength(metres);
  }

  function applyLights() {
    if (lights.trim() === "") return onLights(null);
    const typed = Number(lights);
    if (!Number.isInteger(typed) || typed < 0) return setLights(shownLights);
    if (lights !== shownLights || !row.typedCount) onLights(typed);
  }

  return (
    <li
      data-edge={row.edgeId}
      aria-current={selected ? "true" : undefined}
      className={`grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_2.75rem] items-center gap-2 border-t border-border px-3 py-1 ${selected ? "bg-card" : ""}`}
    >
      <button type="button" className="min-h-11 min-w-0 truncate text-left text-[15px]" onClick={onPick}>
        {label}
        {row.kind === "wire" ? <span className="text-muted-foreground"> · dark</span> : null}
        {row.typedCount ? <span className="text-muted-foreground"> · typed count</span> : null}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyLength();
        }}
      >
        <input
          aria-label={`${label} length (${units === "ft" ? "ft" : "m"})`}
          value={length}
          inputMode="decimal"
          disabled={!lit}
          onFocus={onPick}
          onChange={(event) => setLength(event.target.value)}
          onBlur={applyLength}
          className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-base disabled:opacity-50"
        />
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyLights();
        }}
      >
        <input
          aria-label={`${label} lights`}
          aria-describedby="run-lights-note"
          value={lights}
          inputMode="numeric"
          disabled={!lit}
          onFocus={onPick}
          onChange={(event) => setLights(event.target.value)}
          onBlur={() => {
            if (lights !== shownLights) applyLights();
          }}
          className={`min-h-11 w-full rounded-md border bg-background px-2 text-base disabled:opacity-50 ${row.typedCount ? "border-primary" : "border-input"}`}
        />
      </form>
      <button type="button" aria-label={`Delete ${label}`} title="Delete run" className="min-h-11 min-w-11 rounded-md text-[18px] text-muted-foreground hover:text-foreground" onClick={onDelete}>
        ×
      </button>
    </li>
  );
}
