"use client";

import type { Element } from "@nightplot/shared";
import type { RangeIssue } from "@nightplot/shared";
import { Input } from "@/components/ui/input";
import { bounds, gaps, issueSentence, mergeCheck, parseIndex } from "./ops";
import type { EditorAction, EditorState } from "./use-editor-state";

export function ElementInspector({
  state,
  hues,
  issuesFor,
  dispatch,
}: {
  state: EditorState;
  hues: Record<string, string>;
  issuesFor: (id: string) => RangeIssue[];
  dispatch: (action: EditorAction) => void;
}) {
  const selected =
    state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
  const check = mergeCheck(state.els, state.sel);
  const runs = gaps(state.els, state.ledCount);
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-[#0e1014] p-4">
      {selected ? (
        <OneElement
          element={selected}
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
        </div>
      ) : null}
      {state.sel.length === 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[15px] font-medium">Nothing selected</span>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Click a Segment to select it. Drag across LEDs to select them, then choose New Segment. Use Pick LEDs (R) to select across existing Segments.
          </p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <span className="text-[12px] text-muted-foreground">Free LEDs</span>
        <div className="flex flex-wrap gap-1.5">
          {runs.map((run) => (
            <button
              key={`${run.start}-${run.stop}`}
              type="button"
              onClick={() => dispatch({ type: "add-gap", start: run.start, stop: run.stop })}
              className="inline-flex items-baseline gap-1.5 rounded-md border border-dashed border-[#3a4150] px-2 py-1"
            >
              <span className="font-mono text-[12px] text-[#c9c3b8]">
                {run.start}–{run.stop} · {run.stop - run.start}
              </span>
              <span className="text-[12px] text-primary">+ Add</span>
            </button>
          ))}
          {runs.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">Every LED is in a Segment.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OneElement({
  element,
  hue,
  issues,
  ledCount,
  elements,
  dispatch,
}: {
  element: Element;
  hue: string;
  issues: RangeIssue[];
  ledCount: number;
  elements: Element[];
  dispatch: (action: EditorAction) => void;
}) {
  const { lo, hi } = bounds(element, elements, ledCount);
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
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_70px] gap-2.5">
        <Stepper
          label="Start · first LED"
          value={element.start}
          ariaLabel="Start, first LED, inclusive"
          invalid={startBad}
          onChange={(value) => dispatch({ type: "start", value })}
          onMinus={() => dispatch({ type: "nudge", delta: -1, which: "start" })}
          onPlus={() => dispatch({ type: "nudge", delta: 1, which: "start" })}
        />
        <Stepper
          label="Stop · after last LED"
          value={element.stop}
          ariaLabel="Stop, after last LED, exclusive"
          invalid={stopBad}
          labelClass={stopBad ? "text-destructive" : undefined}
          onChange={(value) => dispatch({ type: "stop", value })}
          onMinus={() => dispatch({ type: "nudge", delta: -1, which: "end" })}
          onPlus={() => dispatch({ type: "nudge", delta: 1, which: "end" })}
        />
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[12px] text-muted-foreground">Length</span>
          <span className="flex h-[34px] items-center font-mono text-[13px] text-[#c9c3b8]">
            {element.stop > element.start ? element.stop - element.start : "—"}
          </span>
        </label>
      </div>
      <div className="flex gap-3.5 text-[12px] text-muted-foreground">
        <span>{before}</span>
        <span>{after}</span>
      </div>
      {word ? <p className="text-[13px] text-destructive">{issueSentence(word, ledCount)}</p> : null}
      {issues.map((issue) => (
        <p key={`${issue.code}-${issue.start}-${issue.stop}`} className="text-[13px] text-destructive">
          {issue.message}
        </p>
      ))}
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
        <button type="button" onClick={onMinus} className="w-7 border-r border-border text-muted-foreground">
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
        <button type="button" onClick={onPlus} className="w-7 border-l border-border text-muted-foreground">
          +
        </button>
      </span>
    </label>
  );
}
