"use client";

import { formatNodeLength, type Element } from "@nightplot/shared";
import type { RangeIssue } from "@nightplot/shared";
import { Input } from "@/components/ui/input";
import { bounds, issueSentence, mergeCheck, parseIndex } from "./ops";
import type { EditorAction, EditorState } from "./use-editor-state";

export function ElementInspector({
  state,
  hues,
  issuesFor,
  dispatch,
  spacingMm,
}: {
  spacingMm?: number | null;
  state: EditorState;
  hues: Record<string, string>;
  issuesFor: (id: string) => RangeIssue[];
  dispatch: (action: EditorAction) => void;
}) {
  const selected =
    state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
  const check = mergeCheck(state.els, state.sel);
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-[#0e1014] p-4">
      {selected ? (
        <OneElement
          element={selected}
          cursor={state.cursor}
          spacingMm={spacingMm}
          hue={hues[selected.id] ?? "#9a9488"}
          issues={issuesFor(selected.id)}
          ledCount={state.ledCount}
          elements={state.els}
          dispatch={dispatch}
        />
      ) : null}
      {state.sel.length > 1 ? (
        <div className="flex flex-col gap-3">
          <span className="text-[15px] font-medium">{state.sel.length} Segments selected</span>
          <p className="text-[13px] leading-normal text-muted-foreground">
            {check.ok
              ? `Combine makes one Segment from ${check.start} to ${check.stop}${
                  check.stop - check.start > check.chosen.reduce((sum, element) => sum + element.stop - element.start, 0)
                    ? ", filling the free LEDs between them"
                    : ""
                }.`
              : check.between.length
                ? `${check.between.map((element) => element.label).join(", ")} sits between them, so they can't be combined.`
                : ""}
          </p>
          <button
            type="button"
            onClick={() => dispatch({ type: "merge" })}
            disabled={!check.ok}
            className="h-[34px] self-start rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            Combine into one
          </button>
          <button type="button" className="self-end text-[13px] text-destructive" onClick={() => dispatch({ type: "delete" })}>Delete all</button>
        </div>
      ) : null}
      {state.sel.length === 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-medium">Nothing selected</span>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Click a Segment to shift it or its first or last LED to grab an edge. To add one, mark its first LED with [ and its last with ], then choose New Segment. Pick LEDs (R) selects across existing Segments.
          </p>
        </div>
      ) : null}

    </div>
  );
}

function OneElement({
  element,
  cursor,
  spacingMm,
  hue,
  issues,
  ledCount,
  elements,
  dispatch,
}: {
  element: Element;
  cursor: number | null;
  spacingMm?: number | null;
  hue: string;
  issues: RangeIssue[];
  ledCount: number;
  elements: Element[];
  dispatch: (action: EditorAction) => void;
}) {
  const { lo, hi } = bounds(element, elements, ledCount);
  const count = Math.max(0, element.stop - element.start);
  const length = formatNodeLength(count, spacingMm ?? null);
  function nudge(which: "start" | "end", delta: number) {
    dispatch({ type: "focus-set", id: element.id, what: which });
    dispatch({ type: "arrow", delta });
  }
  const word = issues[0]?.code;
  const before =
    element.start > lo ? `${element.start - lo} free before` : "touches the Segment before";
  const after =
    hi > element.stop
      ? `${hi - element.stop} free after`
      : element.stop >= ledCount
        ? "runs to the strip end"
        : "touches the Segment after";
  const stopBad = Boolean(word);
  const startBad = word === "invert" || word === "overlap";
  return (
    <>
      <div className="flex items-center gap-2.5">
        <span className="size-2.5 rounded-[3px]" style={{ background: word ? "#e07070" : hue }} />
        <Input
          value={element.label}
          aria-label="Segment label"
          onChange={(event) => dispatch({ type: "label", value: event.target.value })}
          className="h-[34px] flex-1 font-sans text-[15px] font-medium"
        />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Stepper
          label="Start · first LED"
          value={element.start}
          ariaLabel="Start, first LED, inclusive"
          invalid={startBad}
          onChange={(value) => dispatch({ type: "start", value })}
          onMinus={() => nudge("start", -1)}
          onPlus={() => nudge("start", 1)}
        />
        <Stepper
          label="Stop · after last LED"
          value={element.stop}
          ariaLabel="Stop, after last LED, exclusive"
          invalid={stopBad}
          labelClass={stopBad ? "text-destructive" : undefined}
          onChange={(value) => dispatch({ type: "stop", value })}
          onMinus={() => nudge("end", -1)}
          onPlus={() => nudge("end", 1)}
        />

      </div>
      <div className="flex flex-wrap gap-3 text-[12px]">
        <p className="basis-full text-muted-foreground">Saved Segment colour; Apply does not yet send this per-Segment colour to WLED.</p>
        <label>Saved Segment colour<br/><input aria-label="Saved Segment colour" type="color"
          value={element.color?.hex ?? hue} onChange={(event) => dispatch({ type: "color", hex: event.target.value })} /></label>
        <label>White channel (0–255)<br/><input aria-label="White channel" className="w-20 rounded border border-border bg-card px-2 py-1"
          type="number" min={0} max={255} value={element.color?.white ?? 0}
          onChange={(event) => dispatch({ type: "color", white: Number(event.target.value) })} /></label>
        {!element.color ? <span className="self-end text-muted-foreground">Legacy Segment: colour unset until chosen.</span> : null}
      </div>
      <div className="flex flex-wrap gap-3.5 text-[12px] text-muted-foreground">
        <span className="font-mono text-foreground">{count} LEDs{length ? ` · ${length}` : ""}</span>
        <span>{before}</span>
        <span>{after}</span>
      </div>
      {word ? <p className="text-[13px] text-destructive">{issueSentence(word, ledCount)}</p> : null}
      {issues.map((issue) => (
        <p key={`${issue.code}-${issue.start}-${issue.stop}`} className="text-[13px] text-destructive">
          {issue.message}
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-[12px]">
        <button type="button" className="h-[30px] rounded-md border border-input px-2" onClick={() => dispatch({ type: "duplicate" })}>Duplicate <span className="text-muted-foreground">D</span></button>
        <button type="button" className="h-[30px] rounded-md border border-input px-2 disabled:opacity-40" disabled={count < 2} onClick={() => dispatch({ type: "split-half" })}>Split in half <span className="text-muted-foreground">S</span></button>
        <button type="button" className="h-[30px] rounded-md border border-input px-2 disabled:opacity-40" disabled={cursor === null || cursor <= element.start || cursor >= element.stop} onClick={() => dispatch({ type: "cut-cursor" })}>Cut at cursor {cursor ?? "—"}</button>
        <button type="button" className="ml-auto h-[30px] px-2 text-destructive" onClick={() => dispatch({ type: "delete" })}>Delete <span className="text-muted-foreground">⌫</span></button>
      </div>
    </>
  );
}

function Stepper({
  label,
  value,
  ariaLabel,
  invalid,
  labelClass,
  onChange,
  onMinus,
  onPlus,
}: {
  label: string;
  value: number;
  ariaLabel: string;
  invalid: boolean;
  labelClass?: string;
  onChange: (value: number) => void;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className={`text-[12px] text-muted-foreground ${labelClass ?? ""}`}>{label}</span>
      <span
        className={`flex h-[34px] min-w-0 overflow-hidden rounded-md border bg-[#07080a] ${invalid ? "border-destructive" : "border-input"}`}
      >
        <button type="button" onClick={onMinus} aria-label={`Decrease ${label}`} className="w-7 border-r border-border text-muted-foreground">
          −
        </button>
        <input
          value={String(value)}
          inputMode="numeric"
          size={1}
          aria-label={ariaLabel}
          onChange={(event) => onChange(parseIndex(event.target.value, value))}
          className="min-w-0 flex-1 border-none bg-transparent text-center font-mono text-[13px] outline-none"
        />
        <button type="button" onClick={onPlus} aria-label={`Increase ${label}`} className="w-7 border-l border-border text-muted-foreground">
          +
        </button>
      </span>
    </label>
  );
}
