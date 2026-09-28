"use client";

import {
  APPLY_UNKNOWN_SEGMENTS_MESSAGE,
  PHYSICAL_LENGTH_CAPTION,
  adoptControllerRangesReason,
  adoptReportedRanges,
  adoptableControllerRanges,
  applyRefuseReason,
  buildRangeDisplay,
  formatNodeLength,
  previewRefuseReason,
  reportedRangeRails,
  validateDeclaredRanges,
  type ApplyResult,
  type Element,
  type LightDetail as LightDetailPayload,
  type RangeIssue,
} from "@nightplot/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ElementInspector } from "@/components/elements-editor/inspector";
import {
  assignHues,
  elementAt,
  gapAt,
  issueWord,
  ordinal,
  type IssueWord,
} from "@/components/elements-editor/ops";
import { StripEditor } from "@/components/elements-editor/strip-editor";
import {
  useEditorState,
  type EditorAction,
  type EditorState,
} from "@/components/elements-editor/use-editor-state";
import { explainDrift } from "@/components/elements-editor/drift-copy";
import {
  drawingRange,
  locateFrame,
  useLiveLocate,
  type LocateMode,
} from "@/components/elements-editor/use-live-locate";
import { StripZoom } from "@/components/elements-editor/zoom";
import { Button } from "@/components/ui/button";
import { patchJson, postJson } from "@/lib/api";
import { displayBead, inspectPowerHow } from "@/lib/power-status";
import { cn } from "@/lib/utils";

type Busy = "save" | "refresh" | "apply" | "readdress" | "blink" | null;

export function ElementsPanel({
  detail,
  busy,
  notice,
  onBusy,
  onNotice,
  onDetail,
  onSettings,
  onRefresh,
}: {
  detail: LightDetailPayload;
  busy: Busy;
  notice: string | null;
  onBusy: (busy: Busy) => void;
  onNotice: (notice: string | null) => void;
  onDetail: (next: LightDetailPayload) => void;
  onSettings: () => void;
  onRefresh: () => void;
}) {
  const light = detail.light;
  const { state, dispatch, dirtyCount } = useEditorState(detail.elements, light.ledCount, light.id);
  const elsRef = useRef(state.els);
  elsRef.current = state.els;
  const [apply, setApply] = useState<ApplyResult | null>(null);
  const [live, setLive] = useState(false);
  const [locateMode, setLocateMode] = useState<LocateMode>("cursor");
  const [hues, setHues] = useState<Record<string, string>>({});
  const unreachable = light.reachability === "no-answer";

  useEffect(() => {
    setHues(readHues(light.id));
  }, [light.id]);

  useEffect(() => {
    const next = assignHues(state.els, hues);
    const same =
      Object.keys(next).length === Object.keys(hues).length &&
      Object.entries(next).every(([id, hue]) => hues[id] === hue);
    if (same) return;
    setHues(next);
    writeHues(light.id, next);
  }, [state.els, hues, light.id]);

  useEffect(() => {
    if (unreachable) setLive(false);
  }, [unreachable]);

  const issues = useMemo(
    () => validateDeclaredRanges(state.els, light.ledCount),
    [state.els, light.ledCount],
  );
  const display = useMemo(() => {
    const segmentsKnown = light.segmentCount !== null;
    const reported = unreachable || !segmentsKnown ? null : reportedRangeRails(detail.reported);
    return buildRangeDisplay(state.els, reported, issues, { reachable: !unreachable });
  }, [detail.reported, issues, light.segmentCount, state.els, unreachable]);

  const one =
    state.sel.length === 1 ? (state.els.find((element) => element.id === state.sel[0]) ?? null) : null;
  const frame = locateFrame({
    enabled: live && !unreachable,
    lightName: light.name,
    ledCount: light.ledCount,
    hoverIndex: state.hover?.idx ?? null,
    dragging: state.drag !== null,
    drawing: drawingRange(state),
    ledSel: state.ledSel,
    element: one,
    hue: one ? (hues[one.id] ?? null) : null,
    mode: locateMode,
    elements: state.els,
    hues,
  });
  useLiveLocate({
    enabled: live && !unreachable,
    lightId: light.id,
    ledCount: light.ledCount,
    frame,
    brightness: light.brightness,
    onDetail,
  });

  const firstIssue = issues[0] ?? null;
  const applyReason = applyRefuseReason({
    reachable: !unreachable,
    issueMessage: firstIssue?.message ?? null,
    elementCount: state.els.length,
    busyKind: detail.session?.kind ?? null,
    segmentCount: light.segmentCount,
    segmentColor: typeof light.bead === "string" ? light.bead : null,
  });
  const canSave = dirtyCount > 0 && issues.length === 0 && busy === null;
  const canApply = applyReason === null && busy === null;
  const liveReason = unreachable
    ? previewRefuseReason({ reachable: false, hasTarget: true })
    : null;

  const applyFailed = Boolean(apply && !apply.matched);
  const segmentsUnknown = light.segmentCount === null;
  const driftLines = explainDrift(display);
  const showDrift =
    !applyFailed && !segmentsUnknown && !unreachable && rangeDriftPresent(display);
  const bannerOwnsReason = segmentsUnknown || (unreachable && !applyFailed && !showDrift);
  const read = describe(state);
  const zoom = zoomFocus(state, one);
  const wordFor = (id: string): IssueWord | undefined =>
    issueWord(issues.find((issue) => issue.elementId === id || issue.otherId === id)?.code);
  const issuesFor = (id: string): RangeIssue[] =>
    issues.filter((issue) => issue.elementId === id || issue.otherId === id);
  const barIssue = firstIssue
    ? `${state.els.find((element) => element.id === firstIssue.elementId)?.label ?? "Element"}: ${issueWord(firstIssue.code) ?? firstIssue.code}`
    : null;

  async function save(): Promise<boolean> {
    if (!canSave) return false;
    onBusy("save");
    onNotice(null);
    const res = await patchJson<LightDetailPayload>(`/api/lights/${light.id}/elements`, {
      elements: payload(elsRef.current),
    });
    onBusy(null);
    if (!res.ok) {
      onNotice(res.data.message ?? "Draft was not saved.");
      return false;
    }
    onDetail(res.data);
    onRefresh();
    return true;
  }

  async function applyRanges() {
    if (applyReason) {
      onNotice(applyReason);
      return;
    }
    if (dirtyCount > 0) {
      const saved = await save();
      if (!saved) return;
    }
    onBusy("apply");
    onNotice(null);
    const res = await postJson<LightDetailPayload>(`/api/lights/${light.id}/apply`, {
      elements: payload(elsRef.current),
    });
    onBusy(null);
    const body = res.data as LightDetailPayload & { apply?: ApplyResult; message?: string };
    if (body.apply) setApply(body.apply);
    if (res.ok && body.apply?.matched) {
      onDetail(body);
      onRefresh();
      return;
    }
    if (res.status === 409 && body.light) {
      onDetail(body);
      return;
    }
    onNotice(body.message ?? body.apply?.message ?? "Apply did not succeed.");
  }

  function adopt() {
    const rails = apply ? adoptableControllerRanges(apply) : [];
    if (rails.length === 0) return;
    dispatch({ type: "replace", elements: adoptReportedRanges(state.els, rails) });
    setApply(null);
    onNotice(null);
    onDetail({
      ...detail,
      elements: detail.elements,
      reported: rails.map((rail) => ({ start: rail.start, stop: rail.stop, differs: false })),
      light: { ...detail.light, segmentCount: rails.length },
    });
  }

  function toggleLive() {
    if (unreachable) return;
    setLive((current) => !current);
  }

  return (
    <div className="flex flex-col gap-4">
      {applyFailed && apply ? (
        <ApplyFailed apply={apply} onAdopt={adopt} onRetry={() => void applyRanges()} />
      ) : segmentsUnknown ? (
        <div className="rounded-xl border border-border bg-[#12141a] px-4 py-3.5">
          <p className="text-[15px] font-medium">{display.notes[0]?.text ?? "Segments unknown"}</p>
          {applyReason ? <p className="mt-1 text-[13px] text-destructive">{applyReason}</p> : null}
        </div>
      ) : unreachable ? (
        <div className="rounded-xl border border-[#5a2f33] bg-[#1a1113] px-4 py-3.5">
          <p className="text-[15px] font-medium text-destructive">{inspectPowerHow(light)}</p>
          <button type="button" onClick={onSettings} className="mt-1 text-[13px] text-primary">
            Change address
          </button>
        </div>
      ) : showDrift ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/70 bg-[#15130f] px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-medium text-primary">The controller doesn’t match this page</p>
            {(driftLines.length > 0 ? driftLines : display.notes.map((note) => note.text)).map(
              (line, index) => (
                <p key={`${index}-${line}`} className="text-[13px] text-[#c9c3b8]">
                  {line}
                </p>
              ),
            )}
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="outline"
              className="h-9 text-[13px]"
              onClick={adopt}
              disabled={display.reported.length === 0 || busy !== null}
            >
              Use controller’s
            </Button>
            <Button className="h-9 text-[13px]" onClick={() => void applyRanges()} disabled={!canApply} title={applyReason ?? undefined}>
              {busy === "apply" ? "Applying…" : "Apply mine"}
            </Button>
          </div>
        </div>
      ) : null}

      <EditorToolbar
        state={state}
        dispatch={dispatch}
        live={live && !unreachable}
        liveDisabled={unreachable}
        liveReason={liveReason}
        locateMode={locateMode}
        onLocateMode={setLocateMode}
        onLive={toggleLive}
      />

      <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-5 pt-3.5 pb-3">
        <div className="flex min-h-7 items-center gap-3">
          <span
            className={cn(
              "inline-flex h-7 min-w-[74px] items-center justify-center rounded-md px-2.5 font-mono text-[14px] font-medium",
              read.hot ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            {read.chip}
          </span>
          <span className="text-[14px] text-[#c9c3b8]">{read.text}</span>
          <span className={cn("ml-auto text-[12px]", live && !unreachable ? "text-online" : "text-muted-foreground")}>
            {live && !unreachable
              ? (frame?.caption ?? "Preview on · pick something to light")
              : "Off · the strip keeps its look"}
            {live && detail.session?.kind === "preview" && detail.liveCaption ? (
              <span className="mt-0.5 block">{detail.liveCaption}</span>
            ) : null}
          </span>
        </div>
        <StripEditor
          svgId={`light-${light.id}`}
          label={`${light.name} strip, ${light.ledCount} LEDs, ${light.stripBead === "rgbw" ? "RGBW" : "RGB"}`}
          ledCount={light.ledCount}
          rgbw={light.stripBead === "rgbw"}
          state={state}
          hues={hues}
          issueWord={wordFor}
          resting={() => displayBead(light)}
          live={live && !unreachable}
          frame={frame}
          liveLabel={live ? "Stop lighting" : "Light on strip"}
          onLive={toggleLive}
          dispatch={dispatch}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <StripZoom
          ledCount={Math.max(light.ledCount, 1)}
          elements={state.els}
          hues={hues}
          issueWord={wordFor}
          focus={zoom.focus}
          edge={zoom.edge}
          caption={zoom.caption}
        />
        <ElementInspector state={state} hues={hues} issuesFor={issuesFor} dispatch={dispatch} />
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border bg-[#0e1014]">
        <div className="grid grid-cols-[18px_minmax(0,1.4fr)_120px_70px_minmax(0,1fr)] gap-3.5 border-b border-border px-[18px] py-2.5 text-[12px] text-muted-foreground">
          <span />
          <span>Element</span>
          <span>LEDs</span>
          <span>Count</span>
          <span>Check</span>
        </div>
        {state.els.length === 0 ? (
          <p className="px-[18px] py-3 text-[13px] text-muted-foreground">Nothing declared yet.</p>
        ) : (
          [...state.els]
            .sort((a, b) => a.start - b.start)
            .map((element) => {
              const word = wordFor(element.id);
              const count = element.stop > element.start ? element.stop - element.start : 0;
              const length = formatNodeLength(count, light.spacingMm);
              const selected = state.sel.includes(element.id);
              const hue = word ? "#e07070" : (hues[element.id] ?? "#d4a574");
              return (
                <button
                  key={element.id}
                  type="button"
                  onClick={(event) => dispatch({ type: "select-row", id: element.id, shift: event.shiftKey })}
                  className="grid w-full grid-cols-[18px_minmax(0,1.4fr)_120px_70px_minmax(0,1fr)] items-center gap-3.5 border-b border-border px-[18px] py-3 text-left"
                  style={{
                    background: selected ? "#12141a" : "transparent",
                    boxShadow: selected ? `inset 2px 0 0 ${hue}` : "none",
                  }}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: hue }} />
                  <span className="text-[15px] font-medium">{element.label}</span>
                  <span
                    className={cn("font-mono text-[13px]", word ? "text-destructive" : "text-[#c9c3b8]")}
                    title={length ? PHYSICAL_LENGTH_CAPTION : undefined}
                  >
                    {element.start}–{element.stop}
                    {length ? ` · ${length}` : ""}
                  </span>
                  <span className="font-mono text-[13px] text-muted-foreground">{count || "—"}</span>
                  <span className={cn("text-[13px]", word ? "text-destructive" : "text-muted-foreground")}>
                    {selected ? (
                      <span className="sr-only" aria-label="Element kind">
                        {word ?? "ok"}
                      </span>
                    ) : null}
                    {word ?? "ok"}
                  </span>
                </button>
              );
            })
        )}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
        <Hint keys="drag body">shift</Hint>
        <Hint keys="drag edge">resize</Hint>
        <Hint keys="drag free LEDs">select → options</Hint>
        <Hint keys="R">pick LEDs across Elements</Hint>
        <Hint keys="N">new Element from selection</Hint>
        <Hint keys="← →">nudge 1 · ⇧ 10</Hint>
        <Hint keys="⌘Z">undo</Hint>
      </div>

      {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!bannerOwnsReason && applyReason ? (
        <p className="text-[13px] text-destructive">{applyReason}</p>
      ) : null}

      {dirtyCount > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-20 flex w-[min(1020px,calc(100%-48px))] -translate-x-1/2 items-center gap-2.5 rounded-xl border border-input bg-[#12141a] px-3.5 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
          <span className="text-[14px] text-primary">
            {dirtyCount} unsaved change{dirtyCount === 1 ? "" : "s"}
          </span>
          {barIssue ? <span className="text-[13px] text-destructive">{barIssue}</span> : null}
          <button
            type="button"
            onClick={() => dispatch({ type: "revert" })}
            className="ml-auto text-[13px] text-muted-foreground"
          >
            Revert
          </button>
          <Button variant="outline" className="h-[34px] px-3 text-[13px]" onClick={() => void save()} disabled={!canSave}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            className="h-[34px] px-3 text-[13px]"
            onClick={() => void applyRanges()}
            disabled={!canApply}
            title={applyReason ?? undefined}
          >
            {busy === "apply" ? "Applying…" : "Save & Apply"}
          </Button>
        </div>
      ) : (
        <Button className="sr-only" aria-label="Apply" onClick={() => void applyRanges()} disabled={!canApply} title={applyReason ?? undefined}>
          Apply
        </Button>
      )}

      {state.toast ? (
        <div className="fixed top-[72px] left-1/2 z-20 -translate-x-1/2 rounded-lg border border-[#3a4150] bg-[#12141a] px-3.5 py-2 text-[13px] shadow-[0_12px_30px_rgba(0,0,0,0.5)]">
          {state.toast}
        </div>
      ) : null}
    </div>
  );
}

function EditorToolbar({
  state,
  dispatch,
  live,
  liveDisabled,
  liveReason,
  locateMode,
  onLocateMode,
  onLive,
}: {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  live: boolean;
  liveDisabled: boolean;
  liveReason: string | null;
  locateMode: LocateMode;
  onLocateMode: (mode: LocateMode) => void;
  onLive: () => void;
}) {
  const one = state.sel.length === 1 ? state.els.find((element) => element.id === state.sel[0]) : null;
  const mergeOk = state.sel.length > 1 && mergeReady(state);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-[9px] border border-input bg-[#12141a] p-[3px] text-[13px]">
        <ToolButton active={state.mode === "select"} hint="V" onClick={() => dispatch({ type: "tool", mode: "select" })}>
          Select
        </ToolButton>
        <ToolButton active={state.mode === "range"} hint="R" onClick={() => dispatch({ type: "tool", mode: "range" })}>
          Pick LEDs
        </ToolButton>
        <ToolButton active={state.mode === "split"} hint="C" onClick={() => dispatch({ type: "tool", mode: "split" })}>
          Cut
        </ToolButton>
      </div>
      <span className="mx-1 h-6 w-px bg-input" />
      <ActionButton hint="D" disabled={!one} onClick={() => dispatch({ type: "duplicate" })}>
        Duplicate
      </ActionButton>
      <ActionButton
        hint="S"
        disabled={!one || one.stop - one.start < 2}
        onClick={() => dispatch({ type: "split-half" })}
      >
        Split in half
      </ActionButton>
      <ActionButton hint="M" disabled={!mergeOk} onClick={() => dispatch({ type: "merge" })}>
        Combine
      </ActionButton>
      <ActionButton
        hint="⌫"
        disabled={state.sel.length === 0 && !state.ledSel}
        className="text-destructive"
        onClick={() => dispatch({ type: state.ledSel ? "remove-from" : "delete" })}
      >
        Delete
      </ActionButton>
      <span className="mx-1 h-6 w-px bg-input" />
      <button
        type="button"
        disabled={state.hist.length === 0}
        onClick={() => dispatch({ type: "undo" })}
        className="h-[34px] px-2.5 text-[13px] text-[#c9c3b8] disabled:opacity-40"
      >
        Undo
      </button>
      <button
        type="button"
        disabled={state.fut.length === 0}
        onClick={() => dispatch({ type: "redo" })}
        className="h-[34px] px-2.5 text-[13px] text-[#c9c3b8] disabled:opacity-40"
      >
        Redo
      </button>
      <div className="ml-auto flex items-center gap-4 text-[13px] text-[#c9c3b8]">
        <Switch on={state.snap} label="Snap to 5" tone="primary" onClick={() => dispatch({ type: "snap" })} />
        {!liveDisabled ? (
          <div className="flex rounded-md border border-input p-0.5 text-[12px]" role="group" aria-label="What Show lights">
            <button
              type="button"
              aria-pressed={locateMode === "cursor"}
              onClick={() => onLocateMode("cursor")}
              className={cn(
                "rounded px-2 py-1",
                locateMode === "cursor" ? "bg-[#2f3542] text-foreground" : "text-muted-foreground",
              )}
            >
              Cursor only
            </button>
            <button
              type="button"
              aria-pressed={locateMode === "hold"}
              onClick={() => onLocateMode("hold")}
              className={cn(
                "rounded px-2 py-1",
                locateMode === "hold" ? "bg-[#2f3542] text-foreground" : "text-muted-foreground",
              )}
            >
              Elements stay lit
            </button>
          </div>
        ) : null}
        <Switch
          on={live}
          label="Show on the real strip"
          tone="online"
          disabled={liveDisabled}
          title={liveReason ?? undefined}
          onClick={onLive}
        />
      </div>
      {liveReason ? <p className="basis-full text-[12px] text-destructive">{liveReason}</p> : null}
    </div>
  );
}

function mergeReady(state: EditorState): boolean {
  if (state.sel.length < 2) return false;
  const chosen = state.els.filter((element) => state.sel.includes(element.id));
  if (chosen.length < 2) return false;
  const start = Math.min(...chosen.map((element) => element.start));
  const stop = Math.max(...chosen.map((element) => element.stop));
  return !state.els.some(
    (element) => !state.sel.includes(element.id) && element.start < stop && element.stop > start,
  );
}

function ToolButton({
  active,
  hint,
  onClick,
  children,
}: {
  active: boolean;
  hint: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium",
        active ? "bg-[#2f3542] text-foreground" : "text-muted-foreground",
      )}
    >
      {children}
      <span className="font-mono text-[11px] font-normal text-muted-foreground">{hint}</span>
    </button>
  );
}

function ActionButton({
  hint,
  disabled,
  className,
  onClick,
  children,
}: {
  hint: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-[34px] items-center gap-2 rounded-lg border border-input px-3 text-[13px] font-semibold disabled:opacity-40",
        className,
      )}
    >
      {children}
      <span className="font-mono text-[11px] font-normal text-muted-foreground">{hint}</span>
    </button>
  );
}

function Switch({
  on,
  label,
  tone,
  disabled,
  title,
  onClick,
}: {
  on: boolean;
  label: string;
  tone: "primary" | "online";
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-2 disabled:opacity-40"
    >
      <span
        className={cn(
          "relative h-[18px] w-[30px] rounded-full",
          on ? (tone === "online" ? "bg-online" : "bg-primary") : "bg-input",
        )}
      >
        <span
          className="absolute top-[3px] size-3 rounded-full"
          style={{ left: on ? 15 : 3, background: on ? "#0c0d10" : "#9a9488" }}
        />
      </span>
      {label}
    </button>
  );
}

function Hint({ keys, children }: { keys: string; children: string }) {
  return (
    <span>
      <span className="font-mono text-[#c9c3b8]">{keys}</span> {children}
    </span>
  );
}

function describe(state: EditorState): { chip: string; text: string; hot: boolean } {
  const drag = state.drag;
  const dragEl = drag && "id" in drag ? state.els.find((element) => element.id === drag.id) : null;
  if (drag && dragEl && drag.kind !== "draw") {
    const length = dragEl.stop - dragEl.start;
    if (drag.kind === "move") {
      const delta = dragEl.start - drag.orig.start;
      return {
        chip: `${delta >= 0 ? "+" : ""}${delta}`,
        hot: true,
        text: `Shifting ${dragEl.label} · ${dragEl.start}–${dragEl.stop} · ${length} LEDs`,
      };
    }
    const delta = length - (drag.orig.stop - drag.orig.start);
    return {
      chip: String(drag.kind === "start" ? dragEl.start : dragEl.stop),
      hot: true,
      text: `Resizing ${dragEl.label} · ${dragEl.start}–${dragEl.stop} · ${length} LEDs (${delta >= 0 ? "+" : ""}${delta})`,
    };
  }
  if (drag?.kind === "draw" && state.draftRange) {
    const count = state.draftRange.stop - state.draftRange.start;
    return {
      chip: `${count} LED${count === 1 ? "" : "s"}`,
      hot: true,
      text: `Selecting ${state.draftRange.start}–${state.draftRange.stop} · let go for options`,
    };
  }
  if (state.hover && state.mode === "split") {
    const found = elementAt(state.hover.idx, state.els);
    const inside = found && state.hover.b > found.start && state.hover.b < found.stop;
    return {
      chip: `cut ${state.hover.b}`,
      hot: false,
      text: inside
        ? `Click to split ${found.label} into ${found.start}–${state.hover.b} and ${state.hover.b}–${found.stop}`
        : "Point inside an Element to cut it",
    };
  }
  if (state.hover) {
    const found = elementAt(state.hover.idx, state.els);
    if (found) {
      return {
        chip: `LED ${state.hover.idx}`,
        hot: false,
        text: `${found.label} · ${ordinal(state.hover.idx - found.start + 1)} of ${found.stop - found.start} · row ${state.hover.r + 1}, position ${(state.hover.idx % 100) + 1}`,
      };
    }
    const gap = gapAt(state.hover.idx, state.els, state.ledCount);
    return {
      chip: `LED ${state.hover.idx}`,
      hot: false,
      text: `Free · run ${gap.lo}–${gap.hi} (${gap.hi - gap.lo} LEDs)${state.ledSel ? ` · shift-click to extend to ${state.hover.idx}` : " · drag to select LEDs"}`,
    };
  }
  if (state.ledSel) {
    const count = state.ledSel.stop - state.ledSel.start;
    return {
      chip: `${count} LED${count === 1 ? "" : "s"}`,
      hot: true,
      text: `${state.ledSel.start}–${state.ledSel.stop} selected · shift-click to extend · Esc to clear`,
    };
  }
  return {
    chip: "—",
    hot: false,
    text: "Hover the strip to read an LED. Drag across free LEDs to add an Element.",
  };
}

function zoomFocus(
  state: EditorState,
  one: Element | null,
): { focus: number; edge: boolean; caption: string } {
  const drag = state.drag;
  const dragEl = drag && drag.kind !== "draw" ? state.els.find((element) => element.id === drag.id) : null;
  if (state.drag && dragEl && (state.drag.kind === "start" || state.drag.kind === "end")) {
    const focus = state.drag.kind === "start" ? dragEl.start : dragEl.stop;
    return { focus, edge: true, caption: `${state.drag.kind === "start" ? "start" : "stop"} edge at ${focus}` };
  }
  if (state.hover) {
    const focus = state.mode === "split" ? state.hover.b : state.hover.idx;
    return {
      focus,
      edge: state.mode === "split",
      caption: state.mode === "split" ? `cut at ${focus}` : `around LED ${focus}`,
    };
  }
  if (state.ledSel) {
    return { focus: state.ledSel.start, edge: true, caption: `selection start at ${state.ledSel.start}` };
  }
  if (one) return { focus: one.start, edge: true, caption: `${one.label} start edge at ${one.start}` };
  return { focus: 0, edge: false, caption: "around LED 0" };
}

function payload(elements: Element[]) {
  return elements.map((element) => ({
    id: element.id,
    label: element.label,
    start: element.start,
    stop: element.stop,
  }));
}

function rangeDriftPresent(display: {
  declared: { differs: boolean }[];
  reported: { differs: boolean }[];
  regions: { kind: string }[];
}): boolean {
  return (
    display.declared.some((rail) => rail.differs) ||
    display.reported.some((rail) => rail.differs) ||
    display.regions.some((region) => region.kind === "drift")
  );
}

function hueKey(lightId: string): string {
  return `nightplot:element-hues:${lightId}`;
}

function readHues(lightId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(hueKey(lightId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeHues(lightId: string, hues: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(hueKey(lightId), JSON.stringify(hues));
  } catch {
    /* display-only */
  }
}

function ApplyFailed({
  apply,
  onAdopt,
  onRetry,
}: {
  apply: ApplyResult;
  onAdopt: () => void;
  onRetry: () => void;
}) {
  const adoptReason = adoptControllerRangesReason(apply);
  const unknownReread = apply.read === null || apply.message === APPLY_UNKNOWN_SEGMENTS_MESSAGE;
  const rows =
    apply.rows.length > 0
      ? apply.rows
      : apply.sent.map((item) => ({
          label: item.label,
          sent: { start: item.start, stop: item.stop },
          read: null,
          matched: false,
        }));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#5a2f33] bg-[#1a1113] px-4 py-3.5">
      <span className="text-[15px] font-medium text-destructive">{apply.message}</span>
      {rows.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1.2fr)_auto_auto] gap-x-3 gap-y-1 text-[13px]">
          <span className="text-muted-foreground">Element</span>
          <span className="text-muted-foreground">Sent</span>
          <span className="text-muted-foreground">Read back</span>
          {rows.map((row) => (
            <div key={`${row.label}-${row.sent.start}`} className="contents">
              <span>{row.label}</span>
              <span className="font-mono">
                {row.sent.start}–{row.sent.stop}
              </span>
              <span className={cn("font-mono", row.matched ? undefined : "text-destructive")}>
                {row.read ? `${row.read.start}–${row.read.stop}` : unknownReread ? "unknown" : "nothing"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[13px] text-[#c9c3b8]">
        {unknownReread ? "Your draft is kept." : "Your draft is kept. Nothing else on the controller changed."}
      </p>
      <p className="text-[13px] text-primary">{apply.caption}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-9 text-[13px]"
          onClick={onAdopt}
          disabled={adoptReason !== null}
          title={adoptReason ?? undefined}
        >
          Use controller’s
        </Button>
        <Button className="h-9 text-[13px]" onClick={onRetry}>
          Apply again
        </Button>
      </div>
      {adoptReason ? <p className="text-[12px] text-muted-foreground">{adoptReason}</p> : null}
    </div>
  );
}
