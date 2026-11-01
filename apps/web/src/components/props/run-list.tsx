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
  short: boolean;
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
        short: edge.kind === "lit" && (row?.lengthM ?? 0) > 0 && (row?.lengthM ?? 0) < layout.pitchM,
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
  const strings = layoutStrings(layout);
  const unit = layout.units === "ft" ? "ft" : "m";
  const list = useRef<HTMLDivElement>(null);

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
        <p id="run-length-note" className="px-3 text-[12px] leading-4 text-muted-foreground">
          A new length moves that run&apos;s end along the run.
        </p>
        <p id="run-lights-note" className="px-3 pb-1 text-[12px] leading-4 text-muted-foreground">
          Lights follow round(length ÷ spacing). A number you type here overrides that until the length changes.
        </p>
      </div>
      <div ref={list} className="flex flex-col">
        {strings.map((string, stringIndex) => {
          const group = rows.filter((row) => row.stringIndex === stringIndex);
          const lights = group.reduce((sum, row) => sum + row.lights, 0);
          const word = group.length === 1 ? "run" : "runs";
          return (
            <section key={string.id} aria-label={`String ${stringIndex + 1}`}>
              <h2 className="border-t border-border bg-card/40 px-3 py-2 text-[14px] font-medium">
                String {stringIndex + 1}: Wire in, {group.length} {word} · {lights} lights
              </h2>
              <ol className="flex flex-col">
                {group.map((row) => (
                  <RunRowItem
                    key={row.edgeId}
                    row={row}
                    label={strings.length > 1 ? `String ${stringIndex + 1} · run ${row.order}` : `Run ${row.order}`}
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
        })}
      </div>
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
  const [lengthError, setLengthError] = useState<string | null>(null);
  const [lightsError, setLightsError] = useState<string | null>(null);
  // Follow the drawing when it changes underneath the field.
  if (lastLength !== shownLength) {
    setLastLength(shownLength);
    setLength(shownLength);
    setLengthError(null);
  }
  if (lastLights !== shownLights) {
    setLastLights(shownLights);
    setLights(shownLights);
    setLightsError(null);
  }
  const lit = row.kind === "lit";

  function applyLength() {
    const metres = parseLength(length, units);
    if (metres == null) {
      setLengthError(units === "ft" ? "Enter a length like 3' 11\"." : "Enter a length in metres, greater than zero.");
      return;
    }
    setLengthError(null);
    if (Math.abs(metres - row.lengthM) > 1e-4) onLength(metres);
  }

  function applyLights() {
    if (lights.trim() === "") {
      setLightsError(null);
      onLights(null);
      return;
    }
    if (!/^\d+$/.test(lights.trim()) || Number(lights) <= 0) {
      setLightsError("Enter a whole number of lights, or leave it empty.");
      return;
    }
    setLightsError(null);
    const typed = Number(lights);
    if (lights !== shownLights || !row.typedCount) onLights(typed);
  }

  return (
    <li
      data-edge={row.edgeId}
      aria-current={selected ? "true" : undefined}
      className={`border-t border-border ${selected ? "bg-card shadow-[inset_3px_0_0_0_var(--color-primary)]" : ""}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_2.75rem] items-center gap-2 px-3 py-1">
      <button type="button" className="min-h-11 min-w-0 truncate text-left text-[15px]" onClick={onPick}>
        {label}
        {row.kind === "wire" ? <span className="text-muted-foreground"> · dark</span> : null}
        {row.short ? <span className="text-amber-200"> · short</span> : null}
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
          aria-describedby="run-length-note"
          aria-invalid={lengthError ? true : undefined}
          value={length}
          inputMode="decimal"
          disabled={!lit}
          onFocus={onPick}
          onChange={(event) => { setLength(event.target.value); setLengthError(null); }}
          onBlur={applyLength}
          className={`min-h-11 w-full rounded-md border bg-background px-2 text-base disabled:opacity-50 ${lengthError ? "border-red-400" : "border-input"}`}
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
          aria-invalid={lightsError ? true : undefined}
          value={lights}
          inputMode="numeric"
          disabled={!lit}
          onFocus={onPick}
          onChange={(event) => { setLights(event.target.value); setLightsError(null); }}
          onBlur={() => {
            if (lights !== shownLights) applyLights();
          }}
          className={`min-h-11 w-full rounded-md border bg-background px-2 text-base disabled:opacity-50 ${lightsError ? "border-red-400" : row.typedCount ? "border-primary" : "border-input"}`}
        />
      </form>
      <button type="button" aria-label={`Delete ${label}`} title="Delete run" className="min-h-11 min-w-11 rounded-md text-[18px] text-muted-foreground hover:text-foreground" onClick={onDelete}>
        ×
      </button>
      </div>
      {lengthError || lightsError ? <p className="px-3 pb-2 text-[13px] text-red-400">{lengthError ?? lightsError}</p> : null}
    </li>
  );
}
