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
import { CursorControls } from "@/components/elements-editor/cursor-controls";
import {
  assignHues,
  ELEMENT_HUES,
  elementAt,
  gapAt,
  gaps,
  edgeAt,
  issueWord,
  ordinal,
  type IssueWord,
} from "@/components/elements-editor/ops";
import { KeysBar } from "@/components/elements-editor/keys-bar";
import { EditorPopover } from "@/components/elements-editor/popover";
import { PhoneRemote } from "@/components/elements-editor/phone-remote";
import { PreviewRecovery } from "@/components/elements-editor/preview-recovery";
import { StripEditor } from "@/components/elements-editor/strip-editor";
import {
  useEditorState,
  type EditorAction,
  type EditorState,
} from "@/components/elements-editor/use-editor-state";
import { explainDrift } from "@/components/elements-editor/drift-copy";
import {
  COUNT_OFF_MAX_LEDS,
  drawingRange,
  locateFrame,
  locatePayloadKey,
  searchStep,
  useLiveLocate,
  type LocateMode,
} from "@/components/elements-editor/use-live-locate";
import { StripZoom } from "@/components/elements-editor/zoom";
import { SegmentBackupPanel } from "@/components/segment-backup";
import { Button } from "@/components/ui/button";
import { patchJson, postJson } from "@/lib/api";
import { displayBead, inspectPowerHow } from "@/lib/power-status";
import { cn } from "@/lib/utils";

type Busy = "save" | "refresh" | "apply" | "readdress" | "blink" | "recover" | null;

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
  const [locateMode, setLocateMode] = useState<LocateMode>("hold");
  const [searchRange, setSearchRange] = useState<{ start: number; stop: number } | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [backgroundPercent, setBackgroundPercent] = useState(60);
  const [hues, setHues] = useState<Record<string, string>>({});
  const unreachable = light.reachability === "no-answer";
  const [scanning, setScanning] = useState<1 | -1 | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);

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

  useEffect(() => {
    function stop(event: Event) {
      const ids = (event as CustomEvent<{ lightIds?: string[] }>).detail?.lightIds;
      if (!ids?.length || ids.includes(light.id)) {
        setLive(false);
        setSearchRange(null);
        setLocateMode("cursor");
      }
    }
    window.addEventListener("nightplot:all-off", stop);
    return () => window.removeEventListener("nightplot:all-off", stop);
  }, [light.id]);

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
    hoverIndex: locateMode === "cursor" && state.focus.kind === "sel" ? null : state.cursor,
    dragging: state.drag?.kind === "draw",
    drawing: drawingRange(state),
    ledSel: state.ledSel,
    element: one,
    hue: one ? (hues[one.id] ?? null) : null,
    mode: locateMode,
    elements: state.els,
    hues,
    backgroundPercent,
    searchRange,
  });
  const locate = useLiveLocate({
    enabled: live && !unreachable,
    lightId: light.id,
    ledCount: light.ledCount,
    frame,
    brightness: light.brightness,
    onDetail,
  });
  const searchReady = frame !== null && locate.acknowledgedKey === locatePayloadKey(frame, light.brightness)
    && !locate.error && !locate.stopping;
  const frozenPreview = detail.frozenPreview === true || (!recoveryNotice && locate.error?.code === "pixel-preview-frozen");

  const firstIssue = issues[0] ?? null;
  const applyReadyReason = frozenPreview ? "Recover the frozen LEDs before Apply." : applyRefuseReason({
    reachable: !unreachable,
    issueMessage: firstIssue?.message ?? null,
    elementCount: state.els.length,
    busyKind: detail.session?.kind === "blink" ? "blink" : null,
    previewIntent: false,
    segmentCount: light.segmentCount,
    segmentColor: typeof light.bead === "string" ? light.bead : null,
  });
  const canSave = dirtyCount > 0 && issues.length === 0 && busy === null;
  const canApply = applyReadyReason === null && busy === null && !locate.stopping && locate.error?.kind !== "end";
  const liveReason = unreachable
    ? previewRefuseReason({ reachable: false, hasTarget: true })
    : null;

  const applyFailed = Boolean(apply && !apply.matched);
  const segmentsUnknown = light.segmentCount === null;
  const driftLines = explainDrift(display);
  const showDrift =
    !applyFailed && !segmentsUnknown && !unreachable && rangeDriftPresent(display);
  const bannerOwnsReason = segmentsUnknown || (unreachable && !applyFailed && !showDrift);
  const read = describe(state, light.spacingMm, scanning);
  const zoom = zoomFocus(state);
  const wordFor = (id: string): IssueWord | undefined =>
    issueWord(issues.find((issue) => issue.elementId === id || issue.otherId === id)?.code);
  const issuesFor = (id: string): RangeIssue[] =>
    issues.filter((issue) => issue.elementId === id || issue.otherId === id);
  const barIssue = firstIssue
    ? `${state.els.find((element) => element.id === firstIssue.elementId)?.label ?? "Segment"}: ${issueWord(firstIssue.code) ?? firstIssue.code}`
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
    if (applyReadyReason) {
      onNotice(applyReadyReason);
      return;
    }
    if (dirtyCount > 0) {
      const saved = await save();
      if (!saved) return;
    }
    onBusy("apply");
    onNotice(null);
    if (live || locate.stopping || detail.session?.kind === "preview") {
      setLive(false);
      const restored = await locate.stop();
      if (!restored) {
        onBusy(null);
        onNotice("Preview could not be confirmed ended and restored. Apply was not sent. Refresh this Light to check its state, or use All Off.");
        return;
      }
      if (!live && detail.session?.kind === "preview" && !locate.stopping) {
        let ended;
        try {
          ended = await postJson<LightDetailPayload & { restored?: boolean }>(`/api/lights/${light.id}/preview/end`, {});
        } catch {
          onBusy(null);
          onNotice("Preview could not be confirmed ended. Apply was not sent.");
          return;
        }
        if ((!ended.ok && ended.status !== 404) || (ended.ok && ended.data.restored === false)) {
          onBusy(null);
          onNotice(!ended.ok ? ended.data.message ?? "Preview could not be restored. Apply was not sent." : "Preview could not be restored. Apply was not sent.");
          return;
        }
        if (ended.ok) onDetail(ended.data);
      }
    }
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
    if (unreachable || (frozenPreview && !live) || busy === "recover") return;
    setRecoveryNotice(null);
    if (live) {
      setSearchRange(null);
      setLocateMode("cursor");
    }
    setLive((current) => !current);
  }

  function openRemote() {
    dispatch({ type: "cursor-set", index: state.cursor ?? 0 });
    setSearchRange(null);
    setLocateMode("cursor");
    setRemoteOpen(true);
  }

  function closeRemote() {
    // Keep this editor mounted: its Preview sender finishes any in-flight hop,
    // then ends and reports a failed restore on the Segments page if needed.
    setLive(false);
    setRemoteOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentBackupPanel detail={detail} blocked={dirtyCount > 0 || live || busy !== null || Boolean(detail.session)}
        onRestored={(next) => { setApply(null); onDetail(next); }} />
      {remoteOpen ? <PhoneRemote
        lightName={light.name}
        ledCount={light.ledCount}
        cursor={state.cursor ?? 0}
        live={live && !unreachable}
        blocked={unreachable || frozenPreview || busy === "recover"}
        stopping={locate.stopping}
        error={locate.error?.message ?? null}
        onStep={(delta) => dispatch({ type: "cursor-step", delta })}
        onPreview={() => setLive(true)}
        onEnd={() => setLive(false)}
        onClose={closeRemote}
      /> : null}
      {frozenPreview ? <PreviewRecovery
        lightId={light.id}
        lightName={light.name}
        disabled={unreachable || busy !== null || locate.stopping}
        onBusy={(running) => onBusy(running ? "recover" : null)}
        onRecovered={(next, message) => {
          setLive(false);
          setRecoveryNotice(message);
          onDetail(next);
        }}
      /> : null}
      {recoveryNotice ? <p role="status" className="rounded-xl border border-online/40 px-4 py-3 text-[13px] text-online">{recoveryNotice}</p> : null}
      {applyFailed && apply ? (
        <ApplyFailed apply={apply} onAdopt={adopt} onRetry={() => void applyRanges()} />
      ) : segmentsUnknown ? (
        <div className="rounded-xl border border-border bg-[#12141a] px-4 py-3.5">
          <p className="text-[15px] font-medium">{display.notes[0]?.text ?? "Segments unknown"}</p>
          {applyReadyReason ? <p className="mt-1 text-[13px] text-destructive">{applyReadyReason}</p> : null}
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
            <p className="text-[15px] font-medium text-primary">Segments differ from the controller</p>
            <p className="text-[13px] text-[#c9c3b8]">{dirtyCount > 0 ? "Unsaved edits on this page. Save them first; Apply later if you want them on the controller." : "Your saved Segments stay as they are until you Apply."}</p>
            <details className="text-[13px] text-[#c9c3b8]">
              <summary className="w-fit cursor-pointer text-primary">Details</summary>
              <div className="mt-2 flex flex-col gap-1">
                {(driftLines.length > 0 ? driftLines : display.notes.map((note) => note.text)).map(
                  (line, index) => <p key={`${index}-${line}`}>{line}</p>,
                )}
              </div>
            </details>
          </div>
          <div className="flex gap-2 sm:ml-auto">
            <Button
              variant="outline"
              className="h-9 text-[13px]"
              onClick={adopt}
              disabled={display.reported.length === 0 || dirtyCount > 0 || busy !== null}
              title={dirtyCount > 0 ? "Save or revert your edits before using the controller’s ranges." : undefined}
            >
              Use controller’s
            </Button>
            <Button className="h-9 text-[13px]" onClick={() => void applyRanges()} disabled={!canApply} title={applyReadyReason ?? undefined}>
              {busy === "apply" ? "Applying…" : "Apply mine"}
            </Button>
          </div>
        </div>
      ) : null}

      <EditorToolbar state={state} dispatch={dispatch} />

      {locate.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/50 px-4 py-3 text-[13px]">
          <p className="flex-1 text-destructive">{locate.error.message}</p>
          {locate.error.notSent ? <Button variant="outline" className="h-9 text-[13px]" onClick={onRefresh} disabled={busy !== null}>Refresh</Button> : null}
          {live && !unreachable && locate.error.kind === "frame" && !locate.stopping ? (
            <Button variant="outline" className="h-9 text-[13px]" onClick={locate.retry} disabled={frozenPreview || busy !== null}>
              Retry Preview
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-[14px] border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <span className={cn("inline-flex h-7 min-w-[74px] items-center justify-center rounded-md px-2.5 font-mono text-[14px] font-medium", read.hot ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground")}>{read.chip}</span>
          <span className="min-w-0 flex-1 text-[13px] text-[#c9c3b8]">{read.text}</span>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-[12px]">
            <Button type="button" variant="outline" className="h-[34px] px-3 text-[13px]" onClick={openRemote} disabled={unreachable || frozenPreview || busy !== null}>
              Phone remote
            </Button>
            <Switch on={live && !unreachable} label="Light on strip" tone="online" disabled={unreachable || (frozenPreview && !live) || busy === "recover"} title={frozenPreview ? "Recover the frozen LEDs before starting Preview." : liveReason ?? undefined} onClick={toggleLive} />
            {live && !unreachable ? <EditorPopover label={locateMode === "hold" ? `Segments ${backgroundPercent}% · cursor bright` : locateMode === "count" ? "Count off · every 10th LED" : locateMode === "search" ? "Find an LED · halve the strip" : "Cursor only"} className="border-[#1f4a45] text-online">
              <div role="radiogroup" aria-label="Preview lighting" className="flex flex-col gap-3">
                {(["cursor", "hold", "count", "search"] as const).map((mode) => <label key={mode} className="flex items-start gap-2 text-[13px]">
                  <input type="radio" name={`preview-mode-${light.id}`} checked={locateMode === mode} disabled={mode === "count" && light.ledCount > COUNT_OFF_MAX_LEDS} onChange={() => {
                    setSearchRange(mode === "search" ? { start: 0, stop: light.ledCount } : null);
                    setLocateMode(mode);
                  }} className="mt-1 accent-[#7ee0d0]" />
                  <span>{mode === "cursor" ? "Cursor only" : mode === "hold" ? "Segments stay lit" : mode === "count" ? "Count off · every 10th LED" : "Find an LED · halve the strip"}<span className="mt-0.5 block text-[12px] text-muted-foreground">{mode === "cursor" ? "Only the cursor or selection lights." : mode === "hold" ? "Every Segment glows in its colour." : mode === "search" ? "At your physical spot, say if it lights up; each answer halves the search." : light.ledCount > COUNT_OFF_MAX_LEDS ? `Count off supports up to ${COUNT_OFF_MAX_LEDS} LEDs; this strip has ${light.ledCount}.` : "Count 10, 20, 30… from the first LED. Every tenth is bright; the rest glow dimly."}</span></span>
                </label>)}
              </div>
              {locateMode === "hold" ? <label className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="flex-1">Segment brightness</span><output className="font-mono">{backgroundPercent}%</output>
                <input type="range" min={0} max={100} step={5} value={backgroundPercent} aria-label="Segment brightness" aria-valuetext={`${backgroundPercent}%`} onChange={(event) => setBackgroundPercent(Number(event.target.value))} className="w-full accent-[#d4a574]" />
              </label> : null}
              <p className="mt-3 border-t border-border pt-3 text-[12px] leading-relaxed text-muted-foreground">This is a Preview. Nothing is saved, and turning it off restores the previous look.</p>
            </EditorPopover> : null}
          </div>
          {locate.stopping || locate.error || (live && detail.liveCaption) ? <p role="status" className="basis-full text-[12px] text-muted-foreground">
            {locate.stopping ? "Ending Preview…" : locate.error ? locate.error.notSent ? "Preview paused" : "Preview not confirmed" : detail.liveCaption}
          </p> : null}
        </div>
        {live && locateMode === "search" && searchRange ? <section aria-label="Find an LED" className="mx-5 mt-4 rounded-xl border border-primary/50 bg-[#15130f] p-4 text-[13px]">
          <p className="font-medium">Find the LED at your spot</p>
          {searchRange.stop - searchRange.start === 1 ? <p className="mt-2">Search narrowed to LED {searchRange.start} (counting from zero). {searchReady ? "It is lit in Preview." : locate.error ? "Preview is not confirmed; use Retry or End Preview." : "Waiting for Preview confirmation."}</p> : <>
            <p className="mt-2">Look at the spot you want to identify. Is an LED at that spot lit now? Checking LEDs {frame?.start}–{(frame?.stop ?? 1) - 1}.</p>
            {!searchReady ? <p role="status" className="mt-2 text-muted-foreground">{locate.error ? "Preview is not confirmed. Retry or End Preview before answering." : "Waiting for Preview confirmation before answering."}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={() => setSearchRange(searchStep(searchRange, true))} disabled={!searchReady}>Lit at my spot</Button>
              <Button type="button" variant="outline" onClick={() => setSearchRange(searchStep(searchRange, false))} disabled={!searchReady}>Not lit at my spot</Button>
            </div>
          </>}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={() => setSearchRange({ start: 0, stop: light.ledCount })}>Start over</Button>
            <Button type="button" variant="outline" onClick={() => { setSearchRange(null); setLocateMode("cursor"); }}>Leave search</Button>
          </div>
          <p className="mt-2 text-muted-foreground">Preview is temporary. End Preview restores; All Off cancels without restoring. No Segment is changed.</p>
        </section> : null}
        <div className="px-5 pt-4 pb-2">
        {one ? (
          <label className="mb-3 flex max-w-[460px] flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>Name selected Segment</span>
            <input
              aria-label="Name selected Segment"
              value={one.label}
              onChange={(event) => dispatch({ type: "label", value: event.target.value })}
              className="h-9 min-w-[180px] flex-1 rounded-md border border-input bg-[#07080a] px-3 text-[14px] text-foreground outline-none focus:border-primary"
            />
          </label>
        ) : null}
        <StripEditor
          svgId={`light-${light.id}`}
          label={`${light.name} strip, ${light.ledCount} LEDs, ${light.stripBead === "rgbw" ? "RGBW" : "RGB"}`}
          ledCount={light.ledCount}
          rgbw={light.stripBead === "rgbw"}
          state={state}
          hues={hues}
          issueWord={wordFor}
          resting={() => locate.error || locate.stopping ? "unknown" : displayBead(light)}
          live={live && !unreachable && !locate.error && !locate.stopping}
          frame={frame}
          liveLabel={live ? "Stop lighting" : "Light on strip"}
          onLive={toggleLive}
          dispatch={dispatch}
        />
        </div>
        <KeysBar state={state} hues={hues} live={live && !unreachable && !locate.error && !locate.stopping} spacingMm={light.spacingMm} />
        <CursorControls state={state} dispatch={dispatch} live={live} paused={remoteOpen} blocked={unreachable || frozenPreview || busy === "recover" || Boolean(locate.error) || locate.stopping} onPreview={() => setLive(true)} onScanning={setScanning} />
        <StripZoom ledCount={Math.max(light.ledCount, 1)} elements={state.els} hues={hues} issueWord={wordFor} focus={zoom.focus} edge={zoom.edge} caption={zoom.caption} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-start gap-3.5">
      <div className="min-w-0 overflow-x-auto rounded-[14px] border border-border bg-[#0e1014]">
        <div className="grid min-w-[310px] grid-cols-[10px_minmax(70px,1fr)_64px_34px_44px_44px] sm:grid-cols-[14px_minmax(0,1fr)_84px_44px_60px_56px] gap-1 border-b border-border px-3 sm:gap-2 sm:px-[18px] py-2.5 text-[12px] text-muted-foreground">
          <span />
          <span>Segment</span>
          <span>LEDs</span>
          <span>Count</span>
          <span>Length</span>
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
              const hue = word ? "#e07070" : (hues[element.id] ?? ELEMENT_HUES[0]);
              return (
                <button
                  key={element.id}
                  type="button"
                  onClick={(event) => dispatch({ type: "select-row", id: element.id, shift: event.shiftKey })}
                  className="grid w-full min-w-[310px] grid-cols-[10px_minmax(70px,1fr)_64px_34px_44px_44px] sm:grid-cols-[14px_minmax(0,1fr)_84px_44px_60px_56px] items-center gap-1 border-b border-border px-3 sm:gap-2 sm:px-[18px] py-3 text-left"
                  style={{
                    background: selected ? "#12141a" : "transparent",
                    boxShadow: selected ? `inset 2px 0 0 ${hue}` : "none",
                  }}
                >
                  <span className="size-2.5 rounded-[3px]" style={{ background: hue }} />
                  <span className="min-w-0 text-[13px] font-medium [overflow-wrap:anywhere]">{element.label}</span>
                  <span
                    className={cn("font-mono text-[13px]", word ? "text-destructive" : "text-[#c9c3b8]")}
                    title={length ? PHYSICAL_LENGTH_CAPTION : undefined}
                  >
                    {element.start}–{element.stop}
                  </span>
                  <span className="font-mono text-[12px] text-muted-foreground">{count || "—"}</span>
                  <span className="font-mono text-[12px] text-muted-foreground" title={length ? PHYSICAL_LENGTH_CAPTION : undefined}>{length ?? "—"}</span>
                  <span className={cn("text-[13px]", word ? "text-destructive" : "text-muted-foreground")}>
                    {selected ? (
                      <span className="sr-only" aria-label="Segment kind">
                        {word ?? "ok"}
                      </span>
                    ) : null}
                    {word ?? "ok"}
                  </span>
                </button>
              );
            })
        )}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12px]">
          <span className="text-muted-foreground">Free</span>
          {gaps(state.els, light.ledCount).map((run) => <button type="button" key={run.start} className="rounded-md border border-dashed border-[#3a4150] px-2 py-1" onClick={() => dispatch({ type: "add-gap", start: run.start, stop: run.stop })}>
            <span className="font-mono">{run.start}–{run.stop} · {run.stop - run.start}</span><span className="ml-1.5 text-primary">+ Add</span>
          </button>)}
          {gaps(state.els, light.ledCount).length === 0 ? <span className="text-muted-foreground">Every LED is in a Segment.</span> : null}
        </div>
      </div>

        <ElementInspector state={state} hues={hues} issuesFor={issuesFor} dispatch={dispatch} spacingMm={light.spacingMm} />
      </div>

      {notice ? <p className="text-[13px] text-destructive">{notice}</p> : null}
      {!bannerOwnsReason && applyReadyReason ? (
        <p className="text-[13px] text-destructive">{applyReadyReason}</p>
      ) : null}

      {dirtyCount > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-20 flex w-[min(1020px,calc(100%-48px))] -translate-x-1/2 flex-wrap items-center gap-2.5 rounded-xl border border-input bg-[#12141a] px-3.5 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
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
            {busy === "save" ? "Saving…" : "Save Segments"}
          </Button>
          <Button
            className="h-[34px] px-3 text-[13px]"
            onClick={() => void applyRanges()}
            disabled={!canApply}
            title={applyReadyReason ?? undefined}
          >
            {busy === "apply" ? "Applying…" : "Save & Apply"}
          </Button>
          {live ? <span className="basis-full text-[12px] text-muted-foreground">Save Segments keeps Preview on. Save & Apply ends Preview first.</span> : null}
        </div>
      ) : (
        <Button className="sr-only" aria-label="Apply" onClick={() => void applyRanges()} disabled={!canApply} title={applyReadyReason ?? undefined}>
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

function EditorToolbar({ state, dispatch }: { state: EditorState; dispatch: (action: EditorAction) => void }) {
  const hints = {
    locate: "The cursor follows the pointer. Nothing is edited.",
    select: "Click a Segment to shift it, or its first or last LED to grab that edge. Then use ← →.",
    range: "Click or drag any LEDs, even inside Segments. ← → grows the selection.",
    split: "Click inside a Segment to split it.",
  };
  return <div className="flex flex-wrap items-center gap-2.5">
    <div className="flex rounded-[9px] border border-input bg-[#12141a] p-[3px] text-[13px]">
      <ToolButton active={state.mode === "locate"} hint="L" onClick={() => dispatch({ type: "tool", mode: "locate" })}>Locate</ToolButton>
      <ToolButton active={state.mode === "select"} hint="V" onClick={() => dispatch({ type: "tool", mode: "select" })}>Select</ToolButton>
      <ToolButton active={state.mode === "range"} hint="R" onClick={() => dispatch({ type: "tool", mode: "range" })}>Pick LEDs</ToolButton>
      <ToolButton active={state.mode === "split"} hint="C" onClick={() => dispatch({ type: "tool", mode: "split" })}>Cut</ToolButton>
    </div>
    <span title={hints[state.mode]} className="min-w-48 flex-1 text-[12px] text-muted-foreground lg:truncate">{hints[state.mode]}</span>
    <div className="ml-auto flex items-center gap-3 text-[12px]">
      <button type="button" disabled={!state.hist.length} onClick={() => dispatch({ type: "undo" })} className="h-[30px] disabled:opacity-40">Undo</button>
      <button type="button" disabled={!state.fut.length} onClick={() => dispatch({ type: "redo" })} className="h-[30px] disabled:opacity-40">Redo</button>
      <span className="h-5 w-px bg-input" />
      <Switch on={state.snap} label="Snap to 5" tone="primary" onClick={() => dispatch({ type: "snap" })} />
      <EditorPopover label="Shortcuts">
        <div className="flex flex-col gap-2 text-[12px]">
          <Hint keys="L / V / R / C">Locate / Select / Pick LEDs / Cut</Hint>
          <Hint keys="← →">move the focus · Shift moves 10</Hint>
          <Hint keys="Tab / Shift Tab">cycle Segment and edges</Hint>
          <Hint keys="Alt / ⌥">detach a shared edge</Hint>
          <Hint keys="[ / ]">mark start / end</Hint>
          <Hint keys="N / Enter">new Segment / selection options</Hint>
          <Hint keys="D / S / M">duplicate / split in half / combine</Hint>
          <Hint keys="Space">scan / pause</Hint>
          <Hint keys="Home / End">strip start / end</Hint>
          <Hint keys="⌫ / Delete">delete selection</Hint>
          <Hint keys="Ctrl / ⌘ Z">undo · Shift to redo</Hint>
          <Hint keys="Esc">close options / step back / clear</Hint>
        </div>
      </EditorPopover>
    </div>
  </div>;
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
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 font-medium",
        active ? "bg-[#2f3542] text-foreground" : "text-muted-foreground",
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

function describe(state: EditorState, spacingMm: number | null, scanning: 1 | -1 | null): { chip: string; text: string; hot: boolean } {
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
        : "Point inside a Segment to cut it",
    };
  }
  const lengthOf = (count: number) => { const length = formatNodeLength(count, spacingMm); return length ? ` · ${length}` : ""; };
  if (state.hover && !state.keyMoved) {
    const found = elementAt(state.hover.idx, state.els);
    const edge = found ? edgeAt(state.hover.idx, found) : null;
    return { chip: `LED ${state.hover.idx}`, hot: false,
      text: found ? `${found.label} · ${ordinal(state.hover.idx - found.start + 1)} of ${found.stop - found.start}${state.mode === "locate" ? "" : edge ? ` · click to grab its ${edge === "start" ? "start" : "stop"} edge` : " · click to select"}`
        : `Free · run ${gapAt(state.hover.idx, state.els, state.ledCount).lo}–${gapAt(state.hover.idx, state.els, state.ledCount).hi}${state.mode === "locate" ? "" : " · click, then ← → to grow a selection"}` };
  }
  const focus = state.focus;
  const el = "id" in focus ? state.els.find((item) => item.id === focus.id) : null;
  if (el && focus.kind === "edge") return {
    chip: `${focus.which === "start" ? "start" : "stop"} ${focus.which === "start" ? el.start : el.stop}`, hot: true,
    text: `${el.label} ${el.start}–${el.stop} · ${el.stop - el.start} LEDs${lengthOf(el.stop - el.start)} · ${focus.which === "start" ? `first LED is ${el.start}` : `last LED is ${el.stop - 1}`}`,
  };
  if (el && focus.kind === "seg") return { chip: `${el.start}–${el.stop}`, hot: false, text: `${el.label} · ${el.stop - el.start} LEDs${lengthOf(el.stop - el.start)}` };
  if (state.ledSel && focus.kind === "sel") {
    const range = state.ledSel, count = range.stop - range.start;
    return { chip: `${count} LEDs`, hot: true, text: `${range.start}–${range.stop} selected${lengthOf(count)} · Enter for options` };
  }
  const cursor = state.cursor ?? 0;
  const here = elementAt(cursor, state.els);
  const gap = gapAt(cursor, state.els, state.ledCount);
  return { chip: `LED ${cursor}`, hot: false, text: `${scanning ? `Scanning ${scanning === 1 ? "forward" : "back"} · ` : ""}${here
    ? `${here.label} · ${ordinal(cursor - here.start + 1)} of ${here.stop - here.start}${lengthOf(cursor - here.start)}${spacingMm ? " in" : ""}`
    : `Free · run ${gap.lo}–${gap.hi} (${gap.hi - gap.lo} LEDs)`}` };
}

function zoomFocus(state: EditorState): { focus: number; edge: boolean; caption: string } {
  if (state.mode === "split" && state.hover) return { focus: state.hover.b, edge: true, caption: `cut at ${state.hover.b}` };
  const cursor = state.cursor ?? 0;
  return { focus: cursor, edge: false, caption: `around LED ${cursor}` };
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
          <span className="text-muted-foreground">Segment</span>
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
