"use client";

import { countLayout, formatLength, layoutStrings, parseLength, type PropLayout } from "@nightplot/shared";
import { runBadge, stringLetter } from "./run-labels";
import { useEffect, useRef, useState } from "react";

export type RunRow = {
  edgeId: string;
  stringIndex: number;
  order: number;
  kind: "lit" | "wire" | "hidden";
  lengthM: number;
  lights: number;
  typedCount: boolean;
  placed: boolean;
  short: boolean;
  name: string;
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
        typedCount: edge.kind === "lit" && edge.lockedLights != null && edge.manualLights !== true,
        placed: edge.kind === "lit" && edge.manualLights === true,
        short: edge.kind === "lit" && (row?.lengthM ?? 0) > 0 && (row?.lengthM ?? 0) < layout.pitchM,
        name: edge.name ?? "",
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
  onName,
  lightEdgeId,
  onSpace,
  onRemoveLight,
  className,
}: {
  layout: PropLayout;
  picked: string | null;
  onPick: (edgeId: string) => void;
  onLength: (edgeId: string, lengthM: number) => void;
  onLights: (edgeId: string, lights: number | null) => void;
  onName: (edgeId: string, name: string) => void;
  /** The run whose light is selected, when one is. */
  lightEdgeId: string | null;
  onSpace: (edgeId: string) => void;
  onRemoveLight: () => void;
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
    // Keep the highlighted row fully on screen. A row left on the bottom edge
    // is clipped on a phone, and the highlight is easy to miss.
    row?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [picked]);

  if (rows.length === 0) {
    return <p className={`px-4 py-3 text-[14px] text-muted-foreground ${className ?? ""}`}>No runs yet.</p>;
  }

  return (
    <section aria-label="Runs" className={`overflow-y-auto ${className ?? ""}`}>
      <div className="sticky top-0 bg-background">
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem] items-center gap-2 px-3 py-1 text-[12px] text-muted-foreground">
          <span>Run</span>
          <span>Length ({unit})</span>
          <span>Lights</span>
        </div>
        <p id="run-length-note" className="px-3 text-[12px] leading-4 text-muted-foreground">
          A new length moves that run&apos;s end along the run.
        </p>
        <p id="run-lights-note" className="px-3 pb-1 text-[12px] leading-4 text-muted-foreground">
          Lights are worked out from the length and spacing. Type a number to override it until the length changes.
        </p>
      </div>
      <div ref={list} className="flex flex-col">
        {strings.map((string, stringIndex) => {
          const group = rows.filter((row) => row.stringIndex === stringIndex);
          const lights = group.reduce((sum, row) => sum + row.lights, 0);
          const word = group.length === 1 ? "run" : "runs";
          return (
            <section key={string.id} aria-label={`String ${stringLetter(stringIndex)}`}>
              <h2 className="border-t border-border bg-card/40 px-3 py-2 text-[14px] font-medium">
                String {stringLetter(stringIndex)}: Wire in, {group.length} {word} · {lights} lights
              </h2>
              <ol className="flex flex-col">
                {group.map((row) => (
                  <RunRowItem
                    key={row.edgeId}
                    row={row}
                    label={runBadge(stringIndex, row.order)}
                    units={layout.units}
                    selected={picked === row.edgeId}
                    onPick={() => onPick(row.edgeId)}
                    onLength={(lengthM) => onLength(row.edgeId, lengthM)}
                    onLights={(lights) => onLights(row.edgeId, lights)}
                    onName={(name) => onName(row.edgeId, name)}
                    lightSelected={lightEdgeId === row.edgeId}
                    onSpace={() => onSpace(row.edgeId)}
                    onRemoveLight={onRemoveLight}
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
  onName,
  lightSelected,
  onSpace,
  onRemoveLight,
}: {
  row: RunRow;
  label: string;
  units: PropLayout["units"];
  selected: boolean;
  onPick: () => void;
  onLength: (lengthM: number) => void;
  onLights: (lights: number | null) => void;
  onName: (name: string) => void;
  lightSelected: boolean;
  onSpace: () => void;
  onRemoveLight: () => void;
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
  const [position, setPosition] = useState(row.name);
  const [lastName, setLastName] = useState(row.name);
  if (lastName !== row.name) {
    setLastName(row.name);
    setPosition(row.name);
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
      className={`scroll-mb-3 border-t border-border ${selected ? "bg-card shadow-[inset_3px_0_0_0_var(--color-primary)]" : ""}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_4.5rem] items-center gap-2 px-3 py-1">
      <button type="button" className="min-h-11 min-w-0 truncate text-left text-[15px]" onClick={onPick}>
        {label}
        {row.name ? <span className="text-muted-foreground"> · {row.name}</span> : null}
        {row.kind === "wire" ? <span className="text-muted-foreground"> · dark</span> : null}
        {row.short ? <span className="text-amber-200"> · short</span> : null}
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
      </div>
      {selected ? (
        <form
          className="px-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            onName(position);
          }}
        >
          <input
            aria-label={`${label} position name`}
            value={position}
            placeholder="Position, such as top"
            onChange={(event) => setPosition(event.target.value)}
            onBlur={() => { if (position !== row.name) onName(position); }}
            className="min-h-11 w-full rounded-md border border-input bg-background px-2 text-base"
          />
        </form>
      ) : null}
      {selected && lit ? (
        <div className="flex gap-2 px-3 pb-2">
          <button type="button" className="min-h-11 flex-1 rounded-lg border border-border px-2 text-[14px] disabled:opacity-40" disabled={!row.placed} onClick={onSpace}>Space evenly again</button>
          <button type="button" className="min-h-11 flex-1 rounded-lg border border-border px-2 text-[14px] disabled:opacity-40" disabled={!lightSelected} onClick={onRemoveLight}>Remove light</button>
        </div>
      ) : null}
      {row.placed ? (
        <p className="px-3 pb-2 text-[13px] leading-5 text-muted-foreground">
          These lights stay where you put them. Space evenly again keeps all {row.lights} and spreads them along the run.
        </p>
      ) : null}
      {row.typedCount ? (
        // On its own line, so a narrow run name never cuts it to "typed co…".
        <p className="px-3 pb-2 text-[13px] leading-5 text-muted-foreground">
          {row.lights} lights typed in: this overrides length ÷ spacing until the length changes. Clear the field to count from the length.
        </p>
      ) : null}
      {lengthError || lightsError ? <p className="px-3 pb-2 text-[13px] text-red-400">{lengthError ?? lightsError}</p> : null}
    </li>
  );
}
